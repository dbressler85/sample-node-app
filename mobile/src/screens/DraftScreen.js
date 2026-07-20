import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import useAndroidBack from '../useAndroidBack';
import usePoll from '../usePoll';

const STATUS = {
  scheduled: { label: 'Scheduled', color: colors.warn },
  in_progress: { label: 'Live', color: colors.good },
  complete: { label: 'Complete', color: colors.textDim },
  none: { label: 'No draft', color: colors.textDim },
};
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return iso;
  }
}

export default function DraftScreen({ league, onBack, onOpenPlayer }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [position, setPosition] = useState(null);
  const [picking, setPicking] = useState(null); // playerId being drafted

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.leagueDraft(league.leagueId));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [league.leagueId]);

  useEffect(() => { load(); }, [load]);
  // While the draft is live, poll so the board and "on the clock" update as other
  // teams pick — without a manual pull. Not while picking (avoids clobbering) or
  // when scheduled/complete.
  usePoll(load, 15000, !!(data && data.status === 'in_progress') && !picking);

  const myTurn = !!(data && data.onClock && data.onClock.mine);

  const pool = useMemo(() => {
    if (!data || !data.available) return [];
    return position ? data.available.filter((p) => p.position === position) : data.available;
  }, [data, position]);

  // A draft pick is irreversible, so confirm before committing (the pool rows now open
  // a profile on tap, and the explicit Draft button routes through here).
  function confirmDraft(p) {
    if (!myTurn || picking != null) return;
    Alert.alert('Draft this player?', `${p.name} — ${p.position}${p.team ? ` · ${p.team}` : ''}${p.value != null ? ` · value ${p.value}` : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Draft', style: 'default', onPress: () => draftPlayer(p) },
    ]);
  }

  async function draftPlayer(p) {
    if (!myTurn) return;
    setPicking(p.id);
    try {
      const res = await api.makeDraftPick(league.leagueId, p.id);
      setData(res);
    } catch (e) {
      Alert.alert('Could not draft', e.message);
    } finally {
      setPicking(null);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.container}>
        <View style={styles.topbar}>
          <Pressable onPress={onBack} hitSlop={10}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{league.name}</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.error}>{error || 'Could not load the draft.'}</Text>
          <Pressable style={styles.retry} onPress={load}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      </View>
    );
  }

  const st = STATUS[(data && data.status) || 'none'] || STATUS.none;
  const recent = data && data.board ? data.board.filter((s) => s.player).slice(-6).reverse() : [];

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{league.name}</Text>
        <View style={{ width: 44 }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {data && data.status === 'none' ? (
        <View style={styles.center}><Text style={styles.empty}>No draft in this league.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <View style={styles.headerRow}>
            <Text style={styles.dtype}>{data.type || 'Draft'}</Text>
            <View style={[styles.badge, { borderColor: st.color }]}>
              <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
            </View>
          </View>
          {data.status === 'scheduled' && data.startTime ? (
            <Text style={styles.sched}>Starts {fmtDate(data.startTime)}</Text>
          ) : null}

          {myTurn ? (
            <View style={styles.clock}>
              <Text style={styles.clockText}>You're on the clock — pick {data.onClock.round}.{String(data.onClock.pick).padStart(2, '0')}</Text>
              <Text style={styles.clockSub}>Tap a player below to draft</Text>
            </View>
          ) : data.onClock ? (
            <Text style={styles.waiting}>On the clock: pick {data.onClock.round}.{String(data.onClock.pick).padStart(2, '0')} (another team)</Text>
          ) : null}

          {/* My picks */}
          {data.myPicks && data.myPicks.length ? (
            <>
              <Text style={styles.section}>My picks</Text>
              {data.myPicks.map((s) => (
                <View key={s.overall} style={styles.pickRow}>
                  <Text style={styles.pickNo}>{s.round}.{String(s.pick).padStart(2, '0')}</Text>
                  {s.player ? (
                    <>
                      <View style={[styles.dot, { backgroundColor: positionColors[s.player.position] || colors.textDim }]} />
                      <Text style={styles.pickName} numberOfLines={1}>{s.player.name}</Text>
                      <Text style={styles.pickMeta}>{s.player.position}{s.player.value != null ? ` · ${s.player.value}` : ''}</Text>
                    </>
                  ) : (
                    <Text style={styles.pickUpcoming}>Upcoming</Text>
                  )}
                </View>
              ))}
            </>
          ) : null}

          {/* Available pool */}
          <Text style={styles.section}>Available · by ADP{myTurn ? ' · tap a name to scout, Draft to pick' : ''}</Text>
          <View style={styles.posRow}>
            <Pressable style={[styles.posChip, !position && styles.posChipActive]} onPress={() => setPosition(null)}>
              <Text style={[styles.posText, !position && { color: colors.text }]}>All</Text>
            </Pressable>
            {POSITIONS.map((p) => (
              <Pressable key={p} style={[styles.posChip, position === p && styles.posChipActive]} onPress={() => setPosition(position === p ? null : p)}>
                <Text style={[styles.posText, position === p && { color: colors.text }]}>{p}</Text>
              </Pressable>
            ))}
          </View>
          {pool.length === 0 ? (
            <Text style={styles.empty}>No available players{position ? ` at ${position}` : ''}.</Text>
          ) : (
            pool.map((p, i) => (
              <View key={p.id} style={[styles.avRow, myTurn && styles.avRowLive, p.tag === 'target' && styles.avRowTarget, p.tag === 'avoid' && styles.avRowAvoid]}>
                <Pressable
                  style={styles.avIdentity}
                  onPress={onOpenPlayer ? () => onOpenPlayer(p.id) : undefined}
                  disabled={!onOpenPlayer}
                >
                  <Text style={styles.avRank}>{i + 1}</Text>
                  <View style={[styles.dot, { backgroundColor: positionColors[p.position] || colors.textDim }]} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.avNameRow}>
                      <Text style={styles.avName} numberOfLines={1}>{p.name}</Text>
                      {p.tag ? <Text style={[styles.tagMark, { color: p.tag === 'target' ? colors.good : colors.bad }]}>{p.tag === 'target' ? '◎' : '⊘'}</Text> : null}
                    </View>
                    <Text style={styles.avMeta}>{p.position}{p.team ? ` · ${p.team}` : ''}{p.age != null ? ` · ${p.age}y` : ''}{p.adp != null ? ` · ADP ${p.adp}` : ''}</Text>
                  </View>
                  <Text style={styles.avValue}>{p.value != null ? p.value : '—'}</Text>
                </Pressable>
                {myTurn ? (
                  picking === p.id ? (
                    <ActivityIndicator color={colors.accent} style={styles.avDraftBtn} />
                  ) : (
                    <Pressable
                      style={({ pressed }) => [styles.avDraftBtn, pressed && { opacity: 0.7 }]}
                      onPress={() => confirmDraft(p)}
                      disabled={picking != null}
                    >
                      <Text style={styles.avDraftTxt}>Draft</Text>
                    </Pressable>
                  )
                ) : null}
              </View>
            ))
          )}

          {/* Recent picks */}
          {recent.length ? (
            <>
              <Text style={styles.section}>Recent picks</Text>
              {recent.map((s) => (
                <View key={s.overall} style={styles.pickRow}>
                  <Text style={styles.pickNo}>{s.round}.{String(s.pick).padStart(2, '0')}</Text>
                  <View style={[styles.dot, { backgroundColor: positionColors[s.player.position] || colors.textDim }]} />
                  <Text style={styles.pickName} numberOfLines={1}>{s.player.name}</Text>
                  <Text style={styles.pickMeta}>{s.player.position}</Text>
                </View>
              ))}
            </>
          ) : null}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  list: { padding: 16 },
  error: { color: colors.bad, textAlign: 'center', marginTop: 12, marginHorizontal: 24 },
  retry: { marginTop: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: colors.accent, fontWeight: '700' },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 20, fontSize: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dtype: { color: colors.text, fontSize: 18, fontWeight: '900' },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  sched: { color: colors.textDim, fontSize: 13, marginTop: 6 },
  clock: { backgroundColor: colors.gold + '22', borderColor: colors.gold, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 12 },
  clockText: { color: colors.gold, fontSize: 16, fontWeight: '900' },
  clockSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  waiting: { color: colors.textDim, fontSize: 13, marginTop: 12, fontWeight: '600' },
  section: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 20, marginBottom: 8 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickNo: { color: colors.textDim, fontSize: 13, fontWeight: '800', width: 44 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  pickName: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  pickMeta: { color: colors.textDim, fontSize: 12, marginLeft: 8 },
  pickUpcoming: { color: colors.textDim, fontSize: 13, fontStyle: 'italic', flex: 1 },
  posRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  posChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 6 },
  posChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  posText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  avRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  avRowLive: { borderColor: colors.gold },
  avRowTarget: { borderColor: colors.good, backgroundColor: colors.good + '10' },
  avRowAvoid: { opacity: 0.5 },
  avNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagMark: { fontSize: 13, fontWeight: '900' },
  avIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  avDraftBtn: { marginLeft: 10, backgroundColor: colors.gold, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, minWidth: 58, alignItems: 'center' },
  avDraftTxt: { color: colors.bg, fontSize: 13, fontWeight: '900' },
  avRank: { color: colors.textDim, fontSize: 13, fontWeight: '800', width: 22 },
  avName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  avMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  avValue: { color: colors.gold, fontSize: 16, fontWeight: '900', minWidth: 30, textAlign: 'right' },
});
