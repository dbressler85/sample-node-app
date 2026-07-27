import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, SectionList, RefreshControl, ActivityIndicator } from 'react-native';
import { colors } from '../theme';
import { displayLg, displayLabel } from '../typography';
import { pickInventoryPreferDevice } from '../mflDevice';
import ErrorView from '../components/ErrorView';
import PressableScale from '../components/PressableScale';
import useAndroidBack from '../useAndroidBack';
import useCachedResource from '../useCachedResource';
import { Value } from '../components/Brand';
import ValueCredit from '../components/ValueCredit';

// Your draft-pick capital, grouped BY LEAGUE (richest capital first) so it reads as "what you hold,
// and in which window" — not a flat cross-league pile of picks that told you nothing about where to
// act. Each league card carries its team context: your outlook (win-now / rebuilding / ascending),
// roster age, and format. Trading picks stays on the trade desk (a shop/acquire flow lands here next).

// A round → tint, so a 1st reads hotter than a 4th at a glance.
const ROUND_COLOR = { 1: colors.gold, 2: colors.accent, 3: colors.good, 4: colors.textDim };

// Outlook → tint. These are the same team-state buckets the trade desk uses: win-now reads urgent
// (warm), ascending reads as upward growth (green), rebuilding stays muted, balanced is neutral-blue.
const OUTLOOK_COLOR = {
  'Win-now window': colors.warn,
  Ascending: colors.good,
  Rebuilding: colors.textDim,
  Balanced: colors.accent,
};

export default function PickInventoryScreen({ onBack, onShopPicks, onGetPicks, onTradePick }) {
  // Device-first: the per-league assets/futureDraftPicks/draftResults fan-out runs on-device, falling
  // back to the backend on any device-read failure.
  const { data, error, refreshing, loading, reload } = useCachedResource('pickInventory', () => pickInventoryPreferDevice());
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const summary = data && data.summary;
  const sections = ((data && data.byLeague) || []).map((l) => ({ league: l, data: l.picks }));

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Hub</Text></Pressable>
        <Text style={[styles.title, displayLg()]}>Pick Capital</Text>
        <View style={{ width: 54 }} />
      </View>
      {summary ? (
        <Text style={styles.subtitle}>
          {summary.total} pick{summary.total === 1 ? '' : 's'} · {summary.firsts} first{summary.firsts === 1 ? '' : 's'}
          {summary.acquired ? ` · ${summary.acquired} acquired` : ''} · {summary.totalValue.toLocaleString()} value · {summary.leagues} league{summary.leagues === 1 ? '' : 's'}
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <ErrorView message={error} onRetry={reload} refreshing={refreshing} onRefresh={reload} />
      ) : !sections.length ? (
        <View style={styles.center}><Text style={styles.emptyText}>No draft picks found across your leagues.</Text></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, i) => `${item.leagueId}:${item.token}:${i}`}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
          renderSectionHeader={({ section }) => <LeagueHeader league={section.league} onShopPicks={onShopPicks} onGetPicks={onGetPicks} />}
          renderItem={({ item }) => <PickRow p={item} onTradePick={onTradePick} />}
          renderSectionFooter={({ section }) =>
            section.league.count === 0 ? <Text style={styles.leagueEmpty}>No picks — all traded away.</Text> : null
          }
          ListFooterComponent={<ValueCredit center label="Pick values" style={styles.credit} />}
        />
      )}
    </View>
  );
}

// The per-league card header: league name + total pick value, then a context chip row (outlook,
// roster age, format) so the picks below read in the context of where this team actually is.
function LeagueHeader({ league, onShopPicks, onGetPicks }) {
  const c = league.context || {};
  const outlookColor = OUTLOOK_COLOR[c.outlook] || colors.textDim;
  const arg = { leagueId: league.leagueId, name: league.leagueName };
  return (
    <View style={styles.leagueHead}>
      <View style={styles.leagueTop}>
        <Text style={[styles.leagueName, displayLabel()]} numberOfLines={1}>{league.leagueName}</Text>
        <View style={styles.leagueVal}>
          <Value size={17}>{(league.value || 0).toLocaleString()}</Value>
          <Text style={styles.leagueValCap}>capital</Text>
        </View>
      </View>
      <Text style={styles.leagueMeta}>
        {league.count} pick{league.count === 1 ? '' : 's'}{league.firsts ? ` · ${league.firsts} first${league.firsts === 1 ? '' : 's'}` : ''}
      </Text>
      <View style={styles.chips}>
        {c.outlook ? (
          <View style={[styles.chip, { borderColor: outlookColor }]}>
            <View style={[styles.dot, { backgroundColor: outlookColor }]} />
            <Text style={[styles.chipText, { color: outlookColor }]}>{c.outlook}</Text>
          </View>
        ) : null}
        {c.avgAge != null ? (
          <View style={styles.chip}><Text style={styles.chipTextDim}>avg age {c.avgAge}</Text></View>
        ) : null}
        {c.scoringLabel ? (
          <View style={styles.chip}><Text style={styles.chipTextDim}>{c.scoringLabel}</Text></View>
        ) : null}
      </View>
      {/* Turn the capital into action: shop these picks for a proven player, or spend a player to add
          picks. Each opens a ranked-partner shortlist for that intent. Shown only when I hold picks. */}
      {(onShopPicks || onGetPicks) && league.count > 0 ? (
        <View style={styles.ctaRow}>
          {onShopPicks ? (
            <PressableScale style={styles.cta} onPress={() => onShopPicks(arg)}>
              <Text style={styles.ctaText}>Shop picks</Text>
            </PressableScale>
          ) : null}
          {onGetPicks ? (
            <PressableScale style={[styles.cta, styles.ctaAlt]} onPress={() => onGetPicks(arg)}>
              <Text style={[styles.ctaText, styles.ctaTextAlt]}>Get picks</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function PickRow({ p, onTradePick }) {
  const rc = ROUND_COLOR[p.round] || colors.textDim;
  // Every pick here is yours — the trade glyph shops it (opens the desk with it on your side).
  const canTrade = p.token && onTradePick;
  return (
    <View style={[styles.row, { borderLeftColor: rc, borderLeftWidth: 3 }]}>
      <View style={[styles.roundBadge, { backgroundColor: rc + '22', borderColor: rc }]}>
        <Text style={[styles.roundText, { color: rc }]}>{p.round ? `R${p.round}` : '—'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.pickLabel} numberOfLines={1}>
          {p.label}
          {p.kind === 'upcoming' ? <Text style={styles.tag}>  THIS YEAR</Text> : null}
        </Text>
        {p.acquiredFrom ? <Text style={styles.meta} numberOfLines={1}>from {p.acquiredFrom}</Text> : null}
      </View>
      {p.value != null ? <Value size={15}>{p.value}</Value> : null}
      {canTrade ? (
        <Pressable
          onPress={() => onTradePick(p)}
          hitSlop={10}
          style={({ pressed }) => [styles.tradeBtn, pressed && { opacity: 0.6 }]}
          accessibilityLabel="Shop this pick"
        >
          <Text style={styles.tradeIcon}>⇄</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 54 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4 },
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32 },
  // Per-league card header.
  leagueHead: { marginTop: 18, marginBottom: 10 },
  leagueTop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  leagueName: { color: colors.text, fontSize: 16, fontWeight: '900', letterSpacing: 0.4, flex: 1, marginRight: 12 },
  leagueVal: { alignItems: 'flex-end' },
  leagueValCap: { color: colors.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: -2 },
  leagueMeta: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, marginRight: 7, marginBottom: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  chipTextDim: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  leagueEmpty: { color: colors.textDim, fontSize: 13, fontStyle: 'italic', paddingVertical: 6 },
  credit: { marginTop: 8, marginBottom: 20 },
  ctaRow: { flexDirection: 'row', marginTop: 10, marginBottom: 2 },
  cta: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.accent, paddingVertical: 8, alignItems: 'center', marginRight: 8, backgroundColor: 'rgba(79,140,255,0.10)' },
  ctaAlt: { marginRight: 0 },
  ctaText: { color: colors.accent, fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  ctaTextAlt: { color: colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  roundBadge: { width: 38, paddingVertical: 3, borderRadius: 6, borderWidth: 1, alignItems: 'center', marginRight: 10 },
  roundText: { fontSize: 11, fontWeight: '800' },
  pickLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  tag: { color: colors.gold, fontSize: 10, fontWeight: '900' },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  // Trade glyph — trade is an ACTION → accent (color law), not the decorative violet.
  tradeBtn: { marginLeft: 10, width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.accent, backgroundColor: 'rgba(79,140,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  tradeIcon: { color: colors.accent, fontSize: 16, fontWeight: '900' },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center' },
});
