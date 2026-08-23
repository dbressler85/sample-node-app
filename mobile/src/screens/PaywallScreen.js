import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { colors, rgb, glow, space, radius, size, weight } from '../theme';
import { displayLabel } from '../typography';
import { GlyphMark } from '../components/NeonGlyphs';
import { PLANS } from '../entitlement/billing';
import { actionLabel } from '../entitlement/core';
import { useEntitlement } from '../entitlement';

// The paywall. Rendered by <PaywallHost/> on top of the app when a gated action is attempted or the
// user taps "Go Pro". Gold = value/premium (the design color law), so Pro wears the championship gold.
// The copy is context-aware: an action gate names the feature; a trial that's ending nudges to keep it.

const FEATURES = [
  'Act in every league from one command center',
  'One-tap Set-All lineups across all your leagues',
  'Cross-league Waiver Wizard — line up & file claims everywhere',
  'Trade suggester: build, propose, accept & counter in-app',
  'Make your draft picks in-app, on the clock',
  'Trade, waiver & lineup-alert notifications',
];

export default function PaywallScreen({ context = {}, onClose }) {
  const { trial, reason, purchase, restore } = useEntitlement();
  const [selected, setSelected] = useState('annual');
  const [busy, setBusy] = useState(null); // 'buy' | 'restore'
  const [error, setError] = useState(null);

  const gated = context.action ? `${actionLabel(context.action)} is a Pro feature.` : null;
  const trialLine =
    reason === 'trial' && trial && trial.inTrial
      ? `You're on the free trial — ${trial.daysLeft} day${trial.daysLeft === 1 ? '' : 's'} left.`
      : reason === 'expired'
        ? 'Your free trial has ended.'
        : null;
  const plan = PLANS.find((p) => p.id === selected) || PLANS[0];
  const cta = reason === 'trial' ? `Keep Pro — ${plan.priceString}/${plan.period}` : `Start Pro — ${plan.priceString}/${plan.period}`;

  async function onBuy() {
    setError(null);
    setBusy('buy');
    try {
      await purchase(selected);
      onClose();
    } catch (e) {
      setError('Purchase could not be completed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function onRestore() {
    setError(null);
    setBusy('restore');
    try {
      const info = await restore();
      if (info && info.subscribed) onClose();
      else setError('No previous purchase found for this account.');
    } catch (e) {
      setError('Could not restore purchases. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.root}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.card}>
        <Pressable style={styles.close} onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <GlyphMark name="x" size={17} color={colors.textDim} weight={2} />
        </Pressable>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.eyebrow}>Dynasty Central</Text>
          <Text style={[styles.title, displayLabel()]}>PRO</Text>

          {gated ? <Text style={styles.gated}>{gated}</Text> : null}
          <Text style={styles.pitch}>
            See everything free. With Pro, <Text style={styles.pitchBold}>act on it across every league</Text> — no more bouncing between MFL tabs.
          </Text>
          {trialLine ? <Text style={styles.trial}>{trialLine}</Text> : null}

          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f} style={styles.featureRow}>
                <GlyphMark name="check" size={14} color={colors.good} weight={2.6} />
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </View>

          <View style={styles.plans}>
            {PLANS.map((p) => {
              const on = p.id === selected;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setSelected(p.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[styles.plan, on && glow(rgb.gold, { edge: 0.7, wash: 0.14, halo: 0.4, radius: 14 })]}
                >
                  {p.badge ? (
                    <View style={styles.planBadge}>
                      <Text style={styles.planBadgeText}>{p.badge}</Text>
                    </View>
                  ) : null}
                  <View style={styles.planMain}>
                    <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                    <Text style={styles.planTitle}>{p.title}</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={styles.planPrice}>
                      {p.priceString}
                      <Text style={styles.planPer}>/{p.period}</Text>
                    </Text>
                  </View>
                  {p.per ? <Text style={styles.planSub}>{p.per} billed annually</Text> : null}
                </Pressable>
              );
            })}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={onBuy}
            disabled={!!busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cta, glow(rgb.gold, { edge: 0.6, wash: 0.9, halo: 0.5, radius: 18 }), pressed && { opacity: 0.9 }, busy && { opacity: 0.7 }]}
          >
            {busy === 'buy' ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.ctaText}>{cta}</Text>}
          </Pressable>

          <Pressable onPress={onRestore} disabled={!!busy} hitSlop={8} style={styles.restore}>
            <Text style={styles.restoreText}>{busy === 'restore' ? 'Restoring…' : 'Restore purchases'}</Text>
          </Pressable>

          <Text style={styles.legal}>
            Billed through Google Play. Cancel anytime in your Play Store subscriptions. Your free trial gives full access — you won’t be
            charged until it ends.
          </Text>
          <Pressable onPress={() => Linking.openURL('https://play.google.com/store/account/subscriptions').catch(() => {})} hitSlop={6}>
            <Text style={styles.manage}>Manage subscription</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: space.lg, zIndex: 100 },
  card: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '90%',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: `rgba(${rgb.gold},0.45)`,
    overflow: 'hidden',
  },
  close: { position: 'absolute', top: 10, right: 12, zIndex: 2, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.textDim, fontSize: 18, fontWeight: weight.bold },
  body: { padding: space.xl, paddingTop: space.xxl },
  eyebrow: { color: colors.violetText, fontSize: size.caption, fontWeight: weight.heavy, letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center' },
  title: { color: colors.gold, fontSize: size.mega, fontWeight: '900', letterSpacing: 3, textAlign: 'center', marginTop: 2, textShadowColor: `rgba(${rgb.gold},0.6)`, textShadowRadius: 18 },
  gated: { color: colors.gold, fontSize: size.bodySm, fontWeight: weight.bold, textAlign: 'center', marginTop: space.md },
  pitch: { color: colors.text, fontSize: size.body, lineHeight: 21, textAlign: 'center', marginTop: space.md },
  pitchBold: { color: colors.gold, fontWeight: weight.heavy },
  trial: { color: colors.textDim, fontSize: size.caption, fontWeight: weight.bold, textAlign: 'center', marginTop: space.sm },
  features: { marginTop: space.xl, gap: space.sm },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  check: { color: colors.good, fontSize: size.body, fontWeight: '900', marginTop: 1 },
  featureText: { color: colors.text, fontSize: size.bodySm, lineHeight: 19, flex: 1 },
  plans: { marginTop: space.xl, gap: space.md },
  plan: { backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, paddingTop: space.lg },
  planBadge: { position: 'absolute', top: -1, right: 12, backgroundColor: colors.gold, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 2 },
  planBadgeText: { color: colors.onAccent, fontSize: size.micro, fontWeight: '900', letterSpacing: 0.3 },
  planMain: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.textDim, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.gold },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  planTitle: { color: colors.text, fontSize: size.bodyLg, fontWeight: weight.heavy },
  planPrice: { color: colors.text, fontSize: size.bodyLg, fontWeight: '900' },
  planPer: { color: colors.textDim, fontSize: size.caption, fontWeight: weight.bold },
  planSub: { color: colors.textDim, fontSize: size.micro, fontWeight: weight.medium, marginTop: 4, marginLeft: 28 },
  error: { color: colors.bad, fontSize: size.caption, fontWeight: weight.bold, textAlign: 'center', marginTop: space.md },
  cta: { marginTop: space.xl, borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: colors.onAccent, fontSize: size.bodyLg, fontWeight: '900', letterSpacing: 0.3 },
  restore: { marginTop: space.md, alignItems: 'center', paddingVertical: space.xs },
  restoreText: { color: colors.accent, fontSize: size.bodySm, fontWeight: weight.bold },
  legal: { color: colors.textDim, fontSize: size.micro, lineHeight: 15, textAlign: 'center', marginTop: space.lg },
  manage: { color: colors.textDim, fontSize: size.micro, fontWeight: weight.bold, textAlign: 'center', marginTop: space.sm, textDecorationLine: 'underline' },
});
