import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { appAlert } from "../components/AppAlert";
import { useRequirePro } from '../entitlement';
import { api } from '../api';
import { waiversOverviewPreferDevice } from '../mflDevice';
import { colors, positionColors, size } from '../theme';
import Button from '../components/Button';
import { celebrate } from '../components/Celebrate';
import AvailabilityBadge from '../components/AvailabilityBadge';
import ValueDelta from '../components/ValueDelta';
import BidPlanRow from '../components/BidPlanRow';
import { toast } from '../components/Toast';
import ErrorView from '../components/ErrorView';
import NavTools from '../components/NavTools';
import Reveal from '../components/Reveal';
import Pulse from '../components/Pulse';
import NeonSign from '../components/NeonSign';
import useActFlash from '../useActFlash';
import usePopScale from '../usePopScale';
import useAndroidBack from '../useAndroidBack';
import useCachedResource, { peekResource, primeResource } from '../useCachedResource';
import { ScreenTitle } from '../components/Brand';

const SORTS = [
  { key: 'value', label: 'Market' },
  { key: 'projection', label: 'Proj' },
  { key: 'season', label: 'Yr pts' },
  { key: 'ownership', label: 'Own%' },
  { key: 'trend', label: 'Trend' },
];

// Drop one claim from a pending payload ({ summary:{pending}, pending:[…], results:[…] }), returning a
// new object (or the same one if nothing matched). Used for the optimistic cancel below.
function removeClaim(p, cid, lid) {
  if (!p || !Array.isArray(p.pending)) return p;
  const kept = p.pending.filter((c) => !(c.id === cid && c.leagueId === lid));
  if (kept.length === p.pending.length) return p;
  return { ...p, pending: kept, summary: { ...p.summary, pending: Math.max(0, ((p.summary && p.summary.pending) || 0) - 1) } };
}

// Patch one pending claim's bid in place (optimistic reflection of an edit before the reconcile lands).
function patchClaimBid(p, cid, lid, bid) {
  if (!p || !Array.isArray(p.pending)) return p;
  return { ...p, pending: p.pending.map((c) => (c.id === cid && c.leagueId === lid ? { ...c, bid } : c)) };
}

// The per-league board carries its OWN "claims submitted here" list (board.pending) — separate from the
// cross-league pending payload above. These mirror removeClaim/pruneCanceled for it, so a delete on the
// board reflects immediately (optimistic) and the reconcile refetch can't echo the removed claim back.
function removeBoardClaim(b, cid) {
  if (!b || !Array.isArray(b.pending)) return b;
  const kept = b.pending.filter((c) => c.id !== cid);
  if (kept.length === b.pending.length) return b;
  return { ...b, pending: kept };
}
function pruneBoardClaims(b, cancels) {
  if (!b || !Array.isArray(b.pending) || !cancels || cancels.size === 0) return b;
  const now = Date.now();
  for (const [k, exp] of cancels) if (exp <= now) cancels.delete(k);
  if (cancels.size === 0) return b;
  const kept = b.pending.filter((c) => !cancels.has(`${b.leagueId}-${c.id}`));
  if (kept.length === b.pending.length) return b;
  return { ...b, pending: kept };
}

// Filter just-canceled claims out of a freshly-fetched pending payload. MFL's queue can still echo a
// canceled bid for a beat after the REPLACE resubmit; without this, the reconcile refetch would make
// the row we just removed flicker back in. `cancels` is a Map(key → expiry) — expired keys are pruned.
function pruneCanceled(res, cancels) {
  if (!res || !Array.isArray(res.pending) || cancels.size === 0) return res;
  const now = Date.now();
  for (const [k, exp] of cancels) if (exp <= now) cancels.delete(k);
  if (cancels.size === 0) return res;
  const kept = res.pending.filter((c) => !cancels.has(`${c.leagueId}-${c.id}`));
  if (kept.length === res.pending.length) return res;
  const removed = res.pending.length - kept.length;
  return { ...res, pending: kept, summary: { ...res.summary, pending: Math.max(0, ((res.summary && res.summary.pending) || 0) - removed) } };
}

// `onExit`, when provided, makes this a LEAGUE-SCOPED overlay (opened from a league hub / roster /
// lineup editor rather than the Waivers tab): it lands straight on that league's board, and backing
// out of the board pops the overlay back to where you came from instead of revealing the cross-league
// overview. This keeps in-league navigation scoped and backable (UX_GUARDRAILS C7) — the tab usage
// (no onExit) is unchanged.
export default function WaiversScreen({ active = true, initialLeagueId, initialPosition, initialSort, onExit, onStartWizard, onOpenPlayer, onOpenLineup }) {
  // Landing overview via the shared hook: instant paint on remount (survives the tab-switch
  // unmount), throttled reloads, and it keeps the list on a failed refresh. `loadOverview`
  // (reload) is also called after a claim to reflect it immediately.
  const { data: overview, error: overviewError, refreshing: ovRefreshing, reload: loadOverview, refetch: refetchOverview } = useCachedResource('waivers:overview', () => waiversOverviewPreferDevice(), { active });
  // Auto-heal a per-league "could not load waiver settings" (a transient throttle): if any card came
  // back with an error, SILENTLY re-pull the overview a few times with backoff — the league that lost
  // the throttle race usually wins it on a later attempt (and now that the backend serves overview
  // settings from cache, the re-pull resolves stragglers without re-bursting near-live reads). Uses the
  // silent refetch, NOT loadOverview: a self-heal must not flip the pull-to-refresh spinner, or the
  // background retry reads as a stuck "spinner over the top" load the user never started. Resets once
  // the errors clear, so it never loops forever on a genuine outage.
  const ovRetry = useRef(0);
  useEffect(() => {
    const hasErr = !!(overview && overview.leagues && overview.leagues.some((l) => l.error));
    if (!hasErr) { ovRetry.current = 0; return undefined; }
    if (ovRetry.current >= 3) return undefined;
    const t = setTimeout(() => { ovRetry.current += 1; refetchOverview(); }, 1500 * (ovRetry.current + 1));
    return () => clearTimeout(t);
  }, [overview, refetchOverview]);
  // Pending claims go through the same cached hook so switching to the Pending tab paints the last
  // snapshot INSTANTLY (the screen unmounts on every tab switch, so a bare fetch showed a cold
  // full-screen spinner every single time). It revalidates in the background and after a claim.
  // Claims the user just canceled: key `${lid}-${cid}` → expiry ms. We drop a canceled row instantly
  // and keep it dropped through the reconcile grace window (MFL can echo it back for a beat).
  const recentCancels = useRef(new Map());
  // In-flight cancels — a hard guard against a double-tap firing a SECOND DELETE. That matters for
  // correctness, not just polish: an MFL claim id encodes its index in the round, and the first cancel
  // resubmits the round WITHOUT that pick, shifting every later index — so a second DELETE at the old
  // index would cancel the WRONG claim.
  const cancelingRef = useRef(new Set());
  const { data: pending, reload: loadPending, setData: setPending } = useCachedResource(
    'waivers:pending',
    async () => pruneCanceled(await api.waiverPending(), recentCancels.current),
    { active },
  );
  const [segment, setSegment] = useState('leagues'); // 'leagues' | 'pending'
  // A league drill-in: the per-league board. Set from a card tap or a Home
  // deep-link (initialLeagueId), which lands the user straight on that board.
  const [openLeagueId, setOpenLeagueId] = useState(initialLeagueId || null);
  const [position, setPosition] = useState(initialPosition || null);
  // Default to dynasty value: it's meaningful year-round (esp. the offseason),
  // unlike weekly projection which is empty between seasons. Toggle to Proj for
  // in-season streaming. A deep-link (e.g. Under Center's "replace a wiped position")
  // can land the board pre-sorted — by this week's projection — via initialSort.
  const [sort, setSort] = useState(initialSort || 'value');
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(false); // board (drill-in) loading
  const [error, setError] = useState(null);
  const [claim, setClaim] = useState(null); // {leagueId, addId}
  const [editing, setEditing] = useState(null); // a pending claim being edited (bid)
  const [picking, setPicking] = useState(false); // "New claim" search sheet open

  function closeBoard() {
    // Scoped overlay: the board IS the whole screen, so its back exits to the caller (league hub),
    // not to a cross-league overview the user never opened.
    if (onExit) { onExit(); return; }
    setOpenLeagueId(null);
    setBoard(null);
    setPosition(null);
  }

  // Back: claim / batch sheet first, then the board drill-in (returns to overview).
  useAndroidBack(useCallback(() => {
    if (picking) {
      setPicking(false);
      return true;
    }
    if (editing) {
      setEditing(null);
      return true;
    }
    if (claim) {
      setClaim(null);
      return true;
    }
    if (openLeagueId) {
      closeBoard();
      return true;
    }
    return false;
  }, [claim, editing, picking, openLeagueId]));

  // Board for the drilled-in league. Stale-while-revalidate: seed instantly from the cache for this
  // exact league+position+sort if we've seen it, otherwise KEEP whatever board is already on screen
  // (e.g. the prior sort/position for this league) and revalidate in the background — never blank to a
  // spinner while we hold data. A failed refetch keeps the shown board (BoardView gates error on !board).
  const loadBoard = useCallback(async () => {
    if (!openLeagueId) return;
    const key = `waivers:board:${openLeagueId}:${position || 'all'}:${sort}`;
    const cached = peekResource(key);
    if (cached) setBoard(cached.value);
    setLoading(true);
    setError(null);
    try {
      const b = await api.waiverBoard(openLeagueId, { position, sort });
      // Prune a just-deleted claim MFL's queue may still echo (same grace window the pending list uses),
      // so the board's "claims submitted here" strip can't flicker the removed row back in.
      const pruned = pruneBoardClaims(b, recentCancels.current);
      setBoard(pruned);
      primeResource(key, pruned);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [openLeagueId, position, sort]);

  useEffect(() => {
    if (openLeagueId) loadBoard();
  }, [openLeagueId, loadBoard]);

  function refreshAll() {
    if (openLeagueId) loadBoard();
    loadOverview();
    loadPending();
  }

  // Open the wizard INSTANTLY with a lightweight stub queue built from the overview we
  // already have — the wizard then loads each league's full suggestion on demand (current +
  // prefetch next) instead of blocking here on the whole N-league fan-out (was ~30s cold).
  function startWizard() {
    if (!onStartWizard) return;
    const src = overview && overview.leagues ? overview.leagues : null;
    if (!src) return; // button is only shown once the overview has leagues, so this is defensive
    const stubs = src
      .filter((l) => !l.error)
      .map((l) => ({ leagueId: l.leagueId, name: l.name, system: l.system, waiverState: l.waiverState }));
    if (!stubs.length) {
      appAlert('Nothing to pick up', 'No leagues available to run the wizard right now.');
      return;
    }
    onStartWizard(stubs);
  }

  async function cancelClaim(cid, lid) {
    const key = `${lid}-${cid}`;
    if (cancelingRef.current.has(key)) return; // already canceling this one — ignore the repeat tap
    cancelingRef.current.add(key);
    // Reflect the action IMMEDIATELY (docs/UX_GUARDRAILS.md): drop the row now instead of waiting on the
    // MFL round-trip + the slow reconcile refetch (that lag was the "I clicked cancel and nothing
    // happened" report). Keep it dropped through the grace window so the reconcile can't flicker it back.
    recentCancels.current.set(key, Date.now() + 12000);
    const prevPending = pending;
    const prevBoard = board;
    const next = removeClaim(pending, cid, lid);
    setPending(next);
    primeResource('waivers:pending', next); // keep the survive-remount snapshot in step with the view
    // Reflect on the per-league board's claims strip too — it reads board.pending, not the list above,
    // so without this a delete on the board did nothing until (and unless) the reconnect refetch landed.
    if (openLeagueId === lid) setBoard((b) => removeBoardClaim(b, cid));
    toast('Claim canceled');
    try {
      await api.cancelClaim(lid, cid);
      loadPending(); // reconcile in the background; pruneCanceled keeps the canceled row from returning
      loadOverview();
      if (openLeagueId) loadBoard(); // reflect the removed claim in the board's claims strip
    } catch (e) {
      // Non-destructive (docs/UX_GUARDRAILS.md): the cancel didn't take, so put the row back exactly as
      // it was and let the user try again, rather than leaving a phantom "canceled" that's still live.
      recentCancels.current.delete(key);
      setPending(prevPending);
      setBoard(prevBoard);
      primeResource('waivers:pending', prevPending);
      appAlert('Could not cancel', e.message);
    } finally {
      cancelingRef.current.delete(key);
    }
  }

  // Edit a pending FAAB claim's bid in place (backend does the REPLACE-resubmit). Reflect the new bid
  // immediately (C3), then reconcile; revert non-destructively if MFL rejects it.
  async function saveBid(c, newBid) {
    const prev = pending;
    const next = patchClaimBid(pending, c.id, c.leagueId, newBid);
    setPending(next);
    primeResource('waivers:pending', next);
    setEditing(null);
    toast(`Bid updated · $${newBid}`);
    try {
      await api.editClaim(c.leagueId, c.id, { bid: newBid });
      loadPending();
      loadOverview();
      if (openLeagueId) loadBoard();
    } catch (e) {
      setPending(prev);
      primeResource('waivers:pending', prev);
      appAlert('Could not update bid', e.message);
    }
  }

  const summary = overview && overview.summary;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 20, top: 8, zIndex: 5 }}><NavTools active={active} /></View>
        <ScreenTitle focused={active}>Waivers</ScreenTitle>
        {summary && !openLeagueId ? (
          <Text style={styles.subtitle}>
            {summary.total} league{summary.total === 1 ? '' : 's'}
            {summary.pending ? ` · ${summary.pending} pending` : ''}
            {summary.rostersFull ? ` · ${summary.rostersFull} roster${summary.rostersFull === 1 ? '' : 's'} full` : ''}
          </Text>
        ) : null}
      </View>

      {openLeagueId ? (
        <BoardView
          leagueName={board ? board.name : ''}
          onBack={closeBoard}
          board={board}
          loading={loading}
          error={error}
          position={position}
          setPosition={setPosition}
          sort={sort}
          setSort={setSort}
          onPick={(addId) => setClaim({ leagueId: openLeagueId, addId })}
          onNewClaim={() => setPicking(true)}
          onOpenPlayer={onOpenPlayer}
          onRetry={loadBoard}
          onCancel={cancelClaim}
        />
      ) : (
        <>
          <View style={styles.segment}>
            {[
              ['leagues', 'Leagues'],
              ['pending', 'Pending'],
            ].map(([k, label]) => (
              <Pressable key={k} style={[styles.seg, segment === k && styles.segActive]} onPress={() => setSegment(k)}>
                <Text style={[styles.segText, segment === k && styles.segTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {segment === 'leagues' ? (
            <>
              {overview && overview.leagues && overview.leagues.length ? (
                <Pressable
                  style={({ pressed }) => [styles.wizardBtn, pressed && { opacity: 0.85 }]}
                  onPress={startWizard}
                >
                  <Text style={styles.wizardBtnText}>Waiver Wizard — pick up across leagues</Text>
                </Pressable>
              ) : null}
              <OverviewView
                overview={overview}
                loading={overview == null}
                refreshing={ovRefreshing}
                error={overviewError}
                onOpen={setOpenLeagueId}
                onRefresh={loadOverview}
              />
            </>
          ) : (
            <PendingView pending={pending} onCancel={cancelClaim} onEdit={setEditing} onOpenPlayer={onOpenPlayer} />
          )}
        </>
      )}

      {claim ? (
        <ClaimSheet
          leagueId={claim.leagueId}
          addId={claim.addId}
          onClose={() => setClaim(null)}
          onOpenLineup={onOpenLineup}
          onDone={() => {
            setClaim(null);
            refreshAll();
          }}
        />
      ) : null}

      {editing ? (
        <EditBidSheet claim={editing} onClose={() => setEditing(null)} onSave={(n) => saveBid(editing, n)} />
      ) : null}

      {picking ? (
        <NewClaimSheet
          leagueName={board ? board.name : ''}
          onClose={() => setPicking(false)}
          onPick={(addId) => { setPicking(false); setClaim({ leagueId: openLeagueId, addId }); }}
        />
      ) : null}

    </View>
  );
}

// The per-league landing list — mirrors the Lineups overview. Each card shows
// the league's pickup system, budget/priority, roster space, how many free
// agents are worth a look, and pending claims; tapping drills into its board.
function OverviewView({ overview, loading, refreshing, error, onOpen, onRefresh }) {
  // Cold load paints the list's SHAPE in place (league-card silhouettes) rather than a lone centered
  // spinner floating over an empty screen — the load reads as the screen filling itself in, not an
  // overlay dropped on top (docs/UX_GUARDRAILS.md instant-paint).
  if (loading && !overview) return <OverviewSkeleton />;
  if (error && !overview) return <ErrorView message={error} onRetry={onRefresh} onRefresh={onRefresh} refreshing={refreshing} />;
  return (
    <FlatList
      data={overview ? sortByUrgency(overview.leagues) : []}
      keyExtractor={(l) => l.leagueId}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      renderItem={({ item, index }) => (
        <Reveal delay={Math.min(index, 8) * 45} animate={index < 10}>
          <LeagueCard item={item} onPress={() => onOpen(item.leagueId)} />
        </Reveal>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No leagues found.</Text>}
    />
  );
}

// League-card silhouettes for the cold overview load — mirrors LeagueCard's shape (name · badge, a
// state banner, two meta lines) so the layout doesn't jump when the real cards land. One Pulse drives
// them all, matching the Players screen's skeleton.
function OverviewSkeleton({ count = 4 }) {
  return (
    <View style={styles.list}>
      <Pulse min={0.45}>
        {Array.from({ length: count }).map((_, i) => (
          <View key={i} style={styles.ovCard}>
            <View style={styles.ovTop}>
              <View style={[styles.skBar, { width: '52%', height: 15 }]} />
              <View style={styles.skBadge} />
            </View>
            <View style={styles.skBanner} />
            <View style={[styles.skBar, { width: '68%', height: 11, marginTop: 10 }]} />
            <View style={[styles.skBar, { width: '44%', height: 11, marginTop: 8 }]} />
          </View>
        ))}
      </Pulse>
    </View>
  );
}

// A waiver run within this window counts as "imminent" — floated up top, card emphasized, and a
// get-your-claims-in badge shown. Long enough to catch a "tonight" run you opened this morning.
const IMMINENT_MS = 24 * 60 * 60 * 1000;
function isImminent(item) {
  return item && item.waiverState === 'waivers_soon' && item.nextWaiverRun != null && item.nextWaiverRun - Date.now() <= IMMINENT_MS;
}
// Urgency ranking for the overview: leagues with a waiver run coming FIRST (soonest run leads — that's
// the deadline you're racing), then open free agency (actionable but no deadline), then closed, then
// unreadable. Stable within a group (keeps the incoming pinned-first order via the original index).
function waiverSortKey(item) {
  if (item.error) return [3, 0];
  if (item.waiverState === 'waivers_soon') return [0, item.nextWaiverRun != null ? item.nextWaiverRun : 0];
  if (item.waiverState === 'fa_open') return [1, 0];
  return [2, 0];
}
function sortByUrgency(leagues) {
  return (leagues || [])
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const ka = waiverSortKey(a.l);
      const kb = waiverSortKey(b.l);
      return ka[0] - kb[0] || ka[1] - kb[1] || a.i - b.i;
    })
    .map((x) => x.l);
}

// "in 2 days" / "in 6 hours" / "within the hour" for a future run timestamp (ms).
function runLabel(ms) {
  const diff = ms - Date.now();
  if (diff <= 0) return 'now';
  const hours = Math.round(diff / (60 * 60 * 1000));
  if (hours < 24) return hours <= 1 ? 'within the hour' : `in ${hours} hours`;
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  return days <= 1 ? 'tomorrow' : `in ${days} days`;
}

// The league's pickup posture → a clear, color-coded banner. Three distinct states.
function stateInfo(item) {
  if (item.waiverState === 'fa_open') {
    return { glyph: 'dot', neon: 'good', label: 'Free agency open', sub: 'Add anyone now — processes immediately', color: colors.good };
  }
  if (item.waiverState === 'waivers_soon') {
    return {
      glyph: 'hourglass',
      neon: 'warn',
      label: item.nextWaiverRun != null ? `Waivers process ${runLabel(item.nextWaiverRun)}` : 'Waiver cycle running',
      sub: 'Claims you place queue now and process at the run',
      color: colors.warn,
    };
  }
  return { glyph: 'lock', neon: 'cold', label: 'Waivers closed', sub: item.lockReason || 'No open free agency and no upcoming waiver run', color: colors.textDim };
}

function LeagueCard({ item, onPress }) {
  if (item.error) {
    return (
      <View style={styles.ovCard}>
        <Text style={styles.ovName}>{item.name}</Text>
        <Text style={styles.rowError}>{item.error}</Text>
      </View>
    );
  }
  const budget =
    item.system === 'faab' && item.faabRemaining != null
      ? `$${item.faabRemaining} FAAB`
      : item.system === 'fcfs' && item.waiverPriority
      ? `Priority #${item.waiverPriority}`
      : null;
  const st = stateInfo(item);
  const imminent = isImminent(item);
  return (
    <Pressable style={({ pressed }) => [styles.ovCard, { borderLeftWidth: 3, borderLeftColor: st.color }, imminent && styles.ovCardImminent, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={styles.ovTop}>
        <Text style={styles.ovName} numberOfLines={1}>{item.name}</Text>
        <SystemBadge system={item.system} />
      </View>
      <View style={[styles.stateBanner, { backgroundColor: st.color + '18', borderColor: st.color + '55' }]}>
        <View style={styles.stateLabelRow}>
          <NeonSign glyph={st.glyph} color={st.neon} grade="inline" size={15} />
          <Text style={[styles.stateLabel, { color: st.color }]}>{st.label}</Text>
        </View>
        <Text style={styles.stateSub} numberOfLines={2}>{st.sub}</Text>
      </View>
      {imminent ? (
        <View style={styles.imminentBadge}>
          <Text style={styles.imminentText}>Get your claims in — processes {runLabel(item.nextWaiverRun)}</Text>
        </View>
      ) : null}
      <Text style={styles.ovMeta}>
        {[
          budget,
          `Roster ${item.rosterCount}/${item.rosterSize}${item.rosterFull ? ' · FULL' : ''}`,
        ]
          .filter(Boolean)
          .join('  ·  ')}
      </Text>
      {item.topAvailable && item.topAvailable.length ? (
        <Text style={styles.ovTop3} numberOfLines={1}>
          Top: {item.topAvailable.map((p) => `${p.name.split(',')[0]}${p.value != null ? ` (${p.value})` : ''}`).join(', ')}
        </Text>
      ) : null}
      <View style={styles.ovBottom}>
        {/* The raw free-agent count isn't actionable (the "Top:" line already shows what's
            worth grabbing); keep only the pending-claims count, which is. */}
        <Text style={styles.ovCount}>
          {item.pendingCount ? <Text style={styles.ovPending}>{item.pendingCount} pending</Text> : null}
        </Text>
        <Text style={styles.chev}>›</Text>
      </View>
    </Pressable>
  );
}

function BoardView({ board, loading, error, position, setPosition, sort, setSort, onPick, onNewClaim, onBack, leagueName, onOpenPlayer, onRetry, onCancel }) {
  const header = onBack ? (
    <Pressable style={styles.backRow} onPress={onBack} hitSlop={8}>
      <Text style={styles.backChev}>‹</Text>
      <Text style={styles.backText} numberOfLines={1}>{leagueName || 'Leagues'}</Text>
      {/* Subtle non-blocking hint while revalidating a board we're already showing (filter/sort toggle,
          post-claim refresh) — the list stays put instead of blanking to a full-screen spinner. */}
      {loading && board ? <ActivityIndicator color={colors.accent} size="small" style={{ marginLeft: 10 }} /> : null}
    </Pressable>
  ) : null;

  // Full-screen spinner / error ONLY when there's nothing to show — a reload with a board in hand keeps
  // the board on screen (stale-while-revalidate) and shows the inline hint above instead.
  if (loading && !board) return <View style={{ flex: 1 }}>{header}<Center><ActivityIndicator color={colors.accent} size="large" /></Center></View>;
  if (error && !board) return <View style={{ flex: 1 }}>{header}<ErrorView message={error} onRetry={onRetry} /></View>;
  if (!board) return <View style={{ flex: 1 }}>{header}</View>;

  // Which free agents already have a claim in — so a FA row can flash its accent the moment your claim
  // lands on it (Texture §2.3), the same "action visibly lands on the row" feedback the tag rows use.
  const claimedIds = new Set((board.pending || []).map((c) => c.add && c.add.id).filter(Boolean));

  return (
    <View style={{ flex: 1 }}>
      {header}
      {/* Roster details on the left, sorts on the right of the SAME line — so the filter row
          below carries only positions and nothing has to side-scroll. Both rows wrap. */}
      <View style={styles.metaSortRow}>
        <View style={styles.boardMeta}>
          <SystemBadge system={board.system} />
          {board.system === 'faab' && board.settings.faabRemaining != null ? (
            <Text style={styles.metaText}>${board.settings.faabRemaining} left</Text>
          ) : null}
          {board.system === 'fcfs' && board.settings.waiverPriority ? (
            <Text style={styles.metaText}>Priority #{board.settings.waiverPriority}</Text>
          ) : null}
          <Text style={styles.metaText}>
            Roster {board.rosterCount}/{board.settings.rosterSize}
            {board.rosterFull ? ' · FULL' : ''}
          </Text>
        </View>
        <View style={styles.sortChips}>
          {SORTS.map((s) => (
            <FilterChip key={s.key} label={s.label} active={sort === s.key} onPress={() => setSort(s.key)} sortStyle />
          ))}
        </View>
      </View>

      <View style={styles.filterRow}>
        <FilterChip label="All" active={!position} onPress={() => setPosition(null)} />
        {board.positions.map((p) => (
          <FilterChip key={p} label={p} active={position === p} onPress={() => setPosition(p)} />
        ))}
      </View>

      {/* Always-present way to file a claim — a search over the pool, so you can claim a SPECIFIC player
          even when the ranked list below is sparse (or a read blipped it empty). The claim it opens
          validates availability for THIS league and re-reads the free-agent set fresh. */}
      {onNewClaim ? (
        <Pressable onPress={onNewClaim} style={({ pressed }) => [styles.newClaimBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="File a new waiver claim">
          <Text style={styles.newClaimText}>＋ New claim</Text>
        </Pressable>
      ) : null}

      {/* Claims already in for THIS league — so you can see the two you've submitted while
          building a third, and remove one without leaving the board. */}
      {board.pending && board.pending.length ? (
        <View style={styles.claimsStrip}>
          <Text style={styles.claimsTitle}>
            {board.pending.length} claim{board.pending.length === 1 ? '' : 's'} submitted here
          </Text>
          {board.pending.map((c) => (
            <View key={c.id} style={styles.claimRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.claimAdd} numberOfLines={1}>
                  + {c.add ? c.add.name : '—'}
                  {c.bid != null ? <Text style={styles.claimMeta}>  ${c.bid}</Text> : null}
                  {c.priority != null ? <Text style={styles.claimMeta}>  #{c.priority}</Text> : null}
                </Text>
                {c.drop ? <Text style={styles.claimDrop} numberOfLines={1}>− {c.drop.name}</Text> : null}
              </View>
              <Pressable onPress={() => onCancel && onCancel(c.id, board.leagueId)} hitSlop={8} style={styles.claimDelBtn}>
                <Text style={styles.claimDel}>Delete</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <FlatList
        data={board.freeAgents}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
        <Reveal delay={Math.min(index, 8) * 40} animate={index < 12}>
          <FaRow p={item} claimed={claimedIds.has(item.id)} onPress={() => onPick(item.id)} onOpenPlayer={onOpenPlayer} />
        </Reveal>
      )}
        ListEmptyComponent={
          position ? (
            <Text style={styles.empty}>No {position} free agents right now.</Text>
          ) : (
            // An empty pool with NO filter almost always means the free-agent read blipped (a live league
            // always has free agents) — offer a retry + point at New claim, not a dead "none".
            <View style={styles.faEmptyWrap}>
              <Text style={styles.empty}>The free-agent list didn’t load. Retry, or use “＋ New claim” above to search for a player.</Text>
              <Pressable style={({ pressed }) => [styles.retry, pressed && { opacity: 0.85 }]} onPress={onRetry}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          )
        }
      />
    </View>
  );
}

function FaRow({ p, claimed, onPress, onOpenPlayer }) {
  const posColor = positionColors[p.position] || colors.textDim;
  // Texture: wash the row's accent when your claim lands on THIS player (§2.3) — the action visibly
  // lands on the board instead of only appearing in the "claims submitted" strip. Keyed to `claimed`,
  // so it fires when the claim goes in and skips scroll-in / re-sort (useActFlash's first-mount guard).
  const flash = useActFlash(claimed ? 1 : 0);
  // Identity (badge + name + meta + value) opens the cross-league profile to research the
  // player; the "+ Claim" pill is the action. Falls back to a whole-row claim if no profile
  // handler is wired.
  const Identity = onOpenPlayer ? Pressable : View;
  const idProps = onOpenPlayer ? { onPress: () => onOpenPlayer(p.id) } : {};
  return (
    <View style={[styles.faRow, p.tag === 'target' && styles.faRowTarget, p.tag === 'avoid' && styles.faRowAvoid]}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: 12, backgroundColor: colors.good, opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.20] }) }]}
      />
      <Identity style={styles.faIdentity} {...idProps}>
        <View style={[styles.posBadge, { backgroundColor: posColor + '22', borderColor: posColor }]}>
          <Text style={[styles.pos, { color: posColor }]}>{p.position}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.faNameRow}>
            <Text style={styles.faName} numberOfLines={1}>
              {p.name}
            </Text>
            {p.tag ? <Text style={[styles.faTagMark, { color: p.tag === 'target' ? colors.good : colors.bad }]}>{p.tag === 'target' ? '◎' : '⊘'}</Text> : null}
            <AvailabilityBadge availability={p.availability} style={{ marginLeft: 6 }} />
          </View>
          <Text style={styles.faMeta}>
            {[
              p.team,
              p.projection != null ? `proj ${p.projection}` : null,
              p.seasonPoints != null ? `${p.seasonPoints} yr` : null,
              p.ownership != null ? `${p.ownership}% rost` : null,
              p.trend ? `+${(p.trend / 1000).toFixed(1)}k adds` : null,
              p.onWaivers ? `waivers${p.clearTime ? ` ${p.clearTime}` : ''}` : 'free agent',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {p.value != null ? <Text style={styles.faValue}>{p.value}</Text> : null}
      </Identity>
      <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.addBtnPill, pressed && { opacity: 0.7 }]}>
        <Text style={styles.addBtn}>+ Claim</Text>
      </Pressable>
    </View>
  );
}

// A player name in a result line — tappable through to the profile when we have an id.
function ResultName({ player, onOpenPlayer }) {
  if (!player) return <Text style={styles.resultDim}>—</Text>;
  const short = String(player.name || '').split(',')[0];
  if (player.id && onOpenPlayer) {
    return <Text style={styles.resultLink} onPress={() => onOpenPlayer(player.id)}>{short}</Text>;
  }
  return <Text>{short}</Text>;
}

// When a claim processes: a real countdown from the calendar-derived run time (c.at), falling back
// to MFL's human run-time label, then a generic "pending".
function waiverWhen(c) {
  if (c && c.at) {
    const ms = new Date(c.at).getTime() - Date.now();
    if (!Number.isNaN(ms)) {
      if (ms <= 60 * 1000) return 'processing now';
      const mins = Math.round(ms / 60000);
      if (mins < 60) return `in ${mins}m`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `in ${hrs}h ${mins % 60}m`;
      const days = Math.floor(hrs / 24);
      return `in ${days}d ${hrs % 24}h`;
    }
  }
  return (c && (c.atLabel || c.processTime)) || 'pending';
}

function PendingView({ pending, onCancel, onEdit, onOpenPlayer }) {
  if (!pending) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={styles.subsection}>Pending claims · {pending.summary.pending}</Text>
      {pending.pending.length === 0 ? <Text style={styles.empty}>No pending claims.</Text> : null}
      {pending.pending.map((c) => {
        // A queued FAAB bid can be re-bid before it processes (backend re-files the round with the new
        // bid). Only FAAB claims carry an editable $ — fcfs/priority claims have nothing to change.
        const canEdit = onEdit && c.system === 'faab' && c.bid != null;
        return (
          <View key={`${c.leagueId}-${c.id}`} style={styles.pendRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pendAdd}>
                + {c.add ? c.add.name : '—'}
                {c.bid != null ? <Text style={styles.pendBid}>  ${c.bid}</Text> : null}
                {c.priority != null ? <Text style={styles.pendBid}>  #{c.priority}</Text> : null}
              </Text>
              {c.drop ? <Text style={styles.pendDrop}>− {c.drop.name}</Text> : null}
              <Text style={styles.pendLeague}>{c.leagueName} · {waiverWhen(c)}</Text>
            </View>
            {canEdit ? (
              <Pressable onPress={() => onEdit(c)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Edit bid for ${c.add ? c.add.name : 'claim'}`}>
                <Text style={styles.editClaim}>Edit</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => onCancel(c.id, c.leagueId)} hitSlop={8}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
        );
      })}

      {pending.results.length ? <Text style={styles.subsection}>Recent results</Text> : null}
      {pending.results.map((r, i) => (
        <View key={i} style={styles.resultRow}>
          <Text style={[styles.resultTag, { color: r.result === 'won' ? colors.good : colors.bad }]}>
            {r.result === 'won' ? 'WON' : 'LOST'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.resultText} numberOfLines={1}>
              {/* A green "+" reads as "acquired" — only right for a WON add. An outbid LOSS shows a
                  neutral bullet so the row doesn't imply we got the player. */}
              {r.result === 'won' ? <Text style={styles.resultAddSign}>+ </Text> : <Text style={styles.resultDim}>• </Text>}
              <ResultName player={{ name: r.add, id: r.addId }} onOpenPlayer={onOpenPlayer} />
              {r.drop ? (
                <Text style={styles.resultDim}>
                  {'  ·  − '}
                  <ResultName player={{ name: r.drop, id: r.dropId }} onOpenPlayer={onOpenPlayer} />
                </Text>
              ) : null}
              {r.bid != null ? <Text style={styles.resultDim}>{`  ·  $${r.bid}${r.result === 'won' ? '' : ' bid'}`}</Text> : null}
            </Text>
            <Text style={styles.resultLeague} numberOfLines={1}>{r.leagueName}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function ClaimSheet({ leagueId, addId, onClose, onOpenLineup, onDone }) {
  const requirePro = useRequirePro();
  const [preview, setPreview] = useState(null);
  const [bench, setBench] = useState([]);
  const [dropId, setDropId] = useState(null);
  const [bid, setBid] = useState(null);
  const [changingDrop, setChangingDrop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async (overrides = {}) => {
    try {
      const body = { addId };
      const d = 'dropId' in overrides ? overrides.dropId : dropId;
      const b = 'bid' in overrides ? overrides.bid : bid;
      if (d) body.dropId = d;
      if (b != null && b !== '') body.bid = Number(b);
      const p = await api.previewClaim(leagueId, body);
      setPreview(p);
      if (bid == null && p.suggestedBid != null) setBid(String(p.suggestedBid));
      if (!dropId && p.drop) setDropId(p.drop.id);
    } catch (e) {
      setError(e.message);
    }
  }, [addId, leagueId, dropId, bid]);

  useEffect(() => {
    refresh();
    api.roster(leagueId).then((r) => setBench(r.bench || [])).catch(() => {});
  }, [leagueId, addId]);

  // An IMMEDIATE add (open free agency) executes on MFL right now — and when it drops a player, that
  // drop is permanent and can't be undone from the app. So gate the immediate+drop case behind a
  // confirm; a queued FAAB/waiver claim (processes later, cancelable) submits without the extra step.
  function submit() {
    if (preview && preview.immediate && dropId) {
      const addName = (preview.add && preview.add.name) || 'this player';
      const dropName = (preview.drop && preview.drop.name) || 'a player';
      appAlert('Add now?', `Adds ${addName} and DROPS ${dropName} immediately on MyFantasyLeague. This can’t be undone from the app.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add & drop', style: 'destructive', onPress: doSubmit },
      ]);
      return;
    }
    doSubmit();
  }

  async function doSubmit() {
    if (!requirePro('waivers.file')) return; // Pro gate (inert until enforced)
    setBusy(true);
    try {
      const body = { addId };
      if (dropId) body.dropId = dropId;
      if (bid != null && bid !== '') body.bid = Number(bid);
      const res = await api.submitClaim(leagueId, body);
      celebrate('claimPlaced');
      // On an IMMEDIATE add (free-agent leagues — the player is yours right now), offer to jump
      // straight to the lineup so a startable pickup can be slotted in. Pending FAAB/waiver
      // claims process later, so there's nothing to set yet — those just confirm.
      const addName = res.submitted.add.name;
      if (preview && preview.immediate && onOpenLineup) {
        appAlert('Added', `${addName} is on your roster.`, [
          { text: 'Not now', style: 'cancel', onPress: onDone },
          { text: 'Set lineup', onPress: () => { onDone(); onOpenLineup({ leagueId }); } },
        ]);
      } else {
        toast(`Claim submitted · ${addName}${res.submitted.bid != null ? ` for $${res.submitted.bid}` : ''}`);
        onDone();
      }
    } catch (e) {
      celebrate('claimFailed');
      appAlert('Could not submit', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        <View style={styles.grabber} />
        {!preview ? (
          <ActivityIndicator color={colors.accent} style={{ paddingVertical: 30 }} />
        ) : (
          <>
            <Text style={styles.sheetTitle}>Claim {preview.add ? preview.add.name : ''}</Text>
            <Text style={styles.sheetSub}>
              {preview.name} · <SystemInline system={preview.system} />
              {preview.immediate ? ' · adds immediately' : preview.clearTime ? ` · ${preview.clearTime}` : ''}
            </Text>

            {/* Drop */}
            <Text style={styles.fieldLabel}>{preview.dropRequired ? 'Drop (required — roster full)' : 'Drop (optional)'}</Text>
            <Pressable style={styles.dropBox} onPress={() => setChangingDrop((v) => !v)}>
              <Text style={styles.dropText}>
                {preview.drop ? `− ${preview.drop.name}${preview.drop.value != null ? ` (${preview.drop.value})` : ''}` : 'None'}
              </Text>
              <Text style={styles.change}>{changingDrop ? 'Close' : 'Change'}</Text>
            </Pressable>
            {changingDrop ? (
              <ScrollView style={{ maxHeight: 150 }}>
                {bench.map((p) => (
                  <Pressable
                    key={p.id}
                    style={styles.benchRow}
                    onPress={() => {
                      setDropId(p.id);
                      setChangingDrop(false);
                      refresh({ dropId: p.id });
                    }}
                  >
                    <Text style={styles.benchName}>{p.name} <Text style={styles.benchMeta}>{p.position} · {p.value}</Text></Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {/* Add-vs-drop dynasty value delta (shared with the WaiverWizard) — the backend already
                returns valueDelta on the preview, so the quick FA claim shows the same trade-off. */}
            <ValueDelta addValue={preview.add ? preview.add.value : null} dropValue={preview.drop ? preview.drop.value : null} net={preview.valueDelta} />

            {/* Bid (faab) */}
            {preview.system === 'faab' ? (
              <>
                <Text style={styles.fieldLabel}>FAAB bid{preview.suggestedBid != null ? ` · suggested $${preview.suggestedBid}` : ''}</Text>
                <View style={styles.bidRow}>
                  <Stepper onPress={() => { const n = Math.max(0, Number(bid || 0) - 1); setBid(String(n)); refresh({ bid: n }); }} label="−" />
                  <TextInput
                    style={styles.bidInput}
                    keyboardType="number-pad"
                    value={bid == null ? '' : String(bid)}
                    onChangeText={(t) => setBid(t.replace(/[^0-9]/g, ''))}
                    onEndEditing={() => refresh({ bid: Number(bid || 0) })}
                  />
                  <Stepper onPress={() => { const n = Number(bid || 0) + 1; setBid(String(n)); refresh({ bid: n }); }} label="+" />
                  {preview.budgetAfter != null ? <Text style={styles.budgetAfter}>${preview.budgetAfter} left after</Text> : null}
                </View>
                <BidPlanRow plan={preview.bidPlan} current={bid} onPick={(n) => { setBid(String(n)); refresh({ bid: n }); }} />
              </>
            ) : null}

            {preview.errors && preview.errors.length ? (
              <Text style={styles.sheetError}>{preview.errors.join(' ')}</Text>
            ) : null}

            <Button
              title={preview.immediate ? 'Add Player' : 'Submit Claim'}
              onPress={submit}
              busy={busy}
              disabled={!preview.valid}
            />
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </>
        )}
      </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

// Edit a queued FAAB bid. Deliberately minimal — the add and drop are fixed; only the $ changes (to
// change who/what, cancel and re-file). The backend re-files the whole round with the new bid.
function EditBidSheet({ claim, onClose, onSave }) {
  const [bid, setBid] = useState(claim.bid != null ? String(claim.bid) : '0');
  const [busy, setBusy] = useState(false);
  const n = Math.max(0, Number(bid || 0));
  const unchanged = n === (claim.bid != null ? claim.bid : 0);
  async function save() {
    if (busy || unchanged) return;
    setBusy(true);
    await onSave(n); // onSave (saveBid) closes the sheet optimistically + reconciles; it never throws
  }
  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Edit bid · {claim.add ? claim.add.name : ''}</Text>
          <Text style={styles.sheetSub}>{claim.leagueName}{claim.drop ? ` · drops ${claim.drop.name}` : ''}</Text>
          <Text style={styles.fieldLabel}>FAAB bid</Text>
          <View style={styles.bidRow}>
            <Stepper onPress={() => setBid(String(Math.max(0, n - 1)))} label="−" />
            <TextInput
              style={styles.bidInput}
              keyboardType="number-pad"
              value={bid}
              onChangeText={(t) => setBid(t.replace(/[^0-9]/g, ''))}
              autoFocus
            />
            <Stepper onPress={() => setBid(String(n + 1))} label="+" />
          </View>
          <Button
            title={unchanged ? 'No change' : `Update bid to $${n}`}
            onPress={save}
            busy={busy}
            disabled={unchanged}
          />
          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

// File a claim by SEARCHING the player pool — the reliable add path that doesn't depend on the board's
// ranked free-agent list (which can be sparse, or blipped empty by a throttled read). Pick a player →
// the ClaimSheet opens and validates availability for this league (re-reading the FA set fresh), so a
// legitimate claim goes through even when the board looked empty.
function NewClaimSheet({ leagueName, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); setErr(null); setBusy(false); return undefined; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      api.playerSearch(term, { status: 'available' })
        .then((r) => { if (alive) { setRows((r && r.players) || []); setErr(null); } })
        .catch((e) => { if (alive) setErr(e.message); })
        .finally(() => { if (alive) setBusy(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>New waiver claim</Text>
          <Text style={styles.sheetSub}>Search a player to claim{leagueName ? ` in ${leagueName}` : ''}.</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Player name"
            placeholderTextColor={colors.textDim}
            value={q}
            onChangeText={setQ}
            autoFocus
            autoCorrect={false}
            autoCapitalize="words"
          />
          {err ? <Text style={styles.sheetError}>{err}</Text> : null}
          <FlatList
            data={rows}
            keyExtractor={(p) => String(p.id)}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 340 }}
            renderItem={({ item }) => (
              <Pressable style={styles.pickRow} onPress={() => onPick(item.id)}>
                <View style={[styles.posBadge, { borderColor: positionColors[item.position] || colors.textDim, backgroundColor: (positionColors[item.position] || colors.textDim) + '22' }]}>
                  <Text style={[styles.pos, { color: positionColors[item.position] || colors.textDim }]}>{item.position}</Text>
                </View>
                <Text style={styles.pickName} numberOfLines={1}>
                  {item.name}
                  {item.team ? <Text style={styles.pickMeta}>  {item.team}</Text> : null}
                </Text>
                {item.value != null ? <Text style={styles.faValue}>{item.value}</Text> : null}
              </Pressable>
            )}
            ListEmptyComponent={
              busy ? <ActivityIndicator color={colors.accent} style={{ paddingVertical: 18 }} />
                : q.trim().length >= 2 ? <Text style={styles.empty}>No available players match “{q.trim()}”.</Text>
                : <Text style={styles.empty}>Type at least 2 letters to search.</Text>
            }
          />
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

function Center({ children }) {
  return <View style={styles.center}>{children}</View>;
}
function FilterChip({ label, active, onPress, sortStyle }) {
  const scale = usePopScale(active); // Texture: pop when this filter/sort chip becomes active (§2.3)
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={label}>
      <Animated.View style={[styles.filterChip, active && styles.filterChipActive, sortStyle && styles.sortChip, { transform: [{ scale }] }]}>
        <Text style={[styles.filterText, active && { color: colors.text }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}
function Stepper({ onPress, label }) {
  return (
    <Pressable
      style={styles.stepper}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Increase bid' : 'Decrease bid'}
    >
      <Text style={styles.stepperText}>{label}</Text>
    </Pressable>
  );
}
const SYS = {
  faab: { label: 'FAAB', full: 'FAAB — free-agent acquisition budget (blind bidding)', color: colors.accent },
  fcfs: { label: 'FCFS', full: 'FCFS — first come, first served waivers', color: colors.warn },
  free: { label: 'Free agent', full: 'Open free agency — adds immediately', color: colors.good },
};
function SystemBadge({ system, small }) {
  const s = SYS[system] || SYS.free;
  return <Text style={[styles.sysBadge, { color: s.color, borderColor: s.color }, small && styles.sysBadgeSmall]} accessibilityLabel={s.full}>{s.label}</Text>;
}
function SystemInline({ system }) {
  const s = SYS[system] || SYS.free;
  return <Text style={{ color: s.color, fontWeight: '800' }} accessibilityLabel={s.full}>{s.label}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  wizardBtn: { backgroundColor: colors.accent, marginHorizontal: 16, marginBottom: 10, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  wizardBtnText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  // Landing list — league cards (mirrors Lineups).
  ovCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  // A league whose waivers clear within the act-now window — warm border so it's obvious at a glance.
  ovCardImminent: { borderColor: colors.warn, borderWidth: 1.5, backgroundColor: 'rgba(255,162,58,0.06)' },
  imminentBadge: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: 'rgba(255,162,58,0.15)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  imminentText: { color: colors.warn, fontSize: 12, fontWeight: '800' },
  // Cold-overview skeleton blocks (shimmer via Pulse).
  skBar: { height: 12, borderRadius: 4, backgroundColor: colors.cardAlt },
  skBadge: { width: 44, height: 18, borderRadius: 5, backgroundColor: colors.cardAlt },
  skBanner: { height: 44, borderRadius: 10, backgroundColor: colors.cardAlt, marginTop: 8 },
  ovTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ovName: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, marginRight: 10 },
  ovMeta: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 8 },
  stateBanner: { marginTop: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  stateLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  stateLabel: { fontSize: 13, fontWeight: '900' },
  stateSub: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 2 },
  ovTop3: { color: colors.textDim, fontSize: 12, marginTop: 6 },
  lockBadge: { color: colors.warn, fontSize: size.micro, fontWeight: '900', borderWidth: 1, borderColor: colors.warn, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  lockReason: { color: colors.warn, fontSize: 12, marginTop: 6, lineHeight: 16 },
  ovBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  ovCount: { color: colors.text, fontSize: 13, fontWeight: '700' },
  ovPending: { color: colors.accent, fontWeight: '800' },
  chev: { color: colors.textDim, fontSize: 22, fontWeight: '700' },
  rowError: { color: colors.bad, marginTop: 6, fontSize: 13 },
  // Board drill-in back header.
  backRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6, paddingTop: 2 },
  backChev: { color: colors.accent, fontSize: 26, fontWeight: '800', marginRight: 6, marginTop: -2 },
  backText: { color: colors.accent, fontSize: 15, fontWeight: '700', flex: 1 },
  segment: { flexDirection: 'row', marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3, marginBottom: 8 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segActive: { backgroundColor: colors.cardAlt },
  segText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  segTextActive: { color: colors.text },
  metaSortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 8, rowGap: 6 },
  boardMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  sortChips: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metaText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  claimsStrip: { marginHorizontal: 16, marginBottom: 4, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.accent + '55', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  claimsTitle: { color: colors.violetText, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  claimRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  claimAdd: { color: colors.text, fontSize: 14, fontWeight: '800' },
  claimMeta: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  claimDrop: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  claimDelBtn: { paddingHorizontal: 10, paddingVertical: 6, marginLeft: 8 },
  claimDel: { color: colors.bad, fontSize: 13, fontWeight: '800' },
  filterChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 6 },
  filterChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  sortChip: { borderStyle: 'dashed' },
  filterText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 4 },
  faRowWrap: { marginBottom: 10 },
  faRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10 },
  posBadge: { width: 40, paddingVertical: 2, borderRadius: 6, borderWidth: 1, alignItems: 'center', marginRight: 10 },
  pos: { fontSize: 11, fontWeight: '800' },
  faNameRow: { flexDirection: 'row', alignItems: 'center' },
  faName: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  faMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  faValue: { color: colors.gold, fontSize: 15, fontWeight: '900', marginHorizontal: 10 },
  faIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  // Tag rows read via a color-law tint, not opacity — dimming the whole row killed the name's
  // legibility and the "+ Claim" tap affordance. Target = good wash, avoid = bad wash (symmetric).
  faRowTarget: { borderColor: colors.good, backgroundColor: colors.good + '12' },
  faRowAvoid: { borderColor: colors.bad, backgroundColor: colors.bad + '12' },
  faTagMark: { fontSize: 13, fontWeight: '900', marginLeft: 6 },
  addBtnPill: { borderWidth: 1, borderColor: colors.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 4 },
  addBtn: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  leagueChoices: { marginTop: -4, marginBottom: 10, marginLeft: 12, gap: 6 },
  leagueChoice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  leagueChoiceText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  subsection: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 12, marginBottom: 8 },
  pendRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  pendAdd: { color: colors.text, fontSize: 15, fontWeight: '700' },
  pendBid: { color: colors.accent, fontWeight: '900' },
  pendDrop: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  pendLeague: { color: colors.accent, fontSize: 12, marginTop: 4, fontWeight: '600' },
  cancel: { color: colors.bad, fontSize: 13, fontWeight: '700' },
  editClaim: { color: colors.accent, fontSize: 13, fontWeight: '700', marginRight: 16 },
  newClaimBtn: { marginHorizontal: 16, marginBottom: 10, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  newClaimText: { color: colors.onAccent, fontSize: 14, fontWeight: '800' },
  faEmptyWrap: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 24 },
  retry: { marginTop: 14, backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 11, minHeight: 44, justifyContent: 'center' },
  retryText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  searchInput: { marginTop: 10, backgroundColor: colors.cardAlt, borderRadius: 10, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 11 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700', marginLeft: 10 },
  pickMeta: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  resultTag: { fontSize: 11, fontWeight: '900', width: 46 },
  resultText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  resultAddSign: { color: colors.good, fontWeight: '900' },
  resultLink: { color: colors.accent, fontWeight: '800' },
  resultDim: { color: colors.textDim, fontWeight: '600' },
  resultLeague: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 24 },
  error: { color: colors.bad, textAlign: 'center' },
  sysBadge: { fontSize: size.micro, fontWeight: '900', borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  sysBadgeSmall: { fontSize: size.micro, paddingHorizontal: 5 },
  // sheet
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  kav: { width: '100%' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 12 },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderTopWidth: 1, borderColor: colors.border },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sheetSub: { color: colors.textDim, fontSize: 13, marginTop: 2, marginBottom: 8 },
  fieldLabel: { color: colors.violetText, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  dropBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.cardAlt, borderRadius: 10, padding: 12 },
  dropText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  change: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  benchRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  benchName: { color: colors.text, fontSize: 14 },
  benchMeta: { color: colors.textDim, fontSize: 12 },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  stepperText: { color: colors.text, fontSize: 20, fontWeight: '900' },
  bidInput: { backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, color: colors.text, fontSize: 18, fontWeight: '800', minWidth: 70, textAlign: 'center' },
  budgetAfter: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  sheetError: { color: colors.bad, fontSize: 13, marginTop: 12 },
  confirm: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  confirmOff: { backgroundColor: colors.cardAlt },
  confirmText: { color: colors.onAccent, fontSize: 16, fontWeight: '800' },
  cancelBtn: { alignItems: 'center', paddingTop: 14 },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
});
