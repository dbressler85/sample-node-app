import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';

// "Trade for this player" — league by league, NOT a batch send. Lists every league where
// he's on another team; picking one opens that league's trade desk seeded with the target
// and a needs-fitting suggested offer you then craft. If he's only a target in one league,
// the caller opens it directly (this sheet is for choosing among several).
export default function TradeAcrossSheet({ player, onClose, onCraft }) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let alive = true;
    api.playerTradePreview(player.id)
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
            <Text style={styles.sub}>Pick a league to craft an offer. Each opens that league's trade desk with a suggested, needs-fitting package you can adjust.</Text>
            {preview.leagues.map((l) => (
              <Pressable
                key={l.leagueId}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                onPress={() => onCraft({ leagueId: l.leagueId, name: l.name, targetPlayerId: player.id, partnerFranchiseId: l.partnerFranchiseId })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.league} numberOfLines={1}>{l.name}</Text>
                  <Text style={styles.owner} numberOfLines={1}>held by {l.partnerName}</Text>
                </View>
                <Text style={styles.craft}>Craft offer ›</Text>
              </Pressable>
            ))}
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
  craft: { color: colors.accent, fontSize: 14, fontWeight: '800' },
});
