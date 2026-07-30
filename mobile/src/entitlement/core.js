// Entitlement core — the single source of truth for the free/Pro line and the reverse-trial math.
//
// PURE and dependency-free (no react-native import), exactly like theme.js, so it loads in plain node
// for unit tests. The React layer (./index.js) wraps this; screens gate actions through it:
//
//     const requirePro = useRequirePro();
//     onPress={() => { if (!requirePro('waivers.file')) return; fileClaim(); }}
//
// The product line (see the PO decision): READS are free (the all-leagues, read-only cockpit); the
// ACT + AUTOMATE layer is Pro. A handful of personal writes stay free on purpose (FREE_ACTIONS).

export const TRIAL_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

// The Pro action registry — the 🔒 "act + automate across leagues" rows. Key → the short label the
// paywall shows ("<label> is a Pro feature"). Anything NOT listed here is free (all reads included).
export const PRO_ACTIONS = {
  'lineup.apply': 'One-tap Set-All lineups',
  'waivers.file': 'Filing waiver claims',
  'waivers.wizard': 'The cross-league Waiver Wizard',
  'trades.suggest': 'The trade suggester',
  'trades.propose': 'Proposing, accepting & countering trades in-app',
  'draft.pick': 'Making draft picks in-app',
  'notifications.premium': 'Trade, waiver & lineup notifications',
};

// Explicit FREE overrides — writes we deliberately keep free: personal state that costs nothing and
// keeps free users active for re-conversion, plus the safety-critical on-the-clock alert (paywalling
// it would mean a free user misses a pick and blames the app). Listed so the line is documented.
export const FREE_ACTIONS = {
  'watchlist.toggle': true,
  'tags.set': true,
  'notifications.onClock': true,
};

export function isGatedAction(action) {
  return Object.prototype.hasOwnProperty.call(PRO_ACTIONS, action);
}

export function actionLabel(action) {
  return PRO_ACTIONS[action] || 'This';
}

// Reverse-trial status from the stored start time. `started` is false until the clock is set (first
// authed launch). daysLeft is a ceil so a user 6.2 days in still reads "1 day left", floored at 0.
export function trialStatus(now, trialStartedAt, trialDays = TRIAL_DAYS) {
  if (!trialStartedAt) return { started: false, inTrial: false, daysLeft: trialDays, endsAt: null };
  const endsAt = trialStartedAt + trialDays * DAY_MS;
  const remaining = endsAt - now;
  return {
    started: true,
    inTrial: remaining > 0,
    daysLeft: Math.max(0, Math.ceil(remaining / DAY_MS)),
    endsAt,
  };
}

// The tier decision. An active paid entitlement (`subscribed`, from the store) always wins; otherwise
// the reverse trial grants Pro until it lapses; then free. `reason` powers copy + analytics:
//   'subscribed' → paid · 'trial' → in the 7-day full-access trial · 'expired' → trial ended · 'none' → trial never started.
export function deriveTier({ subscribed = false, trialStartedAt = null, now, trialDays = TRIAL_DAYS }) {
  const trial = trialStatus(now, trialStartedAt, trialDays);
  if (subscribed) return { tier: 'pro', isPro: true, reason: 'subscribed', trial };
  if (trial.inTrial) return { tier: 'pro', isPro: true, reason: 'trial', trial };
  return { tier: 'free', isPro: false, reason: trial.started ? 'expired' : 'none', trial };
}

// Can this action run? `enforced` is false by default (until billing is live), which makes EVERYTHING
// allowed — so the whole layer is inert in production until EXPO_PUBLIC_ENFORCE_PRO=1 is set. When
// enforced: reads + FREE_ACTIONS are always allowed; gated actions require Pro.
export function canUse(action, { isPro, enforced }) {
  if (!enforced) return true;
  if (FREE_ACTIONS[action]) return true;
  if (!isGatedAction(action)) return true; // reads + anything not explicitly gated
  return !!isPro;
}
