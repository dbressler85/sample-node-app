import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';

// Batch "send a trade offer for this player across every league he's on another
// team." One preview (per league: the owner + a suggested fair give-package from
// your roster there), a checkbox list (all pre-selected), and a single submit that
// fires the offers. The trade equivalent of AddAcrossSheet.
export default function TradeAcrossSheet({ player, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.playerTradePreview(player.id)
      .then((pv) => {
        setPreview(pv);
        setSelected(new Set((pv.leagues || []).map((l) => l.leagueId)));
      })
      .catch(() => setPreview({ leagues: [] }));
  }, [player.id]);

  async function submit() {
    setBusy(true);
    try {
      const leagues = preview.leagues
        .filter((l) => selected.has(l.leagueId))
        .map((l) => ({ leagueId: l.leagueId, partnerFranchiseId: l.partnerFranchiseId, giveIds: l.suggestedGive.map((g) => g.id) }));
      const res = await api.playerTrade(player.id, leagues);
      Alert.alert('Offers sent', `${player.name} offered in ${res.summary.submitted} of ${res.summary.requested} leagues.`);
      onDone();
    } catch (e) {
      Alert.alert('Could not send', e.message);
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
        <Text style={styles.sheetTitle}>Trade for {player.name}</Text>
        {!preview ? (
          <ActivityIndicator color={colors.accent} style={{ paddingVertical: 24 }} />
        ) : preview.leagues.length === 0 ? (
          <Text style={styles.empty}>He isn't on another team in any of your leagues — nothing to offer for.</Text>
        ) : (
          <>
            <Text style={styles.sub}>A fair package is suggested per league — review, then send. Tweak any offer in that league's trade desk.</Text>
            {preview.leagues.map((l) => {
              const on = selected.has(l.leagueId);
              return (
                <Pressable key={l.leagueId} style={styles.row} onPress={() => toggle(l.leagueId)}>
                  <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.league} numberOfLines={1}>{l.name} <Text style={styles.owner}>· {l.partnerName}</Text></Text>
                    <Text style={styles.give} numberOfLines={1}>
                      offer {l.suggestedGive.map((g) => g.name.split(',')[0]).join(' + ') || '—'}
                      <Text style={styles.vals}>{`  (${l.giveValue} for ${l.targetValue})`}</Text>
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
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Send {selected.size} offer{selected.size === 1 ? '' : 's'}</Text>}
            </Pressable>
          </>
        )}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderTopWidth: 1, borderColor: colors.border },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 4, marginBottom: 8, lineHeight: 17 },
  empty: { color: colors.textDim, fontSize: 14, paddingVertical: 20, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 14 },
  league: { color: colors.text, fontSize: 15, fontWeight: '700' },
  owner: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  give: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  vals: { color: colors.gold, fontWeight: '700' },
  confirm: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  confirmOff: { backgroundColor: colors.cardAlt },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
