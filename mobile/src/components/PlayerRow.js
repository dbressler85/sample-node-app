import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, positionColors } from '../theme';
import AvailabilityBadge from './AvailabilityBadge';

export default function PlayerRow({ player }) {
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
});
