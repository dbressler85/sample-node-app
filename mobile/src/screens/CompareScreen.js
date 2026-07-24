import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import ErrorView from '../components/ErrorView';
import useAndroidBack from '../useAndroidBack';

// Side-by-side player comparison: add up to 4 players and weigh them on the numbers that
// matter in a trade — dynasty value, age, positional rank, ownership, momentum, and last
// year's stat line. The best value in each row is highlighted so the edge reads at a glance.

const MAX = 4;
const num = (v) => (v == null ? null : v);
const stat = (p, cat, key) => (p.priorSeason && p.priorSeason.stats && p.priorSeason.stats[cat] ? num(p.priorSeason.stats[cat][key]) : null);
const prior = (p, key) => (p.priorSeason ? num(p.priorSeason[key]) : null);

// Each metric: how to read a value off a player, how to render it, and which direction wins
// (so we can highlight the leader). `best: null` means no single winner (neutral rows).
function buildMetrics(priorYear) {
  return [
    { label: 'Value', get: (p) => num(p.value), fmt: (v) => v, best: 'max' },
    { label: 'Age', get: (p) => num(p.age), fmt: (v) => `${v}y`, best: 'min' },
    { label: 'Pos rank', get: (p) => num(p.posRank), fmt: (v, p) => `${p.position}${v}`, best: 'min' },
    { label: 'Overall', get: (p) => num(p.overallRank), fmt: (v) => `#${v}`, best: 'min' },
    { label: 'Owned', get: (p) => num(p.ownership), fmt: (v) => `${v}%`, best: 'max' },
    { label: 'Trend', get: (p) => num(p.trend), fmt: (v) => (v > 0 ? `+${v.toLocaleString()}` : String(v)), best: 'max' },
    { section: `${priorYear} season` },
    { label: 'PPG', get: (p) => prior(p, 'ppg'), fmt: (v) => v, best: 'max' },
    { label: 'Games', get: (p) => prior(p, 'games'), fmt: (v) => v, best: 'max' },
    { label: 'Pass yds', get: (p) => stat(p, 'passing', 'yds'), fmt: (v) => v.toLocaleString(), best: 'max' },
    { label: 'Pass TD', get: (p) => stat(p, 'passing', 'td'), fmt: (v) => v, best: 'max' },
    { label: 'Cmp/Att', get: (p) => stat(p, 'passing', 'cmp'), fmt: (v, p) => `${v}/${stat(p, 'passing', 'att')}`, best: null },
    { label: 'Rush yds', get: (p) => stat(p, 'rushing', 'yds'), fmt: (v) => v.toLocaleString(), best: 'max' },
    { label: 'Rush TD', get: (p) => stat(p, 'rushing', 'td'), fmt: (v) => v, best: 'max' },
    { label: 'Rec', get: (p) => stat(p, 'receiving', 'rec'), fmt: (v) => v, best: 'max' },
    { label: 'Rec yds', get: (p) => stat(p, 'receiving', 'yds'), fmt: (v) => v.toLocaleString(), best: 'max' },
    { label: 'Rec TD', get: (p) => stat(p, 'receiving', 'td'), fmt: (v) => v, best: 'max' },
  ];
}

export default function CompareScreen({ seedPlayer, onBack, onOpenPlayer }) {
  const [ids, setIds] = useState(seedPlayer ? [String(seedPlayer.id)] : []);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  // Reload the comparison whenever the id set changes.
  useEffect(() => {
    if (!ids.length) { setPlayers([]); return undefined; }
    let alive = true;
    setLoading(true);
    api.comparePlayers(ids)
      .then((r) => { if (alive) { setPlayers(r.players || []); setError(null); } })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ids]);

  // Debounced search to add another player.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      api.playerSearch(q).then((r) => alive && setResults(r.players || [])).catch(() => alive && setResults([]));
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  const addPlayer = (id) => {
    setQuery('');
    setResults(null);
    setIds((cur) => (cur.includes(String(id)) || cur.length >= MAX ? cur : [...cur, String(id)]));
  };
  const removePlayer = (id) => setIds((cur) => cur.filter((x) => x !== String(id)));

  const metrics = buildMetrics((players[0] && players[0].priorSeason && players[0].priorSeason.year) || 'Last');
  // Only show a metric row if at least one player has a value for it (keeps the table tight).
  const visible = metrics.filter((m) => m.section || players.some((p) => m.get(p) != null));

  // Per-row leader (by best direction), so we can bold the winning cell.
  const leaderFor = (m) => {
    if (!m.best) return null;
    const vals = players.map((p) => m.get(p)).filter((v) => v != null);
    if (vals.length < 2) return null;
    return m.best === 'max' ? Math.max(...vals) : Math.min(...vals);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Back</Text></Pressable>
        <Text style={styles.title}>Compare</Text>
        <View style={{ width: 54 }} />
      </View>

      {ids.length < MAX ? (
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.search}
            placeholder={ids.length ? 'Add another player…' : 'Search a player to compare…'}
            placeholderTextColor={colors.textDim}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? <Pressable onPress={() => setQuery('')} hitSlop={10}><Text style={styles.clear}>✕</Text></Pressable> : null}
        </View>
      ) : null}

      {results && results.length ? (
        <View style={styles.results}>
          {results.slice(0, 6).map((r) => (
            <Pressable key={r.id} style={({ pressed }) => [styles.resultRow, pressed && { opacity: 0.7 }]} onPress={() => addPlayer(r.id)}>
              <Text style={styles.resultName} numberOfLines={1}>{r.name}</Text>
              <Text style={styles.resultMeta}>{r.position} · {r.team}{r.value != null ? ` · ${r.value}` : ''}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {error ? (
        <ErrorView message={error} onRetry={() => setIds((x) => [...x])} />
      ) : !players.length && !loading ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Add two or more players to compare their value, age, rank, and last-season stats side by side.</Text>
        </View>
      ) : (
        <ScrollView style={styles.grow} contentContainerStyle={styles.body}>
          {/* Player header columns */}
          <View style={styles.headRow}>
            <View style={styles.labelCell} />
            {players.map((p) => {
              const pc = positionColors[p.position] || colors.textDim;
              return (
                <View key={p.id} style={styles.playerCol}>
                  <Pressable onPress={() => removePlayer(p.id)} hitSlop={8} style={styles.removeBtn}><Text style={styles.removeTxt}>✕</Text></Pressable>
                  <Pressable onPress={() => onOpenPlayer && onOpenPlayer(p.id)}>
                    <Text style={[styles.playerName, { color: pc }]} numberOfLines={2}>{p.name}</Text>
                    <Text style={styles.playerMeta} numberOfLines={1}>{p.position} · {p.team}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          {loading ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} /> : null}

          {visible.map((m, i) =>
            m.section ? (
              <Text key={`s-${i}`} style={styles.sectionLabel}>{m.section}</Text>
            ) : (
              <View key={m.label} style={[styles.metricRow, i % 2 === 0 && styles.metricRowAlt]}>
                <Text style={styles.labelCellText}>{m.label}</Text>
                {players.map((p) => {
                  const v = m.get(p);
                  const lead = leaderFor(m);
                  const isLead = lead != null && v === lead;
                  return (
                    <View key={p.id} style={styles.playerCol}>
                      <Text style={[styles.cellVal, isLead && styles.cellLead]} numberOfLines={1}>
                        {v == null ? '—' : m.fmt(v, p)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  grow: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 54 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 10, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  search: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 },
  clear: { color: colors.textDim, fontSize: 15, paddingHorizontal: 6 },
  results: { marginHorizontal: 16, marginTop: 6, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  resultRow: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  resultName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  resultMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  headRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 },
  labelCell: { width: 84 },
  labelCellText: { width: 84, color: colors.textDim, fontSize: 12, fontWeight: '700' },
  playerCol: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  removeBtn: { position: 'absolute', top: -4, right: 2, zIndex: 2 },
  removeTxt: { color: colors.textDim, fontSize: 13, fontWeight: '800' },
  playerName: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
  playerMeta: { color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 2 },
  metricRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  metricRowAlt: { backgroundColor: colors.card },
  sectionLabel: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 4, marginLeft: 2 },
  cellVal: { color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  cellLead: { color: colors.good, fontWeight: '900' },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', lineHeight: 21 },
});
