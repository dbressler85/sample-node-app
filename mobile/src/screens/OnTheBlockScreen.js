import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import useAndroidBack from '../useAndroidBack';

const NOTE_MAX = 120;

// Centralized trade bait: every player you're shopping, grouped by league, with value /
// slot / an asking-price note and a jump to that league's trade desk to actually build
// the offer. Add players to the block from a roster (the ⇄ Block toggle on each player).
export default function OnTheBlockScreen({ onBack, onShopLeague, onOpenPlayer }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // `${leagueId}:${playerId}` being removed
  const [editing, setEditing] = useState(null); // { leagueId, player } whose note is open
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useAndroidBack(useCallback(() => {
    if (editing) { setEditing(null); return true; }
    onBack();
    return true;
  }, [editing, onBack]));

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.tradeBait());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function removeOne(leagueId, player) {
    const k = `${leagueId}:${player.id}`;
    setBusy(k);
    try {
      await api.removeBait(leagueId, player.id);
      await load();
    } catch (e) {
      Alert.alert('Could not remove', e.message);
    } finally {
      setBusy(null);
    }
  }

  function openEditor(leagueId, player) {
    setEditing({ leagueId, player });
    setDraft(player.note || '');
  }

  // Re-add with the note — the backend treats add as idempotent-with-note-update and
  // re-syncs the league's bait (IN_EXCHANGE_FOR) to MFL.
  async function saveNote() {
    if (!editing) return;
    setSaving(true);
    try {
      await api.addBait(editing.leagueId, editing.player.id, draft.trim() || null);
      setEditing(null);
      await load();
    } catch (e) {
      Alert.alert('Could not save note', e.message);
    } finally {
      setSaving(false);
    }
  }

  const totals = data && data.totals;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Trades</Text>
        </Pressable>
        <Text style={styles.title}>On the Block</Text>
        <View style={{ width: 60 }} />
      </View>
      {totals && totals.count > 0 ? (
        <>
          <Text style={styles.subtitle}>
            {totals.count} player{totals.count === 1 ? '' : 's'} shopped across {totals.leagues} league{totals.leagues === 1 ? '' : 's'}
            <Text style={{ color: colors.gold, fontWeight: '800' }}>{`  ·  ${totals.value} value`}</Text>
          </Text>
          <Text style={styles.syncNote}>Also posted to each league's MFL Trade Bait board</Text>
        </>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
      ) : (
        <FlatList
          data={(data && data.leagues) || []}
          keyExtractor={(l) => l.leagueId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          renderItem={({ item: lg }) => (
            <View style={styles.card}>
              <Pressable style={({ pressed }) => [styles.leagueRow, pressed && { opacity: 0.7 }]} onPress={() => onShopLeague({ leagueId: lg.leagueId, name: lg.name })}>
                <Text style={styles.leagueName} numberOfLines={1}>{lg.name}</Text>
                <Text style={styles.shopLink}>Shop ›</Text>
              </Pressable>
              {lg.players.map((p) => (
                <View key={p.id} style={styles.playerBlock}>
                  <View style={styles.playerRow}>
                    <Pressable
                      style={styles.blockIdentity}
                      onPress={onOpenPlayer ? () => onOpenPlayer(p.id) : undefined}
                      disabled={!onOpenPlayer}
                    >
                      <View style={[styles.dot, { backgroundColor: positionColors[p.position] || colors.textDim }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.playerName} numberOfLines={1}>
                          {p.name}
                          {p.stale ? <Text style={styles.stale}>  · no longer rostered</Text> : null}
                        </Text>
                        <Text style={styles.playerMeta} numberOfLines={1}>
                          {[p.position, p.bucket, p.age != null ? `${p.age}y` : null].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      {p.value != null ? <Text style={styles.playerVal}>{p.value}</Text> : null}
                    </Pressable>
                    <Pressable onPress={() => removeOne(lg.leagueId, p)} hitSlop={8} style={styles.remove} disabled={busy === `${lg.leagueId}:${p.id}`}>
                      {busy === `${lg.leagueId}:${p.id}` ? <ActivityIndicator size="small" color={colors.textDim} /> : <Text style={styles.removeTxt}>✕</Text>}
                    </Pressable>
                  </View>
                  <Pressable style={({ pressed }) => [styles.noteRow, pressed && { opacity: 0.7 }]} onPress={() => openEditor(lg.leagueId, p)}>
                    {p.note ? (
                      <Text style={styles.noteText} numberOfLines={2}>{`“${p.note}”`}<Text style={styles.noteEdit}>  ✎</Text></Text>
                    ) : (
                      <Text style={styles.noteAdd}>+ Asking price / target</Text>
                    )}
                  </Pressable>
                  {p.suggestions && p.suggestions.length ? (
                    <View style={styles.fitRow}>
                      <Text style={styles.fitLabel}>Best fits</Text>
                      <Text style={styles.fitText} numberOfLines={2}>
                        {p.suggestions.map((s) => `${s.name} (${s.reason})`).join(' · ')}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>Nobody on the block</Text>
              <Text style={styles.emptyText}>Open any league's roster and tap ⇄ Block on a player to start shopping him. They'll all show up here.</Text>
            </View>
          }
        />
      )}

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.backdrop} onPress={() => (saving ? null : setEditing(null))}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{editing ? editing.player.name : ''}</Text>
              <Text style={styles.sheetSub}>What you're asking in return (shown to your league on MFL as your bait).</Text>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={(t) => setDraft(t.slice(0, NOTE_MAX))}
                placeholder="e.g. a 1st + a young WR"
                placeholderTextColor={colors.textDim}
                multiline
                autoFocus
                maxLength={NOTE_MAX}
              />
              <Text style={styles.counter}>{draft.length}/{NOTE_MAX}</Text>
              <View style={styles.sheetActions}>
                <Pressable style={[styles.sheetBtn, styles.cancel]} onPress={() => setEditing(null)} disabled={saving}>
                  <Text style={styles.cancelTxt}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.sheetBtn, styles.save]} onPress={saveNote} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>{draft.trim() ? 'Save' : 'Clear note'}</Text>}
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4 },
  syncNote: { color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 2, opacity: 0.7 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  leagueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, marginBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  leagueName: { color: colors.text, fontSize: 13, fontWeight: '800', letterSpacing: 0.3, flex: 1, marginRight: 10, textTransform: 'uppercase' },
  shopLink: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  playerBlock: { paddingVertical: 4 },
  playerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  blockIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  playerName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  stale: { color: colors.warn, fontSize: 12, fontWeight: '700' },
  playerMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  playerVal: { color: colors.gold, fontSize: 15, fontWeight: '900', marginRight: 12, minWidth: 30, textAlign: 'right' },
  remove: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  removeTxt: { color: colors.textDim, fontSize: 16, fontWeight: '800' },
  noteRow: { marginLeft: 18, marginTop: 2, marginBottom: 4 },
  noteText: { color: colors.text, fontSize: 13, fontStyle: 'italic', lineHeight: 18 },
  noteEdit: { color: colors.accent, fontStyle: 'normal', fontWeight: '800' },
  noteAdd: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  fitRow: { flexDirection: 'row', alignItems: 'flex-start', marginLeft: 18, marginBottom: 8, marginTop: 2, gap: 8 },
  fitLabel: { color: colors.accent, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 },
  fitText: { color: colors.textDim, fontSize: 12, flex: 1, lineHeight: 16 },
  error: { color: colors.bad, textAlign: 'center' },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', paddingHorizontal: 24, lineHeight: 20 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 },
  sheet: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 18 },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sheetSub: { color: colors.textDim, fontSize: 13, marginTop: 4, marginBottom: 14, lineHeight: 18 },
  input: { backgroundColor: colors.cardAlt, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 15, padding: 12, minHeight: 72, textAlignVertical: 'top' },
  counter: { color: colors.textDim, fontSize: 11, textAlign: 'right', marginTop: 4 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  sheetBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  cancel: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  cancelTxt: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
  save: { backgroundColor: colors.accent },
  saveTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
