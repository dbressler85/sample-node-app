import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import useAndroidBack from '../useAndroidBack';

// Roster strength as a plain qualitative tag (from where its value ranks in the
// league), so the outlook label is explainable rather than a bare number. Thresholds
// mirror the backend model (strong ≥ 0.55, thin ≤ 0.45).
const strengthLabel = (pct) => {
  if (pct == null) return null;
  if (pct >= 0.55) return 'strong roster';
  if (pct <= 0.45) return 'thin roster';
  return 'middle of the pack';
};

// Cross-league dynasty portfolio: total invested value, how it's spread by age, and
// the value "at risk" — tied up in hurt starters or players aging past their
// position's decline curve. The strategic counterpart to the Home action list.
export default function PortfolioScreen({ onBack, onOpenPlayer, onOpenLeague }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(() => {
    api.portfolio().then(setD).catch((e) => setError(e.message)).finally(() => setRefreshing(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.error}>{error}</Text>
        <Pressable onPress={() => { setError(null); load(); }} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable>
      </View>
    );
  }
  if (!d) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color={colors.accent} size="large" /></View>;
  }

  const maxBand = Math.max(1, ...d.ageCurve.map((b) => b.value));
  const risk = d.atRisk;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Home</Text></Pressable>
        <Text style={styles.title}>Portfolio</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        {/* Totals */}
        <View style={styles.card}>
          <Text style={styles.totalValue}>{d.totals.rosterValue.toLocaleString()}</Text>
          <Text style={styles.totalLabel}>total dynasty value · {d.totals.teams} team{d.totals.teams === 1 ? '' : 's'}</Text>
          <View style={styles.statRow}>
            <Stat label="Players" value={d.totals.playerCount} />
            <Stat label="Value-wtd age" value={d.totals.valueWeightedAge != null ? `${d.totals.valueWeightedAge}y` : '—'} />
            <Stat label="Leagues" value={d.totals.leagues} />
          </View>
        </View>

        {/* Value at risk */}
        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardTitle}>Value at risk</Text>
            <Text style={[styles.riskPct, risk.pct >= 25 && { color: colors.bad }, risk.pct >= 15 && risk.pct < 25 && { color: colors.warn }]}>{risk.pct}%</Text>
          </View>
          <View style={styles.riskSplit}>
            <RiskStat label="Hurt starters" value={risk.injured.value} count={risk.injured.count} color={colors.bad} />
            <RiskStat label="Aging" value={risk.aging.value} count={risk.aging.count} color={colors.warn} />
          </View>
          {risk.top.length ? (
            <View style={styles.topList}>
              {risk.top.map((p, i) => (
                <Pressable key={`${p.leagueId}-${p.id}-${i}`} style={({ pressed }) => [styles.riskRow, pressed && { opacity: 0.7 }]} onPress={() => onOpenPlayer && onOpenPlayer(p.id)}>
                  <View style={[styles.posBadge, { borderColor: positionColors[p.position] || colors.textDim }]}>
                    <Text style={[styles.pos, { color: positionColors[p.position] || colors.textDim }]}>{p.position}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.riskName} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.riskSub} numberOfLines={1}>{p.reason} · {p.leagueName}</Text>
                  </View>
                  <Text style={styles.riskVal}>{p.value}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.clear}>Nothing at risk — healthy and young across the board.</Text>
          )}
        </View>

        {/* Age curve */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Value by age</Text>
          {d.ageCurve.map((b) => (
            <View key={b.band} style={styles.curveRow}>
              <Text style={styles.curveBand}>{b.band}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.round((b.value / maxBand) * 100)}%` }]} />
              </View>
              <Text style={styles.curveVal}>{b.pct}%</Text>
            </View>
          ))}
          <Text style={styles.hint}>Where your value sits by player age. A left-heavy curve is a younger, ascending portfolio.</Text>
        </View>

        {/* Per-league */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>By league</Text>
          {d.byLeague.map((l) => {
            const Row = onOpenLeague ? Pressable : View;
            const rowProps = onOpenLeague ? { onPress: () => onOpenLeague({ leagueId: l.leagueId, name: l.name }) } : {};
            return (
              <Row key={l.leagueId} style={({ pressed }) => [styles.leagueRow, pressed && { opacity: 0.7 }]} {...rowProps}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.leagueName} numberOfLines={1}>{l.name}</Text>
                  <Text style={styles.leagueSub} numberOfLines={1}>
                    {[l.outlook, l.coreAge != null ? `core ${l.coreAge}y` : null, strengthLabel(l.strengthPct)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {l.atRiskPct > 0 ? <Text style={[styles.leagueRisk, l.atRiskPct >= 20 && { color: colors.bad }]}>{l.atRiskPct}% risk</Text> : null}
                <Text style={styles.leagueVal}>{l.value != null ? l.value : '—'}</Text>
                {onOpenLeague ? <Text style={styles.leagueChev}>›</Text> : null}
              </Row>
            );
          })}
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function RiskStat({ label, value, count, color }) {
  return (
    <View style={styles.riskStat}>
      <Text style={[styles.riskStatValue, { color }]}>{value}</Text>
      <Text style={styles.riskStatLabel}>{label} · {count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
  title: { color: colors.text, fontSize: 17, fontWeight: '900' },
  body: { padding: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 },
  totalValue: { color: colors.gold, fontSize: 40, fontWeight: '900', letterSpacing: -1 },
  totalLabel: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginTop: 2 },
  statRow: { flexDirection: 'row', marginTop: 16, gap: 10 },
  stat: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  statLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 2 },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.textDim, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  riskPct: { color: colors.good, fontSize: 22, fontWeight: '900', marginBottom: 10 },
  riskSplit: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  riskStat: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  riskStatValue: { fontSize: 22, fontWeight: '900' },
  riskStatLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 3 },
  topList: { marginTop: 8 },
  riskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  posBadge: { width: 38, paddingVertical: 2, borderRadius: 6, borderWidth: 1, alignItems: 'center', marginRight: 10 },
  pos: { fontSize: 11, fontWeight: '800' },
  riskName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  riskSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  riskVal: { color: colors.gold, fontSize: 15, fontWeight: '900', width: 40, textAlign: 'right' },
  clear: { color: colors.good, fontSize: 13, marginTop: 4 },
  curveRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  curveBand: { color: colors.textDim, fontSize: 12, fontWeight: '700', width: 46 },
  barTrack: { flex: 1, height: 14, backgroundColor: colors.bg, borderRadius: 7, overflow: 'hidden', marginHorizontal: 8 },
  barFill: { height: 14, backgroundColor: colors.accent, borderRadius: 7 },
  curveVal: { color: colors.text, fontSize: 12, fontWeight: '800', width: 38, textAlign: 'right' },
  hint: { color: colors.textDim, fontSize: 11, marginTop: 6, lineHeight: 15 },
  leagueRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  leagueName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  leagueSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  leagueRisk: { color: colors.warn, fontSize: 12, fontWeight: '800', marginRight: 12 },
  leagueVal: { color: colors.gold, fontSize: 15, fontWeight: '900', width: 44, textAlign: 'right' },
  leagueChev: { color: colors.textDim, fontSize: 18, fontWeight: '700', marginLeft: 8 },
  error: { color: colors.bad, textAlign: 'center', marginBottom: 14 },
  retry: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: colors.border },
  retryText: { color: colors.text, fontWeight: '700' },
});
