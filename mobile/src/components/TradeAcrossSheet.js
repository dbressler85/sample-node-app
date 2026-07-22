import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';

// "Trade for this player" — league by league, NOT a batch send. Lists every league where
// he's on another team; picking one opens that league's trade desk seeded with the target
// and a needs-fitting suggested offer you then craft. If he's only a target in one league,
// the caller opens it directly (this sheet is for choosing among several).
export default function TradeAcrossSheet({ player, onClose, onCraft, onStartWizard }) {
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());

  const ctxFor = (l) => ({ leagueId: l.leagueId, name: l.name, targetPlayerId: player.id, partnerFranchiseId: l.partnerFranchiseId });
  function start() {
    const chosen = (preview.leagues || []).filter((l) => selected.has(l.leagueId)).map(ctxFor);
    if (!chosen.length) return;
    if (chosen.length === 1) onCraft(chosen[0]);
    else onStartWizard(chosen);
  }

  useEffect(() => {
    let alive = true;
    // The profile already classified every league; he's a trade target only where another team
    // owns him ('unavailable'). Send just those so the backend probes a handful of leagues, not
    // all of them. (Empty → the backend falls back to probing every league.)
    const targetLeagueIds = (player.crossLeague || []).filter((c) => c.relation === 'unavailable').map((c) => c.leagueId);
    api.playerTradePreview(player.id, targetLeagueIds)
      .then((pv) => {
        if (!alive) return;
        // Only a trade target in one league? Skip the picker and go straight to crafting.
        if (pv.leagues && pv.leagues.length === 1) {
          const l = pv.leagues[0];
          onCraft({ leagueId: l.leagueId, name: l.name, targetPlayerId: player.id, partnerFranchiseId: l.partnerFranchiseId });
          return;
        }
        setPreview(pv);
      })
      .catch(() => { if (alive) setPreview({ leagues: [] }); });
    return () => { alive = false; };
  }, [player.id]);

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
            <Text style={styles.sub}>Check the leagues you want to shop him in. One opens that league's trade desk; several step you through a suggested, needs-fitting offer in each.</Text>
            {preview.leagues.map((l) => {
              const on = selected.has(l.leagueId);
              return (
                <Pressable
                  key={l.leagueId}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                  onPress={() => setSelected((s) => { const n = new Set(s); n.has(l.leagueId) ? n.delete(l.leagueId) : n.add(l.leagueId); return n; })}
                >
                  <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.league} numberOfLines={1}>{l.name}</Text>
                    <Text style={styles.owner} numberOfLines={1}>held by {l.partnerName}</Text>
                  </View>
                </Pressable>
              );
            })}
            <Pressable
              style={({ pressed }) => [styles.confirm, !selected.size && styles.confirmOff, pressed && selected.size && { opacity: 0.85 }]}
              onPress={start}
              disabled={!selected.size}
            >
              <Text style={styles.confirmText}>{selected.size > 1 ? `Craft offers (${selected.size}) ›` : 'Craft offer ›'}</Text>
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
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  league: { color: colors.text, fontSize: 15, fontWeight: '700' },
  owner: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '900' },
  confirm: { marginTop: 16, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmOff: { opacity: 0.4 },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
