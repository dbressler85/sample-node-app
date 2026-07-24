import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

// The league's format + your team situation, in one compact card — shown on the Draft, Draft List,
// and Trade Bait screens so a pick/trade decision carries the context that changes it: superflex vs
// 1QB, PPR depth, any TE-reception premium, HOW MANY of each position you must start, and whether
// your team is win-now / ascending (with core age + strength). Everything is optional/fail-soft.

function Chip({ label, tone }) {
  const color = tone === 'accent' ? colors.gold : colors.textDim;
  return (
    <View style={[styles.chip, tone === 'accent' && styles.chipAccent]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

export default function LeagueContext({ context }) {
  if (!context) return null;
  const { superflex, pprLabel, tePremium, lineup, team } = context;
  return (
    <View style={styles.card}>
      <View style={styles.chipRow}>
        <Chip label={superflex ? 'Superflex' : '1QB'} tone={superflex ? 'accent' : undefined} />
        {pprLabel ? <Chip label={pprLabel} /> : null}
        {tePremium > 0 ? <Chip label={`TE +${tePremium}/rec`} tone="accent" /> : null}
      </View>
      {lineup && lineup.label ? (
        <Text style={styles.line}>
          <Text style={styles.lineLabel}>Starters  </Text>{lineup.label}
        </Text>
      ) : null}
      {team && (team.outlook || team.coreAge != null || team.strengthLabel) ? (
        <Text style={styles.line}>
          <Text style={styles.lineLabel}>Your team  </Text>
          {[team.outlook, team.coreAge != null ? `core ${team.coreAge}y` : null, team.strengthLabel]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 10, gap: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  chipAccent: { borderColor: colors.gold, backgroundColor: 'rgba(243,193,74,0.10)' },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  line: { color: colors.text, fontSize: 12.5, lineHeight: 17 },
  lineLabel: { color: colors.textDim, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
});
