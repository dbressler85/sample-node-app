import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';

// Batch "claim a player across every league he's free in" — one preview (per-league
// suggested drop + bid), checkbox list (all pre-selected), and a single submit that
// files the claims in one pass. Shared by the player profile and the Waivers
// "Best Available" view so a breakout on 4 waiver wires is one action, not four.
export default function AddAcrossSheet({ player, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.playerAddPreview(player.id)
      .then((pv) => {
        setPreview(pv);
        setSelected(new Set(pv.leagues.map((l) => l.leagueId)));
      })
      .catch(() => setPreview({ leagues: [] }));
  }, [player.id]);

  async function submit() {
    setBusy(true);
    try {
      const leagues = preview.leagues.filter((l) => selected.has(l.leagueId)).map((l) => ({ leagueId: l.leagueId }));
      const res = await api.playerAdd(player.id, leagues);
      Alert.alert('Claims submitted', `${player.name} claimed in ${res.summary.submitted} of ${res.summary.requested} leagues.`);
      onDone();
    } catch (e) {
      Alert.alert('Could not submit', e.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        <Text style={styles.sheetTitle}>Add {player.name} across leagues</Text>
        {!preview ? (
          <ActivityIndicator color={colors.accent} style={{ paddingVertical: 24 }} />
        ) : preview.leagues.length === 0 ? (
          <Text style={styles.empty}>Not available in any of your leagues right now.</Text>
        ) : (
          <>
            {preview.leagues.map((l) => {
              const on = selected.has(l.leagueId);
              return (
                <Pressable key={l.leagueId} style={styles.addRow} onPress={() => toggle(l.leagueId)}>
                  <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
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
            <Pressable
              style={({ pressed }) => [styles.confirm, (!selected.size || busy) && styles.confirmOff, pressed && selected.size && { opacity: 0.85 }]}
              onPress={submit}
              disabled={!selected.size || busy}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Claim in {selected.size} league{selected.size === 1 ? '' : 's'}</Text>}
            </Pressable>
            <Text style={styles.tip}>Fine-tune each bid/drop in the Waivers tab.</Text>
          </>
        )}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderTopWidth: 1, borderColor: colors.border },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginBottom: 6 },
  empty: { color: colors.textDim, fontSize: 14, paddingVertical: 20, textAlign: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 14 },
  addLeague: { color: colors.text, fontSize: 15, fontWeight: '700' },
  addMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  confirm: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  confirmOff: { backgroundColor: colors.cardAlt },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  tip: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 12 },
});
