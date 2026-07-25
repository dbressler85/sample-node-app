import React, { useCallback, useEffect, useState } from 'react';
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
  Alert,
} from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import { celebrate } from '../components/Celebrate';
import AvailabilityBadge from '../components/AvailabilityBadge';
import ValueDelta from '../components/ValueDelta';
import { toast } from '../components/Toast';
import ErrorView from '../components/ErrorView';
import Reveal from '../components/Reveal';
import useAndroidBack from '../useAndroidBack';
import useCachedResource from '../useCachedResource';
import { ScreenTitle } from '../components/Brand';

const SORTS = [
  { key: 'value', label: 'Market' },
  { key: 'projection', label: 'Proj' },
  { key: 'season', label: 'Yr pts' },
  { key: 'ownership', label: 'Own%' },
  { key: 'trend', label: 'Trend' },
];

export default function WaiversScreen({ active = true, initialLeagueId, initialPosition, initialSort, onStartWizard, onOpenPlayer, onOpenLineup }) {
  // Landing overview via the shared hook: instant paint on remount (survives the tab-switch
  // unmount), throttled reloads, and it keeps the list on a failed refresh. `loadOverview`
  // (reload) is also called after a claim to reflect it immediately.
  const { data: overview, error: overviewError, refreshing: ovRefreshing, reload: loadOverview } = useCachedResource('waivers:overview', () => api.waiversOverview(), { active });
  // Pending claims go through the same cached hook so switching to the Pending tab paints the last
  // snapshot INSTANTLY (the screen unmounts on every tab switch, so a bare fetch showed a cold
  // full-screen spinner every single time). It revalidates in the background and after a claim.
  const { data: pending, reload: loadPending } = useCachedResource('waivers:pending', () => api.waiverPending(), { active });
  const [wizardLoading, setWizardLoading] = useState(false);
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

  function closeBoard() {
    setOpenLeagueId(null);
    setBoard(null);
    setPosition(null);
  }

  // Back: claim / batch sheet first, then the board drill-in (returns to overview).
  useAndroidBack(useCallback(() => {
    if (claim) {
      setClaim(null);
      return true;
    }
    if (openLeagueId) {
      closeBoard();
      return true;
    }
    return false;
  }, [claim, openLeagueId]));

  // Board for the drilled-in league.
  const loadBoard = useCallback(async () => {
    if (!openLeagueId) return;
    setLoading(true);
    setError(null);
    try {
      setBoard(await api.waiverBoard(openLeagueId, { position, sort }));
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

  // Fetch per-league pickup suggestions, then hand the wizard a queue of the
  // leagues that actually have free agents to consider.
  async function startWizard() {
    if (!onStartWizard) return;
    setWizardLoading(true);
    try {
      const res = await api.waiverSuggestions();
      // Include locked leagues so the wizard can explain them (draft pending, etc.)
      // rather than silently omitting them.
      const queue = (res.leagues || []).filter((l) => !l.error && (l.locked || (l.candidates && l.candidates.length)));
      if (!queue.length) {
        Alert.alert('Nothing to pick up', 'No free agents worth a claim across your leagues right now.');
        return;
      }
      onStartWizard(queue);
    } catch (e) {
      Alert.alert('Could not build suggestions', e.message);
    } finally {
      setWizardLoading(false);
    }
  }

  async function cancelClaim(cid, lid) {
    try {
      await api.cancelClaim(lid, cid);
      loadPending();
      loadOverview();
      if (openLeagueId) loadBoard(); // reflect the removed claim in the board's claims strip
    } catch (e) {
      Alert.alert('Could not cancel', e.message);
    }
  }

  const summary = overview && overview.summary;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ScreenTitle>Waivers</ScreenTitle>
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
                  disabled={wizardLoading}
                >
                  {wizardLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.wizardBtnText}>Waiver Wizard — pick up across leagues</Text>
                  )}
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
            <PendingView pending={pending} onCancel={cancelClaim} onOpenPlayer={onOpenPlayer} />
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

    </View>
  );
}

// The per-league landing list — mirrors the Lineups overview. Each card shows
// the league's pickup system, budget/priority, roster space, how many free
// agents are worth a look, and pending claims; tapping drills into its board.
function OverviewView({ overview, loading, refreshing, error, onOpen, onRefresh }) {
  if (loading && !overview) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;
  if (error && !overview) return <ErrorView message={error} onRetry={onRefresh} onRefresh={onRefresh} refreshing={refreshing} />;
  return (
    <FlatList
      data={overview ? overview.leagues : []}
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
    return { icon: '🟢', label: 'Free agency open', sub: 'Add anyone now — processes immediately', color: colors.good };
  }
  if (item.waiverState === 'waivers_soon') {
    return {
      icon: '⏳',
      label: item.nextWaiverRun != null ? `Waivers process ${runLabel(item.nextWaiverRun)}` : 'Waiver cycle running',
      sub: 'Claims you place queue now and process at the run',
      color: colors.accent,
    };
  }
  return { icon: '🔒', label: 'Waivers closed', sub: item.lockReason || 'No open free agency and no upcoming waiver run', color: colors.textDim };
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
  return (
    <Pressable style={({ pressed }) => [styles.ovCard, { borderLeftWidth: 3, borderLeftColor: st.color }, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={styles.ovTop}>
        <Text style={styles.ovName} numberOfLines={1}>{item.name}</Text>
        <SystemBadge system={item.system} />
      </View>
      <View style={[styles.stateBanner, { backgroundColor: st.color + '18', borderColor: st.color + '55' }]}>
        <Text style={[styles.stateLabel, { color: st.color }]}>{st.icon}  {st.label}</Text>
        <Text style={styles.stateSub} numberOfLines={2}>{st.sub}</Text>
      </View>
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

function BoardView({ board, loading, error, position, setPosition, sort, setSort, onPick, onBack, leagueName, onOpenPlayer, onRetry, onCancel }) {
  const header = onBack ? (
    <Pressable style={styles.backRow} onPress={onBack} hitSlop={8}>
      <Text style={styles.backChev}>‹</Text>
      <Text style={styles.backText} numberOfLines={1}>{leagueName || 'Leagues'}</Text>
    </Pressable>
  ) : null;

  if (loading) return <View style={{ flex: 1 }}>{header}<Center><ActivityIndicator color={colors.accent} size="large" /></Center></View>;
  if (error) return <View style={{ flex: 1 }}>{header}<ErrorView message={error} onRetry={onRetry} /></View>;
  if (!board) return <View style={{ flex: 1 }}>{header}</View>;

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
          <FaRow p={item} onPress={() => onPick(item.id)} onOpenPlayer={onOpenPlayer} />
        </Reveal>
      )}
        ListEmptyComponent={<Text style={styles.empty}>No free agents match.</Text>}
      />
    </View>
  );
}

function FaRow({ p, onPress, onOpenPlayer }) {
  const posColor = positionColors[p.position] || colors.textDim;
  // Identity (badge + name + meta + value) opens the cross-league profile to research the
  // player; the "+ Claim" pill is the action. Falls back to a whole-row claim if no profile
  // handler is wired.
  const Identity = onOpenPlayer ? Pressable : View;
  const idProps = onOpenPlayer ? { onPress: () => onOpenPlayer(p.id) } : {};
  return (
    <View style={[styles.faRow, p.tag === 'target' && styles.faRowTarget, p.tag === 'avoid' && styles.faRowAvoid]}>
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

function PendingView({ pending, onCancel, onOpenPlayer }) {
  if (!pending) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={styles.subsection}>Pending claims · {pending.summary.pending}</Text>
      {pending.pending.length === 0 ? <Text style={styles.empty}>No pending claims.</Text> : null}
      {pending.pending.map((c) => (
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
          <Pressable onPress={() => onCancel(c.id, c.leagueId)} hitSlop={8}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
      ))}

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

  async function submit() {
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
        Alert.alert('Added', `${addName} is on your roster.`, [
          { text: 'Not now', style: 'cancel', onPress: onDone },
          { text: 'Set lineup', onPress: () => { onDone(); onOpenLineup({ leagueId }); } },
        ]);
      } else {
        toast(`Claim submitted · ${addName}${res.submitted.bid != null ? ` for $${res.submitted.bid}` : ''}`);
        onDone();
      }
    } catch (e) {
      celebrate('claimFailed');
      Alert.alert('Could not submit', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={() => {}}>
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
              </>
            ) : null}

            {preview.errors && preview.errors.length ? (
              <Text style={styles.sheetError}>{preview.errors.join(' ')}</Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.confirm, !preview.valid && styles.confirmOff, pressed && preview.valid && { opacity: 0.85 }]}
              onPress={submit}
              disabled={!preview.valid || busy}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>{preview.immediate ? 'Add Player' : 'Submit Claim'}</Text>}
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </>
        )}
      </Pressable>
    </Pressable>
  );
}

function Center({ children }) {
  return <View style={styles.center}>{children}</View>;
}
function FilterChip({ label, active, onPress, sortStyle }) {
  return (
    <Pressable style={[styles.filterChip, active && styles.filterChipActive, sortStyle && styles.sortChip]} onPress={onPress}>
      <Text style={[styles.filterText, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}
function Stepper({ onPress, label }) {
  return (
    <Pressable style={styles.stepper} onPress={onPress}>
      <Text style={styles.stepperText}>{label}</Text>
    </Pressable>
  );
}
const SYS = { faab: { label: 'FAAB', color: colors.accent }, fcfs: { label: 'FCFS', color: colors.warn }, free: { label: 'Free agent', color: colors.good } };
function SystemBadge({ system, small }) {
  const s = SYS[system] || SYS.free;
  return <Text style={[styles.sysBadge, { color: s.color, borderColor: s.color }, small && { fontSize: 9 }]}>{s.label}</Text>;
}
function SystemInline({ system }) {
  const s = SYS[system] || SYS.free;
  return <Text style={{ color: s.color, fontWeight: '800' }}>{s.label}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  wizardBtn: { backgroundColor: colors.accent, marginHorizontal: 16, marginBottom: 10, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  wizardBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  // Landing list — league cards (mirrors Lineups).
  ovCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  // A league whose waivers clear within the act-now window — warm border so it's obvious at a glance.
  ovCardImminent: { borderColor: colors.warn, borderWidth: 1.5, backgroundColor: 'rgba(255,162,58,0.06)' },
  imminentBadge: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: 'rgba(255,162,58,0.15)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  imminentText: { color: colors.warn, fontSize: 12, fontWeight: '800' },
  ovTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ovName: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, marginRight: 10 },
  ovMeta: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 8 },
  stateBanner: { marginTop: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  stateLabel: { fontSize: 13, fontWeight: '900' },
  stateSub: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 2 },
  ovTop3: { color: colors.textDim, fontSize: 12, marginTop: 6 },
  lockBadge: { color: colors.warn, fontSize: 10, fontWeight: '900', borderWidth: 1, borderColor: colors.warn, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
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
  claimsTitle: { color: colors.accent, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  claimRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  claimAdd: { color: colors.text, fontSize: 14, fontWeight: '800' },
  claimMeta: { color: colors.gold, fontSize: 13, fontWeight: '800' },
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
  faRowTarget: { borderColor: colors.good },
  faRowAvoid: { opacity: 0.55 },
  faTagMark: { fontSize: 13, fontWeight: '900', marginLeft: 6 },
  addBtnPill: { borderWidth: 1, borderColor: colors.good, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 4 },
  addBtn: { color: colors.good, fontSize: 12, fontWeight: '800' },
  leagueChoices: { marginTop: -4, marginBottom: 10, marginLeft: 12, gap: 6 },
  leagueChoice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  leagueChoiceText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  subsection: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 12, marginBottom: 8 },
  pendRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  pendAdd: { color: colors.good, fontSize: 15, fontWeight: '700' },
  pendBid: { color: colors.accent, fontWeight: '900' },
  pendDrop: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  pendLeague: { color: colors.accent, fontSize: 12, marginTop: 4, fontWeight: '600' },
  cancel: { color: colors.bad, fontSize: 13, fontWeight: '700' },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  resultTag: { fontSize: 11, fontWeight: '900', width: 46 },
  resultText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  resultAddSign: { color: colors.good, fontWeight: '900' },
  resultLink: { color: colors.accent, fontWeight: '800' },
  resultDim: { color: colors.textDim, fontWeight: '600' },
  resultLeague: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 24 },
  error: { color: colors.bad, textAlign: 'center' },
  sysBadge: { fontSize: 10, fontWeight: '900', borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  // sheet
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderTopWidth: 1, borderColor: colors.border },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sheetSub: { color: colors.textDim, fontSize: 13, marginTop: 2, marginBottom: 8 },
  fieldLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  dropBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.cardAlt, borderRadius: 10, padding: 12 },
  dropText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  change: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  benchRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  benchName: { color: colors.text, fontSize: 14 },
  benchMeta: { color: colors.textDim, fontSize: 12 },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  stepperText: { color: colors.text, fontSize: 20, fontWeight: '900' },
  bidInput: { backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, color: colors.text, fontSize: 18, fontWeight: '800', minWidth: 70, textAlign: 'center' },
  budgetAfter: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  sheetError: { color: colors.bad, fontSize: 13, marginTop: 12 },
  confirm: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  confirmOff: { backgroundColor: colors.cardAlt },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  cancelBtn: { alignItems: 'center', paddingTop: 14 },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
});
