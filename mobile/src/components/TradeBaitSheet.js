import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { appAlert } from './AppAlert';
import BottomSheet from './BottomSheet';
import Checkbox from './Checkbox';
import LeagueContext from './LeagueContext';
import { api } from '../api';
import { colors } from '../theme';

// "Put this player on the block" across every league you roster him in. Each league shows its format
// (lineup / scoring / superflex / TE-prem) + your team's outlook there, so you can decide WHERE to
// shop him. Leagues where he's already on your block show pre-checked and locked ("On block"). Check
// any others and confirm — he's ADDED to those leagues' bait alongside whatever's already listed
// (read-modify-write on the backend, so existing players + picks + your asking note are preserved).
export default function TradeBaitSheet({ player, onClose, onDone }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(new Set()); // leagueIds newly checked to ADD (excludes already-on-block)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    api.tradebaitForPlayer(player.id)
      .then((d) => { setData(d); setSelected(new Set()); })
      .catch((e) => setError(e.message || 'Could not load your leagues.'));
  }, [player.id]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function submit() {
    setBusy(true);
    const ids = [...selected];
    try {
      // Add sequentially-ish (Promise.all) — each is a read-modify-write against that league's block.
      const results = await Promise.allSettled(ids.map((leagueId) => api.addBait(leagueId, player.id)));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      if (ok === 0) {
        // Total failure — do NOT report success or dismiss; let the user retry with the sheet intact.
        const first = results.find((r) => r.status === 'rejected');
        appAlert('Couldn’t update block', (first && first.reason && first.reason.message) || `Couldn’t add ${player.name} to your block. Try again.`);
        return;
      }
      appAlert('On the block', `${player.name} added to your block in ${ok} of ${ids.length} league${ids.length === 1 ? '' : 's'}.`);
      onDone();
    } catch (e) {
      appAlert('Could not update block', e.message);
    } finally {
      setBusy(false);
    }
  }

  const eligible = data ? data.leagues.filter((l) => !l.onBait) : [];

  return (
    <BottomSheet onClose={onClose}>
      <Text style={styles.sheetTitle}>Shop {player.name}</Text>
      <Text style={styles.sheetSub}>Put him on your trade block in the leagues you choose.</Text>
      {error ? (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
          <Text style={styles.empty}>{error}</Text>
          <Pressable style={({ pressed }) => [styles.retry, pressed && { opacity: 0.85 }]} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} style={{ paddingVertical: 24 }} />
      ) : data.leagues.length === 0 ? (
        <Text style={styles.empty}>You don’t roster {player.name} in any league.</Text>
      ) : (
        <>
          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 4 }}>
            {data.leagues.map((l) => {
              const already = !!l.onBait;
              const on = already || selected.has(l.leagueId);
              return (
                <Pressable
                  key={l.leagueId}
                  style={styles.row}
                  onPress={() => (already ? null : toggle(l.leagueId))}
                  disabled={already}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: already }}
                  accessibilityLabel={already ? `${l.name}, already on the block` : l.name}
                >
                  <View style={styles.rowHead}>
                    <Checkbox checked={on} size={24} locked={already} style={styles.check} />
                    <Text style={styles.leagueName} numberOfLines={1}>{l.name}</Text>
                    {already ? <Text style={styles.onBlock}>On block</Text> : null}
                  </View>
                  {l.context ? <View style={styles.ctxWrap}><LeagueContext context={l.context} /></View> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            style={({ pressed }) => [styles.confirm, (!selected.size || busy) && styles.confirmOff, pressed && selected.size && { opacity: 0.85 }]}
            onPress={submit}
            disabled={!selected.size || busy}
          >
            {busy ? <ActivityIndicator color={colors.onAccent} /> : (
              <Text style={styles.confirmText}>
                {selected.size ? `Add to block in ${selected.size} league${selected.size === 1 ? '' : 's'}` : eligible.length ? 'Check a league to shop him' : 'Already on the block everywhere'}
              </Text>
            )}
          </Pressable>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sheetSub: { color: colors.textDim, fontSize: 13, marginTop: 3, marginBottom: 8 },
  empty: { color: colors.textDim, fontSize: 14, paddingVertical: 20, textAlign: 'center' },
  retry: { marginTop: 12, backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 11, minHeight: 44, justifyContent: 'center' },
  retryText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowHead: { flexDirection: 'row', alignItems: 'center' },
  check: { marginRight: 12 },
  leagueName: { color: colors.text, fontSize: 15, fontWeight: '800', flex: 1 },
  onBlock: { color: colors.accent, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  ctxWrap: { marginLeft: 36, marginTop: 6 },
  confirm: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  confirmOff: { backgroundColor: colors.cardAlt },
  confirmText: { color: colors.onAccent, fontSize: 16, fontWeight: '900' },
});
