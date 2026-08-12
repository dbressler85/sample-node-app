import React, { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, FlatList, StyleSheet, Pressable, RefreshControl, Dimensions } from 'react-native';
import ListSkeleton from '../components/ListSkeleton';
import { api } from '../api';
import { portfolioPreferDevice } from '../mflDevice';
import { colors, positionColors } from '../theme';
import { displayLabel } from '../typography';
import { TopbarTitle } from '../components/Brand';
import useAndroidBack from '../useAndroidBack';
import useCachedResource from '../useCachedResource';
import Sparkline from '../components/Sparkline';
import OutlookDonut from '../components/OutlookDonut';
import PressableScale from '../components/PressableScale';
import Reveal from '../components/Reveal';
import AnimatedNumber from '../components/AnimatedNumber';
import PartialNote from '../components/PartialNote';
import DeviceNote from '../components/DeviceNote';
import ValueCredit from '../components/ValueCredit';
import { toast } from '../components/Toast';

// Chart width = screen minus the body padding (16×2) and card padding (16×2).
const CHART_W = Dimensions.get('window').width - 64;

// Fixed holdings-row height — MUST match styles.holdRow.height. Feeds getItemLayout so the virtualized
// list knows every row's offset up front and a fast fling never renders blank cells.
const HOLDING_ROW_HEIGHT = 54;
const getHoldingLayout = (_data, index) => ({ length: HOLDING_ROW_HEIGHT, offset: HOLDING_ROW_HEIGHT * index, index });

// Cross-league dynasty portfolio: total invested value, how it's spread by age, and
// the value "at risk" — tied up in hurt starters or players aging past their
// position's decline curve. The strategic counterpart to the Home action list.
export default function PortfolioScreen({ onBack, onOpenPlayer, onOpenLeague }) {
  // Portfolio via the shared cache hook: instant repaint on return, throttled reloads, and it keeps
  // the last book on a failed refresh (C1/C2/C4). A shop/trade done elsewhere marks it stale
  // (invalidate-on-write), so returning here refetches (C3).
  // Device-first: the per-league roster fan-out runs on-device (its own IP), the backend only aggregates;
  // silently falls back to the backend's own resilient fan-out on any device-read failure. `_source` tags it.
  const { data: d, error: fetchError, refreshing, reload } = useCachedResource('portfolio', () => portfolioPreferDevice());
  const [posFilter, setPosFilter] = useState(null); // tap an allocation segment to filter holdings by position
  const [showAllHoldings, setShowAllHoldings] = useState(false); // Top holdings: 12 by default, expand to the full book
  const [holdView, setHoldView] = useState('value'); // Top holdings ranking: 'value' (biggest bets) | 'exposure' (most leagues)
  const [showAllRisk, setShowAllRisk] = useState(false); // Value at risk: 8 by default, expand to the full list
  const [riskView, setRiskView] = useState('value'); // Value at risk ranking: 'value' | 'exposure' (leagues held)
  const [portTab, setPortTab] = useState('overview'); // sub-tab (tabs-lite): 'overview' | 'teams'
  const [teamSort, setTeamSort] = useState('value'); // Teams tab sort: 'value' | 'trend' | 'strength'

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const [baitOverride, setBaitOverride] = useState({}); // id -> bool, optimistic "on the block" state

  const resolveBaited = (h) => (h.id in baitOverride ? baitOverride[h.id] : !!h.baited);
  // Mirror the override map in a ref so toggleShop can read the current state WITHOUT depending on
  // baitOverride — that keeps its identity stable, so a shop toggle re-renders only the touched
  // memoized row instead of every holding row.
  const baitRef = useRef(baitOverride);
  baitRef.current = baitOverride;
  // Shop / un-shop a holding across every league you roster him in — optimistic, reverts on failure.
  const toggleShop = useCallback((h) => {
    const cur = h.id in baitRef.current ? baitRef.current[h.id] : !!h.baited;
    const next = !cur;
    setBaitOverride((m) => ({ ...m, [h.id]: next }));
    api.portfolioShop(h.id, next, h.leagueIds).catch(() => {
      setBaitOverride((m) => ({ ...m, [h.id]: cur }));
      toast('Could not update trade block'); // non-destructive: the row already reverted; never blank the page
    });
  }, []);

  // Cross-league arbitrage: shop a player in the ONE league where he's worth most (not every league
  // like Top holdings). Own optimistic override, keyed by player id, reverted on failure.
  const [arbBait, setArbBait] = useState({}); // id -> bool
  const arbBaitRef = useRef(arbBait);
  arbBaitRef.current = arbBait;
  const shopArb = useCallback((a) => {
    const cur = a.id in arbBaitRef.current ? arbBaitRef.current[a.id] : !!a.baited;
    const next = !cur;
    setArbBait((m) => ({ ...m, [a.id]: next }));
    api.portfolioShop(a.id, next, [a.high.leagueId]).catch(() => {
      setArbBait((m) => ({ ...m, [a.id]: cur }));
      toast('Could not update trade block');
    });
  }, []);

  // Untag a player from the Your-tags list — optimistic local removal, reverted on failure.
  const [untagged, setUntagged] = useState(() => new Set());
  const untagPlayer = useCallback((id) => {
    setUntagged((s) => new Set(s).add(id));
    api.setTag(id, null).catch(() => {
      setUntagged((s) => { const n = new Set(s); n.delete(id); return n; });
      toast('Could not remove tag'); // non-destructive: the untag already reverted
    });
  }, []);
  // Your-tags filters + sort.
  const [tagKind, setTagKind] = useState('all'); // 'all' | 'target' | 'avoid'
  const [tagPos, setTagPos] = useState(null); // null | 'QB' | 'RB' | …
  const [tagSort, setTagSort] = useState('value'); // 'value' | 'position' | 'name' | 'tag' | 'shares'

  // renderItem for the holdings FlatList — a memoized HoldingRow. MUST stay above the early returns
  // below so the hook count is stable across renders (data-null render vs loaded render); it reads
  // only resolveBaited/onOpenPlayer/toggleShop, none of which need `d`.
  const renderHolding = useCallback(
    ({ item: h, index: i }) => (
      <View style={styles.holdRowFrame}>
        <HoldingRow h={h} index={i} baited={resolveBaited(h)} onOpen={onOpenPlayer} onToggleShop={toggleShop} />
      </View>
    ),
    // resolveBaited closes over baitOverride; extraData on the list also keys re-render off it.
    [baitOverride, onOpenPlayer, toggleShop] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Only take over with the error view when there's NO book to show. A failed background refetch while
  // the portfolio is painted keeps it on screen (non-destructive — UX_GUARDRAILS C4).
  if (fetchError && !d) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.error}>{fetchError}</Text>
        <Pressable onPress={() => reload()} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable>
      </View>
    );
  }
  if (!d) {
    return <View style={styles.container}><ListSkeleton rows={6} /></View>;
  }

  const maxBand = Math.max(1, ...d.ageCurve.map((b) => b.value));
  const risk = d.atRisk;
  // Value at risk mirrors Top holdings: deduped per player (backend), sortable by value or by
  // leagues held, and expandable from a default slice to the full list.
  const RISK_DEFAULT = 8;
  const riskSorted =
    riskView === 'exposure'
      ? [...risk.top].sort((a, b) => (b.leagues || 1) - (a.leagues || 1) || b.value - a.value)
      : risk.top; // backend already orders by at-risk value
  const riskShown = showAllRisk ? riskSorted : riskSorted.slice(0, RISK_DEFAULT);
  // Top holdings can be ranked two ways: by value (backend's default order — your biggest bets)
  // or by exposure (how many of your leagues roster him — your most widely-held). Same players,
  // different lens: depth vs breadth. Exposure ties break on value.
  const rankedHoldings = holdView === 'exposure'
    ? [...d.holdings].sort((a, b) => b.leagues - a.leagues || b.value - a.value)
    : d.holdings;
  // The value/shares tab governs the whole position lens: switch it (and collapse "Show all").
  const selectHoldView = (k) => { setHoldView(k); setShowAllHoldings(false); };
  // Allocation by position honours the same tab: by value = share of total dynasty value;
  // by shares = share of your roster slots (one per league you hold a player). Sorted by the
  // active metric so the dominant sector reads first in either lens.
  const allocPctOf = (a) => (holdView === 'exposure' && a.sharePct != null ? a.sharePct : a.pct);
  const allocView = d.allocation ? [...d.allocation].sort((a, b) => allocPctOf(b) - allocPctOf(a)) : [];
  // Only render well-formed arbitrage rows — an item must carry the player name and BOTH league
  // legs (name + numeric value). Guards against a stale/older-shape cached payload rendering as
  // ghost rows (position badge + Shop with no name/value), which reads as "broken".
  const arbItems = (d.arbitrage || []).filter(
    (a) => a && a.id && a.name && a.high && a.low && Number.isFinite(a.high.value) && Number.isFinite(a.low.value) && a.high.name && a.low.name
  );

  // The Top-holdings list is the one unbounded part of this screen (a player per league you hold
  // him in → potentially hundreds of rows once "Show all" is on). Drive it through a FlatList so
  // only the on-screen rows mount; everything else on the page rides in the header/footer. The rows
  // are a memoized HoldingRow, and toggleShop has a stable identity, so shopping one player
  // re-renders just that row instead of the whole book.
  const hasHoldings = !!(d.holdings && d.holdings.length);
  const visibleHoldings = !hasHoldings
    ? []
    : posFilter
    ? rankedHoldings.filter((h) => h.position === posFilter)
    : showAllHoldings
    ? rankedHoldings
    : rankedHoldings.slice(0, 12);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Hub</Text></Pressable>
        <TopbarTitle>Portfolio</TopbarTitle>
        <View style={{ width: 60 }} />
      </View>

      {/* Sub-tabs (tabs-lite): Overview keeps the full analysis scroll; Teams is the per-team view. */}
      <View style={styles.segRow}>
        {[['overview', 'Overview'], ['teams', 'Teams']].map(([k, lbl]) => (
          <Pressable key={k} onPress={() => setPortTab(k)} style={[styles.seg, portTab === k && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: portTab === k }}>
            <Text style={[styles.segText, portTab === k && styles.segTextOn]}>{lbl}</Text>
          </Pressable>
        ))}
      </View>

      {portTab === 'teams' ? (
        <TeamsView d={d} refreshing={refreshing} reload={reload} onOpenLeague={onOpenLeague} teamSort={teamSort} setTeamSort={setTeamSort} />
      ) : (
      <FlatList
        data={visibleHoldings}
        keyExtractor={(h) => h.id}
        renderItem={renderHolding}
        getItemLayout={getHoldingLayout}
        extraData={baitOverride}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={11}
        removeClippedSubviews
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
        ListHeaderComponent={(
          <View>
        {/* Hero: total value, movement, and the value-over-time line — the portfolio glance. */}
        <View style={styles.card}>
          <Text style={styles.totalLabel}>Total dynasty value · {d.totals.teams} team{d.totals.teams === 1 ? '' : 's'}</Text>
          <AnimatedNumber value={d.totals.rosterValue} style={styles.totalValue} />
          {/* While partial (some leagues didn't load), the total is only a FRACTION of your portfolio, so
              the trend + sparkline are hidden — comparing a partial aggregate to a complete one reads as a
              fake catastrophic drop. The banner explains it; pull-to-refresh loads the rest. */}
          {!d.totals.partial ? <ChangeLine change={d.change} /> : null}
          <PartialNote loaded={d.totals.teams} total={d.totals.leagues} onRetry={reload} />
          {d._source === 'device' ? <DeviceNote text={`Rosters live from MFL on-device · ${d.totals.leagues} league${d.totals.leagues === 1 ? '' : 's'}`} /> : null}
          {d.totals.partial ? (
            <Text style={styles.buildingHint}>Value trend hidden until all {d.totals.leagues} leagues load — pull to refresh.</Text>
          ) : d.history && d.history.length >= 2 ? (
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

        {/* Movers — which of your holdings rose/fell most since we started tracking. Hidden on a partial
            load: a holding's value is understated when some leagues failed, so its "move" would be a
            fake drop (same reason ChangeLine/Sparkline hide above). Backend also returns movers:[] when
            partial; this gate covers a stale-payload / build-skew window either direction. */}
        {!d.totals.partial && d.movers && d.movers.length ? (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, displayLabel()]}>Your movers</Text>
            {d.movers.map((m, i) => {
              const up = m.delta > 0;
              return (
                <Reveal key={m.id} delay={Math.min(i, 6) * 45}>
                <PressableScale
                  style={styles.moverRow}
                  onPress={() => onOpenPlayer && onOpenPlayer(m.id, { id: m.id, name: m.name, position: m.position })}
                >
                  <View style={[styles.posBadge, { borderColor: positionColors[m.position] || colors.textDim }]}>
                    <Text style={[styles.pos, { color: positionColors[m.position] || colors.textDim }]}>{m.position}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.moverName} numberOfLines={1}>{m.name}</Text>
                    {m.team ? <Text style={styles.moverTeam}>{m.team}</Text> : null}
                  </View>
                  <Text style={[styles.moverDelta, { color: up ? colors.good : colors.bad }]}>
                    {up ? '▲' : '▼'} {up ? '+' : '−'}{Math.abs(m.delta)} ({up ? '+' : '−'}{Math.abs(m.pct)}%)
                  </Text>
                </PressableScale>
                </Reveal>
              );
            })}
            <Text style={styles.hint}>Biggest value swings among your holdings since tracking began — where your book is heating up or cooling off.</Text>
          </View>
        ) : null}

        {/* Cross-league arbitrage — the same player is worth more in one of your leagues than another
            (format + league size drive it), so that's where to shop him. Only shown when you actually
            have a gap worth acting on. */}
        {arbItems.length ? (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, displayLabel()]}>Cross-league arbitrage</Text>
            {arbItems.map((a, i) => {
              const baited = a.id in arbBait ? arbBait[a.id] : !!a.baited;
              return (
                <Reveal key={a.id} delay={Math.min(i, 6) * 45}>
                  <View style={styles.arbRow}>
                    <PressableScale style={styles.arbMain} onPress={() => onOpenPlayer && onOpenPlayer(a.id, { id: a.id, name: a.name, position: a.position })}>
                      <View style={[styles.posBadge, { borderColor: positionColors[a.position] || colors.textDim }]}>
                        <Text style={[styles.pos, { color: positionColors[a.position] || colors.textDim }]}>{a.position}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.arbName} numberOfLines={1}>{a.name}</Text>
                        <Text style={styles.arbLine} numberOfLines={2}>
                          <Text style={{ color: colors.gold, fontWeight: '900' }}>{a.high.value}</Text> in {a.high.name}
                          {'  ·  '}<Text style={{ fontWeight: '900' }}>{a.low.value}</Text> in {a.low.name}
                        </Text>
                        <Text style={styles.arbHint} numberOfLines={2}>
                          +{a.spread} ({a.spreadPct}%) more in {a.high.name}{a.sellSignal ? ` — and you're ${outlookShort(a.high.outlook)} there, so cash out` : ' — shop him there'}.
                        </Text>
                      </View>
                    </PressableScale>
                    <Pressable
                      hitSlop={8}
                      onPress={() => shopArb(a)}
                      style={[styles.shop, baited && styles.shopOn]}
                      accessibilityLabel={baited ? `Stop shopping ${a.name} in ${a.high.name}` : `Shop ${a.name} in ${a.high.name}`}
                    >
                      <Text style={[styles.shopTxt, baited && styles.shopTxtOn]}>{baited ? '⇄ Shopping' : '⇄ Shop'}</Text>
                    </Pressable>
                  </View>
                </Reveal>
              );
            })}
            <Text style={styles.hint}>A player you hold in more than one league is worth more in some than others — Superflex, TE-premium, and league size all move his price. Shop him where he’s worth most (⇄ Shop puts him on the block in that league only).</Text>
          </View>
        ) : null}


        {/* Allocation by position — the portfolio's "sectors" as a single stacked bar. Tap a
            segment (or legend key) to filter the holdings below to that position; tap it again
            to clear. The active segment stays lit; the rest dull. */}
        {d.allocation && d.allocation.length ? (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, displayLabel()]}>Allocation by position</Text>
            {/* Same value/shares lens as Top holdings — by value = share of dynasty value,
                by shares = share of roster slots. */}
            <View style={styles.holdTabs}>
              {[['value', 'By value'], ['exposure', 'By shares']].map(([k, label]) => (
                <Pressable key={k} onPress={() => selectHoldView(k)} style={[styles.holdTab, holdView === k && styles.holdTabOn]}>
                  <Text style={[styles.holdTabTxt, holdView === k && styles.holdTabTxtOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.holdScope}>{holdView === 'value' ? '% OF TOTAL VALUE' : '% OF TOTAL SHARES · ROSTER SLOTS'}</Text>
            <View style={styles.allocBar}>
              {allocView.map((a, i) => {
                const dull = posFilter && posFilter !== a.position;
                return (
                  <Pressable
                    key={a.position}
                    onPress={() => setPosFilter((cur) => (cur === a.position ? null : a.position))}
                    style={{
                      width: `${allocPctOf(a)}%`,
                      backgroundColor: positionColors[a.position] || colors.textDim,
                      opacity: dull ? 0.28 : 1,
                      borderTopLeftRadius: i === 0 ? 7 : 0,
                      borderBottomLeftRadius: i === 0 ? 7 : 0,
                      borderTopRightRadius: i === allocView.length - 1 ? 7 : 0,
                      borderBottomRightRadius: i === allocView.length - 1 ? 7 : 0,
                    }}
                  />
                );
              })}
            </View>
            <View style={styles.allocLegend}>
              {allocView.map((a) => {
                const active = posFilter === a.position;
                const dull = posFilter && !active;
                return (
                  <Pressable
                    key={a.position}
                    onPress={() => setPosFilter((cur) => (cur === a.position ? null : a.position))}
                    style={[styles.allocKey, active && styles.allocKeyActive, dull && { opacity: 0.4 }]}
                  >
                    <View style={[styles.allocDot, { backgroundColor: positionColors[a.position] || colors.textDim }]} />
                    <Text style={[styles.allocKeyText, active && { color: colors.text }]}>{a.position} {allocPctOf(a)}%</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>
              {posFilter
                ? `Showing ${posFilter} holdings — tap ${posFilter} again to clear.`
                : holdView === 'value'
                  ? 'Each position’s share of your total dynasty value. Tap a position to filter your holdings below.'
                  : 'Each position’s share of your roster slots (one slot per league you hold a player). Tap to filter.'}
            </Text>
          </View>
        ) : null}

        {/* Top holdings — your biggest positions across every league (exposure + share). The card
            box is drawn in three pieces so the rows between can be a virtualized FlatList: this is
            the TOP (title + lenses + column key); the rows carry the sides; the footer closes it. */}
        {hasHoldings ? (
          <View style={styles.holdCardTop}>
            <View style={styles.cardHeadRow}>
              <Text style={[styles.cardTitle, displayLabel()]}>{posFilter ? `Top ${posFilter} holdings` : 'Top holdings'}</Text>
              {posFilter ? (
                <Pressable onPress={() => setPosFilter(null)} hitSlop={8}><Text style={styles.clearFilter}>Clear ✕</Text></Pressable>
              ) : null}
            </View>

            {/* Two lenses on the same book: biggest bets (value) vs most widely-held (exposure).
                Hidden while a position filter is active. */}
            {!posFilter ? (
              <>
                <View style={styles.holdTabs}>
                  {[['value', 'By value'], ['exposure', 'By shares']].map(([k, label]) => (
                    <Pressable key={k} onPress={() => selectHoldView(k)} style={[styles.holdTab, holdView === k && styles.holdTabOn]}>
                      <Text style={[styles.holdTabTxt, holdView === k && styles.holdTabTxtOn]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.holdScope}>
                  {showAllHoldings ? `ALL ${d.holdings.length}` : 'TOP 12'} · {holdView === 'value' ? 'BY TOTAL VALUE' : 'BY SHARES · LEAGUES HELD'}
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
                <Text style={styles.holdKeyPct}>7-day</Text>
              </View>
            </View>
          </View>
        ) : null}
          </View>
        )}
        ListFooterComponent={(
          <View>
            {/* Holdings card FOOTER — closes the three-piece card box wrapped around the
                virtualized rows (top piece is in the header, sides ride on each row). */}
            {hasHoldings ? (
              <View style={styles.holdCardBottom}>
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
              <Text style={{ color: colors.gold, fontWeight: '900' }}>Value</Text> = each player’s value summed across every league you roster him in (your real exposure); <Text style={{ fontWeight: '900' }}>7-day</Text> = how his dynasty value has moved over the last week (<Text style={{ color: colors.good, fontWeight: '900' }}>▲</Text> rising, <Text style={{ color: colors.bad, fontWeight: '900' }}>▼</Text> falling, <Text style={{ fontWeight: '900' }}>◆</Text> flat). Think of each league you hold him in as one <Text style={{ fontWeight: '900' }}>share</Text>: <Text style={{ fontWeight: '900' }}>By value</Text> ranks by total value (shares × per-league value), <Text style={{ fontWeight: '900' }}>By shares</Text> ranks by how many leagues hold him. <Text style={{ fontWeight: '900' }}>⇄ Shop</Text> puts him on the block in every league you hold him.
            </Text>
            <ValueCredit style={styles.credit} />
          </View>
        ) : null}

        {/* Value at risk */}
        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={[styles.cardTitle, displayLabel()]}>Value at risk</Text>
            <Text style={[styles.riskPct, risk.pct >= 25 && { color: colors.bad }, risk.pct >= 15 && risk.pct < 25 && { color: colors.warn }]}>{risk.pct}%</Text>
          </View>
          <View style={styles.riskSplit}>
            <RiskStat label="Hurt starters" value={risk.injured.value} count={risk.injured.count} color={colors.bad} />
            <RiskStat label="Aging" value={risk.aging.value} count={risk.aging.count} color={colors.warn} />
          </View>
          {risk.top.length ? (
            <>
              {/* Same value/exposure lens as Top holdings. */}
              <View style={styles.holdTabs}>
                <Pressable onPress={() => setRiskView('value')} style={[styles.holdTab, riskView === 'value' && styles.holdTabOn]}>
                  <Text style={[styles.holdTabTxt, riskView === 'value' && styles.holdTabTxtOn]}>By value</Text>
                </Pressable>
                <Pressable onPress={() => setRiskView('exposure')} style={[styles.holdTab, riskView === 'exposure' && styles.holdTabOn]}>
                  <Text style={[styles.holdTabTxt, riskView === 'exposure' && styles.holdTabTxtOn]}>By shares</Text>
                </Pressable>
              </View>
              <View style={styles.topList}>
                {riskShown.map((p) => {
                  const baited = resolveBaited(p);
                  const leaguesLbl = (p.leagues || 1) === 1 ? '1 league' : `${p.leagues} leagues`;
                  const reasons = (p.reasons && p.reasons.length ? p.reasons : [p.reason]).filter(Boolean).join(' · ');
                  return (
                    <View key={p.id} style={styles.riskRow}>
                      <Pressable
                        style={({ pressed }) => [styles.holdIdentity, pressed && { opacity: 0.7 }]}
                        onPress={() => onOpenPlayer && onOpenPlayer(p.id, { id: p.id, name: p.name, position: p.position, team: p.team, value: p.value })}
                      >
                        <View style={[styles.posBadge, { borderColor: positionColors[p.position] || colors.textDim }]}>
                          <Text style={[styles.pos, { color: positionColors[p.position] || colors.textDim }]}>{p.position}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.riskName} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.riskSub} numberOfLines={1}>
                            {reasons}{p.team ? ` · ${p.team}` : ''} · {leaguesLbl}
                          </Text>
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
              {risk.top.length > RISK_DEFAULT ? (
                <Pressable onPress={() => setShowAllRisk((v) => !v)} style={({ pressed }) => [styles.showAll, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.showAllTxt}>
                    {showAllRisk ? 'Show less ▲' : `Show all ${risk.top.length} at risk ▼`}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Text style={styles.clear}>Nothing at risk — healthy and young across the board.</Text>
          )}
        </View>

        {/* Age curve */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, displayLabel()]}>Value by age</Text>
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

        {/* Your tags — the players you've flagged Target/Avoid, on your rosters. Tap a name to open
            the card; tap ⊗ to untag. */}
        {(() => {
          const all = (d.taggedPlayers || []).filter((p) => !untagged.has(p.id));
          if (!all.length) return null;
          const positions = [...new Set(all.map((p) => p.position))].filter(Boolean).sort((a, b) => posRank(a) - posRank(b));
          const tagged = all
            .filter((p) => (tagKind === 'all' || p.tag === tagKind) && (!tagPos || p.position === tagPos))
            .sort((a, b) => {
              if (tagSort === 'name') return String(a.name).localeCompare(String(b.name));
              if (tagSort === 'position') return posRank(a.position) - posRank(b.position) || (b.value || 0) - (a.value || 0);
              if (tagSort === 'tag') return String(a.tag).localeCompare(String(b.tag)) || (b.value || 0) - (a.value || 0);
              if (tagSort === 'shares') return (b.leagues || 0) - (a.leagues || 0) || (b.value || 0) - (a.value || 0);
              return (b.value || 0) - (a.value || 0); // value
            });
          return (
            <View style={styles.card}>
              <Text style={[styles.cardTitle, displayLabel()]}>Your tags · {all.length}</Text>
              <Text style={styles.hint}>
                <Text style={{ color: colors.good, fontWeight: '900' }}>◎ Targets</Text> are protected in trade suggestions; <Text style={{ color: colors.bad, fontWeight: '900' }}>⊘ Avoids</Text> are ones to shop. Tap ⊗ to untag.
              </Text>
              {/* Filter by tag type + position; sort by value / position / name / tag / shares. */}
              <View style={styles.tagFilterRow}>
                <Text style={styles.tagSortLabel}>Tags</Text>
                {[['all', 'All'], ['target', '◎ Targets'], ['avoid', '⊘ Avoids']].map(([k, lbl]) => (
                  <Pressable key={k} onPress={() => setTagKind(k)} style={[styles.tChip, tagKind === k && styles.tChipOn]}>
                    <Text style={[styles.tChipTxt, tagKind === k && styles.tChipTxtOn]}>{lbl}</Text>
                  </Pressable>
                ))}
              </View>
              {positions.length > 1 ? (
                <View style={styles.tagFilterRow}>
                  <Text style={styles.tagSortLabel}>Position</Text>
                  <Pressable onPress={() => setTagPos(null)} style={[styles.tChip, !tagPos && styles.tChipOn]}>
                    <Text style={[styles.tChipTxt, !tagPos && styles.tChipTxtOn]}>All</Text>
                  </Pressable>
                  {positions.map((pos) => (
                    <Pressable key={pos} onPress={() => setTagPos(tagPos === pos ? null : pos)} style={[styles.tChip, tagPos === pos && styles.tChipOn]}>
                      <Text style={[styles.tChipTxt, tagPos === pos && styles.tChipTxtOn]}>{pos}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.tagFilterRow}>
                <Text style={styles.tagSortLabel}>Sort</Text>
                {[['value', 'Value'], ['position', 'Pos'], ['name', 'Name'], ['tag', 'Tag'], ['shares', 'Shares']].map(([k, lbl]) => (
                  <Pressable key={k} onPress={() => setTagSort(k)} style={[styles.tChip, tagSort === k && styles.tChipOn]}>
                    <Text style={[styles.tChipTxt, tagSort === k && styles.tChipTxtOn]}>{lbl}</Text>
                  </Pressable>
                ))}
              </View>
              {tagged.length === 0 ? <Text style={styles.hint}>No tagged players match.</Text> : null}
              {tagged.map((p) => (
                <View key={p.id} style={styles.tagRow}>
                  <Pressable
                    style={({ pressed }) => [styles.holdIdentity, pressed && { opacity: 0.7 }]}
                    onPress={() => onOpenPlayer && onOpenPlayer(p.id, { id: p.id, name: p.name, position: p.position, team: p.team, value: p.value })}
                  >
                    <View style={[styles.posBadge, { borderColor: positionColors[p.position] || colors.textDim }]}>
                      <Text style={[styles.pos, { color: positionColors[p.position] || colors.textDim }]}>{p.position}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.riskName} numberOfLines={1}>
                        <Text style={{ color: p.tag === 'target' ? colors.good : colors.bad, fontWeight: '900' }}>{p.tag === 'target' ? '◎ ' : '⊘ '}</Text>
                        {p.name}
                      </Text>
                      <Text style={styles.riskSub} numberOfLines={1}>
                        {p.tag === 'target' ? 'Target' : 'Avoid'}{p.team ? ` · ${p.team}` : ''} · {(p.leagues || 1) === 1 ? '1 league' : `${p.leagues} leagues`}
                      </Text>
                    </View>
                    <Text style={styles.riskVal}>{p.value}</Text>
                  </Pressable>
                  <Pressable onPress={() => untagPlayer(p.id)} hitSlop={8} style={styles.untagBtn} accessibilityLabel={`Untag ${p.name}`}>
                    <Text style={styles.untagTxt}>⊗</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          );
        })()}

        {/* Per-league */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, displayLabel()]}>By league</Text>
          {d.byLeague.map((l) => {
            const inner = (
              <>
                <View style={{ flex: 1 }}>
                  <Text style={styles.leagueName} numberOfLines={1}>{l.name}</Text>
                  <Text style={[styles.leagueSub, l.loadFailed && { color: colors.warn }]} numberOfLines={1}>
                    {l.loadFailed
                      ? "couldn't load — pull to refresh"
                      : [l.outlook, l.coreAge != null ? `core ${l.coreAge}y` : null, l.strengthLabel].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {l.atRiskPct > 0 ? <Text style={[styles.leagueRisk, l.atRiskPct >= 20 && { color: colors.bad }]}>{l.atRiskPct}% risk</Text> : null}
                <Text style={styles.leagueVal}>{l.value != null ? l.value : '—'}</Text>
                {onOpenLeague ? <Text style={styles.leagueChev}>›</Text> : null}
              </>
            );
            return onOpenLeague ? (
              <PressableScale key={l.leagueId} style={styles.leagueRow} onPress={() => onOpenLeague({ leagueId: l.leagueId, name: l.name })}>
                {inner}
              </PressableScale>
            ) : (
              <View key={l.leagueId} style={styles.leagueRow}>{inner}</View>
            );
          })}
        </View>

        <View style={{ height: 30 }} />
          </View>
        )}
      />
      )}
    </View>
  );
}

// The Teams sub-tab: the outlook-mix donut (win-now / ascending / balanced / rebuilding) + a sortable
// list of your rosters (value · trend · share · outlook · format), each tapping into its roster.
const OUTLOOK_MIX = [
  { key: 'winNow', label: 'Win-now', color: colors.warn },
  { key: 'ascending', label: 'Ascending', color: colors.good },
  { key: 'balanced', label: 'Balanced', color: colors.accent },
  { key: 'rebuilding', label: 'Rebuilding', color: colors.bad },
];
// Map a team's outlook STRING (portfolio service vocabulary) to its slice colour. Same validated
// categorical set as the donut (CVD-checked), distinct from the UI color law's semantic use.
function outlookColor(o) {
  if (o === 'Win-now window') return colors.warn;
  if (o === 'Ascending') return colors.good;
  if (o === 'Rebuilding') return colors.bad;
  return colors.accent; // Balanced / unknown
}

function TeamsView({ d, refreshing, reload, onOpenLeague, teamSort, setTeamSort }) {
  const mix = d.outlookMix || {};
  const segments = OUTLOOK_MIX.map((o) => ({ key: o.key, color: o.color, value: mix[o.key] || 0 }));
  const teamCount = d.totals.teams || 0;
  const teams = [...(d.byLeague || [])].sort((a, b) => {
    if (teamSort === 'trend') return (b.trend7 ? b.trend7.pct : -1e9) - (a.trend7 ? a.trend7.pct : -1e9);
    if (teamSort === 'strength') return (b.strengthPct || 0) - (a.strengthPct || 0);
    return (b.value || 0) - (a.value || 0);
  });
  return (
    <FlatList
      data={teams}
      keyExtractor={(l) => l.leagueId}
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
      renderItem={({ item: l }) => <TeamRow l={l} onOpenLeague={onOpenLeague} />}
      ListHeaderComponent={(
        <View>
          <View style={styles.card}>
            <Text style={[styles.cardTitle, displayLabel()]}>Team outlook</Text>
            {d.totals.partial ? (
              // The distribution isn't apples-to-apples until every league is in — hide the donut while partial.
              <Text style={styles.buildingHint}>Outlook mix shown once all {d.totals.leagues} leagues load — pull to refresh.</Text>
            ) : (
              <View style={styles.outlookRow}>
                <OutlookDonut segments={segments} centerTop={teamCount} centerBottom={teamCount === 1 ? 'team' : 'teams'} />
                <View style={styles.legend}>
                  {OUTLOOK_MIX.map((o) => (
                    <View key={o.key} style={styles.legendRow}>
                      <View style={[styles.legendDot, { backgroundColor: o.color }]} />
                      <Text style={styles.legendLabel} numberOfLines={1}>{o.label}</Text>
                      <Text style={styles.legendCount}>{mix[o.key] || 0}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
          <FormatCard formatMix={d.formatMix} />
          <View style={styles.teamSortRow}>
            {[['value', 'Value'], ['trend', 'Trend'], ['strength', 'Strength']].map(([k, lbl]) => (
              <Pressable key={k} onPress={() => setTeamSort(k)} style={[styles.teamSortChip, teamSort === k && styles.teamSortChipOn]}>
                <Text style={[styles.teamSortText, teamSort === k && styles.teamSortTextOn]}>{lbl}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      ListFooterComponent={<View style={{ paddingTop: 6 }}><ValueCredit center /><View style={{ height: 30 }} /></View>}
    />
  );
}

function TeamRow({ l, onOpenLeague }) {
  const t = l.trend7;
  const oColor = outlookColor(l.outlook);
  const rec = l.record ? `${l.record.wins}-${l.record.losses}${l.record.ties ? `-${l.record.ties}` : ''}` : null;
  const meta = [
    l.loadFailed ? "couldn't load" : l.outlook || 'Balanced',
    rec,
    l.format ? l.format.label : null,
    l.strengthLabel,
  ].filter(Boolean).join(' · ');
  const inner = (
    <>
      <View style={{ flex: 1 }}>
        <View style={styles.teamNameRow}>
          <Text style={[styles.teamName, { flexShrink: 1 }]} numberOfLines={1}>{l.name}</Text>
          {l.windowSignal ? (
            <View style={[styles.winPill, { borderColor: l.windowSignal === 'sell' ? colors.warn : colors.good }]}>
              <Text style={[styles.winPillText, { color: l.windowSignal === 'sell' ? colors.warn : colors.good }]}>
                {l.windowSignal === 'sell' ? 'Sell window' : 'Go for it'}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.teamMetaRow}>
          <View style={[styles.oDot, { backgroundColor: oColor }]} />
          <Text style={styles.teamMeta} numberOfLines={1}>{meta}</Text>
        </View>
      </View>
      {l.history && l.history.length >= 2 ? (
        <View style={styles.teamSpark}>
          <Sparkline data={l.history.map((h) => h.value)} width={54} height={26} color={t && t.dir === 'down' ? colors.bad : colors.good} strokeWidth={1.5} />
        </View>
      ) : null}
      <View style={styles.teamRight}>
        <Text style={styles.teamVal}>{l.value != null ? l.value.toLocaleString() : '—'}</Text>
        <View style={styles.teamTrendRow}>
          {l.share != null ? <Text style={styles.teamShare}>{l.share}%</Text> : null}
          {t ? <Text style={[styles.teamTrend, { color: trendColor(t.dir) }]}>{trendGlyph(t.dir)} {t.pct >= 0 ? '+' : ''}{t.pct}%</Text> : null}
        </View>
      </View>
      {onOpenLeague ? <Text style={styles.leagueChev}>›</Text> : null}
    </>
  );
  return onOpenLeague ? (
    <PressableScale style={styles.teamRow} onPress={() => onOpenLeague({ leagueId: l.leagueId, name: l.name })}>{inner}</PressableScale>
  ) : (
    <View style={styles.teamRow}>{inner}</View>
  );
}

// A proportional stacked bar (no SVG) — segments sized by count, separated by a 2px surface gap. Always
// paired with a printed legend of counts, so identity is never colour-alone.
function MiniStack({ segments }) {
  const shown = (segments || []).filter((s) => s.value > 0);
  if (!shown.length) return <View style={styles.miniStack} />;
  return (
    <View style={styles.miniStack}>
      {shown.map((s, i) => (
        <View key={s.label} style={{ flex: s.value, backgroundColor: s.color, marginLeft: i === 0 ? 0 : 2, borderRadius: 3 }} />
      ))}
    </View>
  );
}

function FormatRow({ label, segments }) {
  const shown = (segments || []).filter((s) => s.value > 0);
  return (
    <View style={styles.fmtRow}>
      <Text style={styles.fmtRowLabel}>{label}</Text>
      <View style={{ flex: 1 }}>
        <MiniStack segments={segments} />
        <Text style={styles.fmtRowLegend} numberOfLines={1}>{shown.map((s) => `${s.label} ${s.value}`).join(' · ')}</Text>
      </View>
    </View>
  );
}

// League-settings distribution across your leagues (the "what kind of leagues do I play" mix), plus the
// derived positional-demand insight — the point of the card. QB is the biggest value lever, so it leads.
function FormatCard({ formatMix }) {
  if (!formatMix) return null;
  const qb = formatMix.qb || {};
  const ppr = formatMix.ppr || {};
  const te = formatMix.te || {};
  const sz = formatMix.size || {};
  const sf = qb.superflex || 0;
  const one = qb['1qb'] || 0;
  const qbTotal = sf + one;
  const insight = qbTotal === 0
    ? null
    : sf / qbTotal >= 0.6
      ? 'Superflex-heavy — QBs are your scarcest, most valuable trade chips across the portfolio.'
      : sf / qbTotal <= 0.4
        ? 'Mostly 1QB — QB value stays modest across your portfolio; running backs and receivers carry it.'
        : 'A mix of QB formats — price your QBs league by league (Superflex pays far more).';
  const teTotal = (te.premium || 0) + (te.standard || 0);
  const sizeChips = Object.keys(sz).sort((a, b) => Number(a) - Number(b)).map((k) => `${k}-team ${sz[k]}`).join(' · ');
  return (
    <View style={styles.card}>
      <Text style={[styles.cardTitle, displayLabel()]}>League formats</Text>
      <FormatRow label="QB" segments={[{ label: 'Superflex', value: sf, color: colors.accent }, { label: '1QB', value: one, color: colors.violet }]} />
      <FormatRow
        label="Scoring"
        segments={[
          { label: 'Full PPR', value: ppr.full || 0, color: colors.good },
          { label: 'Half', value: ppr.half || 0, color: colors.good + '88' },
          { label: 'Std', value: ppr.standard || 0, color: colors.border },
        ]}
      />
      <View style={styles.fmtMetaRow}>
        <Text style={styles.fmtMetaLabel}>TE-premium</Text>
        <Text style={styles.fmtMetaVal}>{te.premium || 0}{teTotal ? ` of ${teTotal}` : ''}</Text>
      </View>
      {sizeChips ? (
        <View style={styles.fmtMetaRow}>
          <Text style={styles.fmtMetaLabel}>Sizes</Text>
          <Text style={styles.fmtMetaVal} numberOfLines={1}>{sizeChips}</Text>
        </View>
      ) : null}
      {insight ? <Text style={styles.fmtInsight}>{insight}</Text> : null}
    </View>
  );
}

// One holding row — memoized so shopping/opening one player doesn't re-render the whole book.
// `baited` is passed in (not derived here) and toggleShop is stable, so only the row whose bait
// state changed re-renders. Sides of the holdings card are drawn by the row-frame wrapper in
// renderHolding; this renders the row content + its bottom hairline.
// 7-day value-trend arrow for a holding: rising / falling / flat.
const POS_RANK = { QB: 0, RB: 1, WR: 2, TE: 3, PK: 4, K: 4, PN: 5, DEF: 6, DL: 6, LB: 6, CB: 6, S: 6 };
function posRank(pos) {
  return POS_RANK[pos] != null ? POS_RANK[pos] : 50;
}

function trendGlyph(dir) {
  return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '◆';
}
function trendColor(dir) {
  return dir === 'up' ? colors.good : dir === 'down' ? colors.bad : colors.textDim;
}

const HoldingRow = React.memo(function HoldingRow({ h, index, baited, onOpen, onToggleShop }) {
  return (
    <Reveal delay={Math.min(index, 10) * 40} animate={index < 12}>
      <View style={styles.holdRow}>
        <Pressable
          style={({ pressed }) => [styles.holdIdentity, pressed && { opacity: 0.7 }]}
          onPress={() => onOpen && onOpen(h.id, { id: h.id, name: h.name, position: h.position, team: h.team, value: h.avg })}
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
            {h.trend7 ? (
              <Text style={[styles.holdTrend, { color: trendColor(h.trend7.dir) }]}>
                {trendGlyph(h.trend7.dir)}{h.trend7.dir === 'flat' ? '' : ` ${h.trend7.pct > 0 ? '+' : '−'}${Math.abs(h.trend7.pct)}%`}
              </Text>
            ) : (
              <Text style={styles.holdTrendNone}>–</Text>
            )}
          </View>
        </Pressable>
        <Pressable
          onPress={() => onToggleShop(h)}
          hitSlop={6}
          style={[styles.shop, baited && styles.shopOn]}
          accessibilityLabel={baited ? `Stop shopping ${h.name}` : `Shop ${h.name} in all ${h.leagues} leagues`}
        >
          <Text style={[styles.shopTxt, baited && styles.shopTxtOn]}>{baited ? '⇄ Shopping' : '⇄ Shop'}</Text>
        </Pressable>
      </View>
    </Reveal>
  );
});

// The movement line under the total: ▲/▼ absolute (+pct%) over the tracked window. Neutral
// until there are two days to compare.
// Terse outlook for the arbitrage "cash out" note (only the non-contending ones ever reach here).
function outlookShort(outlook) {
  if (outlook === 'Rebuilding') return 'rebuilding';
  if (outlook === 'Ascending') return 'ascending';
  if (outlook === 'Balanced') return 'not contending';
  return 'not contending';
}

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
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', minWidth: 60 },
  title: { color: colors.text, fontSize: 17, fontWeight: '900' },
  body: { padding: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 },
  // The Top-holdings card is drawn in three pieces so the rows between can be a virtualized list:
  // TOP (rounded top + top/side borders), the row FRAME (side borders + the card's horizontal
  // padding, carried per row), and BOTTOM (rounded bottom + bottom/side borders). Together they
  // read as one continuous card around the FlatList rows.
  holdCardTop: { backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, paddingHorizontal: 16, paddingTop: 16 },
  holdRowFrame: { backgroundColor: colors.card, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border, paddingHorizontal: 16 },
  holdCardBottom: { backgroundColor: colors.card, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, borderWidth: 1, borderTopWidth: 0, borderColor: colors.border, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4, marginBottom: 14 },
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
  // Fixed height (must equal HOLDING_ROW_HEIGHT) so the FlatList's getItemLayout is exact — a fast
  // fling then never flashes blank rows (UX_GUARDRAILS §2). Two single-line texts, so content never
  // changes the height; alignItems centers them in the fixed box.
  holdRow: { flexDirection: 'row', alignItems: 'center', height: 54, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  holdIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  shop: { marginLeft: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  shopOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  shopTxt: { color: colors.textDim, fontSize: 11, fontWeight: '800' },
  shopTxtOn: { color: colors.onAccent },
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
  arbRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  arbMain: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  arbName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  arbLine: { color: colors.textDim, fontSize: 12, marginTop: 2, lineHeight: 16 },
  arbHint: { color: colors.accent, fontSize: 11, marginTop: 2, lineHeight: 15, fontWeight: '600' },
  moverName: { color: colors.text, fontSize: 14, fontWeight: '700', marginLeft: 2 },
  moverTeam: { color: colors.textDim, fontSize: 11, fontWeight: '700', marginLeft: 2, marginTop: 1 },
  moverDelta: { fontSize: 13, fontWeight: '900', marginLeft: 8 },
  holdName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  holdSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  holdRight: { alignItems: 'flex-end', marginLeft: 8, minWidth: 52 },
  holdVal: { color: colors.gold, fontSize: 15, fontWeight: '900' },
  holdPct: { color: colors.textDim, fontSize: 11, fontWeight: '700', marginTop: 1 },
  holdTrend: { fontSize: 12, fontWeight: '900', marginTop: 1 },
  holdTrendNone: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 1 },
  tagRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tagFilterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 },
  tagSortLabel: { color: colors.violetText, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 2 },
  tChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  tChipOn: { borderColor: colors.accent, backgroundColor: colors.accent + '22' },
  tChipTxt: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  tChipTxtOn: { color: colors.accent },
  untagBtn: { paddingHorizontal: 10, paddingVertical: 6, marginLeft: 8 },
  untagTxt: { color: colors.textDim, fontSize: 18, fontWeight: '900' },
  statRow: { flexDirection: 'row', marginTop: 16, gap: 10 },
  stat: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  statLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 2 },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.violetText, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  riskPct: { color: colors.warn, fontSize: 22, fontWeight: '900', marginBottom: 10 },
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
  credit: { marginTop: 10 },
  tagLine: { color: colors.text, fontSize: 13, lineHeight: 20 },
  leagueRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  leagueName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  leagueSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  leagueRisk: { color: colors.warn, fontSize: 12, fontWeight: '800', marginRight: 12 },
  leagueVal: { color: colors.gold, fontSize: 15, fontWeight: '900', width: 44, textAlign: 'right' },
  leagueChev: { color: colors.textDim, fontSize: 18, fontWeight: '700', marginLeft: 8 },

  // --- Sub-tabs + Teams view ---------------------------------------------------
  segRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 6, marginBottom: 4 },
  seg: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center' },
  segOn: { borderColor: colors.accent, backgroundColor: colors.accent + '1F' },
  segText: { color: colors.textDim, fontSize: 14, fontWeight: '800' },
  segTextOn: { color: colors.accent },
  outlookRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  legend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  legendCount: { color: colors.text, fontSize: 14, fontWeight: '900' },
  teamSortRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  teamSortChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  teamSortChipOn: { borderColor: colors.accent, backgroundColor: colors.accent + '1F' },
  teamSortText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  teamSortTextOn: { color: colors.accent },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingVertical: 11, paddingHorizontal: 14, marginBottom: 8 },
  teamNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  winPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  winPillText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.2 },
  teamMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  oDot: { width: 8, height: 8, borderRadius: 4 },
  teamMeta: { color: colors.textDim, fontSize: 12, fontWeight: '600', flex: 1 },
  teamSpark: { width: 54 },
  teamRight: { alignItems: 'flex-end', minWidth: 68 },
  teamVal: { color: colors.gold, fontSize: 16, fontWeight: '900' },
  teamTrendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  teamShare: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  teamTrend: { fontSize: 11, fontWeight: '900' },
  miniStack: { flexDirection: 'row', height: 10, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.bg },
  fmtRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  fmtRowLabel: { color: colors.textDim, fontSize: 12, fontWeight: '800', width: 58 },
  fmtRowLegend: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 4 },
  fmtMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  fmtMetaLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  fmtMetaVal: { color: colors.text, fontSize: 12, fontWeight: '700', flexShrink: 1, marginLeft: 10, textAlign: 'right' },
  fmtInsight: { color: colors.violetText, fontSize: 12, fontWeight: '700', marginTop: 8, lineHeight: 17 },

  error: { color: colors.bad, textAlign: 'center', marginBottom: 14 },
  retry: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: colors.border },
  retryText: { color: colors.text, fontWeight: '700' },
});
