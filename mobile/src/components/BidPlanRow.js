import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme';

// The smarter FAAB suggestion, surfaced. `plan` = { save, target, max, rationale } from the backend's
// budget × contention × season-phase × roster-fit model. Shows the one-line rationale ("Starting
// upgrade · win-now, Week 13") + three one-tap presets so a bid is a considered choice, not a magic
// number: Save (grab him cheap if uncontested), Target (the recommendation), Max (outbid expected
// competition). `onPick(n)` sets the bid; `current` highlights the matching preset. Renders nothing
// without a plan (non-FAAB, or no suggestion), so callers can drop it in unconditionally.
export default function BidPlanRow({ plan, current, onPick }) {
  if (!plan) return null;
  // Distinct presets only — a bench flyer's save/target/max can collapse to the same $ (all near the
  // floor); showing "$1 · $1 · $1" as three chips is noise, so dedupe by value.
  const chips = [
    { key: 'save', label: 'Save', v: plan.save },
    { key: 'target', label: 'Target', v: plan.target },
    { key: 'max', label: 'Max', v: plan.max },
  ].filter((c, i, a) => c.v != null && a.findIndex((x) => x.v === c.v) === i);
  return (
    <View style={styles.wrap}>
      {plan.rationale ? <Text style={styles.rationale}>{plan.rationale}</Text> : null}
      <View style={styles.row}>
        {chips.map((c) => {
          const on = current != null && current !== '' && Number(current) === c.v;
          return (
            <Pressable
              key={c.key}
              onPress={() => onPick(c.v)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${c.label} bid, $${c.v}`}
            >
              <Text style={[styles.chipLabel, on && styles.chipTextOn]}>{c.label}</Text>
              <Text style={[styles.chipVal, on && styles.chipTextOn]}>${c.v}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  rationale: { color: colors.textDim, fontSize: 12, marginBottom: 8, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.cardAlt },
  chipLabel: { color: colors.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  chipVal: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 2 },
  chipTextOn: { color: colors.accent },
});
