import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

// The league's format + your team situation, in one compact card — shown on the Draft, Draft List,
// and Trade Bait screens so a pick/trade decision carries the context that changes it: superflex vs
// 1QB, PPR depth, any TE-reception premium, HOW MANY of each position you must start, and whether
// your team is win-now / ascending (with core age + strength). Everything is optional/fail-soft.

function Chip({ label, tone }) {
  const color = tone === 'accent' ? colors.accent : colors.textDim;
  return (
    <View style={[styles.chip, tone === 'accent' && styles.chipAccent]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

// `team` (optional) overrides context.team — used on the trade-block editor, whose light context has
// no team block, so it passes the roster summary it already fetched on expand.
export default function LeagueContext({ context, team: teamOverride }) {
  if (!context) return null;
  const { superflex, pprLabel, tePremium, tep, teStarters, lineup } = context;
  const team = teamOverride || context.team;
  const rec = team && team.record;
  const recStr = rec ? `${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ''}` : null;
  // Frame of reference for the raw age numbers: where this team's core age ranks among the league
  // (1 = youngest), so "core 25.8y" reads as "2nd-youngest of 12" — and the league average to compare.
  const ac = team && team.ageContext;
  const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const coreStr = team && team.coreAge != null
    ? `core ${team.coreAge}y${ac && ac.coreRank ? ` (${ord(ac.coreRank)}-youngest of ${ac.teams})` : ''}`
    : null;
  const avgStr = team && team.avgAge != null
    ? `avg ${team.avgAge}y${ac && ac.leagueAvgAge != null ? ` vs lg ${ac.leagueAvgAge}` : ''}`
    : null;
  return (
    <View style={styles.card}>
      <View style={styles.chipRow}>
        <Chip label={superflex ? '2QB' : '1QB'} tone={superflex ? 'accent' : undefined} />
        {pprLabel ? <Chip label={pprLabel} /> : null}
        {/* TE-premium from EITHER trigger: a TE reception bump shows the per-rec amount; a mandated
            2nd TE starter shows "TE-premium · 2 TE". Either way it's flagged wherever format shows. */}
        {tePremium > 0 ? (
          <Chip label={`TE +${tePremium}/rec`} tone="accent" />
        ) : tep ? (
          <Chip label={teStarters >= 2 ? 'TE-premium · 2 TE' : 'TE-premium'} tone="accent" />
        ) : null}
      </View>
      {lineup && lineup.label ? (
        <Text style={styles.line}>
          <Text style={styles.lineLabel}>Starters  </Text>
          {lineup.totalStarters != null ? <Text style={styles.startTotal}>{lineup.totalStarters} total  </Text> : null}
          {lineup.label}
        </Text>
      ) : null}
      {team && (team.outlook || team.coreAge != null || team.avgAge != null || team.strengthLabel || recStr) ? (
        <Text style={styles.line}>
          <Text style={styles.lineLabel}>Your team  </Text>
          {[
            team.outlook,
            recStr ? `${recStr}` : null,
            avgStr,
            coreStr,
            team.strengthLabel,
          ]
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
  chipAccent: { borderColor: colors.accent, backgroundColor: 'rgba(79,140,255,0.10)' },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  line: { color: colors.text, fontSize: 12.5, lineHeight: 17 },
  lineLabel: { color: colors.textDim, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  startTotal: { color: colors.text, fontWeight: '900' },
});
