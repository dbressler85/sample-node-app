import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { getValue, setValue } from '../cache';
import { colors } from '../theme';

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

export default function HomeScreen({ demoMode, onOpenLineup, onOpenLeague, onOpenWaivers, onOpenTrades, onOpenTradeInbox, onOpenDraft, onOpenDraftHub, onOpenOnDeck, onOpenPlayer, onLogout }) {
  const [leagues, setLeagues] = useState([]);
  const [statuses, setStatuses] = useState({}); // leagueId -> { name, status, items }
  const [drafts, setDrafts] = useState([]); // active/scheduled drafts across leagues
  const [news, setNews] = useState([]); // news touching your rostered players
  const [onDeck, setOnDeck] = useState(null); // time-sorted deadlines across leagues
  const [expanded, setExpanded] = useState(new Set(GROUP_ORDER.filter((t) => GROUPS[t].open)));
  const [progress, setProgress] = useState(null); // { done, total }
  const [error, setError] = useState(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false); // a refresh cycle is in flight
  const running = useRef(false);

  // 1) Instant paint from disk cache.
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
      const list = res.leagues.map((l) => ({ leagueId: l.leagueId, name: l.name }));
      setLeagues(list);
      setValue('leagues', list);

      // Drafts are cross-league and seasonal — fetch once and surface if any are active.
      api.drafts().then((d) => setDrafts((d.drafts || []).filter((x) => x.status && x.status !== 'none' && x.status !== 'complete'))).catch(() => {});

      // News that touches your rostered players — the cross-league moat, surfaced
      // on the command center (already ranked by severity × teams-you-start).
      api.news().then((r) => setNews(r.news || [])).catch(() => {});

      // On Deck — time-sorted deadlines across leagues (the proactive layer).
      api.onDeck().then(setOnDeck).catch(() => {});

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
    const coreAges = dyn.map((d) => d.coreAge).filter((a) => a != null);
    return {
      phase: ph,
      allItems: items,
      portfolio: {
        leagues: leagues.length,
        needAttention:
          ph === 'in_season'
            ? vals.filter((v) => v.status && v.status !== 'optimal' && v.status !== 'error' && v.status !== 'offseason').length
            : vals.filter((v) => (v.items || []).length > 0).length,
        injuries: vals.filter((v) => v.status === 'risk').length,
        holes: vals.filter((v) => v.status === 'incomplete').length,
        lineupsToSet: vals.filter((v) => v.status === 'unset').length,
        tradeOffers: items.filter((i) => i.type === 'trade_offer').length,
        waiversPending: items.filter((i) => i.type === 'waiver_pending').length,
        rosterValue: dyn.reduce((s, d) => s + (d.value || 0), 0),
        avgCoreAge: coreAges.length ? Math.round((coreAges.reduce((s, a) => s + a, 0) / coreAges.length) * 10) / 10 : null,
        contenders: dyn.filter((d) => d.outlook === 'Win-now window').length,
        ascending: dyn.filter((d) => d.outlook === 'Ascending').length,
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
  // Top news touching your rostered players (already ranked severity × starters).
  const topNews = news.filter((n) => n.affectedCount > 0).slice(0, 4);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <View>
          <Text style={styles.title}>Command Center</Text>
          <Text style={styles.subtitle}>
            {loading
              ? `Updating ${progress.done}/${progress.total}…`
              : `${portfolio.leagues} leagues${phase === 'offseason' ? ' · Offseason' : ''}${demoMode ? ' · DEMO' : ''}`}
          </Text>
        </View>
        <Pressable onPress={onLogout} hitSlop={10}>
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => (r.kind === 'header' ? `h-${r.type}` : `i-${r.item.id}`)}
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
            <Portfolio p={portfolio} phase={phase} loading={summaryLoading} />
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
                          ? `Live${d.myNextPick ? ` · your next: ${d.myNextPick.round}.${String(d.myNextPick.overall).padStart(2, '0')}` : ''}`
                          : d.status === 'scheduled'
                          ? `Scheduled${d.startTime ? ` · ${new Date(d.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}`
                          : d.status}
                      </Text>
                    </View>
                    {d.myOnClock ? <Text style={styles.draftPill}>PICK</Text> : <Text style={styles.teamChev}>›</Text>}
                  </Pressable>
                ))}
              </View>
            ) : null}
            {portfolio.tradeOffers ? (
              <Pressable
                style={({ pressed }) => [styles.inboxRow, pressed && { opacity: 0.7 }]}
                onPress={onOpenTradeInbox}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.inboxName}>📥 Trade inbox</Text>
                  <Text style={styles.inboxSub} numberOfLines={1}>
                    {portfolio.tradeOffers} offer{portfolio.tradeOffers === 1 ? '' : 's'} across your leagues
                  </Text>
                </View>
                <Text style={styles.teamChev}>›</Text>
              </Pressable>
            ) : null}
            {topNews.length ? (
              <View>
                <Text style={styles.section}>News · your players</Text>
                {topNews.map((n) => (
                  <NewsRow key={n.id} n={n} onPress={() => n.player && n.player.id && onOpenPlayer && onOpenPlayer(n.player.id)} />
                ))}
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.section}>
              Needs attention{summaryLoading ? '  ·  updating…' : ` · ${portfolio.actionItems}`}
            </Text>
          </View>
        }
        renderItem={({ item: row }) =>
          row.kind === 'header' ? (
            <GroupHeader type={row.type} count={row.count} open={expanded.has(row.type)} onPress={() => toggle(row.type)} />
          ) : (
            <TriageRow item={row.item} onPress={() => handleAction(row.item)} />
          )
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
          ) : (
            <Text style={styles.clear}>🎉 Nothing needs you right now.</Text>
          )
        }
        ListFooterComponent={
          leagues.length ? (
            <View>
              <Text style={styles.section}>Your teams · {leagues.length}</Text>
              {leagues.map((t) => {
                const d = (statuses[t.leagueId] || {}).dynasty;
                return (
                  <Pressable key={t.leagueId} style={({ pressed }) => [styles.teamRow, pressed && { opacity: 0.7 }]} onPress={() => onOpenLeague({ leagueId: t.leagueId, name: t.name })}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.teamName} numberOfLines={1}>{t.name}</Text>
                      {d ? (
                        <Text style={styles.teamSub} numberOfLines={1}>
                          {d.value != null ? `${d.value} value` : ''}{d.coreAge != null ? ` · core ${d.coreAge}y` : ''}{d.outlook ? ` · ${d.outlook}` : ''}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.teamChev}>›</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null
        }
      />
    </View>
  );
}

function Portfolio({ p, phase, loading }) {
  const offseason = phase === 'offseason';
  // The Leagues count is known as soon as the league list loads, so keep it live.
  return (
    <View style={styles.portfolio}>
      <View style={styles.tileRow}>
        <Tile label="Leagues" value={String(p.leagues)} loading={loading && !p.leagues} />
        {offseason ? (
          <Tile label="Total roster value" value={p.rosterValue ? String(p.rosterValue) : '—'} gold loading={loading} />
        ) : (
          <Tile label="Needs attention" value={String(p.needAttention)} accent={p.needAttention > 0} loading={loading} />
        )}
      </View>
      <View style={styles.chips}>
        {offseason ? (
          <>
            <Chip label="Avg core age" value={p.avgCoreAge != null ? `${p.avgCoreAge}y` : '—'} loading={loading} />
            <Chip label="Win-now" value={p.contenders} loading={loading} />
            <Chip label="Ascending" value={p.ascending} loading={loading} />
            <Chip label="Trades" value={p.tradeOffers} bad={p.tradeOffers > 0} loading={loading} />
            <Chip label="Waivers" value={p.waiversPending} loading={loading} />
          </>
        ) : (
          <>
            <Chip label="Lineups to set" value={p.lineupsToSet} warn={p.lineupsToSet > 0} loading={loading} />
            <Chip label="Holes" value={p.holes} bad={p.holes > 0} loading={loading} />
            <Chip label="Injuries" value={p.injuries} bad={p.injuries > 0} loading={loading} />
            <Chip label="Trades" value={p.tradeOffers} bad={p.tradeOffers > 0} loading={loading} />
            <Chip label="Waivers" value={p.waiversPending} loading={loading} />
          </>
        )}
      </View>
    </View>
  );
}

function Tile({ label, value, accent, gold, loading }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      {loading ? (
        <View style={styles.tileSpinner}>
          <ActivityIndicator size="small" color={colors.textDim} />
        </View>
      ) : (
        <Text style={[styles.tileValue, accent && { color: colors.accent }, gold && { color: colors.gold }]}>{value}</Text>
      )}
    </View>
  );
}

function Chip({ label, value, bad, warn, loading }) {
  const c = bad ? colors.bad : warn ? colors.warn : colors.textDim;
  return (
    <View style={styles.chip}>
      {loading ? (
        <View style={styles.chipSpinner}>
          <ActivityIndicator size="small" color={colors.textDim} />
        </View>
      ) : (
        <Text style={[styles.chipValue, { color: c }]}>{value}</Text>
      )}
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
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

function NewsRow({ n, onPress }) {
  const sev = n.severity === 'high' ? colors.bad : n.severity === 'medium' ? colors.warn : colors.textDim;
  const name = n.player && n.player.name ? n.player.name.split(',')[0] : null;
  return (
    <Pressable style={({ pressed }) => [styles.newsRow, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={[styles.newsDot, { backgroundColor: sev }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.newsHead} numberOfLines={2}>{n.headline}</Text>
        <Text style={styles.newsMeta} numberOfLines={1}>
          {name ? `${name} · ` : ''}affects {n.affectedCount} team{n.affectedCount === 1 ? '' : 's'}
          {n.startingCount ? <Text style={{ color: colors.warn, fontWeight: '700' }}>{` · starting in ${n.startingCount}`}</Text> : null}
        </Text>
      </View>
      <Text style={styles.teamChev}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 30 },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  logout: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  portfolio: { marginBottom: 4 },
  tileRow: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 },
  tileLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  tileValue: { color: colors.text, fontSize: 30, fontWeight: '900', marginTop: 4 },
  tileSpinner: { height: 40, justifyContent: 'center', alignItems: 'flex-start', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
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
  teamName: { color: colors.text, fontSize: 15, fontWeight: '700', marginRight: 10 },
  teamSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  onDeckRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 15, marginBottom: 14 },
  onDeckRowNow: { borderColor: colors.gold, backgroundColor: colors.cardAlt },
  onDeckIcon: { fontSize: 20, marginRight: 12 },
  onDeckName: { color: colors.text, fontSize: 15, fontWeight: '900', letterSpacing: 0.2 },
  onDeckSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  newsRow: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 8 },
  newsDot: { width: 8, height: 8, borderRadius: 4, marginRight: 12, marginTop: 6 },
  newsHead: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  newsMeta: { color: colors.textDim, fontSize: 12, marginTop: 4 },
  inboxRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 12 },
  inboxName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  inboxSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  draftRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 8 },
  draftRowLive: { borderColor: colors.gold },
  draftName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  draftSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  draftPill: { color: '#20180a', backgroundColor: colors.gold, fontSize: 11, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  teamChev: { color: colors.textDim, fontSize: 20, fontWeight: '700', marginLeft: 8 },
});
