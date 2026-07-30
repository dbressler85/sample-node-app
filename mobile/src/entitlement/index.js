import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ENFORCE_PRO } from '../config';
import { api } from '../api';
import { deriveTier, canUse, TRIAL_DAYS } from './core';
import * as billing from './billing';
import { presentPaywall } from './paywallBus';
import { _setAccountEntitlementHandlers } from './accountBus';

// The entitlement React layer: loads the reverse-trial clock + store subscription, derives the tier via
// the pure core, and exposes it to the app. Enforcement is OFF by default (ENFORCE_PRO) so this is fully
// INERT — it computes tier/trial and renders the paywall UI, but every gate passes — until billing +
// licensing are ready and EXPO_PUBLIC_ENFORCE_PRO=1 is set.

const TRIAL_KEY = 'dc_trial_started_v1'; // device-level, like the welcome flag; the reverse trial begins on first launch

const Ctx = createContext(null);

export function EntitlementProvider({ children }) {
  const [trialStartedAt, setTrialStartedAt] = useState(null);
  const [subscribed, setSubscribed] = useState(false);
  const [comped, setComped] = useState(false); // server whitelist (owner/comped friend), from /api/me
  const [ready, setReady] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Account-level comp: App calls refreshEntitlementAccount() after a login lands (and resets on
  // logout), since App renders this provider and can't consume its context. We read /api/me — guarded
  // so a pre-login mount never fires an unauthenticated request. Fail-soft: any error → not comped.
  useEffect(() => {
    _setAccountEntitlementHandlers({
      refresh: async () => {
        try {
          const me = await api.me();
          setComped(!!(me && me.pro));
        } catch (e) {
          /* not logged in yet / unreachable → not comped */
        }
      },
      reset: () => setComped(false),
    });
    return () => _setAccountEntitlementHandlers(null);
  }, []);

  // Boot: start (or read) the reverse-trial clock, configure billing, read the current entitlement.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let started = await AsyncStorage.getItem(TRIAL_KEY);
        if (!started) {
          started = String(Date.now());
          await AsyncStorage.setItem(TRIAL_KEY, started); // reverse trial: full Pro from first launch
        }
        if (alive) setTrialStartedAt(Number(started));
      } catch (e) {
        /* storage down → trial simply unstarted; enforcement is off by default anyway */
      }
      try {
        await billing.configure();
        const info = await billing.getCustomerInfo();
        if (alive) setSubscribed(!!info.subscribed);
      } catch (e) {
        /* billing unavailable → treat as not subscribed */
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Re-evaluate the trial boundary hourly so a lapse flips isPro without needing a relaunch.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const info = await billing.getCustomerInfo();
      setSubscribed(!!info.subscribed);
    } catch (e) {
      /* keep prior state */
    }
    setNowTick(Date.now());
  }, []);

  const purchase = useCallback(async (planId) => {
    const info = await billing.purchase(planId);
    setSubscribed(!!info.subscribed);
    return info;
  }, []);

  const restore = useCallback(async () => {
    const info = await billing.restore();
    setSubscribed(!!info.subscribed);
    return info;
  }, []);

  const tier = useMemo(
    () => deriveTier({ comped, subscribed, trialStartedAt, now: nowTick, trialDays: TRIAL_DAYS }),
    [comped, subscribed, trialStartedAt, nowTick]
  );

  const value = useMemo(
    () => ({
      ready,
      enforced: ENFORCE_PRO,
      isPro: tier.isPro,
      tier: tier.tier,
      reason: tier.reason, // 'subscribed' | 'trial' | 'expired' | 'none'
      trial: tier.trial, // { started, inTrial, daysLeft, endsAt }
      can: (action) => canUse(action, { isPro: tier.isPro, enforced: ENFORCE_PRO }),
      refresh,
      purchase,
      restore,
    }),
    [ready, tier, refresh, purchase, restore]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Fallback used when a component renders outside the provider (e.g. in isolation): fail OPEN — the layer
// is dormant by default, so "no provider" must never accidentally lock the app.
const OPEN = {
  ready: true,
  enforced: false,
  isPro: true,
  tier: 'pro',
  reason: 'no-provider',
  trial: { started: false, inTrial: false, daysLeft: TRIAL_DAYS, endsAt: null },
  can: () => true,
  refresh: async () => {},
  purchase: async () => {},
  restore: async () => {},
};

export function useEntitlement() {
  return useContext(Ctx) || OPEN;
}

// Imperative gate for action call sites. Returns true when allowed (Pro, in trial, or enforcement off);
// when blocked it returns false AND surfaces the paywall. Canonical use:
//   const requirePro = useRequirePro();
//   onPress={() => { if (!requirePro('waivers.file')) return; fileClaim(); }}
export function useRequirePro() {
  const { can, isPro, reason, trial } = useEntitlement();
  return useCallback(
    (action, source) => {
      if (can(action)) return true;
      presentPaywall({ action, source, isPro, reason, trial });
      return false;
    },
    [can, isPro, reason, trial]
  );
}
