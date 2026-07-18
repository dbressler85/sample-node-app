import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  FlatList,
  Alert,
} from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import AvailabilityBadge from '../components/AvailabilityBadge';

export default function LineupEditorScreen({ league, onBack }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assignments, setAssignments] = useState([]); // slot index -> player id | null
  const [picking, setPicking] = useState(null); // slot index being edited

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.lineupDetail(league.leagueId);
        if (!alive) return;
        setDetail(d);
        setAssignments(d.slots.map((s) => (s.current ? s.current.id : null)));
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [league.leagueId]);

  const byId = useMemo(() => {
    const m = new Map();
    if (detail) for (const p of detail.players) m.set(p.id, p);
    return m;
  }, [detail]);

  const total = useMemo(
    () =>
      Math.round(
        assignments.reduce((s, id) => s + (id && byId.get(id) ? byId.get(id).projection : 0), 0) * 10
      ) / 10,
    [assignments, byId]
  );

  const dirty = useMemo(() => {
    if (!detail) return false;
    return detail.slots.some((s, i) => (s.current ? s.current.id : null) !== assignments[i]);
  }, [detail, assignments]);

  function optimize() {
    setAssignments(detail.slots.map((s) => (s.optimal ? s.optimal.id : null)));
  }

  function assignToSlot(slotIndex, playerId) {
    setAssignments((prev) => {
      const next = prev.slice();
      // If the player is already in another slot, swap them.
      const existing = next.indexOf(playerId);
      if (existing >= 0 && existing !== slotIndex) next[existing] = prev[slotIndex] || null;
      next[slotIndex] = playerId;
      return next;
    });
    setPicking(null);
  }

  async function save() {
    const ids = assignments.filter(Boolean);
    setSaving(true);
    try {
      const updated = await api.applyLineup(league.leagueId, ids);
      setDetail(updated);
      setAssignments(updated.slots.map((s) => (s.current ? s.current.id : null)));
      Alert.alert('Lineup saved', `${updated.name} · ${updated.current.total} projected points.`);
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.error}>{error}</Text>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const optimalDelta = Math.round((detail.optimal.total - total) * 10) / 10;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Lineups</Text>
        </Pressable>
        <Pressable onPress={optimize} hitSlop={10}>
          <Text style={styles.optimize}>Optimize</Text>
        </Pressable>
      </View>

      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {detail.name}
        </Text>
        <Text style={styles.subtitle}>
          Week {detail.week} · projected{' '}
          <Text style={styles.totalStrong}>{total}</Text>
          {optimalDelta > 0.05 ? <Text style={styles.optHint}>  (+{optimalDelta} available)</Text> : null}
        </Text>
        {detail.format ? <Text style={styles.format}>{detail.format}</Text> : null}
        {detail.matchup ? (
          <Text style={styles.matchup}>
            vs {detail.matchup.opponent} ·{' '}
            <Text style={{ color: winColor(detail.matchup.winProb), fontWeight: '800' }}>
              {Math.round(detail.matchup.winProb * 100)}% win
            </Text>
            {detail.mode ? <Text style={styles.modeTag}>  ·  {detail.mode.toUpperCase()}</Text> : null}
          </Text>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.slots}>
        {detail.slots.map((slot, i) => {
          const player = assignments[i] ? byId.get(assignments[i]) : null;
          return <SlotRow key={i} slot={slot} player={player} onPress={() => setPicking(i)} />;
        })}
      </ScrollView>

      <Pressable
        style={({ pressed }) => [
          styles.save,
          !dirty && styles.saveDisabled,
          pressed && dirty && { opacity: 0.85 },
        ]}
        onPress={save}
        disabled={!dirty || saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveText}>{dirty ? 'Save Lineup' : 'Lineup Saved'}</Text>
        )}
      </Pressable>

      {picking !== null ? (
        <PlayerPicker
          slot={detail.slots[picking]}
          players={detail.players}
          assignments={assignments}
          slotIndex={picking}
          onPick={(id) => assignToSlot(picking, id)}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </View>
  );
}

function SlotRow({ slot, player, onPress }) {
  const posColor = player ? positionColors[player.position] || colors.textDim : colors.border;
  return (
    <Pressable style={({ pressed }) => [styles.slot, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <Text style={styles.slotName}>{slot.name}</Text>
      {player ? (
        <>
          <View style={[styles.posDot, { backgroundColor: posColor }]} />
          <View style={{ flex: 1 }}>
            <View style={styles.slotPlayerRow}>
              <Text style={styles.slotPlayer} numberOfLines={1}>
                {player.name}
              </Text>
              <AvailabilityBadge availability={player.availability} style={{ marginLeft: 6 }} />
            </View>
            <Text style={styles.slotBand}>
              floor {player.floor} · ceil {player.ceiling}
            </Text>
          </View>
          <Text style={styles.slotProj}>{player.median.toFixed(1)}</Text>
        </>
      ) : (
        <Text style={styles.slotEmpty}>Tap to fill · empty</Text>
      )}
      <Text style={styles.slotChev}>›</Text>
    </Pressable>
  );
}

function PlayerPicker({ slot, players, assignments, slotIndex, onPick, onClose }) {
  const candidates = players
    .filter((p) => slot.eligible.includes(p.position))
    .sort((a, b) => b.median - a.median);

  return (
    <Pressable style={styles.sheetBackdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        <Text style={styles.sheetTitle}>
          {slot.name} · {slot.eligible.join(' / ')}
        </Text>
        <FlatList
          data={candidates}
          keyExtractor={(p) => p.id}
          style={{ maxHeight: 360 }}
          renderItem={({ item }) => {
            const inThisSlot = assignments[slotIndex] === item.id;
            const elsewhere = assignments.includes(item.id) && !inThisSlot;
            const unavailable = !item.availability.startable;
            return (
              <Pressable
                style={({ pressed }) => [styles.cand, unavailable && { opacity: 0.45 }, pressed && !unavailable && { opacity: 0.6 }]}
                onPress={() => (unavailable ? null : onPick(item.id))}
                disabled={unavailable}
              >
                <View
                  style={[styles.posDot, { backgroundColor: positionColors[item.position] || colors.textDim }]}
                />
                <Text style={styles.candName} numberOfLines={1}>
                  {item.name} <Text style={styles.candTeam}>{item.position} · {item.team}</Text>
                </Text>
                <AvailabilityBadge availability={item.availability} style={{ marginRight: 8 }} />
                {inThisSlot ? <Text style={styles.candTag}>current</Text> : null}
                {elsewhere && !inThisSlot ? <Text style={styles.candTagDim}>starting</Text> : null}
                <Text style={styles.candProj}>{item.median.toFixed(1)}</Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={styles.candEmpty}>No eligible players.</Text>}
        />
        <Pressable style={styles.sheetClose} onPress={onClose}>
          <Text style={styles.sheetCloseText}>Close</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

function winColor(p) {
  if (p >= 0.6) return colors.good;
  if (p <= 0.4) return colors.bad;
  return colors.warn;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  optimize: { color: colors.good, fontSize: 15, fontWeight: '800' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 14, marginTop: 2 },
  format: { color: colors.textDim, fontSize: 11, fontWeight: '700', marginTop: 4, letterSpacing: 0.3 },
  matchup: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  modeTag: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  totalStrong: { color: colors.text, fontWeight: '800' },
  optHint: { color: colors.warn, fontWeight: '700' },
  slots: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  slotName: { color: colors.textDim, fontSize: 12, fontWeight: '800', width: 74 },
  posDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  slotPlayerRow: { flexDirection: 'row', alignItems: 'center' },
  slotPlayer: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  slotBand: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  slotProj: { color: colors.text, fontSize: 15, fontWeight: '800', marginRight: 8 },
  slotEmpty: { color: colors.bad, fontSize: 14, flex: 1, fontStyle: 'italic' },
  slotChev: { color: colors.textDim, fontSize: 20 },
  save: {
    backgroundColor: colors.accent,
    margin: 16,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveDisabled: { backgroundColor: colors.cardAlt },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  error: { color: colors.bad, textAlign: 'center', marginBottom: 16 },
  backBtn: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  backText: { color: colors.text, fontWeight: '600' },
  // picker
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 12 },
  cand: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  candName: { color: colors.text, fontSize: 15, flex: 1 },
  candTeam: { color: colors.textDim, fontSize: 12 },
  candTag: { color: colors.good, fontSize: 11, fontWeight: '800', marginRight: 8 },
  candTagDim: { color: colors.textDim, fontSize: 11, fontWeight: '700', marginRight: 8 },
  candProj: { color: colors.text, fontSize: 15, fontWeight: '800' },
  candEmpty: { color: colors.textDim, textAlign: 'center', paddingVertical: 20 },
  sheetClose: { alignItems: 'center', paddingTop: 16 },
  sheetCloseText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
});
