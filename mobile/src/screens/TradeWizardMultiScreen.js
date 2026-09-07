import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { colors } from '../theme';
import { displayLabel } from '../typography';
import { api } from '../api';
import PressableScale from '../components/PressableScale';
import { GlyphMark } from '../components/NeonGlyphs';
import NeonSign from '../components/NeonSign';
import { Value, TopbarTitle } from '../components/Brand';
import useAndroidBack from '../useAndroidBack';
import { peekResource, primeResource } from '../useCachedResource';
import { STALE } from '../staleTiers';

// The multi-league TRADE WIZARD: pick the leagues you want to shop, then scan them all at once for
// ready-to-send deals. Each league's scan (api.findDeals) ranks every partner by a value-balanced,
// roster-fitting starting deal — built from your needs/surplus AND theirs, plus both sides' trade
// bait — so the wizard presents, per league, the partners most worth approaching with a concrete
// opening offer already drawn up. Tap a deal to open that league's desk seeded on it, ready to tweak
// or send. This is the cross-league complement to the single-league Find Deals screen; both read the
// same finder, so their verdict wording and cache (`tradeFinder:<id>`) stay shared.

// My-perspective value verdict → tint + label. Identical wording to TradeFinderScreen / PickTradeFinder
// so the three surfaces can't drift: favorable = I gain, fair = even, light = I pay a small premium.
const VERDICT = {
  favorable: { color: colors.good, label: 'You gain value' },
  fair: { color: colors.textDim, label: 'Fair deal' },
  light: { color: colors.warn, label: 'You pay up' },
};
const OUTLOOK_COLOR = {
  'Win-now window': colors.warn,
  Ascending: colors.good,
  Rebuilding: colors.textDim,
  Balanced: colors.textDim,
};
const shortOutlook = (o) => (o === 'Win-now window' ? 'Win-now' : o || null);

// A fresh-enough finder snapshot for a league (from a recent Find Deals view or an earlier scan this
// session) → paint it instantly instead of re-fetching. Shares TradeFinderScreen's cache key.
function cachedFinder(leagueId) {
  const hit = peekResource(`tradeFinder:${leagueId}`);
  if (hit && hit.value && Date.now() - (hit.at || 0) < STALE.SLOW) return hit.value;
  return null;
}

export default function TradeWizardMultiScreen({ leagues = [], onExit, onOpenDeal }) {
  const allIds = useMemo(() => leagues.map((l) => String(l.leagueId)), [leagues]);
  const [selected, setSelected] = useState(() => new Set(allIds)); // default: scan them all
  const [phase, setPhase] = useState('choose'); // 'choose' → pick leagues | 'scan' → results
  const [results, setResults] = useState({}); // leagueId -> { status: 'loading'|'done'|'error', data?, error? }

  // A ref-driven, bounded fan-out (the backend caps MFL concurrency globally, so a few in flight just
  // fills its queue — never hits MFL harder than sequential, it just finishes far sooner). Runs to
  // completion regardless of re-renders; results land progressively (instant paint, C1).
  const queue = useRef([]);
  const active = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const pump = useCallback(() => {
    const CONC = 4;
    while (mounted.current && active.current < CONC && queue.current.length) {
      const id = queue.current.shift();
      active.current += 1;
      api.findDeals(id)
        .then((d) => {
          primeResource(`tradeFinder:${id}`, d); // write-through so the single-league finder benefits too
          if (mounted.current) setResults((m) => ({ ...m, [id]: { status: 'done', data: d } }));
        })
        .catch((e) => { if (mounted.current) setResults((m) => ({ ...m, [id]: { status: 'error', error: e.message } })); })
        .finally(() => { active.current -= 1; pump(); });
    }
  }, []);

  const startScan = useCallback(() => {
    const ids = allIds.filter((id) => selected.has(id));
    if (!ids.length) return;
    const init = {};
    const toFetch = [];
    for (const id of ids) {
      const cached = cachedFinder(id);
      if (cached) init[id] = { status: 'done', data: cached }; // recent Find Deals view → instant
      else { init[id] = { status: 'loading' }; toFetch.push(id); }
    }
    setResults(init);
    queue.current = toFetch;
    active.current = 0;
    setPhase('scan');
    pump();
  }, [allIds, selected, pump]);

  // Hardware back: from results, go back to league selection; from selection, exit the wizard.
  useAndroidBack(useCallback(() => {
    if (phase === 'scan') { setPhase('choose'); return true; }
    onExit();
    return true;
  }, [phase, onExit]));

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = selected.size === allIds.length && allIds.length > 0;
  const setAll = () => setSelected(allOn ? new Set() : new Set(allIds));

  const orderedIds = allIds.filter((id) => (results[id] || selected.has(id))); // scan view: stable selection order
  const scannedIds = Object.keys(results);
  const doneCount = scannedIds.filter((id) => results[id].status !== 'loading').length;
  const dealCount = scannedIds.reduce((n, id) => n + ((results[id].data && results[id].data.deals) ? results[id].data.deals.length : 0), 0);
  const scanning = doneCount < scannedIds.length;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={() => (phase === 'scan' ? setPhase('choose') : onExit())} hitSlop={10} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.back} numberOfLines={1}>‹ {phase === 'scan' ? 'Leagues' : 'Back'}</Text>
        </Pressable>
        <TopbarTitle numberOfLines={1}>Trade Wizard</TopbarTitle>
        <View style={{ width: 68 }} />
      </View>

      {phase === 'choose' ? (
        <ChoosePhase
          leagues={leagues}
          selected={selected}
          toggle={toggle}
          allOn={allOn}
          setAll={setAll}
          onScan={startScan}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          <View style={styles.progressCard}>
            <View style={styles.progressRow}>
              {scanning ? <ActivityIndicator size="small" color={colors.accent} /> : <NeonSign glyph="spark" color="accent" grade="inline" size={18} />}
              <Text style={styles.progressText} numberOfLines={1}>
                {scanning
                  ? `Scanning ${doneCount} of ${scannedIds.length} league${scannedIds.length === 1 ? '' : 's'}…`
                  : `${scannedIds.length} league${scannedIds.length === 1 ? '' : 's'} scanned · ${dealCount} deal${dealCount === 1 ? '' : 's'} to open`}
              </Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${scannedIds.length ? Math.round((doneCount / scannedIds.length) * 100) : 0}%` }]} />
            </View>
          </View>

          {orderedIds.map((id) => {
            const league = leagues.find((l) => String(l.leagueId) === id);
            return <LeagueSection key={id} leagueId={id} league={league} result={results[id]} onOpenDeal={onOpenDeal} />;
          })}
          <View style={{ height: 28 }} />
        </ScrollView>
      )}
    </View>
  );
}

function ChoosePhase({ leagues, selected, toggle, allOn, setAll, onScan }) {
  const n = selected.size;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <NeonSign glyph="search" color="accent" grade="inline" size={26} style={styles.introIcon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>Scan for ready deals</Text>
            <Text style={styles.introSub}>
              Pick the leagues to shop. The wizard reads every partner’s needs and surplus — and both sides’
              trade bait — then draws up a fair, roster-fitting opening offer for the teams most worth approaching.
            </Text>
          </View>
        </View>

        <View style={styles.pickHead}>
          <Text style={styles.pickHeadText}>Leagues to scan</Text>
          <Pressable onPress={setAll} hitSlop={8}><Text style={styles.selectAll}>{allOn ? 'Clear all' : 'Select all'}</Text></Pressable>
        </View>

        {leagues.map((l) => {
          const id = String(l.leagueId);
          const on = selected.has(id);
          return (
            <Pressable
              key={id}
              onPress={() => toggle(id)}
              style={({ pressed }) => [styles.leagueRow, on && styles.leagueRowOn, pressed && { opacity: 0.8 }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={l.name}
            >
              <View style={[styles.check, on && styles.checkOn]}>
                {on ? <GlyphMark name="check" size={14} color={colors.onAccent} weight={2.6} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.leagueName} numberOfLines={1}>{l.name}</Text>
                {l.fit ? (
                  <Text style={styles.leagueHint} numberOfLines={1}>
                    You’re deep at {l.fit.topPos} · {l.fit.rivals} rival{l.fit.rivals === 1 ? '' : 's'} need{l.fit.rivals === 1 ? 's' : ''} it
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
        <View style={{ height: 96 }} />
      </ScrollView>

      <View style={styles.footer}>
        <PressableScale
          onPress={onScan}
          disabled={!n}
          style={[styles.scanBtn, !n && styles.scanBtnOff]}
          accessibilityRole="button"
          accessibilityLabel={`Scan ${n} leagues for deals`}
        >
          <Text style={[styles.scanBtnText, !n && styles.scanBtnTextOff]}>
            {n ? `Scan ${n} league${n === 1 ? '' : 's'} for deals` : 'Select a league to scan'}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

function LeagueSection({ leagueId, league, result, onOpenDeal }) {
  const data = result && result.data;
  const name = (data && data.name) || (league && league.name) || 'League';
  const outlook = data && data.myOutlook;
  const outlookColor = OUTLOOK_COLOR[outlook] || colors.textDim;
  const deals = (data && data.deals) || [];
  const needs = (data && data.myNeeds) || [];

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionName, displayLabel()]} numberOfLines={1}>{name}</Text>
        {data && data.format ? <Text style={styles.fmtPill} numberOfLines={1}>{data.format}</Text> : null}
      </View>
      {(outlook || needs.length) ? (
        <View style={styles.sectionMeta}>
          {outlook ? (
            <View style={[styles.chip, { borderColor: outlookColor }]}>
              <View style={[styles.dot, { backgroundColor: outlookColor }]} />
              <Text style={[styles.chipText, { color: outlookColor }]}>{shortOutlook(outlook)}</Text>
            </View>
          ) : null}
          {needs.length ? <Text style={styles.needsLine} numberOfLines={1}>Your needs · {needs.join(' · ')}</Text> : null}
        </View>
      ) : null}

      {result && result.status === 'loading' ? (
        <View style={styles.sectionBody}><ActivityIndicator size="small" color={colors.textDim} /></View>
      ) : result && result.status === 'error' ? (
        <Text style={styles.muted}>Couldn’t scan this league right now.</Text>
      ) : deals.length ? (
        deals.map((d) => <DealCard key={d.partnerFranchiseId} d={d} leagueId={leagueId} leagueName={name} onOpenDeal={onOpenDeal} />)
      ) : (
        <Text style={styles.muted}>No fair deal lines up here right now.</Text>
      )}
    </View>
  );
}

function AssetChips({ assets }) {
  return (
    <View style={styles.assetWrap}>
      {assets.map((a, i) => (
        <View key={`${a.id}:${i}`} style={[styles.asset, a.kind === 'pick' && styles.assetPick]}>
          <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
          {a.value != null ? <Text style={styles.assetVal}>{a.value}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function DealCard({ d, leagueId, leagueName, onOpenDeal }) {
  const verdict = VERDICT[d.verdict] || VERDICT.fair;
  const open = () => onOpenDeal({
    leagueId,
    name: leagueName,
    partnerFranchiseId: d.partnerFranchiseId,
    sendTokens: (d.send || []).map((a) => a.id),
    receiveTokens: (d.receive || []).map((a) => a.id),
  });
  return (
    <PressableScale style={styles.card} onPress={open}>
      <View style={styles.cardTop}>
        <Text style={[styles.team, displayLabel()]} numberOfLines={1}>{d.partnerName || 'Their team'}</Text>
        {d.fillsNeed ? <Text style={styles.needTag}>fills your need</Text> : null}
      </View>
      {d.rationale ? <Text style={styles.reason} numberOfLines={2}>{d.rationale}</Text> : null}

      <View style={styles.deal}>
        <View style={styles.side}>
          <Text style={styles.sideLabel}>YOU SEND</Text>
          <AssetChips assets={d.send || []} />
          <Text style={styles.sideVal}>{(d.sendValue || 0).toLocaleString()}</Text>
        </View>
        <Text style={styles.arrow}>→</Text>
        <View style={styles.side}>
          <Text style={styles.sideLabel}>YOU GET</Text>
          <AssetChips assets={d.receive || []} />
          <Value size={13}>{(d.receiveValue || 0).toLocaleString()}</Value>
        </View>
      </View>

      <View style={styles.cardFoot}>
        <Text style={[styles.verdict, { color: verdict.color }]}>{verdict.label}</Text>
        {d.fairness != null ? <Text style={styles.fairness}>{d.fairness}% even</Text> : null}
        <Text style={styles.openHint}>Open deal ›</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { minWidth: 68, minHeight: 44, justifyContent: 'center' },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24 },

  // Choose phase
  intro: { flexDirection: 'row', gap: 12, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 18 },
  introIcon: { fontSize: 24, marginTop: 2 },
  introTitle: { color: colors.violetText, fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },
  introSub: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginTop: 4 },
  pickHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  pickHeadText: { color: colors.text, fontSize: 15, fontWeight: '900', letterSpacing: 0.3, textTransform: 'uppercase' },
  selectAll: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  leagueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10, minHeight: 56 },
  leagueRowOn: { borderColor: colors.accent + '88', backgroundColor: colors.accent + '0E' },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  leagueName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  leagueHint: { color: colors.good, fontSize: 12, fontWeight: '700', marginTop: 2 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 26, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  scanBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  scanBtnOff: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  scanBtnText: { color: colors.onAccent, fontSize: 15, fontWeight: '900', letterSpacing: 0.3 },
  scanBtnTextOff: { color: colors.textDim },

  // Scan phase
  progressCard: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 16 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressText: { color: colors.text, fontSize: 14, fontWeight: '800', flex: 1 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.cardAlt, marginTop: 10, overflow: 'hidden' },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },

  section: { marginBottom: 22 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionName: { color: colors.text, fontSize: 16, fontWeight: '900', letterSpacing: 0.3, flexShrink: 1 },
  fmtPill: { color: colors.accent, backgroundColor: colors.accent + '1A', borderWidth: 1, borderColor: colors.accent + '55', borderRadius: 6, fontSize: 11, lineHeight: 13, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  sectionMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  needsLine: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  sectionBody: { paddingVertical: 16, alignItems: 'center' },
  muted: { color: colors.textDim, fontSize: 13, fontStyle: 'italic', paddingVertical: 10 },

  // Deal card (shared visual language with TradeFinderScreen)
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  team: { color: colors.text, fontSize: 16, fontWeight: '900', letterSpacing: 0.3, flex: 1, marginRight: 10 },
  needTag: { color: colors.good, fontSize: 11, lineHeight: 13, fontWeight: '800', letterSpacing: 0.2, borderWidth: 1, borderColor: colors.good, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  reason: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 18 },
  deal: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  side: { flex: 1 },
  sideLabel: { color: colors.violetText, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 5 },
  sideVal: { color: colors.textDim, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 2 },
  arrow: { color: colors.textDim, fontSize: 18, fontWeight: '800', paddingHorizontal: 10 },
  assetWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  asset: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 6, maxWidth: '100%' },
  assetPick: { borderWidth: 1, borderColor: colors.goldDeep, backgroundColor: 'rgba(243,193,74,0.10)' },
  assetName: { color: colors.text, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  assetVal: { color: colors.textDim, fontSize: 11, fontWeight: '800', marginLeft: 6, fontVariant: ['tabular-nums'] },
  cardFoot: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 12 },
  verdict: { fontSize: 12, fontWeight: '800' },
  fairness: { color: colors.textDim, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  openHint: { color: colors.accent, fontSize: 13, fontWeight: '700', marginLeft: 'auto' },
});
