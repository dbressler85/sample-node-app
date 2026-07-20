import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors, positionColors } from '../theme';
import AvailabilityBadge from './AvailabilityBadge';

// `onToggleBait` (+ `baited`) opts a row into a trailing "on the block" toggle. When
// it's not passed the row renders exactly as before, so every other screen is unaffected.
export default function PlayerRow({ player, baited, onToggleBait }) {
  const posColor = positionColors[player.position] || colors.textDim;
  return (
    <View style={styles.row}>
      <View style={[styles.posBadge, { backgroundColor: posColor + '22', borderColor: posColor }]}>
        <Text style={[styles.pos, { color: posColor }]}>{player.position || '—'}</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {player.name}
      </Text>
      <AvailabilityBadge availability={player.availability} style={{ marginRight: 8 }} />
      {player.age != null ? <Text style={styles.age}>{player.age}y</Text> : null}
      <Text style={styles.team}>{player.team || 'FA'}</Text>
      {player.value != null ? <Text style={styles.value}>{player.value}</Text> : null}
      {onToggleBait ? (
        <Pressable
          onPress={() => onToggleBait(player)}
          hitSlop={8}
          style={[styles.bait, baited && styles.baitOn]}
          accessibilityLabel={baited ? `Take ${player.name} off the block` : `Put ${player.name} on the block`}
        >
          <Text style={[styles.baitTxt, baited && styles.baitTxtOn]}>{baited ? '⇄ On block' : '⇄ Block'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  posBadge: {
    width: 42,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    marginRight: 12,
  },
  pos: { fontSize: 11, fontWeight: '800' },
  name: { color: colors.text, fontSize: 15, flexShrink: 1 },
  age: { color: colors.textDim, fontSize: 12, marginLeft: 'auto', marginRight: 8 },
  team: { color: colors.textDim, fontSize: 12, fontWeight: '600', width: 40, textAlign: 'right' },
  value: { color: colors.gold, fontSize: 14, fontWeight: '900', width: 34, textAlign: 'right' },
  bait: { marginLeft: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  baitOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  baitTxt: { color: colors.textDim, fontSize: 11, fontWeight: '800' },
  baitTxtOn: { color: '#fff' },
});
