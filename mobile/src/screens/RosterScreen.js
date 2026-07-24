import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, SectionList, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import PlayerRow from '../components/PlayerRow';
import Reveal from '../components/Reveal';
import { colors } from '../theme';
import useCachedResource from '../useCachedResource';

// Roster sort options. `null` (Slots) keeps the lineup-slot grouping; the rest flatten to one list.
const SORT_OPTIONS = [
  { key: null, label: 'Slots' },
  { key: 'position', label: 'Pos' },
  { key: 'name', label: 'Name' },
  { key: 'age', label: 'Age' },
  { key: 'value', label: 'Value' },
  { key: 'team', label: 'Team' },
];
const SORT_LABELS = { position: 'position', name: 'name', age: 'age', value: 'value', team: 'team' };
const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, PK: 4, K: 4, PN: 5, DEF: 6, Def: 6 };

function posRank(p) {
  return POS_ORDER[p] != null ? POS_ORDER[p] : 9;
}
function sortPlayers(arr, key) {
  const a = [...arr];
  const byVal = (x, y) => (y.value || 0) - (x.value || 0);
  if (key === 'position') a.sort((x, y) => posRank(x.position) - posRank(y.position) || byVal(x, y));
  else if (key === 'name') a.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')));
  else if (key === 'age') a.sort((x, y) => (x.age != null ? x.age : 999) - (y.age != null ? y.age : 999) || byVal(x, y));
  else if (key === 'value') a.sort(byVal);
  else if (key === 'team') a.sort((x, y) => String(x.team || 'ZZZ').localeCompare(String(y.team || 'ZZZ')) || byVal(x, y));
  return a;
}

export default function RosterScreen({ league, onBack, onOpenTrades, onOpenDraft, onOpenPlayer }) {
  // Roster via the shared cache hook: instant repaint on return, throttled reloads, and it
  // keeps the roster on a failed refresh (C1/C2/C4). A trade/draft done in an overlay marks it
  // stale (invalidate-on-write), so returning here refetches (C3).
  const { data: roster, error, loading, reload } = useCachedResource(`roster:${league.leagueId}`, () => api.roster(league.leagueId));
  const [baited, setBaited] = useState(() => new Set()); // player ids on the block here
  const [sortKey, setSortKey] = useState(null); // null = group by lineup slot; else a flat sorted list
  const [movingId, setMovingId] = useState(null); // player id whose IR/taxi move is in flight

  // Which roster bucket each player is in, so the per-row IR/taxi actions are correct in BOTH the
  // grouped and the flat-sorted views. active = starter/bench.
  const bucketOf = useMemo(() => {
    const m = {};
    if (roster) {
      for (const p of roster.starters || []) m[String(p.id)] = 'active';
      for (const p of roster.bench || []) m[String(p.id)] = 'active';
      for (const p of roster.ir || []) m[String(p.id)] = 'ir';
      for (const p of roster.taxi || []) m[String(p.id)] = 'taxi';
    }
    return m;
  }, [roster]);

  // Fire an IR/taxi move, then refetch so the roster reflects it. MFL enforces eligibility
  // (IR needs an injury designation; taxi needs a rookie/young player) — surface its error.
  const move = async (player, call) => {
    setMovingId(String(player.id));
    try {
      await call();
      reload();
    } catch (e) {
      Alert.alert('Move not allowed', e.message);
    } finally {
      setMovingId(null);
    }
  };
  const moveActionsFor = (player) => {
    const bucket = bucketOf[String(player.id)];
    const id = String(player.id);
    if (bucket === 'ir') return [{ key: 'act', label: 'Activate', onPress: () => move(player, () => api.moveIr(league.leagueId, { activate: [id] })) }];
    if (bucket === 'taxi') return [{ key: 'promo', label: 'Promote', onPress: () => move(player, () => api.moveTaxi(league.leagueId, { promote: [id] })) }];
    if (bucket === 'active') return [
      { key: 'ir', label: '→ IR', onPress: () => move(player, () => api.moveIr(league.leagueId, { deactivate: [id] })) },
      { key: 'taxi', label: '→ Taxi', onPress: () => move(player, () => api.moveTaxi(league.leagueId, { demote: [id] })) },
    ];
    return [];
  };

  // Trade-bait board for this league, alongside — secondary, best-effort.
  useEffect(() => {
    let alive = true;
    api.leagueBait(league.leagueId)
      .then((bait) => { if (alive) setBaited(new Set((bait.ids || []).map(String))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [league.leagueId]);

  // Optimistically flip the block state, then persist; revert on failure.
  const toggleBait = async (player) => {
    const id = String(player.id);
    const on = baited.has(id);
    setBaited((cur) => {
      const next = new Set(cur);
      on ? next.delete(id) : next.add(id);
      return next;
    });
    try {
      if (on) await api.removeBait(league.leagueId, id);
      else await api.addBait(league.leagueId, id, null);
    } catch (e) {
      setBaited((cur) => {
        const next = new Set(cur);
        on ? next.add(id) : next.delete(id);
        return next;
      });
    }
  };

  // Default view groups by lineup slot. Picking a sort flattens the whole roster into one list
  // ordered by that key, so you can scan the team by position, name, age, value or NFL team.
  const slotSections = roster
    ? [
        { title: 'Starters', data: roster.starters },
        { title: 'Bench', data: roster.bench },
        { title: 'Injured Reserve', data: roster.ir },
        { title: 'Taxi Squad', data: roster.taxi },
      ].filter((s) => s.data && s.data.length > 0)
    : [];
  const allPlayers = roster ? [roster.starters, roster.bench, roster.ir, roster.taxi].flat().filter(Boolean) : [];
  const sections = !roster
    ? []
    : sortKey
    ? [{ title: `${allPlayers.length} players · by ${SORT_LABELS[sortKey]}`, data: sortPlayers(allPlayers, sortKey) }]
    : slotSections;

  // Combined dynasty value of the draft picks (when they're the enriched objects).
  const picksTotal = roster && roster.picks && roster.picks.length && typeof roster.picks[0] === 'object'
    ? roster.picks.reduce((sum, p) => sum + (p.value || 0), 0)
    : null;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Leagues</Text>
        </Pressable>
        <View style={styles.topActions}>
          {onOpenDraft ? (
            <Pressable onPress={() => onOpenDraft(league)} hitSlop={10}>
              <Text style={styles.trades}>◆ Draft</Text>
            </Pressable>
          ) : null}
          {onOpenTrades ? (
            <Pressable onPress={() => onOpenTrades(league)} hitSlop={10}>
              <Text style={styles.trades}>⇄ Trades</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {league.name}
        </Text>
        {roster && roster.franchiseName ? <Text style={styles.subtitle}>{roster.franchiseName}</Text> : null}
      </View>

      {roster && roster.summary ? (
        <View style={styles.summary}>
          <Summary label="Roster value" value={roster.summary.rosterValue} gold />
          <Summary label="Core age" value={roster.summary.coreAge != null ? `${roster.summary.coreAge}y` : '—'} />
          <Summary label="Outlook" value={roster.summary.outlook} wide />
        </View>
      ) : null}

      {roster ? (
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort</Text>
          {SORT_OPTIONS.map((o) => {
            const on = sortKey === o.key;
            return (
              <Pressable key={o.label} onPress={() => setSortKey(o.key)} style={[styles.sortChip, on && styles.sortChipOn]} hitSlop={4}>
                <Text style={[styles.sortChipTxt, on && styles.sortChipTxtOn]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error && !roster ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(p, i) => `${p.id}-${i}`}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>
              {section.title} · {section.data.length}
            </Text>
          )}
          renderItem={({ item, index }) => {
            const acts = moveActionsFor(item);
            const busy = movingId === String(item.id);
            return (
              <Reveal delay={Math.min(index, 12) * 32} animate={index < 14}>
                <PlayerRow player={item} baited={baited.has(String(item.id))} onToggleBait={toggleBait} onOpenPlayer={onOpenPlayer} />
                {acts.length ? (
                  <View style={styles.moveRow}>
                    {busy ? (
                      <ActivityIndicator color={colors.accent} size="small" />
                    ) : (
                      acts.map((a) => (
                        <Pressable key={a.key} onPress={a.onPress} hitSlop={6} style={({ pressed }) => [styles.moveBtn, pressed && { opacity: 0.7 }]}>
                          <Text style={styles.moveTxt}>{a.label}</Text>
                        </Pressable>
                      ))
                    )}
                  </View>
                ) : null}
              </Reveal>
            );
          }}
          ListFooterComponent={
            roster && roster.picks && roster.picks.length ? (
              <View>
                <Text style={styles.sectionHeader}>
                  Draft picks · {roster.picks.length}
                  {picksTotal != null ? <Text style={styles.picksTotal}>{`  ·  ${picksTotal} value`}</Text> : null}
                </Text>
                <View style={styles.picks}>
                  {roster.picks.map((pick, i) => {
                    // Backend now sends pick objects ({token,label,value}); tolerate an old
                    // cached string just in case.
                    const label = typeof pick === 'string' ? pick : pick.label;
                    const token = typeof pick === 'string' ? null : pick.token;
                    const value = typeof pick === 'string' ? null : pick.value;
                    const tappable = token && onOpenTrades;
                    const Chip = tappable ? Pressable : View;
                    const chipProps = tappable
                      ? { onPress: () => onOpenTrades(league, 'propose', { sendPickToken: token }) }
                      : {};
                    return (
                      <Chip
                        key={i}
                        style={({ pressed }) => [styles.pickChip, tappable && styles.pickChipTappable, pressed && { opacity: 0.7 }]}
                        {...chipProps}
                      >
                        <Text style={styles.pickText}>{label}</Text>
                        {value != null ? (
                          <Text style={styles.pickMeta}>val {value}{tappable ? '  ·  Trade ›' : ''}</Text>
                        ) : null}
                      </Chip>
                    );
                  })}
                </View>
                <Text style={styles.picksHint}>Tap a pick to shop it — opens the trade desk with it on your side.</Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

function Summary({ label, value, wide, gold }) {
  return (
    <View style={[styles.summaryCell, wide && { flex: 1.4 }]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, gold && { color: colors.gold }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  topActions: { flexDirection: 'row', gap: 16 },
  trades: { color: colors.accent, fontSize: 15, fontWeight: '800' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: '900' },
  summary: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 4, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  summaryCell: { flex: 1 },
  summaryLabel: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  summaryValue: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 3 },
  picks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  pickChip: { backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: colors.border },
  pickChipTappable: { borderColor: colors.accent + '77' },
  pickText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  pickMeta: { color: colors.accent, fontSize: 11, fontWeight: '700', marginTop: 2 },
  picksTotal: { color: colors.gold, fontSize: 13, fontWeight: '800' },
  picksHint: { color: colors.textDim, fontSize: 11, marginTop: 8, lineHeight: 15 },
  subtitle: { color: colors.textDim, fontSize: 14, marginTop: 2 },
  sortRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, marginTop: 6, marginBottom: 2 },
  sortLabel: { color: colors.textDim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 2 },
  sortChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  sortChipOn: { borderColor: colors.accent, backgroundColor: colors.accent + '22' },
  sortChipTxt: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  sortChipTxtOn: { color: colors.accent },
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  sectionHeader: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 4,
  },
  error: { color: colors.bad, textAlign: 'center' },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 10, paddingLeft: 54, minHeight: 20 },
  moveBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  moveTxt: { color: colors.accent, fontSize: 11, fontWeight: '800' },
});
