import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, RefreshControl, Dimensions } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import useAndroidBack from '../useAndroidBack';
import Sparkline from '../components/Sparkline';

// Chart width = screen minus the body padding (16×2) and card padding (16×2).
const CHART_W = Dimensions.get('window').width - 64;

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
  const [posFilter, setPosFilter] = useState(null); // tap an allocation segment to filter holdings by position

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
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Hub</Text></Pressable>
        <Text style={styles.title}>Portfolio</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        {/* Hero: total value, movement, and the value-over-time line — the portfolio glance. */}
        <View style={styles.card}>
          <Text style={styles.totalLabel}>Total dynasty value · {d.totals.teams} team{d.totals.teams === 1 ? '' : 's'}</Text>
          <Text style={styles.totalValue}>{d.totals.rosterValue.toLocaleString()}</Text>
          <ChangeLine change={d.change} />
          {d.history && d.history.length >= 2 ? (
            <View style={styles.chartWrap}>
              <Sparkline
                data={d.history.map((h) => h.value)}
                width={CHART_W}
                height={64}
                color={!d.change || d.change.absolute >= 0 ? colors.good : colors.bad}
              />
            </View>
          ) : (
            <Text style={styles.buildingHint}>Tracking your value — the trend line fills in over the coming days.</Text>
          )}
          <View style={styles.statRow}>
            <Stat label="Players" value={d.totals.playerCount} />
            <Stat label="Value-wtd age" value={d.totals.valueWeightedAge != null ? `${d.totals.valueWeightedAge}y` : '—'} />
            <Stat label="Leagues" value={d.totals.leagues} />
          </View>
        </View>

        {/* Allocation by position — the portfolio's "sectors" as a single stacked bar. Tap a
            segment (or legend key) to filter the holdings below to that position; tap it again
            to clear. The active segment stays lit; the rest dull. */}
        {d.allocation && d.allocation.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Allocation by position</Text>
            <View style={styles.allocBar}>
              {d.allocation.map((a, i) => {
                const dull = posFilter && posFilter !== a.position;
                return (
                  <Pressable
                    key={a.position}
                    onPress={() => setPosFilter((cur) => (cur === a.position ? null : a.position))}
                    style={{
                      width: `${a.pct}%`,
                      backgroundColor: positionColors[a.position] || colors.textDim,
                      opacity: dull ? 0.28 : 1,
                      borderTopLeftRadius: i === 0 ? 7 : 0,
                      borderBottomLeftRadius: i === 0 ? 7 : 0,
                      borderTopRightRadius: i === d.allocation.length - 1 ? 7 : 0,
                      borderBottomRightRadius: i === d.allocation.length - 1 ? 7 : 0,
                    }}
                  />
                );
              })}
            </View>
            <View style={styles.allocLegend}>
              {d.allocation.map((a) => {
                const active = posFilter === a.position;
                const dull = posFilter && !active;
                return (
                  <Pressable
                    key={a.position}
                    onPress={() => setPosFilter((cur) => (cur === a.position ? null : a.position))}
                    style={[styles.allocKey, active && styles.allocKeyActive, dull && { opacity: 0.4 }]}
                  >
                    <View style={[styles.allocDot, { backgroundColor: positionColors[a.position] || colors.textDim }]} />
                    <Text style={[styles.allocKeyText, active && { color: colors.text }]}>{a.position} {a.pct}%</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>
              {posFilter ? `Showing ${posFilter} holdings — tap ${posFilter} again to clear.` : 'Tap a position to filter your holdings below.'}
            </Text>
          </View>
        ) : null}

        {/* Top holdings — your biggest positions across every league (exposure + share). */}
        {d.holdings && d.holdings.length ? (
          <View style={styles.card}>
            <View style={styles.cardHeadRow}>
              <Text style={styles.cardTitle}>{posFilter ? `Top ${posFilter} holdings` : 'Top holdings'}</Text>
              {posFilter ? (
                <Pressable onPress={() => setPosFilter(null)} hitSlop={8}><Text style={styles.clearFilter}>Clear ✕</Text></Pressable>
              ) : null}
            </View>
            {/* Column key so the two right-hand numbers read clearly. */}
            <View style={styles.holdKeyRow}>
              <Text style={styles.holdKeyName}>Player · leagues held</Text>
              <View style={styles.holdRight}>
                <Text style={styles.holdKeyVal}>value</Text>
                <Text style={styles.holdKeyPct}>% of total</Text>
              </View>
            </View>
            {(posFilter ? d.holdings.filter((h) => h.position === posFilter) : d.holdings).map((h) => (
              <Pressable
                key={h.id}
                style={({ pressed }) => [styles.holdRow, pressed && { opacity: 0.7 }]}
                onPress={() => onOpenPlayer && onOpenPlayer(h.id, { id: h.id, name: h.name, position: h.position, team: h.team, value: h.avg })}
              >
                <View style={[styles.posBadge, { borderColor: positionColors[h.position] || colors.textDim }]}>
                  <Text style={[styles.pos, { color: positionColors[h.position] || colors.textDim }]}>{h.position}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.holdName} numberOfLines={1}>{h.name}</Text>
                  <Text style={styles.holdSub} numberOfLines={1}>
                    {h.team ? `${h.team} · ` : ''}{h.leagues === 1 ? '1 league' : `${h.leagues} leagues`}
                    {h.leagues > 1 ? ` · ${h.avg} avg` : ''}
                  </Text>
                </View>
                <View style={styles.holdRight}>
                  <Text style={styles.holdVal}>{h.value.toLocaleString()}</Text>
                  <Text style={styles.holdPct}>{h.pct}%</Text>
                </View>
              </Pressable>
            ))}
            <Text style={styles.hint}>
              <Text style={{ color: colors.gold, fontWeight: '900' }}>Value</Text> = each player’s value summed across every league you roster him in (your real exposure); <Text style={{ fontWeight: '900' }}>% of total</Text> = his share of your whole portfolio.
            </Text>
          </View>
        ) : null}

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
                <Pressable key={`${p.leagueId}-${p.id}-${i}`} style={({ pressed }) => [styles.riskRow, pressed && { opacity: 0.7 }]} onPress={() => onOpenPlayer && onOpenPlayer(p.id, { id: p.id, name: p.name, position: p.position, team: p.team, value: p.value })}>
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

        {/* Your tags */}
        {d.tags && (d.tags.avoids > 0 || d.tags.targets > 0) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your tags</Text>
            {d.tags.avoids > 0 ? (
              <Text style={styles.tagLine}>
                <Text style={{ color: colors.bad, fontWeight: '900' }}>⊘ {d.tags.avoids}</Text> Avoid{d.tags.avoids === 1 ? '' : 's'} on your rosters — shop them.
              </Text>
            ) : null}
            {d.tags.targets > 0 ? (
              <Text style={styles.tagLine}>
                <Text style={{ color: colors.good, fontWeight: '900' }}>◎ {d.tags.targets}</Text> Target{d.tags.targets === 1 ? '' : 's'} you hold — protected in trade suggestions.
              </Text>
            ) : null}
          </View>
        ) : null}

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

// The movement line under the total: ▲/▼ absolute (+pct%) over the tracked window. Neutral
// until there are two days to compare.
function ChangeLine({ change }) {
  if (!change) return <Text style={styles.changeFlat}>No movement yet</Text>;
  const up = change.absolute >= 0;
  const c = change.absolute === 0 ? colors.textDim : up ? colors.good : colors.bad;
  const sign = up ? '+' : '−';
  const mag = Math.abs(change.absolute).toLocaleString();
  return (
    <Text style={[styles.change, { color: c }]}>
      {up ? '▲' : '▼'} {sign}{mag} <Text style={styles.changePct}>({sign}{Math.abs(change.pct)}%)</Text>
      <Text style={styles.changeWindow}>  ·  {change.days}d</Text>
    </Text>
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
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
  title: { color: colors.text, fontSize: 17, fontWeight: '900' },
  body: { padding: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 },
  totalValue: { color: colors.gold, fontSize: 40, fontWeight: '900', letterSpacing: -1, marginTop: 2 },
  totalLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  change: { fontSize: 15, fontWeight: '900', marginTop: 4 },
  changePct: { fontSize: 14, fontWeight: '800' },
  changeWindow: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  changeFlat: { color: colors.textDim, fontSize: 13, fontWeight: '700', marginTop: 4 },
  chartWrap: { marginTop: 12, marginHorizontal: -2 },
  buildingHint: { color: colors.textDim, fontSize: 12, marginTop: 12, lineHeight: 16 },
  allocBar: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: colors.bg },
  allocLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  allocKey: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: 'transparent' },
  allocKeyActive: { borderColor: colors.border, backgroundColor: colors.bg },
  allocDot: { width: 9, height: 9, borderRadius: 2 },
  allocKeyText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  clearFilter: { color: colors.accent, fontSize: 12, fontWeight: '800', marginBottom: 10 },
  holdKeyRow: { flexDirection: 'row', alignItems: 'flex-end', paddingBottom: 6, marginBottom: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  holdKeyName: { flex: 1, color: colors.textDim, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  holdKeyVal: { color: colors.gold, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  holdKeyPct: { color: colors.textDim, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1 },
  holdRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  holdName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  holdSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  holdRight: { alignItems: 'flex-end', marginLeft: 8, minWidth: 52 },
  holdVal: { color: colors.gold, fontSize: 15, fontWeight: '900' },
  holdPct: { color: colors.textDim, fontSize: 11, fontWeight: '700', marginTop: 1 },
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
  tagLine: { color: colors.text, fontSize: 13, lineHeight: 20 },
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
