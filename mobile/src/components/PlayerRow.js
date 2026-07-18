import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, positionColors } from '../theme';

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
      <Text style={styles.team}>{player.team || 'FA'}</Text>
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
  name: { color: colors.text, fontSize: 15, flex: 1 },
  team: { color: colors.textDim, fontSize: 12, fontWeight: '600', width: 42, textAlign: 'right' },
});
