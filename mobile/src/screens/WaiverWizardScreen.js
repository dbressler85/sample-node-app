import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import AvailabilityBadge from '../components/AvailabilityBadge';
import useAndroidBack from '../useAndroidBack';

// Wizard that walks league-to-league with a suggested pickup (best add + smart
// drop + FAAB bid) pre-filled for each. The owner can swap the add from the
// shortlist, change the drop, adjust the bid, submit, and advance — or skip.
// `leagues` is the pre-filtered queue of per-league suggestion objects.
export default function WaiverWizardScreen({ leagues, onBack }) {
  const [index, setIndex] = useState(0);
  const [addId, setAddId] = useState(null);
  const [dropId, setDropId] = useState(null);
  const [bid, setBid] = useState(null); // string, faab only
  const [browsing, setBrowsing] = useState(false); // candidate picker open
  const [changingDrop, setChangingDrop] = useState(false); // bench picker open
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState([]); // {leagueId, name, action, add?, bid?}

  const total = leagues.length;
  const current = index < total ? leagues[index] : null;
  const done = index >= total;

  // Exit the wizard on hardware back.
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  // Seed the selection from each league's recommendation as we arrive.
  useEffect(() => {
    if (!current) return;
    const rec = current.recommended;
    const seedAdd = rec ? rec.add.id : current.candidates[0] ? current.candidates[0].id : null;
    setAddId(seedAdd);
    setDropId(rec && rec.drop ? rec.drop.id : null);
    setBid(rec && rec.bid != null ? String(rec.bid) : current.system === 'faab' ? String(current.minBid || 1) : null);
    setBrowsing(false);
    setChangingDrop(false);
  }, [current && current.leagueId]);

  const candById = useMemo(() => {
    const m = new Map();
    if (current) for (const c of current.candidates) m.set(c.id, c);
    return m;
  }, [current && current.leagueId]);
  const benchById = useMemo(() => {
    const m = new Map();
    if (current) for (const b of current.bench) m.set(b.id, b);
    return m;
  }, [current && current.leagueId]);

  const add = addId ? candById.get(addId) : null;
  const drop = dropId ? benchById.get(dropId) : null;
  const isFaab = current && current.system === 'faab';
  const dropRequired = !!(current && current.rosterFull);
  const bidNum = bid != null && bid !== '' ? Number(bid) : null;
  const budgetAfter = isFaab && current.faabRemaining != null && bidNum != null ? current.faabRemaining - bidNum : null;

  // Client-side gate (the backend re-validates on submit).
  const errors = [];
  if (!add) errors.push('Pick a player to add.');
  if (dropRequired && !dropId) errors.push('Your roster is full — choose a drop.');
  if (isFaab) {
    if (bidNum == null || Number.isNaN(bidNum)) errors.push('Enter a bid.');
    else if (bidNum < (current.minBid || 1)) errors.push(`Bid is below the minimum ($${current.minBid || 1}).`);
    else if (current.faabRemaining != null && bidNum > current.faabRemaining) errors.push(`Bid exceeds your budget ($${current.faabRemaining}).`);
  }
  const valid = errors.length === 0;

  function advance(result) {
    setResults((r) => [...r, result]);
    setIndex((i) => i + 1);
  }

  async function submitAndNext() {
    if (!valid || !current) return;
    setSubmitting(true);
    try {
      const body = { addId };
      if (dropId) body.dropId = dropId;
      if (isFaab && bidNum != null) body.bid = bidNum;
      await api.submitClaim(current.leagueId, body);
      advance({ leagueId: current.leagueId, name: current.name, action: 'claimed', add: add.name, bid: isFaab ? bidNum : null });
    } catch (e) {
      Alert.alert('Could not submit', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function skip() {
    advance({ leagueId: current.leagueId, name: current.name, action: 'skipped' });
  }

  if (done) return <Summary results={results} onBack={onBack} />;
  if (!current) return null;

  const rec = current.recommended;
  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Done</Text>
        </Pressable>
        <Text style={styles.progress}>League {index + 1} of {total}</Text>
        <Text style={styles.skipTop} onPress={skip}>Skip</Text>
      </View>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.round((index / total) * 100)}%` }]} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} numberOfLines={1}>{current.name}</Text>
        <Text style={styles.subtitle}>
          <SystemBadge system={current.system} />
          {'  '}
          {isFaab && current.faabRemaining != null ? `$${current.faabRemaining} FAAB · ` : ''}
          Roster {current.rosterCount}/{current.rosterSize}{current.rosterFull ? ' · FULL' : ''}
        </Text>
        {rec ? (
          <Text style={[styles.reason, rec.upgrade && { color: colors.gold }]}>
            {rec.upgrade ? '★ ' : ''}{rec.reason}
          </Text>
        ) : null}

        {/* ADD */}
        <Text style={styles.fieldLabel}>Add</Text>
        {add ? (
          <PlayerLine p={add} showValue />
        ) : (
          <Text style={styles.noneText}>No player selected</Text>
        )}
        <Pressable style={styles.changeRow} onPress={() => setBrowsing((v) => !v)}>
          <Text style={styles.changeText}>{browsing ? 'Close' : 'Choose a different player'}</Text>
        </Pressable>
        {browsing ? (
          <View style={styles.picker}>
            {current.candidates.map((c) => (
              <Pressable
                key={c.id}
                style={[styles.pickRow, c.id === addId && styles.pickRowOn]}
                onPress={() => { setAddId(c.id); setBrowsing(false); }}
              >
                <PlayerLine p={c} showValue compact />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* DROP */}
        <Text style={styles.fieldLabel}>{dropRequired ? 'Drop (required — roster full)' : 'Drop (optional)'}</Text>
        <Pressable style={styles.dropBox} onPress={() => setChangingDrop((v) => !v)}>
          <Text style={styles.dropText}>
            {drop ? `− ${drop.name.split(',')[0]}${drop.value != null ? ` (${drop.value})` : ''}` : 'None'}
          </Text>
          <Text style={styles.changeText}>{changingDrop ? 'Close' : 'Change'}</Text>
        </Pressable>
        {changingDrop ? (
          <View style={styles.picker}>
            {!dropRequired ? (
              <Pressable style={styles.pickRow} onPress={() => { setDropId(null); setChangingDrop(false); }}>
                <Text style={styles.benchName}>None (add without dropping)</Text>
              </Pressable>
            ) : null}
            {current.bench.map((b) => (
              <Pressable
                key={b.id}
                style={[styles.pickRow, b.id === dropId && styles.pickRowOn]}
                onPress={() => { setDropId(b.id); setChangingDrop(false); }}
              >
                <Text style={styles.benchName}>
                  {b.name.split(',')[0]} <Text style={styles.benchMeta}>{b.position} · {b.value}</Text>
                </Text>
              </Pressable>
            ))}
            {current.bench.length === 0 ? <Text style={styles.benchName}>No bench players to drop.</Text> : null}
          </View>
        ) : null}

        {/* BID (faab) */}
        {isFaab ? (
          <>
            <Text style={styles.fieldLabel}>
              FAAB bid{rec && rec.bid != null ? ` · suggested $${rec.bid}` : ''}
            </Text>
            <View style={styles.bidRow}>
              <Stepper label="−" onPress={() => setBid(String(Math.max(0, (bidNum || 0) - 1)))} />
              <TextInput
                style={styles.bidInput}
                keyboardType="number-pad"
                value={bid == null ? '' : String(bid)}
                onChangeText={(t) => setBid(t.replace(/[^0-9]/g, ''))}
              />
              <Stepper label="+" onPress={() => setBid(String((bidNum || 0) + 1))} />
              {budgetAfter != null ? <Text style={styles.budgetAfter}>${budgetAfter} left after</Text> : null}
            </View>
          </>
        ) : null}

        {!valid ? <Text style={styles.errorText}>{errors[0]}</Text> : null}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable style={styles.skipInline} onPress={skip} disabled={submitting}>
          <Text style={styles.skipInlineText}>Skip</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.submit, (!valid || submitting) && styles.submitOff, pressed && valid && { opacity: 0.85 }]}
          onPress={submitAndNext}
          disabled={!valid || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>
              {current.system === 'free' ? 'Add' : 'Claim'}{index + 1 === total ? ' & Finish' : ' & Next'}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function PlayerLine({ p, showValue, compact }) {
  const posColor = positionColors[p.position] || colors.textDim;
  return (
    <View style={[styles.playerLine, compact && { paddingVertical: 6 }]}>
      <View style={[styles.posBadge, { backgroundColor: posColor + '22', borderColor: posColor }]}>
        <Text style={[styles.pos, { color: posColor }]}>{p.position}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.playerName} numberOfLines={1}>{p.name.split(',')[0]}</Text>
          <AvailabilityBadge availability={p.availability} style={{ marginLeft: 6 }} />
        </View>
        <Text style={styles.playerMeta} numberOfLines={1}>
          {[
            p.team,
            p.projection != null ? `proj ${p.projection}` : null,
            p.ownership != null ? `${p.ownership}% rost` : null,
            p.trend ? `+${(p.trend / 1000).toFixed(1)}k adds` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {showValue && p.value != null ? <Text style={styles.playerValue}>{p.value}</Text> : null}
    </View>
  );
}

function Summary({ results, onBack }) {
  const claimed = results.filter((r) => r.action === 'claimed');
  const skipped = results.filter((r) => r.action === 'skipped');
  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <Text style={styles.doneMark}>✓</Text>
        <Text style={styles.doneTitle}>
          {claimed.length ? `${claimed.length} claim${claimed.length === 1 ? '' : 's'} submitted` : 'No claims submitted'}
        </Text>
        {skipped.length ? <Text style={styles.doneSub}>{skipped.length} skipped</Text> : null}
        <View style={styles.summaryList}>
          {results.map((r) => (
            <View key={r.leagueId} style={styles.summaryRow}>
              <Text style={styles.summaryName} numberOfLines={1}>{r.name}</Text>
              {r.action === 'claimed' ? (
                <Text style={styles.summarySet} numberOfLines={1}>
                  + {r.add.split(',')[0]}{r.bid != null ? ` · $${r.bid}` : ''}
                </Text>
              ) : (
                <Text style={styles.summarySkip}>skipped</Text>
              )}
            </View>
          ))}
        </View>
        <Pressable style={styles.doneBtn} onPress={onBack}>
          <Text style={styles.doneBtnText}>Back to Waivers</Text>
        </Pressable>
      </View>
    </View>
  );
}

const SYS = { faab: { label: 'FAAB', color: colors.accent }, fcfs: { label: 'FCFS', color: colors.warn }, free: { label: 'Free agent', color: colors.good } };
function SystemBadge({ system }) {
  const s = SYS[system] || SYS.free;
  return <Text style={[styles.sysBadge, { color: s.color, borderColor: s.color }]}>{s.label}</Text>;
}
function Stepper({ onPress, label }) {
  return (
    <Pressable style={styles.stepper} onPress={onPress}>
      <Text style={styles.stepperText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  progress: { color: colors.text, fontSize: 14, fontWeight: '800' },
  skipTop: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
  bar: { height: 4, backgroundColor: colors.card, marginHorizontal: 16, marginTop: 10, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.accent },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  title: { color: colors.text, fontSize: 22, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 6 },
  reason: { color: colors.textDim, fontSize: 13, fontWeight: '700', marginTop: 8 },
  fieldLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 18, marginBottom: 8, letterSpacing: 0.3 },
  playerLine: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 },
  posBadge: { width: 40, paddingVertical: 2, borderRadius: 6, borderWidth: 1, alignItems: 'center', marginRight: 10 },
  pos: { fontSize: 11, fontWeight: '800' },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  playerName: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  playerMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  playerValue: { color: colors.gold, fontSize: 16, fontWeight: '900', marginLeft: 10 },
  noneText: { color: colors.textDim, fontSize: 14, fontStyle: 'italic' },
  changeRow: { paddingTop: 8 },
  changeText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  picker: { marginTop: 8, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  pickRow: { paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickRowOn: { backgroundColor: colors.cardAlt },
  benchName: { color: colors.text, fontSize: 14, paddingVertical: 12, paddingHorizontal: 4 },
  benchMeta: { color: colors.textDim, fontSize: 12 },
  dropBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14 },
  dropText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepperText: { color: colors.text, fontSize: 20, fontWeight: '900' },
  bidInput: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, color: colors.text, fontSize: 18, fontWeight: '800', minWidth: 70, textAlign: 'center' },
  budgetAfter: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  errorText: { color: colors.bad, fontSize: 13, marginTop: 16, fontWeight: '600' },
  actions: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4, gap: 12 },
  skipInline: { paddingHorizontal: 22, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  skipInlineText: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
  submit: { flex: 1, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitOff: { backgroundColor: colors.cardAlt },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  sysBadge: { fontSize: 10, fontWeight: '900', borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  // summary
  doneMark: { color: colors.good, fontSize: 56, fontWeight: '900', marginBottom: 8 },
  doneTitle: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  doneSub: { color: colors.textDim, fontSize: 14, marginTop: 4 },
  summaryList: { alignSelf: 'stretch', marginTop: 24, marginBottom: 8 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  summaryName: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1, marginRight: 12 },
  summarySet: { color: colors.good, fontSize: 14, fontWeight: '800', flexShrink: 1 },
  summarySkip: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  doneBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 40, alignItems: 'center', marginTop: 24 },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
