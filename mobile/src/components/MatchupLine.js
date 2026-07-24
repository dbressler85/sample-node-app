import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

// The matchup summary shown on every lineup surface — one source of truth so the win-probability
// thresholds and the "vs <opponent> · N% win" wording can't drift (they used to be copy-pasted,
// with their own `winColor`, in LineupsScreen and LineupEditorScreen).
//
//   winColor — win% → good/warn/bad. Exported so any other surface colors win% the same way.
//   <MatchupLine> — renders the line. `variant`:
//     • 'compact' (Lineups list row): the single colored line, weight inherited from `style`.
//     • 'detail'  (Lineup editor):    adds " est.", an optional MODE tag, and the basis sub-line
//        ("vs their set lineup" / "assumes their best lineup (not set yet)").

export function winColor(p) {
  if (p >= 0.6) return colors.good;
  if (p <= 0.4) return colors.bad;
  return colors.warn;
}

const winPct = (p) => `${Math.round((p || 0) * 100)}% win`;

export default function MatchupLine({ matchup, mode, variant = 'compact', style, basisStyle }) {
  if (!matchup) return null;
  const detail = variant === 'detail';
  return (
    <>
      <Text style={style}>
        vs {matchup.opponent} ·{' '}
        <Text style={[{ color: winColor(matchup.winProb) }, detail && styles.winStrong]}>{winPct(matchup.winProb)}</Text>
        {detail ? <Text style={styles.estTag}> est.</Text> : null}
        {detail && mode ? <Text style={styles.modeTag}>  ·  {mode.toUpperCase()}</Text> : null}
      </Text>
      {detail ? (
        <Text style={basisStyle || styles.basisTag}>
          {matchup.basis === 'submitted' ? 'vs their set lineup' : 'assumes their best lineup (not set yet)'}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  winStrong: { fontWeight: '800' },
  estTag: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  modeTag: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  basisTag: { color: colors.textDim, fontSize: 11, marginTop: 2, fontStyle: 'italic', opacity: 0.8 },
});
