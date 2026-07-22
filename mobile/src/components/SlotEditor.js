import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, FlatList } from 'react-native';
import { colors, positionColors } from '../theme';
import AvailabilityBadge from './AvailabilityBadge';
import useAndroidBack from '../useAndroidBack';

// Reusable lineup slot editor: renders the slots and a tap-to-swap player picker.
// Parent owns `assignments` (slot index -> player id | null) and gets updates via
// onChange. Used by the single-league editor and the multi-league wizard.
export default function SlotEditor({ slots, players, assignments, onChange }) {
  const [picking, setPicking] = useState(null);

  useAndroidBack(
    useCallback(() => {
      if (picking !== null) {
        setPicking(null);
        return true;
      }
      return false;
    }, [picking])
  );

  const byId = useMemo(() => {
    const m = new Map();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  function assignToSlot(slotIndex, playerId) {
    const next = assignments.slice();
    const existing = next.indexOf(playerId);
    if (existing >= 0 && existing !== slotIndex) next[existing] = assignments[slotIndex] || null; // swap
    next[slotIndex] = playerId;
    onChange(next);
    setPicking(null);
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.slots}>
        {slots.map((slot, i) => {
          const player = assignments[i] ? byId.get(assignments[i]) : null;
          return <SlotRow key={i} slot={slot} player={player} onPress={() => setPicking(i)} />;
        })}
      </ScrollView>

      {picking !== null ? (
        <PlayerPicker
          slot={slots[picking]}
          players={players}
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
              floor {player.floor != null ? player.floor : '—'} · ceil {player.ceiling != null ? player.ceiling : '—'}
            </Text>
          </View>
          <Text style={styles.slotProj}>{player.median != null ? player.median.toFixed(1) : '—'}</Text>
        </>
      ) : (
        <Text style={styles.slotEmpty}>Tap to fill · empty</Text>
      )}
      <Text style={styles.slotChev}>›</Text>
    </Pressable>
  );
}

function PlayerPicker({ slot, players, assignments, slotIndex, onPick, onClose }) {
  // Memoized so re-renders (e.g. the parent's slot-tap state) don't re-filter/sort the roster.
  const candidates = useMemo(
    () => players.filter((p) => slot.eligible.includes(p.position)).sort((a, b) => b.median - a.median),
    [players, slot.eligible],
  );
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
            const unavailable = item.availability ? !item.availability.startable : false;
            return (
              <Pressable
                style={({ pressed }) => [styles.cand, unavailable && { opacity: 0.45 }, pressed && !unavailable && { opacity: 0.6 }]}
                onPress={() => (unavailable ? null : onPick(item.id))}
                disabled={unavailable}
              >
                <View style={[styles.posDot, { backgroundColor: positionColors[item.position] || colors.textDim }]} />
                <Text style={styles.candName} numberOfLines={1}>
                  {item.name} <Text style={styles.candTeam}>{item.position} · {item.team}</Text>
                </Text>
                <AvailabilityBadge availability={item.availability} style={{ marginRight: 8 }} />
                {inThisSlot ? <Text style={styles.candTag}>current</Text> : null}
                {elsewhere && !inThisSlot ? <Text style={styles.candTagDim}>starting</Text> : null}
                <Text style={styles.candProj}>{item.median != null ? item.median.toFixed(1) : '—'}</Text>
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

const styles = StyleSheet.create({
  slots: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  slot: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 10 },
  slotName: { color: colors.textDim, fontSize: 12, fontWeight: '800', width: 74 },
  posDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  slotPlayerRow: { flexDirection: 'row', alignItems: 'center' },
  slotPlayer: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  slotBand: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  slotProj: { color: colors.text, fontSize: 15, fontWeight: '800', marginRight: 8 },
  slotEmpty: { color: colors.bad, fontSize: 14, flex: 1, fontStyle: 'italic' },
  slotChev: { color: colors.textDim, fontSize: 20 },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderTopWidth: 1, borderColor: colors.border },
  sheetTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 12 },
  cand: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  candName: { color: colors.text, fontSize: 15, flex: 1 },
  candTeam: { color: colors.textDim, fontSize: 12 },
  candTag: { color: colors.good, fontSize: 11, fontWeight: '800', marginRight: 8 },
  candTagDim: { color: colors.textDim, fontSize: 11, fontWeight: '700', marginRight: 8 },
  candProj: { color: colors.text, fontSize: 15, fontWeight: '800' },
  candEmpty: { color: colors.textDim, textAlign: 'center', paddingVertical: 20 },
  sheetClose: { alignItems: 'center', paddingTop: 16 },
  sheetCloseText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
});
