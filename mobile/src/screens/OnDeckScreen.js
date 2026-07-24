import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import useAndroidBack from '../useAndroidBack';
import usePoll from '../usePoll';
import useCachedResource from '../useCachedResource';

// On Deck — the proactive, time-sorted view of what needs you next across every
// league. Draft clocks (now), lineup locks (next kickoff), scheduled drafts, and
// waiver runs, soonest first. Tapping an item jumps to the place you'd act.

const TYPE = {
  draft_clock: { icon: '🎯', tint: colors.gold },
  draft_start: { icon: '🎯', tint: colors.accent },
  lineup_lock: { icon: '⚑', tint: colors.warn },
  waiver_run: { icon: '⇄', tint: colors.accent },
  trade_offer: { icon: '🤝', tint: colors.accent },
  trade_deadline: { icon: '⏳', tint: colors.bad },
  ir_violation: { icon: '🚑', tint: colors.bad },
};

// Human "time until" for an ISO timestamp. Near times count down; far ones show
// the weekday + clock. Past/now reads "now".
function countdown(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const ms = t - Date.now();
  if (ms <= 60 * 1000) return 'now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h ${mins % 60}m`;
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function OnDeckScreen({ onBack, onOpenLineup, onOpenDraft, onOpenWaivers, onOpenTradeInbox, onOpenRoster }) {
  // Stale-while-revalidate: paint the last On Deck snapshot from disk instantly,
  // then refetch in the background (and on the 60s poll). Countdowns recompute from
  // each item's timestamp client-side, so a briefly-stale paint is fine.
  const { data, error, refreshing, loading, reload } = useCachedResource('ondeck', () => api.onDeck());
  const [, force] = useState(0); // re-render to tick countdowns

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));
  // Only the "in Xm / in Xh" labels change minute-to-minute; a far item shows a
  // static "Wed 1:00 PM". So only run the 20s re-render tick when at least one item
  // is actually counting down (within the hour) — otherwise it re-rendered the whole
  // list every 20s to change nothing.
  const hasCountdown = useMemo(() => {
    const items = (data && data.items) || [];
    const now = Date.now();
    return items.some((it) => {
      if (!it.at) return false;
      const t = new Date(it.at).getTime();
      return !Number.isNaN(t) && t - now < 60 * 60 * 1000;
    });
  }, [data]);
  useEffect(() => {
    if (!hasCountdown) return undefined;
    const id = setInterval(() => force((n) => n + 1), 20000);
    return () => clearInterval(id);
  }, [hasCountdown]);
  // Re-fetch every minute so a newly-on-the-clock draft or a new deadline appears
  // (usePoll pauses this while the app is backgrounded).
  usePoll(reload, 60000, true);

  function act(item) {
    const league = { leagueId: item.leagueId, name: item.leagueName };
    if (item.action === 'draft') onOpenDraft(league);
    else if (item.action === 'lineup') onOpenLineup(league);
    else if (item.action === 'waiver') onOpenWaivers(league);
    else if (item.action === 'trade') onOpenTradeInbox && onOpenTradeInbox(league);
    else if (item.action === 'roster') onOpenRoster && onOpenRoster(league);
  }

  const items = (data && data.items) || [];
  // Two buckets: things that actually need you now vs. scheduled / already-done status.
  const actions = items.filter((i) => (i.kind || 'action') === 'action');
  const upcoming = items.filter((i) => i.kind === 'upcoming');
  const rows = [];
  if (actions.length) {
    rows.push({ header: 'Needs you', count: actions.length, key: 'h-action' });
    actions.forEach((it, idx) => rows.push({ item: it, key: `a-${it.type}:${it.leagueId}:${idx}` }));
  }
  if (upcoming.length) {
    rows.push({ header: 'Upcoming', count: upcoming.length, key: 'h-up' });
    upcoming.forEach((it, idx) => rows.push({ item: it, key: `u-${it.type}:${it.leagueId}:${idx}` }));
  }

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Hub</Text></Pressable>
        <Text style={styles.title}>Under Center</Text>
        <View style={{ width: 54 }} />
      </View>
      {data ? (
        <>
          <Text style={styles.subtitle}>
            {actions.length ? `${actions.length} need${actions.length === 1 ? 's' : ''} you` : 'Nothing needs you'}
            {upcoming.length ? <Text style={{ color: colors.textDim }}>{`  ·  ${upcoming.length} upcoming`}</Text> : null}
            {data.summary && data.summary.onClock ? <Text style={{ color: colors.gold, fontWeight: '800' }}>{`  ·  ${data.summary.onClock} on the clock`}</Text> : null}
          </Text>
          <Text style={styles.explain}>
            <Text style={{ fontWeight: '800', color: colors.text }}>Needs you</Text> = things to act on (draft clocks, lineups, waivers you haven’t claimed, trade offers, deadlines). <Text style={{ fontWeight: '800', color: colors.text }}>Upcoming</Text> = scheduled or already done (your submitted claims processing, a scheduled draft).
          </Text>
        </>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
          renderItem={({ item: row }) =>
            row.header ? (
              <Text style={styles.sectionHeader}>{row.header} · {row.count}</Text>
            ) : (
              <DeadlineRow item={row.item} onPress={() => act(row.item)} />
            )
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>🎉 All clear</Text>
              <Text style={styles.emptyText}>Nothing needs you and nothing’s coming up across your leagues.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function DeadlineRow({ item, onPress }) {
  const t = TYPE[item.type] || { icon: '•', tint: colors.textDim };
  const when = item.now ? 'NOW' : countdown(item.at) || item.atLabel || null;
  const whenColor = item.now ? colors.gold : item.type === 'lineup_lock' ? colors.warn : colors.textDim;
  // Waiver rows read their status from claim state: claims-in (good) vs window-open-no-claims (warn).
  const isWaiver = item.type === 'waiver_run';
  const detailColor = isWaiver ? (item.hasClaims ? colors.good : colors.warn) : colors.textDim;
  return (
    <Pressable style={({ pressed }) => [styles.row, item.now && styles.rowNow, pressed && { opacity: 0.75 }]} onPress={onPress}>
      <Text style={[styles.icon, { color: t.tint }]}>{t.icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.label} numberOfLines={1}>
          {item.label}
          <Text style={styles.league}>{`  ·  ${item.leagueName}`}</Text>
        </Text>
        {item.detail ? <Text style={[styles.detail, { color: detailColor }, isWaiver && { fontWeight: '700' }]} numberOfLines={1}>{item.detail}</Text> : null}
      </View>
      {when ? <Text style={[styles.when, { color: whenColor }]}>{when}</Text> : <Text style={styles.chev}>›</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 54 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4 },
  explain: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 4, paddingHorizontal: 24, lineHeight: 17, opacity: 0.85 },
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 },
  sectionHeader: { color: colors.accent, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 15, marginBottom: 8 },
  rowNow: { borderColor: colors.gold, backgroundColor: colors.cardAlt },
  icon: { fontSize: 18, width: 30, textAlign: 'center', marginRight: 8 },
  label: { color: colors.text, fontSize: 15, fontWeight: '800' },
  league: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  detail: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  when: { fontSize: 13, fontWeight: '800', marginLeft: 10, textAlign: 'right' },
  chev: { color: colors.textDim, fontSize: 20, fontWeight: '700', marginLeft: 8 },
  error: { color: colors.bad, textAlign: 'center' },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', paddingHorizontal: 20, lineHeight: 20 },
});
