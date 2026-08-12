import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import ListSkeleton from '../components/ListSkeleton';
import { appAlert } from "../components/AppAlert";
import { api } from '../api';
import { colors } from '../theme';
import { TopbarTitle } from '../components/Brand';
import Button from '../components/Button';
import ErrorView from '../components/ErrorView';
import NeonSign from '../components/NeonSign';
import useAndroidBack from '../useAndroidBack';
import useCachedResource, { primeResource } from '../useCachedResource';
import { STALE } from '../staleTiers';

// The trophy case: every podium finish the owner has earned, across leagues and past seasons — gold
// (champion), silver (runner-up), and bronze (3rd). Each trophy shows the team, league, year, and its
// medal. Add by hand or auto-detect from MFL's playoff history; long-press to remove.

// Podium finish → its medal treatment. `neon` is the NeonSign color key (gold/silver/bronze), `hex`
// tints the card's top border + year, `label` names the finish with an EXPLICIT ordinal (1st/2nd/3rd)
// so the place reads at a glance, not just from the medal color. 1 defaults for any legacy trophy
// without a place.
const MEDAL = {
  1: { neon: 'gold', hex: colors.gold, label: '1st · Champion', short: '1st' },
  2: { neon: 'silver', hex: colors.silver, label: '2nd · Runner-up', short: '2nd' },
  3: { neon: 'bronze', hex: colors.bronze, label: '3rd · Third place', short: '3rd' },
};
const medalFor = (place) => MEDAL[place] || MEDAL[1];

function TrophyCard({ trophy, onRemove }) {
  const m = medalFor(trophy.place);
  return (
    <Pressable
      style={[styles.card, { borderTopColor: m.hex }]}
      onLongPress={() => onRemove(trophy)}
      delayLongPress={350}
    >
      <NeonSign glyph="trophy" color={m.neon} grade="inline" size={40} style={styles.cup} />
      <Text style={[styles.medalLabel, { color: m.hex }]}>{m.label}</Text>
      <Text style={[styles.year, { color: m.hex }]}>{trophy.year}</Text>
      <Text style={styles.team} numberOfLines={2}>{trophy.team}</Text>
      <Text style={styles.league} numberOfLines={2}>{trophy.leagueName}</Text>
    </Pressable>
  );
}

export default function TrophyCaseScreen({ onBack }) {
  // The trophy case is history — it changes only when you add an award. Trust it for hours; an add
  // marks it stale immediately (markAllStale) so a new trophy still shows on the next open.
  const { data, error, refreshing, loading, reload, setData } = useCachedResource('trophies', () => api.trophies(), { staleMs: STALE.STATIC });
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  // A write returns the fresh { trophies, summary } — paint it now and keep the cached snapshot in
  // sync so returning to the case shows the change without a refetch flash.
  const apply = (res) => { setData(res); primeResource('trophies', res); };

  const [adding, setAdding] = useState(false);
  const [team, setTeam] = useState('');
  const [leagueName, setLeagueName] = useState('');
  const [year, setYear] = useState('');
  const [place, setPlace] = useState(1); // 1 champion · 2 runner-up · 3 third
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);

  async function detect() {
    setDetecting(true);
    try {
      const res = await api.detectTrophies();
      apply(res);
      const n = (res.added || []).length;
      const fixed = (res.corrected || []).length; // medals re-graded on a re-scan (e.g. gold → silver)
      // The scan couldn't read every season (MFL throttled a few) — invite one more tap so the owner
      // isn't left with a silently-incomplete case.
      const partialNote = res.partial ? '\n\nSome seasons couldn’t be read just now — tap “Find my titles” again to finish.' : '';
      if (n) {
        const lines = res.added.map((t) => `${medalFor(t.place).label} · ${t.year} · ${t.leagueName}`).join('\n');
        appAlert(`Found ${n} finish${n === 1 ? '' : 'es'}!`, (fixed ? `${lines}\n\n(Also corrected ${fixed} medal${fixed === 1 ? '' : 's'} to the right place.)` : lines) + partialNote);
      } else if (fixed) {
        const lines = res.corrected.map((t) => `${medalFor(t.place).label} · ${t.year} · ${t.leagueName}`).join('\n');
        appAlert(`Corrected ${fixed} medal${fixed === 1 ? '' : 's'}`, `Re-graded to the right podium finish:\n${lines}${partialNote}`);
      } else if (res.partial) {
        appAlert('Some seasons couldn’t be read', 'A few seasons didn’t load just now (MyFantasyLeague was busy). Tap “Find my titles” again to finish the scan.');
      } else {
        appAlert('All caught up', 'No new podium finishes found in your MyFantasyLeague playoff history.');
      }
    } catch (e) {
      appAlert('Could not scan', e.message);
    } finally {
      setDetecting(false);
    }
  }

  const trophies = (data && data.trophies) || [];
  const summary = data && data.summary;

  async function submit() {
    if (!team.trim() || !leagueName.trim() || !/^\d{4}$/.test(year.trim())) {
      appAlert('Add a title', 'Enter a team, a league, and a 4-digit year.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.addTrophy({ team: team.trim(), leagueName: leagueName.trim(), year: Number(year.trim()), place });
      apply(res);
      setAdding(false);
      setTeam(''); setLeagueName(''); setYear(''); setPlace(1);
    } catch (e) {
      appAlert('Could not add', e.message);
    } finally {
      setSaving(false);
    }
  }

  function confirmRemove(trophy) {
    appAlert('Remove trophy?', `${trophy.year} · ${trophy.leagueName}`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await api.removeTrophy(trophy.id);
            apply(res);
          } catch (e) {
            appAlert('Could not remove', e.message);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Profile</Text></Pressable>
        <TopbarTitle>Trophy Case</TopbarTitle>
        <Pressable onPress={() => setAdding(true)} hitSlop={10} style={styles.addBtn}><Text style={styles.addBtnText}>＋ Add</Text></Pressable>
      </View>

      {summary && summary.total ? (
        <Text style={styles.subtitle}>
          {[
            // Titles first (fall back to total for a pre-podium cached summary), then silver/bronze only
            // when present — so a champions-only case still reads "N titles", not "N titles · 0 · 0".
            `${summary.titles != null ? summary.titles : summary.total} title${(summary.titles != null ? summary.titles : summary.total) === 1 ? '' : 's'}`,
            summary.silver ? `${summary.silver} silver` : null,
            summary.bronze ? `${summary.bronze} bronze` : null,
            `${summary.leagues} league${summary.leagues === 1 ? '' : 's'}`,
            summary.latest ? `latest ${summary.latest}` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      {!loading && !error ? (
        <Pressable onPress={detect} disabled={detecting} style={({ pressed }) => [styles.detectBtn, pressed && { opacity: 0.85 }]}>
          {detecting ? <ActivityIndicator color={colors.accent} /> : (
            <View style={styles.detectRow}>
              <NeonSign glyph="search" color="accent" grade="inline" size={15} />
              <Text style={styles.detectText}>Find my titles from MyFantasyLeague</Text>
            </View>
          )}
        </Pressable>
      ) : null}

      {loading ? (
        <ListSkeleton rows={6} />
      ) : error ? (
        <ErrorView message={error} onRetry={reload} refreshing={refreshing} onRefresh={reload} />
      ) : !trophies.length ? (
        <FlatList
          key="trophies-empty"
          data={[]}
          renderItem={null}
          keyExtractor={() => 'x'}
          contentContainerStyle={styles.center}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <NeonSign glyph="trophy" color="gold" grade="inline" size={64} style={styles.emptyCup} />
              <Text style={styles.emptyTitle}>No trophies yet</Text>
              <Text style={styles.emptyText}>Add a championship you’ve won — team, league, and year. Every title, all in one case.</Text>
              <Button title="Add your first title" onPress={() => setAdding(true)} />
            </View>
          }
        />
      ) : (
        <FlatList
          key="trophies-grid"
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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Add a trophy</Text>
            <Text style={styles.label}>Finish</Text>
            <View style={styles.placeRow}>
              {[1, 2, 3].map((pl) => {
                const m = medalFor(pl);
                const on = place === pl;
                return (
                  <Pressable
                    key={pl}
                    onPress={() => setPlace(pl)}
                    style={[styles.placeChip, on && { borderColor: m.hex, backgroundColor: m.hex + '22' }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <NeonSign glyph="trophy" color={m.neon} grade="inline" size={16} />
                    <Text style={[styles.placeChipText, on && { color: m.hex }]}>{m.short}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.label}>Team name</Text>
            <TextInput style={styles.input} value={team} onChangeText={setTeam} placeholder="Your team's name" placeholderTextColor={colors.textDim} />
            <Text style={styles.label}>League</Text>
            <TextInput style={styles.input} value={leagueName} onChangeText={setLeagueName} placeholder="League name" placeholderTextColor={colors.textDim} />
            <Text style={styles.label}>Year</Text>
            <TextInput style={styles.input} value={year} onChangeText={setYear} placeholder="e.g. 2024" placeholderTextColor={colors.textDim} keyboardType="number-pad" maxLength={4} />
            <View style={styles.sheetActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setAdding(false)} style={{ flex: 1 }} />
              <Button title="Add trophy" onPress={submit} busy={saving} style={{ flex: 1 }} />
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
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  back: { color: colors.accent, fontSize: 15, fontWeight: '700', minWidth: 74 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  addBtn: { width: 74, alignItems: 'flex-end' },
  addBtnText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  subtitle: { color: colors.textDim, fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  detectBtn: { marginHorizontal: 12, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingVertical: 11, alignItems: 'center' },
  detectRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detectText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },

  grid: { padding: 12, paddingBottom: 40 },
  row: { gap: 12, marginBottom: 12 },
  card: { flex: 1, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, borderTopColor: colors.gold, borderTopWidth: 3, padding: 16, alignItems: 'center' },
  cup: { marginBottom: 4 },
  medalLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 4 },
  year: { color: colors.gold, fontSize: 15, fontWeight: '900', marginTop: 2, fontVariant: ['tabular-nums'] },
  team: { color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  league: { color: colors.textDim, fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 2 },
  hint: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 6, fontStyle: 'italic' },

  empty: { alignItems: 'center', paddingHorizontal: 20 },
  emptyCup: { marginBottom: 12 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  emptyAdd: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  emptyAddText: { color: colors.onAccent, fontWeight: '800', fontSize: 14 },

  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', paddingHorizontal: 24 },
  sheet: { backgroundColor: colors.bg, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 18 },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 12 },
  label: { color: colors.violetText, fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10 },
  placeRow: { flexDirection: 'row', gap: 8 },
  placeChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingVertical: 9, paddingHorizontal: 4 },
  placeChipText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  act: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cancel: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  save: { backgroundColor: colors.accent },
  saveText: { color: colors.onAccent, fontWeight: '800', fontSize: 14 },
});
