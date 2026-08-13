import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { GlyphMark } from '../components/NeonGlyphs';
import useAndroidBack from '../useAndroidBack';
import TradesScreen from './TradesScreen';

// Shop one player across several leagues in a row. Given a queue of trade contexts
// (one per league you checked), it steps through them: each step is the full trade desk
// for that league, seeded with the target + a needs-fitting suggestion. After an offer is
// sent, a single non-blocking bar (NOT stacked OS alerts) offers "Send another" to the same
// owner — common, multiple packages for one player — or "Next league"; the last one closes.
export default function TradeWizardScreen({ queue, onExit, onOpenPlayer }) {
  const [index, setIndex] = useState(0);
  const [reseed, setReseed] = useState(0); // bump → remount the desk for another offer in the SAME league
  const [sent, setSent] = useState(false); // an offer was just sent → show the "what next" bar
  const total = queue.length;
  const cur = queue[index];
  const last = index + 1 >= total;

  const advance = useCallback(() => {
    setSent(false);
    setReseed(0);
    setIndex((i) => {
      if (i + 1 < total) return i + 1;
      onExit();
      return i;
    });
  }, [total, onExit]);

  // Send another package to the SAME owner: re-seed a fresh propose desk in this league.
  const sendAnother = useCallback(() => {
    setSent(false);
    setReseed((n) => n + 1);
  }, []);

  // The desk calls this after a successful send. No alert — just raise the inline bar so the
  // "send another vs. next league" choice lives in one calm, always-visible place.
  const onSent = useCallback(() => { setSent(true); }, []);

  // Hardware back: dismiss the bar first (back to the desk), else exit the whole wizard.
  useAndroidBack(useCallback(() => {
    if (sent) { setSent(false); return true; }
    onExit();
    return true;
  }, [sent, onExit]));

  if (!cur) return null;

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <Pressable onPress={onExit} hitSlop={10} style={styles.closeBtn}><GlyphMark name="x" size={16} color={colors.textDim} weight={2} /></Pressable>
        <View style={styles.progressWrap}>
          <Text style={styles.step}>League {index + 1} of {total}</Text>
          <View style={styles.track}>
            {queue.map((_, i) => (
              <View key={i} style={[styles.pip, i <= index && styles.pipOn]} />
            ))}
          </View>
        </View>
        <Pressable onPress={advance} hitSlop={10}>
          <Text style={styles.skip}>{last ? 'Done' : 'Skip ›'}</Text>
        </Pressable>
      </View>

      <View style={styles.deck}>
        <TradesScreen
          key={`${cur.leagueId}:${reseed}`}
          league={{ leagueId: cur.leagueId, name: cur.name }}
          initialTab="propose"
          seed={{ targetPlayerId: cur.targetPlayerId, partnerFranchiseId: cur.partnerFranchiseId }}
          onBack={onExit}
          onSent={onSent}
          onOpenPlayer={onOpenPlayer}
        />
      </View>

      {/* Post-send: one non-blocking bar. Replaces the two chained OS alerts (desk's "Next league" +
          wizard's "send another") that made an 8-league sweep a gauntlet of stacked dialogs. */}
      {sent ? (
        <View style={styles.sentBar}>
          <View style={styles.sentInfo}>
            <Text style={styles.sentTitle} numberOfLines={1}>✓ Offer sent{cur.partnerName ? ` to ${cur.partnerName}` : ''}</Text>
            <Text style={styles.sentSub} numberOfLines={1}>{cur.name}{last ? '' : ` · League ${index + 1} of ${total}`}</Text>
          </View>
          <Pressable onPress={sendAnother} style={({ pressed }) => [styles.sentBtn, styles.sentGhost, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel={`Send another offer to ${cur.partnerName || 'this owner'}`}>
            <Text style={styles.sentGhostText}>Send another</Text>
          </Pressable>
          <Pressable onPress={advance} style={({ pressed }) => [styles.sentBtn, styles.sentPrimary, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={last ? 'Done' : 'Next league'}>
            <Text style={styles.sentPrimaryText}>{last ? 'Done' : 'Next league →'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  closeBtn: { width: 40 },
  skip: { color: colors.accent, fontSize: 14, fontWeight: '800', width: 52, textAlign: 'right' },
  progressWrap: { flex: 1, alignItems: 'center' },
  step: { color: colors.text, fontSize: 13, fontWeight: '800' },
  track: { flexDirection: 'row', gap: 4, marginTop: 5 },
  pip: { width: 16, height: 3, borderRadius: 2, backgroundColor: colors.border },
  pipOn: { backgroundColor: colors.accent },
  deck: { flex: 1 },
  sentBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 26, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sentInfo: { flex: 1, minWidth: 0 },
  sentTitle: { color: colors.good, fontSize: 14, fontWeight: '800' },
  sentSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  sentBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, minHeight: 44, justifyContent: 'center' },
  sentGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent' },
  sentGhostText: { color: colors.text, fontSize: 14, fontWeight: '800' },
  sentPrimary: { backgroundColor: colors.accent },
  sentPrimaryText: { color: colors.onAccent, fontSize: 14, fontWeight: '800' },
});
