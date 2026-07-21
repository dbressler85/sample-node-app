import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, positionColors } from '../theme';

// Side-by-side trade view: what YOU give on the left, what you get on the right, mirrored so
// the two rosters read as a direct comparison instead of a stacked list. Shared by the trade
// inbox (a real incoming offer) and the desk builder recap (your live selection), so the same
// treatment shows whether you're reviewing an offer or constructing one.
function Col({ label, assets, total, onOpenPlayer, align }) {
  const right = align === 'right';
  return (
    <View style={styles.col}>
      <Text style={[styles.colLabel, right && styles.alignRight]}>{label}{total != null ? ` · ${total}` : ''}</Text>
      {(!assets || !assets.length) ? (
        <Text style={[styles.colEmpty, right && styles.alignRight]}>—</Text>
      ) : assets.map((a) => {
        const tappable = onOpenPlayer && a.kind !== 'pick';
        const Row = tappable ? Pressable : View;
        const rowProps = tappable ? { onPress: () => onOpenPlayer(a.id) } : {};
        return (
          <Row key={a.id} style={[styles.colRow, right && { flexDirection: 'row-reverse' }]} {...rowProps}>
            <View style={[styles.dot, { backgroundColor: positionColors[a.position] || colors.textDim }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.colName, right && styles.alignRight]} numberOfLines={1}>{String(a.name).split(',')[0]}</Text>
              <Text style={[styles.colMeta, right && styles.alignRight]} numberOfLines={1}>
                {a.kind === 'pick' ? (a.value != null ? `val ${a.value}` : 'pick') : `${a.position}${a.value != null ? ` · ${a.value}` : ''}`}
              </Text>
            </View>
          </Row>
        );
      })}
    </View>
  );
}

export default function TradeColumns({ give, get, giveTotal, getTotal, giveLabel = 'You give', getLabel = 'You get', onOpenPlayer }) {
  return (
    <View style={styles.columns}>
      <Col label={giveLabel} assets={give} total={giveTotal} onOpenPlayer={onOpenPlayer} />
      <View style={styles.divider} />
      <Col label={getLabel} assets={get} total={getTotal} onOpenPlayer={onOpenPlayer} align="right" />
    </View>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 8 },
  col: { flex: 1 },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.border, marginHorizontal: 10 },
  colLabel: { color: colors.textDim, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  colRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  colName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  colMeta: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  colEmpty: { color: colors.textDim, fontSize: 13 },
  alignRight: { textAlign: 'right' },
});
