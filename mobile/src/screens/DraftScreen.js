import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, SectionList, ActivityIndicator, Modal, TextInput } from 'react-native';
import EmptyView from '../components/EmptyView';
import { GlyphMark } from '../components/NeonGlyphs';
import { appAlert } from "../components/AppAlert";
import { useRequirePro } from '../entitlement';
import { api, friendlyError } from '../api';
import { colors, positionColors } from '../theme';
import { displayLg, displayLabel } from '../typography';
import { TopbarTitle } from '../components/Brand';
import PressableScale from '../components/PressableScale';
import LeagueContext from '../components/LeagueContext';
import NeonSign from '../components/NeonSign';
import Reveal from '../components/Reveal';
import useAndroidBack from '../useAndroidBack';
import usePoll from '../usePoll';
import { peekResource, primeResource } from '../useCachedResource';
import { applyPickToHome } from './HomeScreen';
import haptics from '../haptics';

const STATUS = {
  scheduled: { label: 'Scheduled', color: colors.warn },
  in_progress: { label: 'Live', color: colors.good },
  complete: { label: 'Complete', color: colors.textDim },
  none: { label: 'No draft', color: colors.textDim },
};
// Fallback filter chips before the board response lands (or for an older backend without `positions`).
// The live list comes from the server per league — QB/RB/WR/TE always, plus PK/DEF where the league
// starts a kicker/defense — so the chips match what's actually draftable in THIS league.
const DEFAULT_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return iso;
  }
}

// One available-pool row. Memoized so a poll tick / filter tap only re-renders the rows whose
// props actually changed, and rendered inside a FlatList so only the visible slice mounts (the
// pool can be hundreds deep). `isPicking`/`pickingActive` are booleans, not the whole picking id,
// so drafting one player doesn't invalidate every other row.
const PoolRow = React.memo(function PoolRow({ p, rank, myTurn, canPick, isPicking, pickingActive, onScout, onDraft }) {
  return (
    <Reveal delay={Math.min(rank - 1, 12) * 30} animate={rank <= 14}>
      <View style={[styles.avRow, myTurn && styles.avRowLive, p.tag === 'target' && styles.avRowTarget, p.tag === 'avoid' && styles.avRowAvoid]}>
        <PressableScale
          pressableStyle={styles.avIdentityFlex}
          style={styles.avIdentityRow}
          onPress={onScout ? () => onScout(p.id) : undefined}
          disabled={!onScout}
        >
          <Text style={styles.avRank}>{rank}</Text>
          <View style={[styles.dot, { backgroundColor: positionColors[p.position] || colors.textDim }]} />
          <View style={{ flex: 1 }}>
            <View style={styles.avNameRow}>
              <Text style={styles.avName} numberOfLines={1}>{p.name}</Text>
              {p.tag ? <Text style={[styles.tagMark, { color: p.tag === 'target' ? colors.good : colors.bad }]}>{p.tag === 'target' ? '◎' : '⊘'}</Text> : null}
            </View>
            <Text style={styles.avMeta}>{p.position}{p.team ? ` · ${p.team}` : ''}{p.age != null ? ` · ${p.age}y` : ''}{p.adp != null ? ` · ADP ${p.adp}` : ''}</Text>
          </View>
          <Text style={styles.avValue}>{p.value != null ? p.value : '—'}</Text>
        </PressableScale>
        {canPick ? (
          isPicking ? (
            <ActivityIndicator color={colors.accent} style={styles.avDraftBtn} />
          ) : (
            <Pressable
              style={({ pressed }) => [styles.avDraftBtn, pressed && { opacity: 0.7 }]}
              onPress={() => onDraft(p)}
              disabled={pickingActive}
              accessibilityRole="button"
              accessibilityLabel={`Draft ${p.name}`}
            >
              <Text style={styles.avDraftTxt}>Draft</Text>
            </Pressable>
          )
        ) : null}
      </View>
    </Reveal>
  );
});

// One row on the full Board (results) tab: overall #, round·pick, pick owner, and either the
// drafted player or the slot's status (on the clock / upcoming). My picks and the on-clock slot are
// highlighted. Memoized — a poll tick only re-renders the slots whose props actually change. Tapping a
// made pick opens the player's profile to scout it.
const BoardRow = React.memo(function BoardRow({ s, isClock, onScout, onTradePick }) {
  const player = s.player;
  // An unmade slot is a tradeable pick: show a trade glyph — shop it if it's mine, else trade for it.
  const canTrade = !player && s.pickToken && onTradePick;
  return (
    <Pressable
      style={[styles.bRow, s.mine && styles.bRowMine, isClock && styles.bRowClock]}
      onPress={player && onScout ? () => onScout(player.id) : undefined}
      disabled={!player || !onScout}
    >
      <View style={styles.bNums}>
        <Text style={[styles.bOverall, s.mine && styles.bOverallMine, isClock && styles.bOverallClock]}>#{s.overall}</Text>
        <Text style={styles.bSlot}>{s.round}.{String(s.pick).padStart(2, '0')}</Text>
      </View>
      <View style={styles.bMain}>
        <Text style={[styles.bOwner, s.mine && styles.bOwnerMine, isClock && styles.bOwnerClock]} numberOfLines={1}>
          {s.franchiseName || `Team ${s.franchiseId}`}{s.mine ? ' · You' : ''}
        </Text>
        {player ? (
          <View style={styles.bPlayerRow}>
            <View style={[styles.dot, { backgroundColor: positionColors[player.position] || colors.textDim }]} />
            <Text style={styles.bPlayer} numberOfLines={1}>{player.name}</Text>
            <Text style={styles.bPlayerMeta}>{player.position}{player.value != null ? ` · ${player.value}` : ''}</Text>
          </View>
        ) : (
          <Text style={[styles.bStatus, isClock && styles.bStatusClock]}>{isClock ? 'On the clock' : 'Upcoming'}</Text>
        )}
      </View>
      {canTrade ? (
        <Pressable
          onPress={() => onTradePick(s)}
          hitSlop={10}
          style={({ pressed }) => [styles.bTrade, pressed && { opacity: 0.6 }]}
          accessibilityLabel={s.mine ? 'Shop this pick' : 'Trade for this pick'}
        >
          <GlyphMark name="swap" size={17} color={colors.accent} weight={2.2} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

// Human duration: "7h 12m" / "12m 05s" / "45s".
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

// A pause-window hour (ET, 0–23) -> "8:00 AM" for the "resumes at…" line.
function hourLabel(h) {
  const ampm = h % 24 < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${ampm}`;
}

// The current pick's live countdown. The backend snapshot carries the ACTIVE ms left (nightly pause
// excluded) and whether we're paused right now. We tick that down locally each second while active,
// and FREEZE it while paused so the pause is respected — the number doesn't drain overnight. The
// snapshot re-anchors on every 15s poll, so local drift never accumulates and a pause boundary
// crossed between polls self-corrects on the next refresh.
const PickClock = React.memo(function PickClock({ pickClock, mine }) {
  const { remainingMs, paused, overdue, pause, deadline } = pickClock;
  const [now, setNow] = useState(() => Date.now());
  // Anchor to this snapshot; recompute (and re-sync `now`) whenever the snapshot or paused state changes.
  const anchor = useMemo(() => ({ at: Date.now(), remainingMs }), [remainingMs, paused]);
  useEffect(() => {
    setNow(Date.now());
    if (paused) return undefined; // frozen while paused — no ticking
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anchor, paused]);

  const remaining = paused ? anchor.remainingMs : anchor.remainingMs - (now - anchor.at);
  const isOverdue = overdue || (!paused && remaining <= 0);
  const urgent = mine && !paused && !isOverdue && remaining <= 60 * 60 * 1000;
  const tone = paused ? colors.warn : isOverdue ? colors.bad : urgent ? colors.warn : colors.gold;

  return (
    <View style={[styles.pc, { borderColor: tone + '66', backgroundColor: tone + '14' }]}>
      {paused ? (
        <>
          <View style={styles.pcRow}>
            <NeonSign glyph="pause" color="warn" grade="inline" size={18} />
            <Text style={[styles.pcBig, { color: tone }]}>Paused</Text>
          </View>
          <Text style={styles.pcSub}>Resumes{pause ? ` ${hourLabel(pause.end)} ET` : ''} · {fmtDur(anchor.remainingMs)} left</Text>
        </>
      ) : isOverdue ? (
        <>
          <View style={styles.pcRow}>
            <NeonSign glyph="hourglass" color="bad" grade="ailing" size={18} />
            <Text style={[styles.pcBig, { color: tone }]}>Overdue</Text>
          </View>
          <Text style={styles.pcSub}>The clock has expired — auto-pick is imminent</Text>
        </>
      ) : (
        <>
          <Text style={[styles.pcBig, { color: tone }]}>{fmtDur(remaining)} <Text style={styles.pcUnit}>left</Text></Text>
          <Text style={styles.pcSub}>Due {fmtDate(deadline)}{pause ? ` · pauses ${hourLabel(pause.start)}–${hourLabel(pause.end)} ET` : ''}</Text>
        </>
      )}
    </View>
  );
});

export default function DraftScreen({ league, demoMode, covered = false, onBack, onOpenPlayer, onOpenTrades, onOpenDraftList }) {
  const requirePro = useRequirePro();
  // Seed the board from the survive-remount cache so reopening the draft paints the last board
  // instantly instead of a cold spinner; the live poll (below) keeps it current.
  const boardKey = `draft:${league.leagueId}`;
  const [data, setData] = useState(() => (peekResource(boardKey) ? peekResource(boardKey).value : null));
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(() => !peekResource(boardKey));
  const [position, setPosition] = useState(null);
  const [tab, setTab] = useState('pick'); // 'pick' = value-ranked pool + my picks; 'board' = full results grid
  const [picking, setPicking] = useState(null); // playerId being drafted
  const [confirming, setConfirming] = useState(null); // player pending the draft-confirm sheet
  const [note, setNote] = useState(''); // optional pick comment (email drafts)

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.leagueDraft(league.leagueId);
      setData(d);
      primeResource(boardKey, d);
    } catch (e) {
      // Non-destructive AND silent: a failed BACKGROUND refresh (poll / focus) keeps the last board on
      // screen and says nothing. A live draft polls repeatedly, so toasting on every throttled tick was
      // the "message pops up every 15–30s" spam — the board is already showing the last-good state, so
      // the failure needs no announcement. Only a COLD load (nothing to show) surfaces the error inline.
      if (!dataRef.current) setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league.leagueId]);

  useEffect(() => { load(); }, [load]);
  // While the draft is live, poll so the board and "on the clock" update as other
  // teams pick — without a manual pull. Not while picking (avoids clobbering) or
  // when scheduled/complete.
  // Pause the live poll while this board is covered by another overlay (not visible) — but keep polling
  // when it's the top/visible screen so a live draft never freezes (UX_GUARDRAILS: reflect-live).
  // Poll cadence scales to the draft's PACE. A slow/email draft (hours per pick, nightly pauses) doesn't
  // need a 15s refresh — that's pointless MFL load that, under a throttle, produced a refresh-failure on
  // every tick. Key off the current pick's clock: the less time on it, the hotter the draft, the faster
  // we poll. A genuinely live fast clock still refreshes every 15s so picks reflect promptly.
  // Poll cadence keyed to PROXIMITY, not just the current pick's nominal clock. Keying only off the
  // current clock went stale in a real case: a slow-clock draft where picks actually come fast polled
  // every few minutes, so the board fell behind — it read "2 picks away" while Home (fresher) already
  // showed on-the-clock. So: my pick, or within a few picks of it → poll fast (never go stale right
  // before my turn); paused overnight → slow; otherwise a steady moderate cadence. Cheap now that the
  // free-agent pool is pinned during a live draft (only the small draftResults read refetches).
  const pollMs = useMemo(() => {
    if (!data || data.status !== 'in_progress') return 30000;
    if (data.onClock && data.onClock.mine) return 15000; // it's my pick — keep it live
    const cur = data.onClock ? data.onClock.overall : null;
    const myNext =
      cur != null
        ? (data.myPicks || [])
            .filter((s) => !s.player && typeof s.overall === 'number' && s.overall >= cur)
            .map((s) => s.overall)
            .sort((a, b) => a - b)[0]
        : null;
    if (myNext != null && myNext - cur <= 3) return 15000; // about to be up — don't fall behind
    if (data.pickClock && data.pickClock.paused) return 300000; // paused overnight → every 5 min
    return 45000; // live but not close to my turn → steady, honest cadence
  }, [data]);
  // Don't poll while a pick is in flight (avoids clobbering) OR while the draft-confirm sheet is armed
  // (a background refresh must not reflow the pool behind the pick you're about to commit — #21).
  usePoll(load, pollMs, !!(data && data.status === 'in_progress') && !picking && !confirming && !covered);

  const myTurn = !!(data && data.onClock && data.onClock.mine);
  // In-app drafting works in BOTH modes now: live picks go through MFL's `live_draft` command
  // (CMD=DRAFT), so a live/slow draft can be run from the app. A live pick is a real, hard-to-undo
  // write, so confirmDraft double-confirms and notes the submission.
  const canPickInApp = true;
  const canPick = myTurn && canPickInApp;

  const pool = useMemo(() => {
    if (!data || !data.available) return [];
    return position ? data.available.filter((p) => p.position === position) : data.available;
  }, [data, position]);
  // Freeze the pool order while it's my turn so a background poll can't reflow the list under my finger
  // as I reach for a Draft button (#21). Snapshot only when my turn STARTS or the position filter
  // changes — NOT on every pool update — so the visible order holds steady while I choose; it goes live
  // again the instant my turn ends (after I pick). The confirm sheet (which names the player) is still
  // the final guard; this keeps the wrong row from sliding under the tap in the first place.
  const [frozenPool, setFrozenPool] = useState(null);
  useEffect(() => {
    setFrozenPool(canPick ? pool : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPick, position]);
  const displayPool = canPick && frozenPool ? frozenPool : pool;
  // Server-supplied draftable positions for this league (adds PK/DEF only where they're started).
  const posFilters = data && Array.isArray(data.positions) && data.positions.length ? data.positions : DEFAULT_POSITIONS;

  // The full board (results) tab, grouped by round for the SectionList. Each section is a round of
  // slots in pick order — made picks and the upcoming ones alike, so you can see every pick and who
  // owns it. Overall pick number lives on each slot.
  const boardSections = useMemo(() => {
    if (!data || !data.board) return [];
    const byRound = new Map();
    for (const s of data.board) {
      if (!byRound.has(s.round)) byRound.set(s.round, []);
      byRound.get(s.round).push(s);
    }
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, picks]) => ({
        round,
        made: picks.filter((s) => s.player).length,
        total: picks.length,
        data: picks.slice().sort((a, b) => a.pick - b.pick),
      }));
  }, [data]);
  const clockOverall = data && data.onClock ? data.onClock.overall : null;

  // Trade an unmade board pick: if it's MINE, shop it (open the desk with it on my side); if it's a
  // rival's, start a trade FOR it (their team as partner, the pick on the you-get side + a suggested
  // give). Reuses the desk's existing seeds — same wiring as the roster/pick-capital pick trade.
  const onTradePick = useCallback((s) => {
    if (!onOpenTrades || !s || !s.pickToken) return;
    if (s.mine) onOpenTrades(league, 'propose', { sendPickToken: s.pickToken });
    else onOpenTrades({ leagueId: league.leagueId, name: league.name }, 'propose', { targetPlayerId: s.pickToken, partnerFranchiseId: String(s.franchiseId) });
  }, [onOpenTrades, league]);

  // A draft pick is irreversible, so confirm before committing (the pool rows now open
  // a profile on tap, and the explicit Draft button routes through here).
  // A pick is irreversible, so route it through a confirm sheet (with an optional note that MFL
  // surfaces in the draft log — "meant for email drafts").
  function confirmDraft(p) {
    if (!myTurn || picking != null) return;
    setNote('');
    setConfirming(p);
  }

  async function draftPlayer(p, comment) {
    if (!myTurn) return;
    if (!requirePro('draft.pick')) return; // Pro gate (inert until enforced)
    setConfirming(null);
    setPicking(p.id);
    try {
      const res = await api.makeDraftPick(league.leagueId, p.id, comment && comment.trim() ? comment.trim() : undefined);
      if (res && res.board) {
        // Full confirmation board came back (already includes the pick) — paint it.
        setData(res);
        primeResource(boardKey, res);
        applyPickToHome(league.leagueId, res); // drop this league off Home's "on the clock" immediately
      } else {
        // Pick SUCCEEDED but the board rebuild lagged (a transient throttle) — the backend returned a
        // success sentinel, not a board. Refresh to pull in the updated board rather than showing an
        // error for a pick that actually went through.
        load();
      }
      haptics.success(); // making a pick has no toast/celebrate — give the moment its own beat
    } catch (e) {
      appAlert('Could not draft', friendlyError(e.message), undefined, { tone: 'error' });
    } finally {
      setPicking(null);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.container}>
        <View style={styles.topbar}>
          <Pressable onPress={onBack} hitSlop={10}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          <TopbarTitle focused={!covered} numberOfLines={1}>{league.name}</TopbarTitle>
          {onOpenTrades ? (
            <Pressable onPress={() => onOpenTrades(league)} hitSlop={10} style={styles.tradesLinkBtn}>
              <GlyphMark name="swap" size={14} color={colors.accent} weight={2} />
              <Text style={styles.tradesLink}>Trades</Text>
            </Pressable>
          ) : <View style={{ width: 44 }} />}
        </View>
        <View style={styles.center}>
          <Text style={styles.error}>{error || 'Could not load the draft.'}</Text>
          <Pressable style={styles.retry} onPress={load}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      </View>
    );
  }

  const st = STATUS[(data && data.status) || 'none'] || STATUS.none;
  const recent = data && data.board ? data.board.filter((s) => s.player).slice(-6).reverse() : [];

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <TopbarTitle focused={!covered} numberOfLines={1}>{league.name}</TopbarTitle>
        <View style={{ width: 44 }} />
      </View>

      {data && data.status === 'none' ? (
        <EmptyView title="No draft in this league" message="This league doesn’t have a draft set up." />
      ) : (
        <>
        <View style={styles.tabRow} accessibilityRole="tablist">
          <Pressable style={[styles.tab, tab === 'pick' && styles.tabActive]} onPress={() => setTab('pick')} accessibilityRole="tab" accessibilityState={{ selected: tab === 'pick' }} accessibilityLabel="Pick">
            <Text style={[styles.tabText, tab === 'pick' && styles.tabTextActive]}>Pick</Text>
          </Pressable>
          <Pressable style={[styles.tab, tab === 'board' && styles.tabActive]} onPress={() => setTab('board')} accessibilityRole="tab" accessibilityState={{ selected: tab === 'board' }} accessibilityLabel="Board">
            <Text style={[styles.tabText, tab === 'board' && styles.tabTextActive]}>Board</Text>
          </Pressable>
        </View>
        {tab === 'board' ? (
        <SectionList
          sections={boardSections}
          keyExtractor={(s) => String(s.overall)}
          contentContainerStyle={styles.list}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={11}
          removeClippedSubviews
          stickySectionHeadersEnabled={false}
          renderItem={({ item }) => (
            <BoardRow s={item} isClock={clockOverall != null && item.overall === clockOverall} onScout={onOpenPlayer} onTradePick={onOpenTrades ? onTradePick : undefined} />
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.bSectionHead}>
              <Text style={styles.bSectionTitle}>Round {section.round}</Text>
              <Text style={styles.bSectionCount}>{section.made}/{section.total} picked</Text>
            </View>
          )}
          ListHeaderComponent={
            <View style={styles.headerRow}>
              <Text style={[styles.dtype, displayLg()]}>Draft board</Text>
              <View style={[styles.badge, { borderColor: st.color }]}>
                <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
              </View>
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>The draft order isn’t available yet.</Text>}
          ListFooterComponent={<View style={{ height: 24 }} />}
        />
        ) : (
        <FlatList
          data={displayPool}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={styles.list}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={11}
          removeClippedSubviews
          renderItem={({ item, index }) => (
            <PoolRow
              p={item}
              rank={index + 1}
              myTurn={myTurn}
              canPick={canPick}
              isPicking={picking === item.id}
              pickingActive={picking != null}
              onScout={onOpenPlayer}
              onDraft={confirmDraft}
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>No available players{position ? ` at ${position}` : ''}.</Text>}
          ListHeaderComponent={
            <View>
              <View style={styles.headerRow}>
                <Text style={[styles.dtype, displayLg()]}>{data.type || 'Draft'}</Text>
                <View style={[styles.badge, { borderColor: st.color }]}>
                  <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
                </View>
              </View>
              {data.status === 'scheduled' && data.startTime ? (
                <Text style={styles.sched}>Starts {fmtDate(data.startTime)}</Text>
              ) : null}

              {data.context ? <LeagueContext context={data.context} /> : null}

              {onOpenDraftList ? (
                <Pressable style={({ pressed }) => [styles.listBtn, pressed && { opacity: 0.85 }]} onPress={() => onOpenDraftList(league)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listBtnTitle}>★ My Draft List</Text>
                    <Text style={styles.listBtnSub}>Rank your targets — MFL auto-picks the top available when you're on the clock</Text>
                  </View>
                  <Text style={styles.listBtnChev}>›</Text>
                </Pressable>
              ) : null}

              {myTurn ? (
                <View style={styles.clock}>
                  <Text style={styles.clockText}>You're on the clock — pick {data.onClock.round}.{String(data.onClock.pick).padStart(2, '0')}</Text>
                  {data.pickClock ? <PickClock pickClock={data.pickClock} mine /> : null}
                  <Text style={styles.clockSub}>{canPickInApp ? 'Tap a player below to draft' : 'Make this pick in the MyFantasyLeague draft room — it’ll show here once processed'}</Text>
                </View>
              ) : data.onClock ? (
                <View style={styles.waitingBox}>
                  <Text style={styles.waiting}>On the clock: pick {data.onClock.round}.{String(data.onClock.pick).padStart(2, '0')} (another team)</Text>
                  {data.pickClock ? <PickClock pickClock={data.pickClock} /> : null}
                </View>
              ) : null}

              {data.myPicks && data.myPicks.length ? (
                <>
                  <Text style={[styles.section, displayLabel()]}>My picks</Text>
                  {data.myPicks.map((s) => (
                    <View key={s.overall} style={styles.pickRow}>
                      <Text style={styles.pickNo}>{s.round}.{String(s.pick).padStart(2, '0')}</Text>
                      {s.player ? (
                        <>
                          <View style={[styles.dot, { backgroundColor: positionColors[s.player.position] || colors.textDim }]} />
                          <Text style={styles.pickName} numberOfLines={1}>{s.player.name}</Text>
                          <Text style={styles.pickMeta}>{s.player.position}{s.player.value != null ? ` · ${s.player.value}` : ''}</Text>
                        </>
                      ) : (
                        <Text style={styles.pickUpcoming}>Upcoming</Text>
                      )}
                    </View>
                  ))}
                </>
              ) : null}

              <Text style={[styles.section, displayLabel()]}>Available · by ADP{myTurn ? (canPickInApp ? ' · tap a name to scout, Draft to pick' : ' · tap a name to scout') : ''}</Text>
              <View style={styles.posRow}>
                <Pressable style={[styles.posChip, !position && styles.posChipActive]} onPress={() => setPosition(null)}>
                  <Text style={[styles.posText, !position && { color: colors.text }]}>All</Text>
                </Pressable>
                {posFilters.map((p) => (
                  <Pressable key={p} style={[styles.posChip, position === p && styles.posChipActive]} onPress={() => setPosition(position === p ? null : p)}>
                    <Text style={[styles.posText, position === p && { color: colors.text }]}>{p === 'PK' ? 'K' : p}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          ListFooterComponent={
            recent.length ? (
              <View>
                <Text style={[styles.section, displayLabel()]}>Recent picks</Text>
                {recent.map((s) => (
                  <View key={s.overall} style={styles.pickRow}>
                    <Text style={styles.pickNo}>{s.round}.{String(s.pick).padStart(2, '0')}</Text>
                    <View style={[styles.dot, { backgroundColor: positionColors[s.player.position] || colors.textDim }]} />
                    <Text style={styles.pickName} numberOfLines={1}>{s.player.name}</Text>
                    <Text style={styles.pickMeta}>{s.player.position}</Text>
                  </View>
                ))}
                <View style={{ height: 24 }} />
              </View>
            ) : <View style={{ height: 24 }} />
          }
        />
        )}
        </>
      )}

      <Modal visible={!!confirming} transparent animationType="fade" onRequestClose={() => setConfirming(null)}>
        <Pressable style={styles.backdrop} onPress={() => setConfirming(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {confirming ? (
              <>
                <Text style={styles.sheetTitle}>
                  Draft {confirming.name}
                  {data && data.onClock ? ` at ${data.onClock.round}.${String(data.onClock.pick).padStart(2, '0')}` : ''}?
                </Text>
                <Text style={styles.sheetMeta}>
                  {confirming.position}{confirming.team ? ` · ${confirming.team}` : ''}{confirming.value != null ? ` · value ${confirming.value}` : ''}
                </Text>
                {!demoMode ? (
                  <>
                    <TextInput
                      style={styles.noteInput}
                      placeholder="Add a note (optional — shown in the draft log)"
                      placeholderTextColor={colors.textDim}
                      value={note}
                      onChangeText={setNote}
                      maxLength={255}
                      multiline
                    />
                    <Text style={styles.sheetWarn}>This submits your pick to MyFantasyLeague — it can’t be undone from the app.</Text>
                  </>
                ) : null}
                <View style={styles.sheetBtns}>
                  <Pressable style={({ pressed }) => [styles.sheetBtn, pressed && { opacity: 0.7 }]} onPress={() => setConfirming(null)}>
                    <Text style={styles.sheetBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={({ pressed }) => [styles.sheetBtn, styles.sheetBtnGo, pressed && { opacity: 0.85 }]} onPress={() => draftPlayer(confirming, note)}>
                    <Text style={[styles.sheetBtnText, styles.sheetBtnGoText]}>Draft</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderTopWidth: 1, borderColor: colors.border },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sheetMeta: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  noteInput: { marginTop: 14, minHeight: 44, maxHeight: 100, backgroundColor: colors.cardAlt, borderRadius: 10, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: 'top' },
  sheetWarn: { color: colors.textDim, fontSize: 12, marginTop: 10, lineHeight: 16 },
  sheetBtns: { flexDirection: 'row', gap: 10, marginTop: 18 },
  sheetBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  sheetBtnText: { color: colors.text, fontSize: 15, fontWeight: '800' },
  sheetBtnGo: { backgroundColor: colors.gold, borderColor: colors.gold },
  sheetBtnGoText: { color: colors.onAccent },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', minWidth: 60 },
  tradesLinkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, minWidth: 60 },
  tradesLink: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  list: { padding: 16 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  tabActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  tabText: { color: colors.textDim, fontSize: 14, fontWeight: '800' },
  tabTextActive: { color: colors.text },
  bSectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  bSectionTitle: { color: colors.violetText, fontSize: 15, fontWeight: '900' },
  bSectionCount: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  bRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  // "Yours" is an identity cue → Signal Blue. "On the clock" is the reserved gold moment and must be
  // the unmistakable hero, so it wins the row (border + fill + text) even when the slot is also mine.
  bRowMine: { borderColor: colors.accent, backgroundColor: colors.accent + '14' },
  bRowClock: { borderColor: colors.gold, backgroundColor: colors.gold + '1F' },
  bNums: { width: 58, marginRight: 10 },
  bOverall: { color: colors.text, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  bOverallMine: { color: colors.accent },
  bOverallClock: { color: colors.gold },
  bSlot: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 1, fontVariant: ['tabular-nums'] },
  bMain: { flex: 1 },
  bOwner: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  bOwnerMine: { color: colors.accent },
  bOwnerClock: { color: colors.gold },
  bPlayerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  bPlayer: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  bPlayerMeta: { color: colors.textDim, fontSize: 12, marginLeft: 8 },
  bStatus: { color: colors.textDim, fontSize: 13, fontStyle: 'italic', marginTop: 3 },
  bStatusClock: { color: colors.gold, fontStyle: 'normal', fontWeight: '800' },
  // Trade glyph on an unmade board pick. Trade is an ACTION → accent (per the color law), not violet.
  bTrade: { marginLeft: 8, width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: colors.accent, backgroundColor: 'rgba(79,140,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  bTradeIcon: { color: colors.accent, fontSize: 17, fontWeight: '900' },
  error: { color: colors.bad, textAlign: 'center', marginTop: 12, marginHorizontal: 24 },
  retry: { marginTop: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: colors.accent, fontWeight: '700' },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 20, fontSize: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dtype: { color: colors.text, fontSize: 18, fontWeight: '900' },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  sched: { color: colors.textDim, fontSize: 13, marginTop: 6 },
  listBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.gold + '77', paddingHorizontal: 14, paddingVertical: 12, marginTop: 12 },
  listBtnTitle: { color: colors.gold, fontSize: 14, fontWeight: '900' },
  listBtnSub: { color: colors.textDim, fontSize: 11, marginTop: 2, lineHeight: 15 },
  listBtnChev: { color: colors.textDim, fontSize: 20, fontWeight: '700', marginLeft: 8 },
  clock: { backgroundColor: colors.gold + '22', borderColor: colors.gold, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 12 },
  clockText: { color: colors.gold, fontSize: 16, fontWeight: '900' },
  clockSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  waiting: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  waitingBox: { marginTop: 12 },
  pc: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
  pcRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pcBig: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  pcUnit: { fontSize: 13, fontWeight: '700', color: colors.textDim },
  pcSub: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  section: { color: colors.violetText, fontSize: 14, fontWeight: '800', marginTop: 20, marginBottom: 8 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickNo: { color: colors.textDim, fontSize: 13, fontWeight: '800', width: 44 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  pickName: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  pickMeta: { color: colors.textDim, fontSize: 12, marginLeft: 8 },
  pickUpcoming: { color: colors.textDim, fontSize: 13, fontStyle: 'italic', flex: 1 },
  posRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  posChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 6 },
  posChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  posText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  avRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  avRowLive: { borderColor: colors.gold },
  avRowTarget: { borderColor: colors.good, backgroundColor: colors.good + '10' },
  // Avoid = a red color-WASH, not opacity. Dimming to 0.5 (the pattern Waivers explicitly rejected)
  // kills the name's legibility and the Draft button's tap affordance on the highest-pressure screen —
  // the ⊘ tag mark already signals "avoid" (usability backlog #20).
  avRowAvoid: { borderColor: colors.bad, backgroundColor: colors.bad + '12' },
  avNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagMark: { fontSize: 13, fontWeight: '900' },
  avIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  avIdentityFlex: { flex: 1 },
  avIdentityRow: { flexDirection: 'row', alignItems: 'center' },
  avDraftBtn: { marginLeft: 10, backgroundColor: colors.gold, borderRadius: 8, paddingHorizontal: 14, minWidth: 58, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  avDraftTxt: { color: colors.onAccent, fontSize: 13, fontWeight: '900' },
  avRank: { color: colors.textDim, fontSize: 13, fontWeight: '800', width: 22 },
  avName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  avMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  avValue: { color: colors.gold, fontSize: 16, fontWeight: '900', minWidth: 30, textAlign: 'right' },
});
