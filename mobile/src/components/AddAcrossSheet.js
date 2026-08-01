import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { appAlert } from './AppAlert';
import BottomSheet from './BottomSheet';
import Checkbox from './Checkbox';
import { api } from '../api';
import { colors } from '../theme';

// Batch "claim a player across every league he's free in" — one preview (per-league
// suggested drop + bid), checkbox list (all pre-selected), and a single submit that
// files the claims in one pass. Shared by the player profile and the Waivers
// "Best Available" view so a breakout on 4 waiver wires is one action, not four.
// `onReview(player, leagueStubs)` — when provided, the primary action HANDS OFF to the waiver wizard
// seeded with this player + the checked leagues (review/adjust each add-drop-bid before filing),
// instead of firing the claims straight from here. That's the flow the free-agent "claim in N leagues"
// button uses; callers without it (if any) keep the one-tap batch submit.
export default function AddAcrossSheet({ player, onClose, onDone, onReview }) {
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Track a load FAILURE distinct from an empty result — a failed fetch must not read as
  // "not available anywhere" (which would wrongly tell the user the action is impossible).
  const load = useCallback(() => {
    setError(null);
    setPreview(null);
    api.playerAddPreview(player.id)
      .then((pv) => {
        setPreview(pv);
        setSelected(new Set(pv.leagues.map((l) => l.leagueId)));
      })
      .catch((e) => setError(e.message || 'Could not load availability.'));
  }, [player.id]);

  useEffect(() => { load(); }, [load]);

  // Hand off to the waiver wizard seeded with this player + the checked leagues, so each league's
  // add / drop / bid can be reviewed and adjusted before anything is filed (no auto-submit here).
  function review() {
    const stubs = preview.leagues
      .filter((l) => selected.has(l.leagueId))
      .map((l) => ({ leagueId: l.leagueId, name: l.name, system: l.system }));
    onReview(player, stubs);
  }

  async function submit() {
    setBusy(true);
    try {
      const leagues = preview.leagues.filter((l) => selected.has(l.leagueId)).map((l) => ({ leagueId: l.leagueId }));
      const res = await api.playerAdd(player.id, leagues);
      appAlert('Claims submitted', `${player.name} claimed in ${res.summary.submitted} of ${res.summary.requested} leagues.`);
      onDone();
    } catch (e) {
      appAlert('Could not submit', e.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  return (
    <BottomSheet onClose={onClose}>
      <Text style={styles.sheetTitle}>Add {player.name} across leagues</Text>
      {error ? (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
          <Text style={styles.empty}>{error}</Text>
          <Pressable style={({ pressed }) => [styles.retry, pressed && { opacity: 0.85 }]} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : !preview ? (
        <ActivityIndicator color={colors.accent} style={{ paddingVertical: 24 }} />
      ) : preview.leagues.length === 0 ? (
        <Text style={styles.empty}>Not available in any of your leagues right now.</Text>
      ) : (
        <>
          {/* Bounded + scrollable within the sheet, so a long availability list can't push the title
              off the top edge (the shell caps the height; this list scrolls the overflow). */}
          <ScrollView style={styles.leagueScroll} contentContainerStyle={styles.leagueScrollContent} showsVerticalScrollIndicator>
            {preview.leagues.map((l) => {
              const on = selected.has(l.leagueId);
              return (
                <Pressable
                  key={l.leagueId}
                  style={styles.addRow}
                  onPress={() => toggle(l.leagueId)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={l.name}
                >
                  <Checkbox checked={on} size={24} style={styles.check} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addLeague} numberOfLines={1}>{l.name}</Text>
                    <Text style={styles.addMeta} numberOfLines={1}>
                      {l.system === 'faab' ? `bid $${l.suggestedBid}` : l.system === 'fcfs' ? 'waiver claim' : 'immediate'}
                      {l.suggestedDrop ? ` · drop ${l.suggestedDrop.name.split(',')[0]}` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            style={({ pressed }) => [styles.confirm, (!selected.size || busy) && styles.confirmOff, pressed && selected.size && { opacity: 0.85 }]}
            onPress={onReview ? review : submit}
            disabled={!selected.size || busy}
          >
            {busy ? <ActivityIndicator color={colors.onAccent} /> : (
              <Text style={styles.confirmText}>
                {onReview ? `Review ${selected.size} claim${selected.size === 1 ? '' : 's'} →` : `Claim in ${selected.size} league${selected.size === 1 ? '' : 's'}`}
              </Text>
            )}
          </Pressable>
          <Text style={styles.tip}>{onReview ? 'Pick the drop and bid for each league before you file.' : 'Fine-tune each bid/drop in the Waivers tab.'}</Text>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginBottom: 6 },
  empty: { color: colors.textDim, fontSize: 14, paddingVertical: 20, textAlign: 'center' },
  retry: { marginTop: 12, backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 11, minHeight: 44, justifyContent: 'center' },
  retryText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  leagueScroll: { flexShrink: 1 },
  leagueScrollContent: { paddingBottom: 4 },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  check: { marginRight: 12 },
  addLeague: { color: colors.text, fontSize: 15, fontWeight: '700' },
  addMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  confirm: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  confirmOff: { backgroundColor: colors.cardAlt },
  confirmText: { color: colors.onAccent, fontSize: 16, fontWeight: '800' },
  tip: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 12 },
});
