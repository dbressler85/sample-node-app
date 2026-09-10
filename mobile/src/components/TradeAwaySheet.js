import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import BottomSheet from './BottomSheet';
import Checkbox from './Checkbox';
import { api } from '../api';
import { colors } from '../theme';

// "Trade away this player" — the SELL mirror of TradeAcrossSheet. Lists every league where you ROSTER
// him; for each we find the partner who most needs his position and pre-build a fair return targeting
// your needs. Picking one league opens that league's trade desk seeded with him on the SEND side, the
// partner selected, and the suggested return pre-checked; picking several steps you through each in the
// trade wizard. Both let you tweak or send from there.

const VERDICT = {
  favorable: { color: colors.good, label: 'You gain value' },
  fair: { color: colors.textDim, label: 'Fair deal' },
  light: { color: colors.warn, label: 'You pay up' },
};

export default function TradeAwaySheet({ player, onClose, onCraft, onStartWizard }) {
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);

  // The seed the desk/wizard consumes: him on the SEND side, the needs-fitting partner selected, and
  // the suggested return pre-checked (receiveTokens). Same seed the Pick Capital shop flow uses.
  const ctxFor = (l) => ({
    leagueId: l.leagueId,
    name: l.name,
    sendTokens: [player.id],
    partnerFranchiseId: l.partnerFranchiseId,
    partnerName: l.partnerName,
    receiveTokens: (l.receive || []).map((r) => r.id),
  });

  function start() {
    const chosen = (preview.leagues || []).filter((l) => selected.has(l.leagueId)).map(ctxFor);
    if (!chosen.length) return;
    if (chosen.length === 1) onCraft(chosen[0]);
    else onStartWizard(chosen);
  }

  // Distinguish a load FAILURE from "no partner lines up" so a flaky fetch doesn't read as "can't trade him."
  const load = useCallback(() => {
    setError(null);
    setPreview(null);
    let alive = true;
    // The profile already classified every league; he's sellable where YOU roster him ('rostered' →
    // actions.dropLeagues). Send just those so the backend probes a handful, not all of them.
    const ownedLeagueIds = ((player.actions && player.actions.dropLeagues) || []).map((l) => l.leagueId);
    api.playerSellPreview(player.id, ownedLeagueIds)
      .then((pv) => {
        if (!alive) return;
        if (pv.leagues && pv.leagues.length === 1) { onCraft(ctxFor(pv.leagues[0])); return; }
        setPreview(pv);
      })
      .catch((e) => { if (alive) setError(e.message || 'Could not load trade partners.'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.id]);

  useEffect(() => load(), [load]);

  return (
    <BottomSheet onClose={onClose}>
      <Text style={styles.sheetTitle}>Trade away {player.name}</Text>
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
        <Text style={styles.empty}>No trade partner lines up for him in your leagues right now — try shopping him on the block instead.</Text>
      ) : (
        <>
          <Text style={styles.sub}>
            Check the leagues you want to shop him in. We find a partner who needs {preview.player.position || 'his position'} and
            pre-build a fair return for your needs — one opens that league’s desk, several step you through each.
          </Text>
          <ScrollView style={styles.leagueScroll} contentContainerStyle={styles.leagueScrollContent} showsVerticalScrollIndicator>
            {preview.leagues.map((l) => {
              const on = selected.has(l.leagueId);
              const v = VERDICT[l.verdict] || VERDICT.fair;
              const gets = (l.receive || []).map((r) => r.name.split(',')[0]).join(', ');
              return (
                <Pressable
                  key={l.leagueId}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                  onPress={() => setSelected((s) => { const n = new Set(s); if (n.has(l.leagueId)) n.delete(l.leagueId); else n.add(l.leagueId); return n; })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${l.name}, trade with ${l.partnerName}`}
                >
                  <Checkbox checked={on} size={22} style={styles.check} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.league} numberOfLines={1}>{l.name}</Text>
                    <Text style={styles.owner} numberOfLines={1}>
                      {l.partnerName}{l.needsPosition ? ` · needs ${preview.player.position}` : ''}
                    </Text>
                    {gets ? <Text style={styles.gets} numberOfLines={1}>you get: {gets}</Text> : null}
                  </View>
                  {l.verdict ? <Text style={[styles.verdict, { color: v.color }]} numberOfLines={1}>{v.label}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            style={({ pressed }) => [styles.confirm, !selected.size && styles.confirmOff, pressed && selected.size && { opacity: 0.85 }]}
            onPress={start}
            disabled={!selected.size}
          >
            <Text style={styles.confirmText}>{selected.size > 1 ? `Craft offers (${selected.size}) ›` : 'Craft offer ›'}</Text>
          </Pressable>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 4, marginBottom: 8, lineHeight: 17 },
  leagueScroll: { flexShrink: 1 },
  leagueScrollContent: { paddingBottom: 4 },
  empty: { color: colors.textDim, fontSize: 14, paddingVertical: 20, textAlign: 'center', lineHeight: 20 },
  retry: { marginTop: 12, backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 11, minHeight: 44, justifyContent: 'center' },
  retryText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  league: { color: colors.text, fontSize: 15, fontWeight: '700' },
  owner: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  gets: { color: colors.accent, fontSize: 12, fontWeight: '700', marginTop: 2 },
  verdict: { fontSize: 11, fontWeight: '800', marginLeft: 8, maxWidth: 92, textAlign: 'right' },
  check: { marginRight: 12 },
  confirm: { marginTop: 16, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmOff: { opacity: 0.4 },
  confirmText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
});
