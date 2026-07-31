import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { draftsPreferDevice, leagueTriagePreferDevice, portfolioPreferDevice, bestAvailablePreferDevice } from '../mflDevice';
import { getValue, setValue, onCacheInvalidate } from '../cache';
import { primeResource } from '../useCachedResource';
import { colors } from '../theme';
import { displayLabel } from '../typography';
import { ScreenTitle } from '../components/Brand';
import Pulse from '../components/Pulse';
import PressableScale from '../components/PressableScale';
import AnimatedNumber from '../components/AnimatedNumber';
import NavTools from '../components/NavTools';
import NeonSign from '../components/NeonSign';
import OutlookDonut from '../components/OutlookDonut';

const CONCURRENCY = 4;
// Background-warm concurrency: deliberately LOW (2, vs the 4 the visible cards get) so the after-cards
// warm queue never floods MFL's budget — a real tap during warming competes with at most 2 background
// reads, and the queue is ordered so the most-likely-tapped board warms first.
const WARM_CONCURRENCY = 2;

// A draft belongs on the Home action list only if it needs you soon: you're on the
// clock, it's live, or it starts within ~3 days. Everything else lives in the Hub.
const DRAFT_SOON_MS = 3 * 24 * 60 * 60 * 1000;
function isDraftActionable(d) {
  if (!d || !d.status || d.status === 'none' || d.status === 'complete') return false;
  if (d.myOnClock || d.status === 'in_progress') return true;
  if (d.status === 'scheduled' && d.startTime) {
    const t = new Date(d.startTime).getTime();
    return !Number.isNaN(t) && t - Date.now() < DRAFT_SOON_MS;
  }
  return false;
}

// Draft pick notation: round.pick (e.g. 4.05 = round 4, 5th pick), not round.overall.
function pickCode(p) {
  return `${p.round}.${String(p.pick).padStart(2, '0')}`;
}
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// Picks until MY next pick: 0 when I'm on the clock, else (my next overall − the current pick on the
// clock). Infinity when I have no upcoming pick or the draft isn't live — those sort last within the
// live group. Drives both the "N away" label and the live-draft ranking.
function picksUntilMine(d) {
  if (d.myOnClock) return 0;
  const cur = d.currentPick && d.currentPick.overall;
  const mine = d.myNextPick && d.myNextPick.overall;
  if (cur != null && mine != null && mine >= cur) return mine - cur;
  return Number.POSITIVE_INFINITY;
}

// Home draft order: live drafts first (the one where your pick is closest on top → farthest), then
// scheduled (soonest start → latest). A scheduled draft with no known start sinks to the bottom.
function sortHomeDrafts(list) {
  const isLive = (d) => d.myOnClock || d.status === 'in_progress';
  return [...list].sort((a, b) => {
    const la = isLive(a);
    const lb = isLive(b);
    if (la !== lb) return la ? -1 : 1;
    if (la) {
      const pa = picksUntilMine(a);
      const pb = picksUntilMine(b);
      return pa === pb ? 0 : pa - pb;
    }
    const ta = a.startTime ? new Date(a.startTime).getTime() : Infinity;
    const tb = b.startTime ? new Date(b.startTime).getTime() : Infinity;
    return ta - tb;
  });
}

// Live-draft subtitle: the current pick on the clock vs. your next pick, with how many picks away it
// is — so at a glance you know whose turn it is and how soon you're up.
function liveDraftSub(d) {
  const cur = d.currentPick;
  const mine = d.myNextPick;
  if (cur && mine && mine.overall >= cur.overall) {
    // "on the clock" reads as round.pick (e.g. 2.01) to match "yours 2.07" — consistent notation.
    return `${pickCode(cur)} on the clock · yours ${pickCode(mine)} · ${mine.overall - cur.overall} away`;
  }
  if (cur && !mine) return `${pickCode(cur)} on the clock · no picks left for you`;
  if (mine) return `Live · your pick ${pickCode(mine)} · ${ordinal(mine.overall)} overall`;
  return `Live · ${d.picksMade || 0} picks made`;
}

// Compact countdown for a trade deadline (ms epoch) → { label, urgent }. Urgent (≤7 days out)
// tints the chip so a near deadline reads at a glance.
function deadlineChip(at) {
  const days = Math.ceil((at - Date.now()) / 86400000);
  const label = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`;
  return { label, urgent: days <= 7 };
}

// Run `worker` over items with limited concurrency.
async function runPool(items, limit, worker) {
  let idx = 0;
  const next = async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

// Home is unmounted every time an overlay covers it (the Draft Hub, Trade inbox, a player
// profile) and remounted on back. This module-level snapshot survives that remount so
// returning repaints the last-known Home instantly — no boot spinner, no full reload — and,
// crucially, a transient backend hiccup on re-entry can't blank a Home that was already
// populated. `at` gates the throttle: a reload only re-runs once the data has gone stale.
let homeCache = { leagues: null, statuses: null, drafts: null, onDeck: null, watchAlerts: null, at: 0 };
let refreshInFlight = false; // guards the fan-out across remounts (a per-mount ref can't)
// Generation token for the fire-and-forget background warm queue. The warm queue outlives warmHome
// (refreshInFlight clears before it drains), so a return-to-Home starts a fresh 15-league triage
// fan-out while the PRIOR run's warms — the app's heaviest reads (portfolio, free agents, rankings,
// boards) — are still hammering the backend, and the two compete for MFL's per-IP budget so the
// visible cards stall ("Updating 0/15" frozen for 30s+). Bumping this on each warmHome makes the old
// queue's workers bail before their next read, handing budget back to the new visible fan-out.
let warmGen = 0;
// How long the cross-league Home triage stays "fresh" before a passive return (from an overlay/tab)
// re-fans-out all your leagues. Kept generous — dynasty triage doesn't change second to second, and
// any ACTION you take (set lineup, file claim, make a pick) resets this to 0 via onCacheInvalidate, so
// post-action returns still refresh immediately. Only idle back-and-forth navigation is spared the
// full fan-out (it just repaints the cached Home). Matches the backend roster cache TTL (5m).
const HOME_STALE_MS = 5 * 60 * 1000;

// After any write, mark Home's snapshot stale so returning to it refetches the triage rather
// than showing pre-action state through the throttle (keep the values for an instant paint).
onCacheInvalidate(() => { homeCache.at = 0; });

// Live subscribers (mounted HomeScreens). warmHome() streams each field update to them so a fan-out
// kicked off BEFORE HomeScreen mounts (at login — see warmHome) still flows into the screen's state
// once it mounts, instead of only landing in the silent snapshot.
const homeListeners = new Set();
function subscribeHome(fn) { homeListeners.add(fn); return () => homeListeners.delete(fn); }
function patchHome(patch) {
  Object.assign(homeCache, patch);
  for (const fn of homeListeners) fn(patch);
}

// Clear the in-memory snapshot on logout / session loss so the next account never sees the
// previous one's Home. Called from App alongside the on-disk cache clear.
export function resetHomeCache() {
  homeCache = { leagues: null, statuses: null, drafts: null, onDeck: null, watchAlerts: null, at: 0 };
  refreshInFlight = false;
}

// Reflect a just-made draft pick on Home INSTANTLY, without waiting on the slow full fan-out. The
// board response's `onClock` is the NEXT slot after your pick, so the picked league drops off "on the
// clock" the moment the pick API returns — the row keeps showing (the draft's still live) but loses the
// PICK pill. The write already marked Home stale (invalidateCaches → homeCache.at=0), so the background
// refetch on return still reconciles the rest (statuses, the Under Center tile, your next pick).
export function applyPickToHome(leagueId, board) {
  if (!homeCache.drafts) return;
  const oc = board && board.onClock;
  const next = homeCache.drafts.map((d) =>
    d.leagueId === leagueId
      ? { ...d, myOnClock: !!(oc && oc.mine), currentPick: oc ? { overall: oc.overall, round: oc.round, pick: oc.pick } : d.currentPick }
      : d);
  patchHome({ drafts: sortHomeDrafts(next) });
}

// THE Home fan-out, as a module function so it can start BEFORE HomeScreen mounts. App fires this
// the instant login succeeds (handleLoggedIn) — so the ~2s login ceremony, the first-run welcome
// modal, and the push-permission prompt are all spent LOADING the cross-league triage instead of
// sitting idle until the user finishes with them. Results stream to homeCache + disk + any mounted
// HomeScreen (via patchHome). Guarded by refreshInFlight so App's login kick and HomeScreen's own
// mount/focus refresh can't double-run it. Fail-soft throughout.
export async function warmHome() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  // Supersede any prior run's still-draining warm queue so it stops competing with THIS fan-out's
  // visible league-card reads for MFL budget.
  warmGen += 1;
  const myGen = warmGen;
  patchHome({ busy: true, error: null });
  try {
    const res = await api.leaguesList();
    // Home reflects all of the account's leagues, already pinned-first from the server.
    const list = (res.leagues || []).map((l) => ({ leagueId: l.leagueId, name: l.name }));
    patchHome({ leagues: list });
    setValue('leagues', list);

    // Drafts / On Deck / Watchlist alerts — independent background reads (fail-soft), written through
    // to the shared caches so opening those views from Home paints instantly. prime the IN-MEMORY store
    // too (not just disk): Draft Hub / On Deck read via useCachedResource, and without an in-memory hit
    // they take the cold path and re-run the whole cross-league fan-out seconds after Home already did.
    // Capture drafts + On Deck so the warm queue below can pre-warm the SPECIFIC boards you're most
    // likely to tap next (the on-the-clock draft, an imminent waiver run), not just the generic tabs.
    const draftsP = draftsPreferDevice().then((d) => { const f = sortHomeDrafts((d.drafts || []).filter(isDraftActionable)); patchHome({ drafts: f }); setValue('drafts', d); primeResource('drafts', d); return d; }).catch(() => null);
    const onDeckP = api.onDeck().then((d) => { patchHome({ onDeck: d }); setValue('ondeck', d); primeResource('ondeck', d); return d; }).catch(() => null);
    api.watchlistAlerts().then((r) => { patchHome({ watchAlerts: r.alerts || [] }); }).catch(() => {});

    // Seed from the last-known statuses so a RE-fan-out (returning to Home) revalidates IN PLACE —
    // each league's tile/outlook updates as its fresh read lands, and nothing ever drops back to a
    // blank/zero state mid-refresh. Cold start (no prior statuses) seeds empty and fills 0→N as before.
    const collected = { ...(homeCache.statuses || {}) };
    patchHome({ progress: { done: Object.keys(collected).length, total: list.length } });
    await runPool(list, CONCURRENCY, async (lg) => {
      try {
        const t = await leagueTriagePreferDevice(lg.leagueId);
        collected[lg.leagueId] = { name: t.name, status: t.status, items: t.items, phase: t.phase, dynasty: t.dynasty, tradeDeadline: t.tradeDeadline };
      } catch (e) {
        collected[lg.leagueId] = { name: lg.name, status: 'error', items: [] };
      }
      // Emit the accumulating map (a fresh object each time so React re-renders) + progress.
      patchHome({ statuses: { ...collected }, progress: { done: Object.keys(collected).length, total: list.length } });
    });
    // Keep only current leagues, then persist + stamp the refresh so a quick overlay return repaints.
    const pruned = {};
    for (const lg of list) if (collected[lg.leagueId]) pruned[lg.leagueId] = collected[lg.leagueId];
    patchHome({ statuses: pruned, at: Date.now() });
    setValue('statuses', pruned);

    // Only NOW (visible league cards loaded) warm the heavy screens the user opens next — the cards had
    // first claim on MFL's budget; these must not have stolen it. Run them as a PRIORITY QUEUE at low
    // concurrency (WARM_CONCURRENCY), NOT a simultaneous burst, so a real tap during warming competes
    // with at most 2 background reads. Order = most likely-tapped / most time-sensitive first, so if the
    // queue is preempted by a tap, the important boards are already warm. Each primes memory (+ disk)
    // under the exact key its screen reads (rankKey ends …:1qb:std; draft/waiver boards per league), so
    // the open paints from cache instead of a blank spinner.
    const [draftsData, onDeckData] = await Promise.all([draftsP, onDeckP]);
    const actionable = draftsData ? (draftsData.drafts || []).filter(isDraftActionable) : [];
    const deckItems = (onDeckData && onDeckData.items) || [];
    const warms = [];
    const pushDraft = (d) => warms.push({ key: `draft:${d.leagueId}`, run: () => api.leagueDraft(d.leagueId) });
    actionable.filter((d) => d.myOnClock).forEach(pushDraft); // 1) on the clock → THE next tap
    for (const it of deckItems.filter((i) => i.type === 'waiver_run' && i.replacements)) { // 2) imminent waiver runs
      const r = it.replacements;
      const position = r.positions && r.positions.length === 1 ? r.positions[0] : null;
      const sort = r.sort || 'projection';
      warms.push({ key: `waivers:board:${r.leagueId}:${position || 'all'}:${sort}`, run: () => api.waiverBoard(r.leagueId, { position, sort }) });
    }
    warms.push({ key: 'players:rankings:value:all:1qb:std', run: () => api.playerRankings('value', null, '1qb') }); // 3) most-browsed tab
    actionable.filter((d) => !d.myOnClock && d.status === 'in_progress').forEach(pushDraft); // 4) other live drafts
    warms.push({ key: 'portfolio', run: () => portfolioPreferDevice() }); // 5) steady dashboards, last
    warms.push({ key: 'players:free', run: () => bestAvailablePreferDevice() });
    const seen = new Set();
    const queue = warms.filter((w) => (seen.has(w.key) ? false : seen.add(w.key))); // de-dupe by key
    // Fire-and-forget (not awaited) so warmHome finishes as soon as the cards are done; the queue keeps
    // warming in the background at low priority. Each worker bails the instant a newer warmHome bumps
    // warmGen, so a stale queue never steals budget from the next visible fan-out.
    runPool(queue, WARM_CONCURRENCY, async (w) => {
      if (myGen !== warmGen) return; // superseded before we started this item — skip it
      try { const v = await w.run(); if (myGen !== warmGen) return; setValue(w.key, v); primeResource(w.key, v); } catch (e) { /* warm is best-effort */ }
    });
  } catch (e) {
    patchHome({ error: e.message });
  } finally {
    patchHome({ progress: null, busy: false });
    refreshInFlight = false;
  }
}

export default function HomeScreen({ active = true, demoMode, onOpenLineup, onOpenLeague, onOpenLeagues, onOpenPortfolio, onOpenWaivers, onOpenTrades, onOpenTradeInbox, onOpenDraft, onOpenDraftHub, onOpenOnDeck, onOpenPlayer, onOpenSettings, onOpenProfile, onLogout }) {
  const [leagues, setLeagues] = useState(homeCache.leagues || []);
  const [statuses, setStatuses] = useState(homeCache.statuses || {}); // leagueId -> { name, status, items }
  const [drafts, setDrafts] = useState(homeCache.drafts || []); // only ACTIONABLE drafts (on the clock / live / imminent)
  const [onDeck, setOnDeck] = useState(homeCache.onDeck || null); // time-sorted deadlines across leagues
  const [watchAlerts, setWatchAlerts] = useState(homeCache.watchAlerts || []); // watched players now free / on the block
  const [showAllWatch, setShowAllWatch] = useState(false); // Watchlist section: show all vs. the first few
  // A watched player free/on-the-block in several leagues arrives as one alert PER league — group them
  // to one row per player so the list doesn't repeat the same name.
  const watchGroups = useMemo(() => {
    const map = new Map();
    for (const a of watchAlerts) {
      const key = `${a.playerId}:${a.type}`;
      if (!map.has(key)) map.set(key, { playerId: a.playerId, name: a.name, type: a.type, leagues: [] });
      map.get(key).leagues.push(a.leagueName);
    }
    return [...map.values()];
  }, [watchAlerts]);
  const [progress, setProgress] = useState(null); // { done, total }
  const [error, setError] = useState(null);
  const [booting, setBooting] = useState(!homeCache.leagues); // in-memory data → paint immediately, no spinner
  const [busy, setBusy] = useState(false); // a refresh cycle is in flight

  // 1) Instant paint from disk cache, then always revalidate in the background.
  // The refresh is non-blocking (paints cached immediately, updates when ready) and
  // the backend now serves repeat league reads from cache, so this stays cheap —
  // and, crucially, always reflects an action just taken in an overlay (a set
  // lineup, a submitted claim) rather than showing stale triage.
  useEffect(() => {
    (async () => {
      // Cold start (no in-memory snapshot): paint the last session's data from disk.
      // Warm remount (returning from an overlay): state was already seeded from homeCache,
      // so skip the disk read and the boot spinner entirely.
      if (!homeCache.leagues) {
        const [cachedLeagues, cachedStatuses] = await Promise.all([getValue('leagues'), getValue('statuses')]);
        if (cachedLeagues) setLeagues(cachedLeagues);
        if (cachedStatuses) setStatuses(cachedStatuses);
        setBooting(false);
      }
      // Only re-run the heavy cross-league fan-out when the data has actually gone stale.
      // Returning from an overlay within the window repaints the cached triage instantly and
      // does NOT reload — so a transient hiccup on re-entry can't blank an already-good Home.
      if (Date.now() - homeCache.at > HOME_STALE_MS) refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep-alive tabs: Home stays MOUNTED when you switch away, so the mount effect above no longer
  // re-runs on return. Re-run the staleness check on the FOCUS edge (active false→true) — a write
  // in another tab/overlay resets homeCache.at to 0 (onCacheInvalidate), so this gives the same
  // post-action refresh that a remount used to. A quick switch away and back (still fresh) no-ops.
  const wasActiveRef = useRef(active);
  useEffect(() => {
    if (active && !wasActiveRef.current && Date.now() - homeCache.at > HOME_STALE_MS) refresh();
    wasActiveRef.current = active;
  }, [active, refresh]);

  // 2) Refresh delegates to the module-level warmHome() — the SAME fan-out App also kicks off at
  // login. warmHome streams its field updates to the subscription effect below (and to homeCache +
  // disk), and self-guards against double-running, so this is safe to call from mount/focus even if
  // a login-time warm is already in flight.
  const refresh = useCallback(() => { warmHome(); }, []);

  // Adopt warmHome's streaming updates — whether it was started here (mount/focus) or by App at
  // login before this screen mounted. Each patch carries only the fields that changed.
  useEffect(() => {
    const off = subscribeHome((patch) => {
      if ('leagues' in patch) setLeagues(patch.leagues);
      if ('statuses' in patch) setStatuses(patch.statuses);
      if ('drafts' in patch) setDrafts(patch.drafts);
      if ('onDeck' in patch) setOnDeck(patch.onDeck);
      if ('watchAlerts' in patch) setWatchAlerts(patch.watchAlerts);
      if ('progress' in patch) setProgress(patch.progress);
      if ('error' in patch) setError(patch.error);
      if ('busy' in patch) setBusy(patch.busy);
      if ('leagues' in patch || 'statuses' in patch) setBooting(false);
    });
    return off;
  }, []);

  // Derive everything from the (current) leagues + their statuses.
  const { portfolio, phase } = useMemo(() => {
    const vals = leagues.map((l) => statuses[l.leagueId]).filter(Boolean);
    const items = vals.flatMap((v) => v.items || []);
    const ph = (vals.find((v) => v.phase) || {}).phase || 'in_season';
    const dyn = vals.map((v) => v.dynasty).filter(Boolean);
    return {
      phase: ph,
      allItems: items,
      portfolio: {
        leagues: leagues.length,
        injuries: vals.filter((v) => v.status === 'risk').length,
        holes: vals.filter((v) => v.status === 'incomplete').length,
        lineupsToSet: vals.filter((v) => v.status === 'unset').length,
        tradeOffers: items.filter((i) => i.type === 'trade_offer').length,
        waiversPending: items.filter((i) => i.type === 'waiver_pending').length,
        // Outlook blends roster strength (value vs the league) with core age; the four buckets are
        // exhaustive over the leagues we could CLASSIFY. A league whose roster read dropped carries no
        // dynasty (dyn filters it out), so the four buckets can sum short of the league count — surface
        // that shortfall as `outlookUnknown` instead of letting the numbers silently not add up.
        contenders: dyn.filter((d) => d.outlook === 'Win-now window').length,
        ascending: dyn.filter((d) => d.outlook === 'Ascending').length,
        rebuilding: dyn.filter((d) => d.outlook === 'Rebuilding').length,
        balanced: dyn.filter((d) => d.outlook === 'Balanced').length,
        outlookUnknown: Math.max(0, leagues.length - dyn.length),
        actionItems: items.length,
      },
    };
  }, [leagues, statuses]);

  // Leagues with an upcoming trade deadline, soonest first — drives the "Trade deadlines" section.
  const deadlineLeagues = useMemo(() => {
    const now = Date.now();
    return leagues
      .map((l) => ({ leagueId: l.leagueId, name: (statuses[l.leagueId] || {}).name || l.name, dl: (statuses[l.leagueId] || {}).tradeDeadline }))
      .filter((x) => x.dl && x.dl.at > now)
      .sort((a, b) => a.dl.at - b.dl.at);
  }, [leagues, statuses]);

  if (booting) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const loading = !!progress && progress.done < progress.total;
  // The portfolio summary is only trustworthy once every current league has
  // reported. Until then (a fresh load with no cache), show a spinner in place
  // of the aggregate counts rather than a misleading run of zeroes. When we have
  // cached data, statuses are already complete, so numbers update in place.
  const summaryLoading = busy && !(leagues.length > 0 && leagues.every((l) => statuses[l.leagueId]));

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <View>
          <ScreenTitle focused={active}>Command Center</ScreenTitle>
          <Text style={styles.subtitle}>
            {loading
              ? `Updating ${progress.done}/${progress.total}…`
              : `${portfolio.leagues} leagues${phase === 'offseason' ? ' · Offseason' : ''}${demoMode ? ' · DEMO' : ''}`}
          </Text>
        </View>
        <NavTools />
      </View>

      <FlatList
        data={[]}
        keyExtractor={(_, i) => `x-${i}`}
        renderItem={null}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.accent} />}
        ListHeaderComponent={
          <View>
            <Portfolio
              p={portfolio}
              phase={phase}
              loading={summaryLoading}
              onLeagues={onOpenLeagues}
              onPortfolio={onOpenPortfolio}
              onOpenOnDeck={onOpenOnDeck}
              onDeck={onDeck}
            />
            {drafts.length ? (
              <View>
                <Pressable style={styles.sectionRow} onPress={onOpenDraftHub}>
                  <Text style={[styles.section, displayLabel()]}>Drafts · {drafts.length}</Text>
                  <Text style={styles.sectionLink}>Hub ›</Text>
                </Pressable>
                {drafts.map((d) => (
                  <Pressable
                    key={d.leagueId}
                    style={({ pressed }) => [styles.draftRow, d.myOnClock && styles.draftRowLive, pressed && { opacity: 0.7 }]}
                    onPress={() => onOpenDraft({ leagueId: d.leagueId, name: d.name })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.draftName} numberOfLines={1}>{d.name}</Text>
                      <Text style={styles.draftSub} numberOfLines={1}>
                        {d.myOnClock
                          ? `You're on the clock${d.currentPick ? ` · ${pickCode(d.currentPick)} (${ordinal(d.currentPick.overall)})` : ''}`
                          : d.status === 'in_progress'
                          ? liveDraftSub(d)
                          : d.status === 'scheduled'
                          ? `Scheduled${d.startTime ? ` · ${new Date(d.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}`
                          : d.status}
                      </Text>
                    </View>
                    {d.myOnClock ? <Pulse><Text style={styles.draftPill}>PICK</Text></Pulse> : <Text style={styles.teamChev}>›</Text>}
                  </Pressable>
                ))}
              </View>
            ) : null}
            {deadlineLeagues.length ? (
              <View>
                <Text style={[styles.section, displayLabel()]}>Trade deadlines · {deadlineLeagues.length}</Text>
                {deadlineLeagues.map((x) => {
                  const c = deadlineChip(x.dl.at);
                  return (
                    <Pressable
                      key={x.leagueId}
                      style={({ pressed }) => [styles.deadlineRow, pressed && { opacity: 0.7 }]}
                      onPress={() => onOpenTrades({ leagueId: x.leagueId, name: x.name })}
                    >
                      <View style={styles.deadlineIcon}><NeonSign grade="inline" glyph="hourglass" color="warn" size={18} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.deadlineName} numberOfLines={1}>{x.name}</Text>
                        <Text style={styles.deadlineSub} numberOfLines={1}>Last day to trade · {x.dl.date}</Text>
                      </View>
                      <Text style={[styles.deadlinePill, c.urgent && styles.deadlinePillUrgent]}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {watchGroups.length ? (
              <View>
                <Text style={[styles.section, displayLabel()]}>Watchlist · {watchGroups.length}</Text>
                {(showAllWatch ? watchGroups : watchGroups.slice(0, 6)).map((g, i) => (
                  <Pressable
                    key={`${g.playerId}-${g.type}-${i}`}
                    style={({ pressed }) => [styles.watchRow, pressed && { opacity: 0.7 }]}
                    onPress={() => onOpenPlayer(g.playerId)}
                  >
                    <View style={styles.watchIcon}><NeonSign grade="inline" glyph="star" color="watch" size={18} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.watchName} numberOfLines={1}>{g.name}</Text>
                      <Text style={[styles.watchSub, g.type === 'free' && { color: colors.good }]} numberOfLines={1}>
                        {g.type === 'free' ? 'Now a free agent' : 'On the block'} in {g.leagues.length === 1 ? g.leagues[0] : `${g.leagues.length} leagues`}
                      </Text>
                    </View>
                    <Text style={styles.teamChev}>›</Text>
                  </Pressable>
                ))}
                {watchGroups.length > 6 ? (
                  <Pressable
                    style={({ pressed }) => [styles.viewAll, pressed && { opacity: 0.7 }]}
                    onPress={() => setShowAllWatch((v) => !v)}
                  >
                    <Text style={styles.viewAllText}>
                      {showAllWatch ? 'Show less' : `View all ${watchGroups.length}`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.inboxRow, pressed && { opacity: 0.7 }]}
              onPress={onOpenTradeInbox}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.inboxTitleRow}>
                  <NeonSign grade="inline" glyph={portfolio.tradeOffers ? 'tray' : 'swap'} color="accent" size={15} />
                  <Text style={styles.inboxName}>{portfolio.tradeOffers ? 'Trade inbox' : 'Trades'}</Text>
                </View>
                <Text style={styles.inboxSub} numberOfLines={1}>
                  {portfolio.tradeOffers
                    ? `${portfolio.tradeOffers} offer${portfolio.tradeOffers === 1 ? '' : 's'} across your leagues`
                    : 'Review offers or propose a trade in any league'}
                </Text>
              </View>
              <Text style={styles.teamChev}>›</Text>
            </Pressable>
            {/* Only surface a refresh failure when we have nothing to fall back on. If Home is
                already populated (cache or a prior good load), a transient backend hiccup stays
                silent rather than replacing a working screen with a scary error + zeros. */}
            {error && leagues.length === 0 ? <Text style={styles.error}>{error}</Text> : null}
            {onDeck && onDeck.summary && onDeck.summary.actions === 0 && !loading ? (
              <View style={styles.clearRow}>
                <NeonSign grade="inline" glyph="check" color="good" size={16} />
                <Text style={styles.clear}>Nothing needs you right now.</Text>
              </View>
            ) : null}
          </View>
        }
      />

      {/* "Needs attention" is now folded into On Deck (the tile + the On Deck row both open it),
          so there's no separate bottom-sheet feed here anymore. */}
    </View>
  );
}

function Portfolio({ p, phase, loading, onLeagues, onPortfolio, onOpenOnDeck, onDeck }) {
  const offseason = phase === 'offseason';
  // On Deck tile headlines what actually needs you (actions), not scheduled/already-done status —
  // sourced from On Deck itself so the count always matches what you see when you open it.
  const actions = onDeck && onDeck.summary ? onDeck.summary.actions : null;
  const onClock = !!(onDeck && onDeck.summary && onDeck.summary.onClock > 0);
  // The Leagues count is known as soon as the league list loads, so keep it live.
  return (
    <View style={styles.portfolio}>
      <View style={styles.tileRow}>
        <Tile label="Leagues ›" value={String(p.leagues)} loading={loading && !p.leagues} onPress={onLeagues} />
        <Tile
          label="Under Center ›"
          value={actions != null ? String(actions) : '—'}
          accent={actions > 0}
          gold={onClock}
          loading={!onDeck}
          onPress={onOpenOnDeck}
        />
      </View>
      {/* Portfolio glance: the team-outlook distribution as a donut, tapping anywhere into the
          Portfolio. Replaces the old text banner + the row of per-mode count chips. */}
      <PortfolioCard p={p} loading={loading} onPortfolio={onPortfolio} />
      {/* In-season, keep the urgent action counts (these aren't outlook "modes"). */}
      {!offseason ? (
        <View style={styles.chips}>
          <Chip label="Lineups to set" value={p.lineupsToSet} warn={p.lineupsToSet > 0} loading={loading} />
          <Chip label="Holes" value={p.holes} bad={p.holes > 0} loading={loading} />
          <Chip label="Injuries" value={p.injuries} bad={p.injuries > 0} loading={loading} />
        </View>
      ) : null}
    </View>
  );
}

// The team-outlook modes, in the CVD-validated categorical order (see OutlookDonut / PortfolioScreen).
const HOME_MODES = [
  { key: 'contenders', label: 'Win now', color: colors.warn },
  { key: 'ascending', label: 'Ascending', color: colors.good },
  { key: 'balanced', label: 'Balanced', color: colors.accent },
  { key: 'rebuilding', label: 'Rebuilding', color: colors.bad },
];

// Portfolio glance card: outlook-distribution donut + legend + "understand your holdings" caption; the
// whole tile taps into the Portfolio. Replaces the old banner + per-mode count chips.
function PortfolioCard({ p, loading, onPortfolio }) {
  const segments = HOME_MODES.map((m) => ({ key: m.key, color: m.color, value: p[m.key] || 0 }));
  const resolved = segments.reduce((s, x) => s + x.value, 0);
  const unread = p.outlookUnknown || 0;
  // Show the distribution once EVERY league is in, and KEEP showing it during a background refresh —
  // gating on data-completeness (not the `loading` flag) so returning to Home doesn't blank a donut
  // that's already complete. A genuinely partial/first load stays on the placeholder.
  const ready = unread === 0 && resolved > 0;
  return (
    <PressableScale style={styles.portCard} onPress={onPortfolio} accessibilityRole="button" accessibilityLabel="Open your portfolio">
      {ready ? (
        <OutlookDonut segments={segments} size={92} stroke={14} centerTop={resolved} centerBottom={resolved === 1 ? 'team' : 'teams'} />
      ) : (
        <View style={styles.portDonutLoading}><ActivityIndicator color={colors.accent} /></View>
      )}
      <View style={styles.portCardBody}>
        <Text style={styles.portCardTitle}>Portfolio</Text>
        <Text style={styles.portCardSub}>Understand your holdings ›</Text>
        {ready ? (
          <View style={styles.portLegend}>
            {HOME_MODES.map((m) => (
              <View key={m.key} style={styles.portLegendItem}>
                <View style={[styles.portLegendDot, { backgroundColor: m.color }]} />
                <Text style={styles.portLegendLabel} numberOfLines={1}>{m.label}</Text>
                <Text style={styles.portLegendCount}>{p[m.key] || 0}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.portUnread}>
            {loading ? 'Building your outlook across your leagues…' : `${Math.max(0, p.leagues - unread)} of ${p.leagues} leagues loaded — pull to refresh`}
          </Text>
        )}
      </View>
    </PressableScale>
  );
}

function Tile({ label, value, accent, gold, loading, onPress }) {
  const num = Number(value);
  const isNum = value != null && value !== '' && !Number.isNaN(num);
  const valStyle = [styles.tileValue, accent && { color: colors.warn }, gold && { color: colors.gold }];
  const inner = (
    <>
      <Text style={styles.tileLabel}>{label}</Text>
      {loading ? (
        <View style={styles.tileSpinner}>
          <ActivityIndicator size="small" color={colors.textDim} />
        </View>
      ) : isNum ? (
        <AnimatedNumber value={num} style={valStyle} duration={640} />
      ) : (
        <Text style={valStyle}>{value}</Text>
      )}
    </>
  );
  // flex:1 lives on the outer touch target so the two tiles stay equal width; the press
  // spring scales the inner card. Non-tappable tiles are a plain View.
  if (onPress) {
    return (
      <PressableScale pressableStyle={styles.tileFlex} style={styles.tile} onPress={onPress}>
        {inner}
      </PressableScale>
    );
  }
  return <View style={[styles.tileFlex, styles.tile]}>{inner}</View>;
}

function Chip({ label, value, bad, warn, loading, onPress }) {
  const c = bad ? colors.bad : warn ? colors.warn : colors.textDim;
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap style={({ pressed } = {}) => [styles.chip, onPress && pressed && { opacity: 0.7 }]} onPress={onPress}>
      {loading ? (
        <View style={styles.chipSpinner}>
          <ActivityIndicator size="small" color={colors.textDim} />
        </View>
      ) : (
        <Text style={[styles.chipValue, { color: c }]}>{value}</Text>
      )}
      <Text style={styles.chipLabel}>{label}</Text>
    </Wrap>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 30 },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  gearBtn: { padding: 2 },
  // A minimalist person silhouette (head + shoulders) clipped into a gold-ringed circle —
  // the account entry point, drawn from plain views so it needs no asset or username.
  avatarBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.accent, backgroundColor: colors.accent + '18', alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  avatarHead: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.accent, marginBottom: 1.5 },
  avatarBody: { width: 17, height: 10, borderTopLeftRadius: 9, borderTopRightRadius: 9, backgroundColor: colors.accent },
  logout: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  portfolio: { marginBottom: 4 },
  tileRow: { flexDirection: 'row', gap: 12 },
  tileFlex: { flex: 1 },
  tile: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 },
  tileLabel: { color: colors.violetText, fontSize: 12, fontWeight: '700' },
  tileValue: { color: colors.text, fontSize: 30, fontWeight: '900', marginTop: 4 },
  tileSpinner: { height: 40, justifyContent: 'center', alignItems: 'flex-start', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' },
  chipInfo: { justifyContent: 'center', paddingHorizontal: 2 },
  chip: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', minWidth: 64 },
  chipValue: { fontSize: 18, fontWeight: '900' },
  chipSpinner: { height: 22, justifyContent: 'center' },
  chipLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 2 },
  section: { color: colors.violetText, fontSize: 15, fontWeight: '800', marginTop: 20, marginBottom: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLink: { color: colors.accent, fontSize: 13, fontWeight: '700', marginTop: 20, marginBottom: 10 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  groupLabel: { color: colors.violetText, fontSize: 15, fontWeight: '700', flex: 1 },
  countPill: { backgroundColor: colors.cardAlt, borderRadius: 12, minWidth: 26, paddingHorizontal: 8, paddingVertical: 2, alignItems: 'center', marginRight: 10 },
  countText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  caret: { color: colors.textDim, fontSize: 18, fontWeight: '700', width: 16, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cardAlt, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, marginLeft: 22 },
  rowLeague: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1, marginRight: 10 },
  rowAction: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  error: { color: colors.bad, marginVertical: 8 },
  clear: { color: colors.textDim, fontSize: 15 },
  clearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 30 },
  teamRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  allLeaguesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 20 },
  allLeaguesText: { color: colors.accent, fontSize: 15, fontWeight: '800' },
  portfolioLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 13, marginTop: 10 },
  portfolioLinkText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  portCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 10 },
  portDonutLoading: { width: 92, height: 92, alignItems: 'center', justifyContent: 'center' },
  portCardBody: { flex: 1 },
  portCardTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  portCardSub: { color: colors.accent, fontSize: 13, fontWeight: '700', marginTop: 1, marginBottom: 8 },
  portLegend: { flexDirection: 'row', flexWrap: 'wrap' },
  portLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '50%', paddingVertical: 3 },
  portLegendDot: { width: 9, height: 9, borderRadius: 4.5 },
  portLegendLabel: { color: colors.textDim, fontSize: 12, fontWeight: '600', flex: 1 },
  portLegendCount: { color: colors.text, fontSize: 13, fontWeight: '900', marginRight: 8 },
  portUnread: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 6 },
  teamName: { color: colors.text, fontSize: 15, fontWeight: '700', marginRight: 10 },
  teamSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  onDeckRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 15, marginBottom: 14 },
  onDeckRowNow: { borderColor: colors.gold, backgroundColor: colors.cardAlt },
  onDeckIcon: { fontSize: 20, marginRight: 12 },
  onDeckName: { color: colors.text, fontSize: 15, fontWeight: '900', letterSpacing: 0.2 },
  onDeckSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  watchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8 },
  watchIcon: { marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  watchName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  watchSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8 },
  deadlineIcon: { marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  deadlineName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  deadlineSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  deadlinePill: { color: colors.textDim, backgroundColor: colors.cardAlt, fontSize: 12, fontWeight: '800', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6, overflow: 'hidden', marginLeft: 8 },
  deadlinePillUrgent: { color: colors.onAccent, backgroundColor: colors.warn },
  viewAll: { alignItems: 'center', paddingVertical: 10, marginBottom: 4 },
  viewAllText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  inboxRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 12 },
  inboxTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inboxName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  inboxSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  draftRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 8 },
  draftRowLive: { borderColor: colors.gold },
  draftName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  draftSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  draftPill: { color: colors.onAccent, backgroundColor: colors.gold, fontSize: 11, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  teamChev: { color: colors.textDim, fontSize: 20, fontWeight: '700', marginLeft: 8 },
  modalWrap: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: colors.border, maxHeight: '80%', paddingTop: 8 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '900', flex: 1, marginRight: 12 },
  modalClose: { color: colors.textDim, fontSize: 18, fontWeight: '800' },
  modalList: { paddingHorizontal: 16, paddingBottom: 28 },
});
