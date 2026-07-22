import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import useCachedResource from '../useCachedResource';
import { colors, positionColors } from '../theme';
import { celebrate } from '../components/Celebrate';
import InfoDot from '../components/InfoDot';
import ErrorView from '../components/ErrorView';
import TradeColumns from '../components/TradeColumns';
import Reveal from '../components/Reveal';
import useAndroidBack from '../useAndroidBack';

// Cross-league trade inbox: every pending incoming offer across all your leagues,
// value-ranked, with accept/reject inline — instead of opening each league one by
// one. Drills into a league's full trade desk for context or to build a counter.

const VERDICT = {
  favorable: { label: 'You gain value', color: colors.good },
  fair: { label: 'Fair deal', color: colors.textDim },
  unfavorable: { label: 'You give up value', color: colors.bad },
};
const VRANK = { favorable: 0, fair: 1, unfavorable: 2 };
// Reconciled bottom-line tone → color (value verdict × roster construction).
const TONE = { good: colors.good, warn: colors.warn, bad: colors.bad, neutral: colors.textDim };
const CONSTRUCTION = {
  good: { color: colors.good, icon: '✓' },
  caution: { color: colors.bad, icon: '⚠' },
  neutral: { color: colors.textDim, icon: '•' },
};
// Compact dynasty outlook ("Win-now window" -> "Win-now") + a color per stance, matching
// the trade desk. Lets the inbox show BOTH teams' context at a glance.
const shortOutlook = (o) => (o === 'Win-now window' ? 'Win-now' : o || null);
const OUTLOOK_COLOR = { 'Win-now window': colors.gold, Ascending: colors.good, Rebuilding: colors.warn, Balanced: colors.textDim };
const teamCtx = (t) => {
  if (!t) return null;
  return [shortOutlook(t.outlook), t.avgAge != null ? `${t.avgAge} yr` : null].filter(Boolean).join(' · ') || null;
};

export default function TradeInboxScreen({ onBack, onOpenLeague, onProposeInLeague, onOpenBlock, onCounter, onManualCounter, onOpenPlayer }) {
  // Offers via the shared hook: instant paint on remount (survives the tab-switch unmount),
  // throttled reloads, non-destructive on a failed refresh. Same 'trades:overview' key the
  // idle prefetch warms. `reload` refetches after responding to an offer / pull-to-refresh.
  const { data, error, refreshing, loading, reload } = useCachedResource('trades:overview', () => api.trades());
  const [busy, setBusy] = useState(null); // `${leagueId}:${offerId}` being responded to
  const [baitByLeague, setBaitByLeague] = useState({}); // leagueId -> # players you're shopping
  const [fitByLeague, setFitByLeague] = useState({}); // leagueId -> fit hint (filled in progressively)

  // As a top-level tab there's no onBack — let the app's handler take hardware back to Home.
  useAndroidBack(useCallback(() => { if (onBack) { onBack(); return true; } return false; }, [onBack]));

  // Your trade-bait board, alongside the offers: flags the leagues where you already have
  // players on the block (a head start on the "Start a trade" list). Best-effort, background.
  useEffect(() => {
    let alive = true;
    api.tradeBait().then((block) => {
      if (alive && block && block.leagues) setBaitByLeague(Object.fromEntries(block.leagues.map((l) => [String(l.leagueId), l.count])));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // The "deep at X" hint needs a per-league needs/surplus read (expensive), so the
  // inbox returns offers immediately and we fill the hint in here — one league at a
  // time, in the background, to stay gentle on MFL. Leagues that already came back
  // with a fit (the ones with an offer) are skipped.
  useEffect(() => {
    if (!data || !data.leagues) return undefined;
    const missing = data.leagues.filter((l) => l.fit == null && fitByLeague[String(l.leagueId)] === undefined);
    if (!missing.length) return undefined;
    let alive = true;
    (async () => {
      for (const l of missing) {
        if (!alive) return;
        try {
          const r = await api.tradeFit(l.leagueId);
          if (!alive) return;
          setFitByLeague((m) => ({ ...m, [String(l.leagueId)]: r.fit || null }));
        } catch (e) { /* skip this league's hint */ }
      }
    })();
    return () => { alive = false; };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function respond(offer, action) {
    const k = `${offer.leagueId}:${offer.id}`;
    setBusy(k);
    try {
      await api.respondTrade(offer.leagueId, offer.id, action);
      celebrate(action === 'accept' ? 'tradeAccepted' : 'offerRejected');
      await reload();
    } catch (e) {
      Alert.alert('Could not respond', e.message);
    } finally {
      setBusy(null);
    }
  }

  // Best deals first: favorable → fair → unfavorable, then by net value. Memoized
  // so the sort doesn't re-run on every unrelated re-render (busy/refresh flips).
  const offers = useMemo(
    () => (data && data.offers ? [...data.offers] : []).sort(
      (a, b) => (VRANK[a.analysis.verdict] - VRANK[b.analysis.verdict]) || (b.analysis.net - a.analysis.net)
    ),
    [data]
  );
  const summary = data && data.summary;
  const leagues = (data && data.leagues) || [];

  // The hub is also where you START a trade: pick any league and open its desk on
  // the Propose tab. Without this, an empty inbox is a dead end and proposing is
  // buried under a league's roster.
  const startTrade = (
    <View style={styles.startWrap}>
      <Text style={styles.startTitle}>Start a trade</Text>
      <Text style={styles.startSub}>Pick a league to build and send an offer.</Text>
      {leagues.map((l, i) => {
        const onBlock = baitByLeague[String(l.leagueId)] || 0;
        const fit = fitByLeague[String(l.leagueId)] !== undefined ? fitByLeague[String(l.leagueId)] : l.fit;
        return (
          <Reveal key={l.leagueId} delay={Math.min(i, 8) * 45}>
          <Pressable
            style={({ pressed }) => [styles.startRow, pressed && { opacity: 0.7 }]}
            onPress={() => (onProposeInLeague || onOpenLeague)({ leagueId: l.leagueId, name: l.name })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.startName} numberOfLines={1}>{l.name}</Text>
              {fit ? (
                <Text style={styles.startFit} numberOfLines={1}>
                  You're deep at {fit.topPos} · {fit.rivals} rival{fit.rivals === 1 ? '' : 's'} need{fit.rivals === 1 ? 's' : ''} it
                </Text>
              ) : null}
              {onBlock ? <Text style={styles.startBait}>{onBlock} on the block here</Text> : null}
            </View>
            <Text style={styles.startCta}>Propose ›</Text>
          </Pressable>
          </Reveal>
        );
      })}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10}>
            <Text style={styles.back}>‹ Hub</Text>
          </Pressable>
        ) : (
          <View style={{ width: 54 }} />
        )}
        <Text style={styles.title}>Trades</Text>
        {onOpenBlock ? (
          <Pressable onPress={onOpenBlock} hitSlop={10}>
            <Text style={styles.blockLink}>⇄ Block</Text>
          </Pressable>
        ) : (
          <View style={{ width: 54 }} />
        )}
      </View>
      {summary ? (
        <Text style={styles.subtitle}>
          {summary.count} offer{summary.count === 1 ? '' : 's'} across your leagues
          {summary.favorable ? <Text style={{ color: colors.good, fontWeight: '800' }}>{`  ·  ${summary.favorable} favorable`}</Text> : null}
        </Text>
      ) : null}
      {data && data.seasonal ? (
        <View style={styles.seasonBanner}>
          <Text style={styles.seasonLabel}>🗓  {data.seasonal.label}</Text>
          <Text style={styles.seasonMsg}>{data.seasonal.message}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error && !data ? (
        <ErrorView message={error} onRetry={reload} refreshing={refreshing} onRefresh={reload} />
      ) : (
        <FlatList
          data={offers}
          keyExtractor={(o) => `${o.leagueId}:${o.id}`}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
          renderItem={({ item, index }) => (
            <Reveal delay={Math.min(index, 6) * 55} animate={index < 8}>
              <OfferCard
                offer={item}
                busy={busy === `${item.leagueId}:${item.id}`}
                onRespond={respond}
                onOpenLeague={() => onOpenLeague({ leagueId: item.leagueId, name: item.leagueName })}
                onCounter={onCounter ? () => onCounter({ leagueId: item.leagueId, name: item.leagueName, offerId: item.id }) : null}
                onManualCounter={onManualCounter ? () => { respond(item, 'reject'); onManualCounter({ leagueId: item.leagueId, name: item.leagueName, partnerFranchiseId: item.withFranchiseId }); } : null}
                onOpenPlayer={onOpenPlayer}
              />
            </Reveal>
          )}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyFace}>😔</Text>
              <Text style={styles.emptyTitle}>Quiet in here</Text>
              <Text style={styles.emptyText}>No pending trade offers across your leagues. Head to Propose to shake something loose.</Text>
            </View>
          }
          ListFooterComponent={leagues.length ? startTrade : null}
        />
      )}
    </View>
  );
}

function OfferCard({ offer, busy, onRespond, onOpenLeague, onCounter, onManualCounter, onOpenPlayer }) {
  const v = VERDICT[offer.analysis.verdict] || VERDICT.fair;
  return (
    <View style={styles.card}>
      <Pressable style={({ pressed }) => [styles.leagueRow, pressed && { opacity: 0.7 }]} onPress={onOpenLeague}>
        <Text style={styles.leagueName} numberOfLines={1}>{offer.leagueName}</Text>
        <Text style={styles.deskLink}>Desk ›</Text>
      </Pressable>
      <View style={styles.cardTop}>
        <Text style={styles.from} numberOfLines={1}>from {offer.withName}</Text>
        <View style={[styles.badge, { borderColor: v.color }]}>
          <Text style={[styles.badgeText, { color: v.color }]}>{v.label}</Text>
        </View>
      </View>

      {/* League format + both teams' dynasty context (outlook + average age). */}
      {(offer.format || offer.me || offer.partner) ? (
        <View style={styles.ctxRow}>
          {offer.format ? <Text style={styles.fmtPill}>{offer.format}</Text> : null}
          {teamCtx(offer.me) ? (
            <Text style={styles.ctxText} numberOfLines={1}>
              You · <Text style={{ color: OUTLOOK_COLOR[offer.me.outlook] || colors.textDim, fontWeight: '800' }}>{teamCtx(offer.me)}</Text>
            </Text>
          ) : null}
          {teamCtx(offer.partner) ? (
            <Text style={styles.ctxText} numberOfLines={1}>
              {offer.withName ? `${offer.withName.split(' ')[0]} · ` : 'Them · '}
              <Text style={{ color: OUTLOOK_COLOR[offer.partner.outlook] || colors.textDim, fontWeight: '800' }}>{teamCtx(offer.partner)}</Text>
            </Text>
          ) : null}
          {offer.me || offer.partner ? <InfoDot id="outlook" /> : null}
        </View>
      ) : null}

      <TradeColumns
        give={offer.send}
        get={offer.acquire}
        giveTotal={offer.analysis.sendValue}
        getTotal={offer.analysis.acquireValue}
        onOpenPlayer={onOpenPlayer}
      />
      <View style={styles.estRow}>
        <Text style={styles.estCaption}>
          Market value · net {offer.analysis.net > 0 ? '+' : ''}{offer.analysis.net}
        </Text>
        <InfoDot id="tradeGrade" />
      </View>
      {offer.personal ? (
        <Text style={[styles.personalLine, { color: (VERDICT[offer.personal.verdict] || VERDICT.fair).color }]}>
          For you · net {offer.personal.net > 0 ? '+' : ''}{offer.personal.net} · {(VERDICT[offer.personal.verdict] || VERDICT.fair).label}
        </Text>
      ) : null}
      {offer.tagNotes && offer.tagNotes.length ? (
        <View style={styles.tagNotes}>
          {offer.tagNotes.map((n, i) => (
            <Text key={i} style={[styles.tagNote, { color: n.level === 'good' ? colors.good : colors.warn }]}>
              {n.level === 'good' ? '✓' : '⚠'} {n.text}
            </Text>
          ))}
        </View>
      ) : null}
      {offer.construction ? (
        <View style={[styles.construction, { borderColor: (CONSTRUCTION[offer.construction.rating] || CONSTRUCTION.neutral).color }]}>
          <Text style={[styles.constructionText, { color: (CONSTRUCTION[offer.construction.rating] || CONSTRUCTION.neutral).color }]}>
            {(CONSTRUCTION[offer.construction.rating] || CONSTRUCTION.neutral).icon} {offer.construction.reason}
          </Text>
        </View>
      ) : null}

      {/* The bottom line: reconciles value and roster fit into one decision, so two
          contradicting badges (good value / hurts your roster) don't leave you guessing. */}
      {offer.bottomLine ? (
        <View style={[styles.bottomLine, { borderLeftColor: TONE[offer.bottomLine.tone] || colors.textDim }]}>
          <Text style={[styles.bottomLineText, { color: TONE[offer.bottomLine.tone] || colors.text }]}>
            {offer.bottomLine.text}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable style={[styles.act, styles.reject]} onPress={() => onRespond(offer, 'reject')} disabled={busy}>
          <Text style={styles.rejectText}>Reject</Text>
        </Pressable>
        <Pressable style={[styles.act, styles.accept]} onPress={() => onRespond(offer, 'accept')} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>Accept</Text>}
        </Pressable>
      </View>
      {onCounter ? (
        <Pressable style={({ pressed }) => [styles.counterBtn, pressed && { opacity: 0.7 }]} onPress={onCounter} disabled={busy}>
          {/* Label reflects what the smart counter WILL do: balance an offer that's
              against you, or ask for a sweetener on one that's already fair/in your favor. */}
          <Text style={styles.counterBtnText}>
            {offer.analysis.net < 0 ? '↩ Counter to balance it' : '↩ Counter — ask for a bit more'}
          </Text>
        </Pressable>
      ) : null}
      {onManualCounter ? (
        <Pressable style={({ pressed }) => [styles.manualBtn, pressed && { opacity: 0.7 }]} onPress={onManualCounter} disabled={busy}>
          <Text style={styles.manualBtnText}>Reject &amp; build your own ›</Text>
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
  blockLink: { color: colors.accent, fontSize: 14, fontWeight: '800', width: 54, textAlign: 'right' },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 },
  leagueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, marginBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  leagueName: { color: colors.text, fontSize: 13, fontWeight: '800', letterSpacing: 0.3, flex: 1, marginRight: 10, textTransform: 'uppercase' },
  deskLink: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  from: { color: colors.textDim, fontSize: 14, fontWeight: '600', flex: 1, marginRight: 10 },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  ctxRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 },
  fmtPill: { color: colors.accent, backgroundColor: colors.accent + '1A', borderWidth: 1, borderColor: colors.accent + '55', borderRadius: 6, fontSize: 11, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  ctxText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  side: { marginBottom: 10 },
  sideLabel: { color: colors.textDim, fontSize: 12, fontWeight: '800', marginBottom: 4 },
  sideRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  sideName: { color: colors.text, fontSize: 14, flex: 1, marginRight: 8 },
  sideMeta: { color: colors.textDim, fontSize: 12 },
  estRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  estCaption: { color: colors.textDim, fontSize: 11 },
  personalLine: { fontSize: 12, fontWeight: '800', marginTop: 3 },
  tagNotes: { marginTop: 6, gap: 3, marginBottom: 4 },
  tagNote: { fontSize: 12, fontWeight: '700' },
  construction: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6 },
  constructionText: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  bottomLine: { marginTop: 10, backgroundColor: colors.bg, borderLeftWidth: 3, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 },
  bottomLineText: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  counterBtn: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10, alignItems: 'center' },
  counterBtnText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  manualBtn: { marginTop: 8, alignItems: 'center' },
  manualBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  act: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  reject: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  rejectText: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
  accept: { backgroundColor: colors.accent },
  acceptText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  error: { color: colors.bad, textAlign: 'center' },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  emptyFace: { fontSize: 46, marginBottom: 10 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', paddingHorizontal: 20 },
  seasonBanner: { marginHorizontal: 16, marginTop: 10, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.gold, padding: 12 },
  seasonLabel: { color: colors.gold, fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 },
  seasonMsg: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  startWrap: { marginTop: 8, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  startTitle: { color: colors.text, fontSize: 15, fontWeight: '900', letterSpacing: 0.3, textTransform: 'uppercase' },
  startSub: { color: colors.textDim, fontSize: 13, marginTop: 3, marginBottom: 12 },
  startRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10 },
  startName: { color: colors.text, fontSize: 15, fontWeight: '700', marginRight: 10 },
  startFit: { color: colors.good, fontSize: 12, fontWeight: '700', marginTop: 2 },
  startBait: { color: colors.gold, fontSize: 12, fontWeight: '700', marginTop: 2 },
  startCta: { color: colors.accent, fontSize: 14, fontWeight: '800' },
});
