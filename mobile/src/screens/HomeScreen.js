import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ActivityIndicator, Modal } from 'react-native';
import { api } from '../api';
import { getValue, setValue } from '../cache';
import { colors } from '../theme';
import { ScreenTitle } from '../components/Brand';
import Pulse from '../components/Pulse';
import PressableScale from '../components/PressableScale';
import AnimatedNumber from '../components/AnimatedNumber';
import GearIcon from '../components/GearIcon';
import InfoDot from '../components/InfoDot';

const GROUPS = {
  lineup_risk: { label: 'Unavailable player in lineup', color: colors.bad, open: true },
  lineup_incomplete: { label: 'Empty slot — needs a pickup', color: colors.bad, open: true },
  trade_offer: { label: 'Trade offers', color: colors.bad, open: true },
  lineup_unset: { label: 'Lineups not set', color: colors.warn, open: false },
  lineup_suboptimal: { label: 'Better lineup available', color: colors.warn, open: false },
  waiver_pending: { label: 'Pending waivers', color: colors.textDim, open: false },
};
const GROUP_ORDER = ['lineup_risk', 'lineup_incomplete', 'trade_offer', 'lineup_unset', 'lineup_suboptimal', 'waiver_pending'];
const ACTION_LABEL = { lineup: 'Set ›', waiver: 'Waivers ›', trade: 'View ›' };
const CONCURRENCY = 4;

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

export default function HomeScreen({ demoMode, onOpenLineup, onOpenLeague, onOpenLeagues, onOpenPortfolio, onOpenWaivers, onOpenTrades, onOpenTradeInbox, onOpenDraft, onOpenDraftHub, onOpenOnDeck, onOpenPlayer, onOpenSettings, onOpenProfile, onLogout }) {
  const [leagues, setLeagues] = useState([]);
  const [statuses, setStatuses] = useState({}); // leagueId -> { name, status, items }
  const [drafts, setDrafts] = useState([]); // only ACTIONABLE drafts (on the clock / live / imminent)
  const [onDeck, setOnDeck] = useState(null); // time-sorted deadlines across leagues
  const [watchAlerts, setWatchAlerts] = useState([]); // watched players now free / on the block
  const [expanded, setExpanded] = useState(new Set(GROUP_ORDER.filter((t) => GROUPS[t].open)));
  const [progress, setProgress] = useState(null); // { done, total }
  const [error, setError] = useState(null);
  const [attentionOpen, setAttentionOpen] = useState(false); // the "Needs attention" feed is now a modal
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false); // a refresh cycle is in flight
  const running = useRef(false);

  // 1) Instant paint from disk cache, then always revalidate in the background.
  // The refresh is non-blocking (paints cached immediately, updates when ready) and
  // the backend now serves repeat league reads from cache, so this stays cheap —
  // and, crucially, always reflects an action just taken in an overlay (a set
  // lineup, a submitted claim) rather than showing stale triage.
  useEffect(() => {
    (async () => {
      const [cachedLeagues, cachedStatuses] = await Promise.all([getValue('leagues'), getValue('statuses')]);
      if (cachedLeagues) setLeagues(cachedLeagues);
      if (cachedStatuses) setStatuses(cachedStatuses);
      setBooting(false);
      refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Refresh: fetch the league list, then stream each league's status.
  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api.leaguesList();
      // Home reflects all of the account's leagues, already pinned-first from the server.
      const list = (res.leagues || []).map((l) => ({ leagueId: l.leagueId, name: l.name }));
      setLeagues(list);
      setValue('leagues', list);

      // Drafts: Home is an action list, so only surface drafts that actually need
      // you now — on the clock, live, or starting within ~3 days. A draft a month
      // out isn't an action; it lives in the Draft Hub (and On Deck). News moved
      // off Home entirely — it's on the Players → News tab.
      api.drafts().then((d) => setDrafts((d.drafts || []).filter(isDraftActionable))).catch(() => {});

      // On Deck — time-sorted deadlines across leagues (the proactive layer).
      api.onDeck().then(setOnDeck).catch(() => {});

      // Watchlist alerts — a player you track just became a free agent or was put on the
      // block by another owner. Background, best-effort; empty (fast) if you track no one.
      api.watchlistAlerts().then((r) => setWatchAlerts(r.alerts || [])).catch(() => {});

      setProgress({ done: 0, total: list.length });
      const collected = {};
      await runPool(list, CONCURRENCY, async (lg) => {
        try {
          const t = await api.leagueTriage(lg.leagueId);
          collected[lg.leagueId] = { name: t.name, status: t.status, items: t.items, phase: t.phase, dynasty: t.dynasty };
        } catch (e) {
          collected[lg.leagueId] = { name: lg.name, status: 'error', items: [] };
        }
        setStatuses((prev) => ({ ...prev, [lg.leagueId]: collected[lg.leagueId] }));
        setProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
      });
      // Keep only current leagues, then persist.
      const pruned = {};
      for (const lg of list) if (collected[lg.leagueId]) pruned[lg.leagueId] = collected[lg.leagueId];
      setStatuses(pruned);
      setValue('statuses', pruned);
    } catch (e) {
      setError(e.message);
    } finally {
      setProgress(null);
      setBusy(false);
      running.current = false;
    }
  }, []);

  function handleAction(item) {
    // Acting on an item leaves the feed for an overlay — close the modal first so we don't
    // return to a stale sheet stacked under the destination.
    setAttentionOpen(false);
    const league = { leagueId: item.leagueId, name: item.leagueName };
    if (item.action === 'lineup') onOpenLineup(league);
    else if (item.action === 'waiver') onOpenWaivers(league);
    else if (item.action === 'trade') onOpenTrades(league);
    else onOpenLeague(league);
  }

  function toggle(type) {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(type) ? n.delete(type) : n.add(type);
      return n;
    });
  }

  // Derive everything from the (current) leagues + their statuses.
  const { portfolio, allItems, phase } = useMemo(() => {
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
        // Outlook now blends roster strength (value vs the league) with core age, so
        // the four buckets are exhaustive and add up to your league count.
        contenders: dyn.filter((d) => d.outlook === 'Win-now window').length,
        ascending: dyn.filter((d) => d.outlook === 'Ascending').length,
        rebuilding: dyn.filter((d) => d.outlook === 'Rebuilding').length,
        balanced: dyn.filter((d) => d.outlook === 'Balanced').length,
        actionItems: items.length,
      },
    };
  }, [leagues, statuses]);

  const rows = useMemo(() => {
    const byType = {};
    for (const t of allItems) (byType[t.type] || (byType[t.type] = [])).push(t);
    const out = [];
    for (const type of GROUP_ORDER) {
      const its = byType[type];
      if (!its || !its.length) continue;
      out.push({ kind: 'header', type, count: its.length });
      if (expanded.has(type)) for (const item of its) out.push({ kind: 'item', item });
    }
    return out;
  }, [allItems, expanded]);

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
          <ScreenTitle>Command Center</ScreenTitle>
          <Text style={styles.subtitle}>
            {loading
              ? `Updating ${progress.done}/${progress.total}…`
              : `${portfolio.leagues} leagues${phase === 'offseason' ? ' · Offseason' : ''}${demoMode ? ' · DEMO' : ''}`}
          </Text>
        </View>
        <View style={styles.topActions}>
          {onOpenSettings ? (
            <Pressable onPress={onOpenSettings} hitSlop={10} accessibilityLabel="Settings" style={styles.gearBtn}>
              <GearIcon size={22} />
            </Pressable>
          ) : null}
          {onOpenProfile ? (
            <Pressable onPress={onOpenProfile} hitSlop={10} accessibilityLabel="Profile" style={styles.avatarBtn}>
              <View style={styles.avatarHead} />
              <View style={styles.avatarBody} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={[]}
        keyExtractor={(_, i) => `x-${i}`}
        renderItem={null}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.accent} />}
        ListHeaderComponent={
          <View>
            {onDeck && onDeck.items && onDeck.items.length ? (
              <Pressable
                style={({ pressed }) => [styles.onDeckRow, onDeck.summary.onClock > 0 && styles.onDeckRowNow, pressed && { opacity: 0.75 }]}
                onPress={onOpenOnDeck}
              >
                <Text style={styles.onDeckIcon}>⏱</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.onDeckName}>On Deck</Text>
                  <Text style={styles.onDeckSub} numberOfLines={1}>
                    {onDeck.summary.onClock > 0
                      ? `${onDeck.summary.onClock} on the clock now · ${onDeck.items.length} total`
                      : `${onDeck.items.length} deadline${onDeck.items.length === 1 ? '' : 's'} coming up`}
                  </Text>
                </View>
                <Text style={styles.teamChev}>›</Text>
              </Pressable>
            ) : null}
            <Portfolio
              p={portfolio}
              phase={phase}
              loading={summaryLoading}
              onLeagues={onOpenLeagues}
              onPortfolio={onOpenPortfolio}
              onOpenAttention={portfolio.actionItems > 0 ? () => setAttentionOpen(true) : null}
            />
            {drafts.length ? (
              <View>
                <Pressable style={styles.sectionRow} onPress={onOpenDraftHub}>
                  <Text style={styles.section}>Drafts · {drafts.length}</Text>
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
                          ? "You're on the clock"
                          : d.status === 'in_progress'
                          ? `Live${d.myNextPick ? ` · your pick ${pickCode(d.myNextPick)} · ${ordinal(d.myNextPick.overall)} overall` : ''}`
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
            {watchAlerts.length ? (
              <View>
                <Text style={styles.section}>Watchlist · {watchAlerts.length}</Text>
                {watchAlerts.slice(0, 6).map((a, i) => (
                  <Pressable
                    key={`${a.playerId}-${a.leagueId}-${i}`}
                    style={({ pressed }) => [styles.watchRow, pressed && { opacity: 0.7 }]}
                    onPress={() => onOpenPlayer(a.playerId)}
                  >
                    <Text style={styles.watchIcon}>⭐</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.watchName} numberOfLines={1}>{a.name}</Text>
                      <Text style={[styles.watchSub, a.type === 'free' && { color: colors.good }]} numberOfLines={1}>
                        {a.type === 'free' ? `Now a free agent in ${a.leagueName}` : `On the block in ${a.leagueName}`}
                      </Text>
                    </View>
                    <Text style={styles.teamChev}>›</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.inboxRow, pressed && { opacity: 0.7 }]}
              onPress={onOpenTradeInbox}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.inboxName}>
                  {portfolio.tradeOffers ? '📥 Trade inbox' : '🔁 Trades'}
                </Text>
                <Text style={styles.inboxSub} numberOfLines={1}>
                  {portfolio.tradeOffers
                    ? `${portfolio.tradeOffers} offer${portfolio.tradeOffers === 1 ? '' : 's'} across your leagues`
                    : 'Review offers or propose a trade in any league'}
                </Text>
              </View>
              <Text style={styles.teamChev}>›</Text>
            </Pressable>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {!summaryLoading && portfolio.actionItems === 0 && !loading ? (
              <Text style={styles.clear}>🎉 Nothing needs you right now.</Text>
            ) : null}
          </View>
        }
      />

      {/* The needs-attention feed, on demand. Tapping the "Needs attention" tile opens it as
          a sheet instead of a permanent list crowding Home. Same grouped rows, same
          expand/collapse, same actions — acting on a row closes the sheet and navigates. */}
      <Modal visible={attentionOpen} animationType="slide" transparent onRequestClose={() => setAttentionOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>
                Needs attention{summaryLoading ? '  ·  updating…' : ` · ${portfolio.actionItems}`}
              </Text>
              <Pressable onPress={() => setAttentionOpen(false)} hitSlop={12} accessibilityLabel="Close">
                <Text style={styles.modalClose}>✕</Text>
              </Pressable>
            </View>
            <FlatList
              data={rows}
              keyExtractor={(r) => (r.kind === 'header' ? `h-${r.type}` : `i-${r.item.id}`)}
              contentContainerStyle={styles.modalList}
              renderItem={({ item: row }) =>
                row.kind === 'header' ? (
                  <GroupHeader type={row.type} count={row.count} open={expanded.has(row.type)} onPress={() => toggle(row.type)} />
                ) : (
                  <TriageRow item={row.item} onPress={() => handleAction(row.item)} />
                )
              }
              ListEmptyComponent={<Text style={styles.clear}>🎉 Nothing needs you right now.</Text>}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Portfolio({ p, phase, loading, onLeagues, onPortfolio, onOpenAttention }) {
  const offseason = phase === 'offseason';
  // The Leagues count is known as soon as the league list loads, so keep it live.
  return (
    <View style={styles.portfolio}>
      <View style={styles.tileRow}>
        <Tile label="Leagues ›" value={String(p.leagues)} loading={loading && !p.leagues} onPress={onLeagues} />
        {/* Shows the number of action ITEMS (what the feed lists), so the tile's count
            matches the feed it opens — not a separate "leagues affected" number. */}
        <Tile
          label={onOpenAttention ? 'Needs attention ›' : 'Needs attention'}
          value={String(p.actionItems)}
          accent={p.actionItems > 0}
          loading={loading}
          onPress={onOpenAttention}
        />
      </View>
      <PressableScale style={styles.portfolioLink} onPress={onPortfolio}>
        <Text style={styles.portfolioLinkText}>Portfolio · understand your holdings</Text>
        <Text style={styles.teamChev}>›</Text>
      </PressableScale>
      <View style={styles.chips}>
        {offseason ? (
          <>
            {/* Team-outlook breakdown, tap any to open the portfolio detail. Trades and
                Waivers used to live here too — dropped as redundant with the trade
                inbox row below and the bottom-nav tabs. */}
            <Chip label="Win now" value={p.contenders} loading={loading} onPress={onPortfolio} />
            <Chip label="Ascending" value={p.ascending} loading={loading} onPress={onPortfolio} />
            <Chip label="Balanced" value={p.balanced} loading={loading} onPress={onPortfolio} />
            <Chip label="Rebuilding" value={p.rebuilding} loading={loading} onPress={onPortfolio} />
            <View style={styles.chipInfo}><InfoDot id="outlook" size={16} /></View>
          </>
        ) : (
          <>
            <Chip label="Lineups to set" value={p.lineupsToSet} warn={p.lineupsToSet > 0} loading={loading} />
            <Chip label="Holes" value={p.holes} bad={p.holes > 0} loading={loading} />
            <Chip label="Injuries" value={p.injuries} bad={p.injuries > 0} loading={loading} />
          </>
        )}
      </View>
    </View>
  );
}

function Tile({ label, value, accent, gold, loading, onPress }) {
  const num = Number(value);
  const isNum = value != null && value !== '' && !Number.isNaN(num);
  const valStyle = [styles.tileValue, accent && { color: colors.accent }, gold && { color: colors.gold }];
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

function GroupHeader({ type, count, open, onPress }) {
  const g = GROUPS[type] || { label: type, color: colors.textDim };
  return (
    <Pressable style={({ pressed }) => [styles.groupHeader, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={[styles.dot, { backgroundColor: g.color }]} />
      <Text style={styles.groupLabel} numberOfLines={1}>{g.label}</Text>
      <View style={styles.countPill}><Text style={styles.countText}>{count}</Text></View>
      <Text style={styles.caret}>{open ? '⌄' : '›'}</Text>
    </Pressable>
  );
}

function TriageRow({ item, onPress }) {
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <Text style={styles.rowLeague} numberOfLines={1}>{item.leagueName}</Text>
      <Text style={styles.rowAction}>{ACTION_LABEL[item.action] || '›'}</Text>
    </Pressable>
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
  avatarBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.gold, backgroundColor: colors.gold + '18', alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  avatarHead: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.gold, marginBottom: 1.5 },
  avatarBody: { width: 17, height: 10, borderTopLeftRadius: 9, borderTopRightRadius: 9, backgroundColor: colors.gold },
  logout: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  portfolio: { marginBottom: 4 },
  tileRow: { flexDirection: 'row', gap: 12 },
  tileFlex: { flex: 1 },
  tile: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 },
  tileLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  tileValue: { color: colors.text, fontSize: 30, fontWeight: '900', marginTop: 4 },
  tileSpinner: { height: 40, justifyContent: 'center', alignItems: 'flex-start', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' },
  chipInfo: { justifyContent: 'center', paddingHorizontal: 2 },
  chip: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', minWidth: 64 },
  chipValue: { fontSize: 18, fontWeight: '900' },
  chipSpinner: { height: 22, justifyContent: 'center' },
  chipLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 2 },
  section: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 20, marginBottom: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLink: { color: colors.accent, fontSize: 13, fontWeight: '700', marginTop: 20, marginBottom: 10 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  groupLabel: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  countPill: { backgroundColor: colors.cardAlt, borderRadius: 12, minWidth: 26, paddingHorizontal: 8, paddingVertical: 2, alignItems: 'center', marginRight: 10 },
  countText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  caret: { color: colors.textDim, fontSize: 18, fontWeight: '700', width: 16, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cardAlt, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, marginLeft: 22 },
  rowLeague: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1, marginRight: 10 },
  rowAction: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  error: { color: colors.bad, marginVertical: 8 },
  clear: { color: colors.textDim, textAlign: 'center', marginTop: 30, fontSize: 15 },
  teamRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  allLeaguesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 20 },
  allLeaguesText: { color: colors.accent, fontSize: 15, fontWeight: '800' },
  portfolioLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 13, marginTop: 10 },
  portfolioLinkText: { color: colors.gold, fontSize: 14, fontWeight: '800' },
  teamName: { color: colors.text, fontSize: 15, fontWeight: '700', marginRight: 10 },
  teamSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  onDeckRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 15, marginBottom: 14 },
  onDeckRowNow: { borderColor: colors.gold, backgroundColor: colors.cardAlt },
  onDeckIcon: { fontSize: 20, marginRight: 12 },
  onDeckName: { color: colors.text, fontSize: 15, fontWeight: '900', letterSpacing: 0.2 },
  onDeckSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  watchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8 },
  watchIcon: { fontSize: 16, marginRight: 12 },
  watchName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  watchSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  inboxRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 12 },
  inboxName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  inboxSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  draftRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 8 },
  draftRowLive: { borderColor: colors.gold },
  draftName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  draftSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  draftPill: { color: '#20180a', backgroundColor: colors.gold, fontSize: 11, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  teamChev: { color: colors.textDim, fontSize: 20, fontWeight: '700', marginLeft: 8 },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: colors.border, maxHeight: '80%', paddingTop: 8 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '900', flex: 1, marginRight: 12 },
  modalClose: { color: colors.textDim, fontSize: 18, fontWeight: '800' },
  modalList: { paddingHorizontal: 16, paddingBottom: 28 },
});
