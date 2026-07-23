import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import useAndroidBack from '../useAndroidBack';
import { peekResource, primeResource } from '../useCachedResource';

// Cache keys for the survive-remount store: seed instantly on reopen (this screen is an overlay,
// so it unmounts on back) and prime on every load, then revalidate in the background.
const BLOCK_KEY = 'block:mine';
const MARKET_KEY = 'block:market';

const NOTE_MAX = 120;

// Centralized trade bait: every player you're shopping, grouped by league, with value /
// slot / an asking-price note and a jump to that league's trade desk to actually build
// the offer. Add players to the block from a roster (the ⇄ Block toggle on each player).
export default function OnTheBlockScreen({ onBack, onShopLeague, onOpenPlayer, onShopPlayer, onOpenInbox }) {
  const [segment, setSegment] = useState('block'); // 'block' (mine) | 'market' (rivals)
  // Seed from the survive-remount cache so reopening paints instantly instead of a cold spinner.
  const [data, setData] = useState(() => (peekResource(BLOCK_KEY) ? peekResource(BLOCK_KEY).value : null));
  const [market, setMarket] = useState(() => (peekResource(MARKET_KEY) ? peekResource(MARKET_KEY).value : null));
  const [loading, setLoading] = useState(() => !peekResource(BLOCK_KEY));
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
      const d = await api.tradeBait();
      setData(d);
      primeResource(BLOCK_KEY, d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // The market (rivals' blocks) revalidates the first time you open that tab this mount — even if it
  // painted instantly from the seeded cache — so a stale seed refreshes without a spinner.
  const loadMarket = useCallback(async () => {
    setError(null);
    try {
      const m = await api.tradeMarket();
      setMarket(m);
      primeResource(MARKET_KEY, m);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  const marketOnce = useRef(false);
  useEffect(() => { if (segment === 'market' && !marketOnce.current) { marketOnce.current = true; loadMarket(); } }, [segment, loadMarket]);

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
        {onOpenInbox ? (
          <Pressable onPress={onOpenInbox} hitSlop={10}>
            <Text style={styles.inboxLink}>Inbox ›</Text>
          </Pressable>
        ) : <View style={{ width: 60 }} />}
      </View>
      <View style={styles.segment}>
        {[['block', 'My Block'], ['market', 'Market']].map(([k, label]) => (
          <Pressable key={k} onPress={() => setSegment(k)} style={[styles.seg, segment === k && styles.segOn]}>
            <Text style={[styles.segTxt, segment === k && styles.segTxtOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {segment === 'block' && totals && totals.count > 0 ? (
        <Text style={styles.subtitle}>
          {totals.count} asset{totals.count === 1 ? '' : 's'} shopped across {totals.leagues} league{totals.leagues === 1 ? '' : 's'}
          <Text style={{ color: colors.gold, fontWeight: '800' }}>{`  ·  ${totals.value} value`}</Text>
        </Text>
      ) : null}

      {segment === 'block' ? (
        loading ? (
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
                {lg.note ? <Text style={styles.leagueNote} numberOfLines={2}>{`Asking: ${lg.note}`}</Text> : null}
                {lg.players.map((p) => {
                  const isPick = p.kind === 'pick';
                  return (
                    <View key={p.id} style={styles.playerBlock}>
                      <View style={styles.playerRow}>
                        <Pressable
                          style={styles.blockIdentity}
                          onPress={!isPick && onOpenPlayer ? () => onOpenPlayer(p.id) : undefined}
                          disabled={isPick || !onOpenPlayer}
                        >
                          <View style={[styles.dot, { backgroundColor: isPick ? colors.accent : positionColors[p.position] || colors.textDim }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.playerName} numberOfLines={1}>
                              {p.name}
                              {p.stale ? <Text style={styles.stale}>  · no longer rostered</Text> : null}
                            </Text>
                            <Text style={styles.playerMeta} numberOfLines={1}>
                              {isPick ? 'Draft pick' : [p.position, p.bucket, p.age != null ? `${p.age}y` : null].filter(Boolean).join(' · ')}
                            </Text>
                          </View>
                          {p.value != null ? <Text style={styles.playerVal}>{p.value}</Text> : null}
                        </Pressable>
                        <Pressable onPress={() => removeOne(lg.leagueId, p)} hitSlop={8} style={styles.remove} disabled={busy === `${lg.leagueId}:${p.id}`}>
                          {busy === `${lg.leagueId}:${p.id}` ? <ActivityIndicator size="small" color={colors.textDim} /> : <Text style={styles.removeTxt}>✕</Text>}
                        </Pressable>
                      </View>
                      {/* Per-player note + rival fits are player-only (picks carry no roster fit, and MFL's
                          asking-price note is per-league — shown above). */}
                      {!isPick ? (
                        <Pressable style={({ pressed }) => [styles.noteRow, pressed && { opacity: 0.7 }]} onPress={() => openEditor(lg.leagueId, p)}>
                          {p.note ? (
                            <Text style={styles.noteText} numberOfLines={2}>{`“${p.note}”`}<Text style={styles.noteEdit}>  ✎</Text></Text>
                          ) : (
                            <Text style={styles.noteAdd}>+ Asking price / target</Text>
                          )}
                        </Pressable>
                      ) : null}
                      {!isPick && p.suggestions && p.suggestions.length ? (
                        <View style={styles.fitRow}>
                          <Text style={styles.fitLabel}>Best fits</Text>
                          <View style={styles.fitChips}>
                            {p.suggestions.map((s, si) => {
                              const Chip = onShopPlayer ? Pressable : View;
                              const chipProps = onShopPlayer
                                ? { onPress: () => onShopPlayer({ leagueId: lg.leagueId, name: lg.name, sendPlayerId: p.id, partnerFranchiseId: s.franchiseId }) }
                                : {};
                              return (
                                <Chip key={si} style={({ pressed }) => [styles.fitChip, pressed && { opacity: 0.7 }]} {...chipProps}>
                                  <Text style={styles.fitChipName} numberOfLines={1}>{s.name}</Text>
                                  <Text style={styles.fitChipReason} numberOfLines={1}>{s.reason}{onShopPlayer ? '  ›' : ''}</Text>
                                </Chip>
                              );
                            })}
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>Nobody on the block</Text>
                <Text style={styles.emptyText}>Nothing on your MFL trade bait right now. Add players from any league's roster (⇄ Block) or set bait on MFL — it'll all show here.</Text>
              </View>
            }
          />
        )
      ) : market == null && !error ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error && !market ? (
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
      ) : (
        <FlatList
          data={(market && market.leagues) || []}
          keyExtractor={(l) => l.leagueId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMarket(); }} tintColor={colors.accent} />}
          renderItem={({ item: lg }) => (
            <View style={styles.card}>
              <Pressable style={({ pressed }) => [styles.leagueRow, pressed && { opacity: 0.7 }]} onPress={() => onShopLeague({ leagueId: lg.leagueId, name: lg.name })}>
                <Text style={styles.leagueName} numberOfLines={1}>{lg.name}</Text>
                <Text style={styles.shopLink}>Shop ›</Text>
              </Pressable>
              {lg.teams.map((team) => (
                <View key={team.franchiseId} style={styles.teamBlock}>
                  <View style={styles.teamHead}>
                    <Text style={styles.teamName} numberOfLines={1}>{team.name}</Text>
                    <Text style={styles.teamVal}>{team.value}</Text>
                  </View>
                  {team.note ? <Text style={styles.teamNote} numberOfLines={2}>{`Wants: ${team.note}`}</Text> : null}
                  <View style={styles.assetWrap}>
                    {team.assets.map((a) => {
                      const isPick = a.kind === 'pick';
                      const Chip = !isPick && onOpenPlayer ? Pressable : View;
                      const chipProps = !isPick && onOpenPlayer ? { onPress: () => onOpenPlayer(a.id) } : {};
                      return (
                        <Chip key={a.id} style={({ pressed }) => [styles.assetChip, pressed && { opacity: 0.7 }]} {...chipProps}>
                          <View style={[styles.assetDot, { backgroundColor: isPick ? colors.accent : positionColors[a.position] || colors.textDim }]} />
                          <Text style={styles.assetName} numberOfLines={1}>{a.name.split(',')[0]}</Text>
                          {a.value != null ? <Text style={styles.assetVal}>{a.value}</Text> : null}
                        </Chip>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No one's shopping</Text>
              <Text style={styles.emptyText}>No other team has anything on their MFL trade bait across your leagues right now.</Text>
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
  inboxLink: { color: colors.accent, fontSize: 14, fontWeight: '800', width: 60, textAlign: 'right' },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4 },
  syncNote: { color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 2, opacity: 0.7 },
  segment: { flexDirection: 'row', marginHorizontal: 16, marginTop: 10, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3 },
  seg: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segOn: { backgroundColor: colors.cardAlt },
  segTxt: { color: colors.textDim, fontSize: 13, fontWeight: '800' },
  segTxtOn: { color: colors.text },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  leagueNote: { color: colors.textDim, fontSize: 12, fontStyle: 'italic', marginBottom: 8, lineHeight: 16 },
  // Market (rivals' blocks)
  teamBlock: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  teamHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  teamName: { color: colors.text, fontSize: 14, fontWeight: '800', flex: 1, marginRight: 10 },
  teamVal: { color: colors.gold, fontSize: 14, fontWeight: '900' },
  teamNote: { color: colors.textDim, fontSize: 12, fontStyle: 'italic', marginTop: 3, lineHeight: 16 },
  assetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  assetChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardAlt, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 9, paddingVertical: 6, gap: 6 },
  assetDot: { width: 7, height: 7, borderRadius: 4 },
  assetName: { color: colors.text, fontSize: 12, fontWeight: '700', maxWidth: 130 },
  assetVal: { color: colors.gold, fontSize: 11, fontWeight: '800' },
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
  fitChips: { flex: 1, gap: 6 },
  fitChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cardAlt, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 7, gap: 8 },
  fitChipName: { color: colors.text, fontSize: 12, fontWeight: '800', flexShrink: 0 },
  fitChipReason: { color: colors.textDim, fontSize: 11, flexShrink: 1, textAlign: 'right' },
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
