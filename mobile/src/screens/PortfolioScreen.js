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
  const [showAllHoldings, setShowAllHoldings] = useState(false); // Top holdings: 12 by default, expand to the full book
  const [holdView, setHoldView] = useState('value'); // Top holdings ranking: 'value' (biggest bets) | 'exposure' (most leagues)

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const [baitOverride, setBaitOverride] = useState({}); // id -> bool, optimistic "on the block" state

  const load = useCallback(() => {
    api.portfolio().then(setD).catch((e) => setError(e.message)).finally(() => setRefreshing(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const resolveBaited = (h) => (h.id in baitOverride ? baitOverride[h.id] : !!h.baited);
  // Shop / un-shop a holding across every league you roster him in — optimistic, reverts on failure.
  const toggleShop = (h) => {
    const next = !resolveBaited(h);
    setBaitOverride((m) => ({ ...m, [h.id]: next }));
    api.portfolioShop(h.id, next, h.leagueIds).catch(() => {
      setBaitOverride((m) => ({ ...m, [h.id]: !next }));
      setError('Could not update trade bait');
    });
  };

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
  // Top holdings can be ranked two ways: by value (backend's default order — your biggest bets)
  // or by exposure (how many of your leagues roster him — your most widely-held). Same players,
  // different lens: depth vs breadth. Exposure ties break on value.
  const rankedHoldings = holdView === 'exposure'
    ? [...d.holdings].sort((a, b) => b.leagues - a.leagues || b.value - a.value)
    : d.holdings;

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

        {/* Movers — which of your holdings rose/fell most since we started tracking. */}
        {d.movers && d.movers.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your movers</Text>
            {d.movers.map((m) => {
              const up = m.delta > 0;
              return (
                <Pressable
                  key={m.id}
                  style={({ pressed }) => [styles.moverRow, pressed && { opacity: 0.7 }]}
                  onPress={() => onOpenPlayer && onOpenPlayer(m.id, { id: m.id, name: m.name, position: m.position })}
                >
                  <View style={[styles.posBadge, { borderColor: positionColors[m.position] || colors.textDim }]}>
                    <Text style={[styles.pos, { color: positionColors[m.position] || colors.textDim }]}>{m.position}</Text>
                  </View>
                  <Text style={styles.moverName} numberOfLines={1}>{m.name}</Text>
                  <Text style={[styles.moverDelta, { color: up ? colors.good : colors.bad }]}>
                    {up ? '▲' : '▼'} {up ? '+' : '−'}{Math.abs(m.delta)} ({up ? '+' : '−'}{Math.abs(m.pct)}%)
                  </Text>
                </Pressable>
              );
            })}
            <Text style={styles.hint}>Biggest value swings among your holdings since tracking began — where your book is heating up or cooling off.</Text>
          </View>
        ) : null}

        {/* Season timing — advisory only; frames whether to hold or sell right now. */}
        {d.seasonal && d.seasonal.message ? (
          <View style={[styles.seasonBanner, d.seasonal.holdToSell && styles.seasonBannerActive]}>
            <Text style={styles.seasonLabel}>{d.seasonal.label.toUpperCase()}</Text>
            <Text style={styles.seasonMsg}>{d.seasonal.message}</Text>
          </View>
        ) : null}

        {/* Concentration — stack risk unique to a multi-league book: value tied to one NFL
            team (a bad season dents many rosters) or one bye week (a rough week of empty slots). */}
        {d.concentration && (d.concentration.byTeam.length || d.concentration.byBye.length) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Concentration</Text>
            {d.concentration.byTeam.slice(0, 5).map((t) => (
              <View key={t.team} style={styles.concRow}>
                <Text style={[styles.concName, t.pct >= 15 && { color: colors.warn }]}>{t.team}</Text>
                <View style={styles.concTrack}>
                  <View style={[styles.concFill, { width: `${Math.min(100, t.pct * 3)}%`, backgroundColor: t.pct >= 15 ? colors.warn : colors.accent }]} />
                </View>
                <Text style={styles.concPct}>{t.pct}%</Text>
              </View>
            ))}
            {d.concentration.byBye.length ? (
              <Text style={styles.concBye}>
                Heaviest bye: <Text style={{ color: colors.text, fontWeight: '800' }}>Week {d.concentration.byBye[0].week}</Text> holds {d.concentration.byBye[0].pct}% of your value.
              </Text>
            ) : null}
            <Text style={styles.hint}>How much of your portfolio rides on one NFL team or a single bye week — the more concentrated, the more one team’s season swings your whole book.</Text>
          </View>
        ) : null}

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

            {/* Two lenses on the same book: biggest bets (value) vs most widely-held (exposure).
                Hidden while a position filter is active. */}
            {!posFilter ? (
              <>
                <View style={styles.holdTabs}>
                  {[['value', 'By value'], ['exposure', 'By exposure']].map(([k, label]) => (
                    <Pressable key={k} onPress={() => { setHoldView(k); setShowAllHoldings(false); }} style={[styles.holdTab, holdView === k && styles.holdTabOn]}>
                      <Text style={[styles.holdTabTxt, holdView === k && styles.holdTabTxtOn]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.holdScope}>
                  {showAllHoldings ? `ALL ${d.holdings.length}` : 'TOP 12'} · {holdView === 'value' ? 'BY VALUE' : 'BY LEAGUES HELD'}
                </Text>
              </>
            ) : null}
            {/* Concentration insight — the multi-league owner's real risk: how far your single
                biggest bet towers over the rest of your book. Framed against your #2 holding so
                it stays meaningful at any league count (share-of-whole-portfolio does not). */}
            {!posFilter && d.holdings[0] ? (() => {
              const h0 = d.holdings[0];
              const h1 = d.holdings[1];
              const mult = h1 && h1.value > 0 ? h0.value / h1.value : null;
              const hot = mult != null && mult >= 1.5; // top is 50%+ bigger than your next-largest
              return (
                <View style={[styles.betBanner, hot && styles.betBannerHot]}>
                  <Text style={styles.betLabel}>BIGGEST BET</Text>
                  <Text style={styles.betText} numberOfLines={2}>
                    <Text style={{ fontWeight: '900', color: colors.text }}>{h0.name.split(',')[0]}</Text> is your largest position
                    {h0.leagues > 1 ? ` across ${h0.leagues} leagues` : ''} —{' '}
                    <Text style={{ fontWeight: '900', color: hot ? colors.warn : colors.gold }}>
                      {mult != null ? `${mult.toFixed(1)}× your next-largest` : 'your top single exposure'}
                    </Text>.
                    {hot ? ' A lot rides on him — one injury swings your whole book.' : ''}
                  </Text>
                </View>
              );
            })() : null}
            {/* Column key so the two right-hand numbers read clearly. */}
            <View style={styles.holdKeyRow}>
              <Text style={styles.holdKeyName}>Player · leagues held</Text>
              <View style={styles.holdRight}>
                <Text style={styles.holdKeyVal}>value</Text>
                <Text style={styles.holdKeyPct}>vs. biggest</Text>
              </View>
            </View>
            {(posFilter ? rankedHoldings.filter((h) => h.position === posFilter) : (showAllHoldings ? rankedHoldings : rankedHoldings.slice(0, 12))).map((h) => {
              const baited = resolveBaited(h);
              return (
                <View key={h.id} style={styles.holdRow}>
                  <Pressable
                    style={({ pressed }) => [styles.holdIdentity, pressed && { opacity: 0.7 }]}
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
                      <Text style={styles.holdPct}>{h.rel != null ? h.rel : h.pct}%</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => toggleShop(h)}
                    hitSlop={6}
                    style={[styles.shop, baited && styles.shopOn]}
                    accessibilityLabel={baited ? `Stop shopping ${h.name}` : `Shop ${h.name} in all ${h.leagues} leagues`}
                  >
                    <Text style={[styles.shopTxt, baited && styles.shopTxtOn]}>{baited ? '⇄ Shopping' : '⇄ Shop'}</Text>
                  </Pressable>
                </View>
              );
            })}
            {/* Top 12 by default; expand to the full ranked book (only when unfiltered — a
                position filter already narrows the list). */}
            {!posFilter && d.holdings.length > 12 ? (
              <Pressable onPress={() => setShowAllHoldings((v) => !v)} style={({ pressed }) => [styles.showAll, pressed && { opacity: 0.7 }]}>
                <Text style={styles.showAllTxt}>
                  {showAllHoldings ? 'Show less ▲' : `Show all ${d.holdings.length} holdings ▼`}
                </Text>
              </Pressable>
            ) : null}
            <Text style={styles.hint}>
              <Text style={{ color: colors.gold, fontWeight: '900' }}>Value</Text> = each player’s value summed across every league you roster him in (your real exposure); <Text style={{ fontWeight: '900' }}>vs. biggest</Text> = his size next to your largest holding (your top bet = 100%), so exposures compare at a glance. <Text style={{ fontWeight: '900' }}>⇄ Shop</Text> puts him on the block in every league you hold him.
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
              {risk.top.map((p, i) => {
                const baited = resolveBaited(p);
                return (
                  <View key={`${p.leagueId}-${p.id}-${i}`} style={styles.riskRow}>
                    <Pressable
                      style={({ pressed }) => [styles.holdIdentity, pressed && { opacity: 0.7 }]}
                      onPress={() => onOpenPlayer && onOpenPlayer(p.id, { id: p.id, name: p.name, position: p.position, team: p.team, value: p.value })}
                    >
                      <View style={[styles.posBadge, { borderColor: positionColors[p.position] || colors.textDim }]}>
                        <Text style={[styles.pos, { color: positionColors[p.position] || colors.textDim }]}>{p.position}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.riskName} numberOfLines={1}>{p.name}</Text>
                        <Text style={styles.riskSub} numberOfLines={1}>{p.reason} · {p.leagueName}</Text>
                      </View>
                      <Text style={styles.riskVal}>{p.value}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggleShop(p)}
                      hitSlop={6}
                      style={[styles.shop, baited && styles.shopOn]}
                      accessibilityLabel={baited ? `Stop shopping ${p.name}` : `Shop ${p.name} in all ${p.leagues || 1} leagues`}
                    >
                      <Text style={[styles.shopTxt, baited && styles.shopTxtOn]}>{baited ? '⇄ Shopping' : '⇄ Shop'}</Text>
                    </Pressable>
                  </View>
                );
              })}
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
  holdTabs: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 9, padding: 3, marginBottom: 8 },
  holdTab: { flex: 1, paddingVertical: 6, borderRadius: 7, alignItems: 'center' },
  holdTabOn: { backgroundColor: colors.cardAlt },
  holdTabTxt: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  holdTabTxtOn: { color: colors.text },
  holdScope: { color: colors.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginBottom: 8 },
  holdKeyRow: { flexDirection: 'row', alignItems: 'flex-end', paddingBottom: 6, marginBottom: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  holdKeyName: { flex: 1, color: colors.textDim, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  holdKeyVal: { color: colors.gold, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  holdKeyPct: { color: colors.textDim, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1 },
  holdRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  holdIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  shop: { marginLeft: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  shopOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  shopTxt: { color: colors.textDim, fontSize: 11, fontWeight: '800' },
  shopTxtOn: { color: '#20180a' },
  betBanner: { backgroundColor: colors.bg, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: colors.gold, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  betBannerHot: { borderLeftColor: colors.warn },
  betLabel: { color: colors.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginBottom: 3 },
  betText: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  seasonBanner: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.textDim, padding: 14, marginBottom: 14 },
  seasonBannerActive: { borderLeftColor: colors.gold },
  seasonLabel: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 0.5, marginBottom: 4 },
  seasonMsg: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  concRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  concName: { color: colors.text, fontSize: 13, fontWeight: '800', width: 44 },
  concTrack: { flex: 1, height: 12, backgroundColor: colors.bg, borderRadius: 6, overflow: 'hidden', marginHorizontal: 10 },
  concFill: { height: 12, borderRadius: 6 },
  concPct: { color: colors.text, fontSize: 12, fontWeight: '800', width: 38, textAlign: 'right' },
  concBye: { color: colors.textDim, fontSize: 13, marginTop: 8, lineHeight: 18 },
  moverRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  moverName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700', marginLeft: 2 },
  moverDelta: { fontSize: 13, fontWeight: '900', marginLeft: 8 },
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
  showAll: { alignItems: 'center', paddingVertical: 11, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  showAllTxt: { color: colors.accent, fontSize: 13, fontWeight: '800' },
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
