import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import ErrorView from '../components/ErrorView';
import LeagueContext from '../components/LeagueContext';
import useAndroidBack from '../useAndroidBack';
import { Value } from '../components/Brand';

// The owner's My Draft List for one league — a pre-draft (and during-draft) tool to narrow the
// pool to who you actually want next. MFL auto-picks the top player still available on this list
// when your clock fires (slow/email drafts) — so the ranking IS your pick order. Two panes:
// "My List" (reorder/remove) and "Add players" (value-ranked pool + search). Local edits, one Save.

const POSITIONS = [[null, 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE'], ['K', 'K'], ['DEF', 'DEF']];

export default function DraftListScreen({ league, onBack, onOpenPlayer }) {
  const [data, setData] = useState(null);
  const [list, setList] = useState([]); // local editable ranked list (player objects)
  const [dirty, setDirty] = useState(false);
  const [seg, setSeg] = useState('list'); // 'list' | 'add'
  const [pos, setPos] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useAndroidBack(useCallback(() => {
    if (dirty) { promptDiscard(onBack); return true; }
    onBack();
    return true;
  }, [dirty, onBack]));

  const load = useCallback(() => {
    setLoading(true);
    api.draftList(league.leagueId)
      .then((d) => { setData(d); setList(d.list || []); setDirty(false); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [league.leagueId]);
  useEffect(() => { load(); }, [load]);

  // Debounced search for the Add pane.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      api.playerSearch(q, { position: pos }).then((r) => alive && setResults(r.players || [])).catch(() => alive && setResults([]));
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query, pos]);

  const listIds = useMemo(() => new Set(list.map((p) => String(p.id))), [list]);
  const nextUp = useMemo(() => list.find((p) => !p.drafted) || null, [list]);

  // Edits — all local until Save.
  const add = (p) => {
    if (listIds.has(String(p.id))) return;
    setList((cur) => [...cur, { id: String(p.id), name: p.name, position: p.position, team: p.team, value: p.value, drafted: false }]);
    setDirty(true);
  };
  const remove = (id) => { setList((cur) => cur.filter((p) => String(p.id) !== String(id))); setDirty(true); };
  const move = (id, delta) => setList((cur) => {
    const i = cur.findIndex((p) => String(p.id) === String(id));
    const j = i + delta;
    if (i < 0 || j < 0 || j >= cur.length) return cur;
    const next = [...cur];
    [next[i], next[j]] = [next[j], next[i]];
    setDirty(true);
    return next;
  });
  const toTop = (id) => setList((cur) => {
    const i = cur.findIndex((p) => String(p.id) === String(id));
    if (i <= 0) return cur;
    const next = [...cur];
    const [it] = next.splice(i, 1);
    next.unshift(it);
    setDirty(true);
    return next;
  });
  // Quick-fill: append the top value pool players not already listed, up to `n`.
  const autoFill = (n) => {
    const pool = (data && data.available) || [];
    const add10 = pool.filter((p) => !listIds.has(String(p.id))).slice(0, n)
      .map((p) => ({ id: String(p.id), name: p.name, position: p.position, team: p.team, value: p.value, drafted: false }));
    if (!add10.length) return;
    setList((cur) => [...cur, ...add10]);
    setDirty(true);
  };

  const save = () => {
    setSaving(true);
    api.saveDraftList(league.leagueId, list.map((p) => p.id))
      .then((d) => { setData(d); setList(d.list || []); setDirty(false); })
      .catch((e) => Alert.alert('Could not save your list', e.message))
      .finally(() => setSaving(false));
  };

  const poolAvailable = useMemo(() => {
    const pool = (data && data.available) || [];
    return pool.filter((p) => !listIds.has(String(p.id)) && (!pos || p.position === pos));
  }, [data, listIds, pos]);
  const searchAvailable = useMemo(
    () => (results || []).filter((p) => !listIds.has(String(p.id))),
    [results, listIds]
  );

  if (loading && !data) {
    return (
      <View style={styles.container}>
        <Header league={league} onBack={onBack} />
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      </View>
    );
  }
  if (error && !data) {
    return (
      <View style={styles.container}>
        <Header league={league} onBack={onBack} />
        <ErrorView message={error} onRetry={load} />
      </View>
    );
  }

  const status = (data && data.status) || 'none';
  const onClockMine = !!(data && data.onClock && data.onClock.mine);

  return (
    <View style={styles.container}>
      <Header league={league} onBack={() => (dirty ? promptDiscard(onBack) : onBack())} />

      {/* What this is — pre-draft / during-draft framing */}
      <View style={styles.explain}>
        <Text style={styles.explainText}>
          Rank the players you want. When you’re on the clock — including slow/email drafts — MFL
          auto-drafts the highest player still available on this list. Build it before the draft and
          refine it as picks come off the board.
        </Text>
      </View>

      {/* Live status + who's next off your list */}
      <View style={[styles.statusBar, onClockMine && styles.statusBarLive]}>
        <Text style={[styles.statusLabel, onClockMine && { color: colors.gold }]}>
          {onClockMine
            ? `🟢 You're on the clock · pick ${data.onClock.round}.${String(data.onClock.pick).padStart(2, '0')}`
            : status === 'in_progress'
            ? '⏳ Draft is live'
            : status === 'scheduled'
            ? '🗓 Draft not started'
            : status === 'complete'
            ? '✓ Draft complete'
            : 'No active draft'}
        </Text>
        {nextUp ? (
          <Text style={styles.nextUp} numberOfLines={1}>
            Auto-picks next: <Text style={styles.nextUpName}>{nextUp.name}</Text> ({nextUp.position})
          </Text>
        ) : list.length ? (
          <Text style={styles.nextUp}>Every player on your list is already drafted.</Text>
        ) : (
          <Text style={styles.nextUp}>Your list is empty — add players below.</Text>
        )}
      </View>

      {data && data.context ? (
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <LeagueContext context={data.context} />
        </View>
      ) : null}

      <View style={styles.segment}>
        {[['list', `My List · ${list.length}`], ['add', 'Add players']].map(([k, label]) => (
          <Pressable key={k} style={[styles.seg, seg === k && styles.segActive]} onPress={() => setSeg(k)}>
            <Text style={[styles.segText, seg === k && styles.segTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {seg === 'list' ? (
        <ScrollView contentContainerStyle={styles.list}>
          {!list.length ? (
            <Text style={styles.empty}>No players yet. Switch to “Add players” to build your list, or auto-fill the top available.</Text>
          ) : (
            list.map((p, i) => (
              <ListRow
                key={p.id}
                p={p}
                rank={i + 1}
                first={i === 0}
                last={i === list.length - 1}
                onOpen={() => onOpenPlayer && onOpenPlayer(p.id)}
                onTop={() => toTop(p.id)}
                onUp={() => move(p.id, -1)}
                onDown={() => move(p.id, +1)}
                onRemove={() => remove(p.id)}
              />
            ))
          )}
          {(data && data.available && data.available.length) ? (
            <Pressable style={styles.fillBtn} onPress={() => autoFill(10)}>
              <Text style={styles.fillText}>＋ Auto-fill top 10 available by value</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : (
        <>
          <View style={styles.searchWrap}>
            <TextInput
              style={styles.search}
              placeholder="Search any player to add…"
              placeholderTextColor={colors.textDim}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query ? <Pressable onPress={() => setQuery('')} hitSlop={10}><Text style={styles.clear}>✕</Text></Pressable> : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.posScroll} contentContainerStyle={styles.posRow}>
            {POSITIONS.map(([k, label]) => (
              <Pressable key={label} style={[styles.posChip, pos === k && styles.posChipOn]} onPress={() => setPos(k)}>
                <Text style={[styles.posChipText, pos === k && { color: colors.text }]}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.addHint}>{query.trim().length >= 2 ? 'Search results' : 'Best available (undrafted, not on a roster)'}</Text>
            {(query.trim().length >= 2 ? searchAvailable : poolAvailable).map((p) => (
              <AddRow key={p.id} p={p} onAdd={() => add(p)} onOpen={() => onOpenPlayer && onOpenPlayer(p.id)} />
            ))}
            {!(query.trim().length >= 2 ? searchAvailable : poolAvailable).length ? (
              <Text style={styles.empty}>{query.trim().length >= 2 ? 'No players match — or they’re already on your list.' : 'No more available players to add.'}</Text>
            ) : null}
          </ScrollView>
        </>
      )}

      {/* Save bar */}
      <View style={styles.saveBar}>
        <Text style={styles.saveState}>{dirty ? 'Unsaved changes' : 'Saved to MyFantasyLeague'}</Text>
        <Pressable
          style={({ pressed }) => [styles.saveBtn, (!dirty || saving) && styles.saveBtnOff, pressed && dirty && { opacity: 0.85 }]}
          onPress={save}
          disabled={!dirty || saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save list</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function promptDiscard(onBack) {
  Alert.alert('Discard changes?', 'You have unsaved changes to your draft list.', [
    { text: 'Keep editing', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: onBack },
  ]);
}

function Header({ league, onBack }) {
  return (
    <View style={styles.topbar}>
      <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Back</Text></Pressable>
      <View style={styles.titleWrap}>
        <Text style={styles.title} numberOfLines={1}>My Draft List</Text>
        <Text style={styles.sub} numberOfLines={1}>{league.name}</Text>
      </View>
      <View style={{ width: 54 }} />
    </View>
  );
}

function ListRow({ p, rank, first, last, onOpen, onTop, onUp, onDown, onRemove }) {
  const pc = positionColors[p.position] || colors.textDim;
  return (
    <View style={[styles.row, p.drafted && styles.rowDrafted, { borderLeftColor: pc, borderLeftWidth: 3 }]}>
      <Text style={styles.rank}>{rank}</Text>
      <Pressable style={styles.rowMain} onPress={onOpen}>
        <View style={styles.nameLine}>
          <Text style={[styles.name, p.drafted && styles.struck]} numberOfLines={1}>{p.name}</Text>
          {p.drafted ? <Text style={styles.draftedTag}>DRAFTED</Text> : null}
        </View>
        <Text style={styles.meta}>{p.position}{p.team ? ` · ${p.team}` : ''}{p.value != null ? ` · ${p.value}` : ''}</Text>
      </Pressable>
      <View style={styles.ctrls}>
        <Pressable onPress={onTop} disabled={first} hitSlop={6} style={styles.ctrlBtn}><Text style={[styles.ctrl, first && styles.ctrlOff]}>⤒</Text></Pressable>
        <Pressable onPress={onUp} disabled={first} hitSlop={6} style={styles.ctrlBtn}><Text style={[styles.ctrl, first && styles.ctrlOff]}>↑</Text></Pressable>
        <Pressable onPress={onDown} disabled={last} hitSlop={6} style={styles.ctrlBtn}><Text style={[styles.ctrl, last && styles.ctrlOff]}>↓</Text></Pressable>
        <Pressable onPress={onRemove} hitSlop={6} style={styles.ctrlBtn}><Text style={styles.remove}>✕</Text></Pressable>
      </View>
    </View>
  );
}

function AddRow({ p, onAdd, onOpen }) {
  const pc = positionColors[p.position] || colors.textDim;
  return (
    <View style={[styles.row, { borderLeftColor: pc, borderLeftWidth: 3 }]}>
      <Pressable style={styles.rowMain} onPress={onOpen}>
        <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
        <Text style={styles.meta}>{p.position}{p.team ? ` · ${p.team}` : ''}</Text>
      </Pressable>
      {p.value != null ? <Value size={15}>{p.value}</Value> : null}
      <Pressable onPress={onAdd} hitSlop={6} style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.7 }]}>
        <Text style={styles.addText}>＋ Add</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 54 },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  explain: { marginHorizontal: 16, marginTop: 10, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 11 },
  explainText: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  statusBar: { marginHorizontal: 16, marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 9 },
  statusBarLive: { borderColor: colors.gold, backgroundColor: colors.gold + '14' },
  statusLabel: { color: colors.text, fontSize: 13, fontWeight: '800' },
  nextUp: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  nextUpName: { color: colors.good, fontWeight: '800' },
  segment: { flexDirection: 'row', marginHorizontal: 16, marginTop: 10, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segActive: { backgroundColor: colors.cardAlt },
  segText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  segTextActive: { color: colors.text },
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 11, marginBottom: 8 },
  rowDrafted: { opacity: 0.5 },
  rank: { color: colors.textDim, fontSize: 13, fontWeight: '800', width: 22, textAlign: 'center' },
  rowMain: { flex: 1, marginLeft: 4 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  struck: { textDecorationLine: 'line-through' },
  draftedTag: { color: colors.bad, fontSize: 9, fontWeight: '900', marginLeft: 6, borderWidth: 1, borderColor: colors.bad, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  ctrls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 8 },
  ctrlBtn: { paddingHorizontal: 1 },
  ctrl: { color: colors.accent, fontSize: 17, fontWeight: '800' },
  ctrlOff: { color: colors.border },
  remove: { color: colors.bad, fontSize: 15, fontWeight: '800' },
  addBtn: { borderWidth: 1, borderColor: colors.good, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 10 },
  addText: { color: colors.good, fontSize: 12, fontWeight: '800' },
  fillBtn: { marginTop: 4, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  fillText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  addHint: { color: colors.textDim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 },
  search: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 },
  clear: { color: colors.textDim, fontSize: 15, paddingHorizontal: 6 },
  posScroll: { flexGrow: 0, flexShrink: 0, marginTop: 6 },
  posRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
  posChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 5 },
  posChipOn: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  posChipText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 24, marginHorizontal: 20, fontSize: 13, lineHeight: 19 },
  saveBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
  saveState: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 11, minWidth: 110, alignItems: 'center' },
  saveBtnOff: { backgroundColor: colors.cardAlt },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
