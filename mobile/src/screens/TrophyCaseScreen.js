import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, RefreshControl, Modal, TextInput, Alert } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import ErrorView from '../components/ErrorView';
import useAndroidBack from '../useAndroidBack';
import useCachedResource, { primeResource } from '../useCachedResource';

// The trophy case: every championship the owner has won, across leagues and past seasons. Each
// trophy shows the team, league, and year. Add a title by hand (auto-detect from MFL's playoff
// history is a planned follow-up); long-press to remove. Gold-forward — this is the brag shelf.

function TrophyCard({ trophy, onRemove }) {
  return (
    <Pressable
      style={styles.card}
      onLongPress={() => onRemove(trophy)}
      delayLongPress={350}
    >
      <Text style={styles.cup}>🏆</Text>
      <Text style={styles.year}>{trophy.year}</Text>
      <Text style={styles.team} numberOfLines={2}>{trophy.team}</Text>
      <Text style={styles.league} numberOfLines={2}>{trophy.leagueName}</Text>
    </Pressable>
  );
}

export default function TrophyCaseScreen({ onBack }) {
  const { data, error, refreshing, loading, reload, setData } = useCachedResource('trophies', () => api.trophies());
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  // A write returns the fresh { trophies, summary } — paint it now and keep the cached snapshot in
  // sync so returning to the case shows the change without a refetch flash.
  const apply = (res) => { setData(res); primeResource('trophies', res); };

  const [adding, setAdding] = useState(false);
  const [team, setTeam] = useState('');
  const [leagueName, setLeagueName] = useState('');
  const [year, setYear] = useState('');
  const [saving, setSaving] = useState(false);

  const trophies = (data && data.trophies) || [];
  const summary = data && data.summary;

  async function submit() {
    if (!team.trim() || !leagueName.trim() || !/^\d{4}$/.test(year.trim())) {
      Alert.alert('Add a title', 'Enter a team, a league, and a 4-digit year.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.addTrophy({ team: team.trim(), leagueName: leagueName.trim(), year: Number(year.trim()) });
      apply(res);
      setAdding(false);
      setTeam(''); setLeagueName(''); setYear('');
    } catch (e) {
      Alert.alert('Could not add', e.message);
    } finally {
      setSaving(false);
    }
  }

  function confirmRemove(trophy) {
    Alert.alert('Remove trophy?', `${trophy.year} · ${trophy.leagueName}`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await api.removeTrophy(trophy.id);
            apply(res);
          } catch (e) {
            Alert.alert('Could not remove', e.message);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Profile</Text></Pressable>
        <Text style={styles.title}>Trophy Case</Text>
        <Pressable onPress={() => setAdding(true)} hitSlop={10} style={styles.addBtn}><Text style={styles.addBtnText}>＋ Add</Text></Pressable>
      </View>

      {summary && summary.total ? (
        <Text style={styles.subtitle}>
          {summary.total} title{summary.total === 1 ? '' : 's'} · {summary.leagues} league{summary.leagues === 1 ? '' : 's'}
          {summary.latest ? ` · latest ${summary.latest}` : ''}
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <ErrorView message={error} onRetry={reload} refreshing={refreshing} onRefresh={reload} />
      ) : !trophies.length ? (
        <FlatList
          data={[]}
          renderItem={null}
          keyExtractor={() => 'x'}
          contentContainerStyle={styles.center}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyCup}>🏆</Text>
              <Text style={styles.emptyTitle}>No trophies yet</Text>
              <Text style={styles.emptyText}>Add a championship you’ve won — team, league, and year. Every title, all in one case.</Text>
              <Pressable onPress={() => setAdding(true)} style={styles.emptyAdd}><Text style={styles.emptyAddText}>＋ Add your first title</Text></Pressable>
            </View>
          }
        />
      ) : (
        <FlatList
          data={trophies}
          keyExtractor={(t) => t.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
          renderItem={({ item }) => <TrophyCard trophy={item} onRemove={confirmRemove} />}
          ListFooterComponent={<Text style={styles.hint}>Long-press a trophy to remove it.</Text>}
        />
      )}

      {/* Add-a-title modal. */}
      <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
        <Pressable style={styles.scrim} onPress={() => setAdding(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Add a championship</Text>
            <Text style={styles.label}>Team name</Text>
            <TextInput style={styles.input} value={team} onChangeText={setTeam} placeholder="Your team's name" placeholderTextColor={colors.textDim} />
            <Text style={styles.label}>League</Text>
            <TextInput style={styles.input} value={leagueName} onChangeText={setLeagueName} placeholder="League name" placeholderTextColor={colors.textDim} />
            <Text style={styles.label}>Year won</Text>
            <TextInput style={styles.input} value={year} onChangeText={setYear} placeholder="e.g. 2024" placeholderTextColor={colors.textDim} keyboardType="number-pad" maxLength={4} />
            <View style={styles.sheetActions}>
              <Pressable style={[styles.act, styles.cancel]} onPress={() => setAdding(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable style={[styles.act, styles.save]} onPress={submit} disabled={saving}>
                {saving ? <ActivityIndicator color="#1a1300" /> : <Text style={styles.saveText}>Add title</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  back: { color: colors.accent, fontSize: 15, fontWeight: '700', width: 74 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  addBtn: { width: 74, alignItems: 'flex-end' },
  addBtnText: { color: colors.gold, fontSize: 14, fontWeight: '800' },
  subtitle: { color: colors.textDim, fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },

  grid: { padding: 12, paddingBottom: 40 },
  row: { gap: 12, marginBottom: 12 },
  card: { flex: 1, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, borderTopColor: colors.gold, borderTopWidth: 3, padding: 16, alignItems: 'center' },
  cup: { fontSize: 40 },
  year: { color: colors.gold, fontSize: 15, fontWeight: '900', marginTop: 6, fontVariant: ['tabular-nums'] },
  team: { color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  league: { color: colors.textDim, fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 2 },
  hint: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 6, fontStyle: 'italic' },

  empty: { alignItems: 'center', paddingHorizontal: 20 },
  emptyCup: { fontSize: 52, marginBottom: 10, opacity: 0.9 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  emptyAdd: { backgroundColor: colors.gold, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  emptyAddText: { color: '#1a1300', fontWeight: '800', fontSize: 14 },

  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', paddingHorizontal: 24 },
  sheet: { backgroundColor: colors.bg, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 18 },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 12 },
  label: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  act: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cancel: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  save: { backgroundColor: colors.gold },
  saveText: { color: '#1a1300', fontWeight: '800', fontSize: 14 },
});
