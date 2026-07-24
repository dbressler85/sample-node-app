import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

// The add-vs-drop dynasty value delta, side by side — the core question on any waiver claim.
// Shared by BOTH claim builders (the WaiverWizard and the FA-board ClaimSheet) so the two
// surfaces show the trade-off identically. Renders only when there's a net to show (`net` != null);
// the drop column reads 0 when adding without dropping.
export default function ValueDelta({ addValue, dropValue, net }) {
  if (net == null) return null;
  return (
    <View style={styles.box}>
      <View style={styles.col}>
        <Text style={styles.label}>ADD</Text>
        <Text style={styles.add}>+{addValue}</Text>
      </View>
      <Text style={styles.op}>−</Text>
      <View style={styles.col}>
        <Text style={styles.label}>DROP</Text>
        <Text style={styles.drop}>{dropValue != null ? dropValue : 0}</Text>
      </View>
      <Text style={styles.op}>=</Text>
      <View style={styles.col}>
        <Text style={styles.label}>NET</Text>
        <Text style={[styles.net, net >= 0 ? styles.up : styles.down]}>
          {net >= 0 ? '+' : ''}{net}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 12, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 14 },
  col: { alignItems: 'center', minWidth: 48 },
  label: { color: colors.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 3 },
  add: { color: colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  drop: { color: colors.textDim, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  op: { color: colors.textDim, fontSize: 16, fontWeight: '700' },
  net: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  up: { color: colors.good },
  down: { color: colors.bad },
});
