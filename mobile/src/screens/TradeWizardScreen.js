import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { appAlert } from '../components/AppAlert';
import { colors } from '../theme';
import useAndroidBack from '../useAndroidBack';
import TradesScreen from './TradesScreen';

// Shop one player across several leagues in a row. Given a queue of trade contexts
// (one per league you checked), it steps through them: each step is the full trade desk
// for that league, seeded with the target + a needs-fitting suggestion. After an offer is
// sent, you choose to send ANOTHER option to the same owner (common — multiple packages for
// one player) or move to the next league; finishing the last one closes the wizard.
export default function TradeWizardScreen({ queue, onExit, onOpenPlayer }) {
  const [index, setIndex] = useState(0);
  const [reseed, setReseed] = useState(0); // bump → remount the desk for another offer in the SAME league
  const total = queue.length;
  const cur = queue[index];

  const advance = useCallback(() => {
    setReseed(0);
    setIndex((i) => {
      if (i + 1 < total) return i + 1;
      onExit();
      return i;
    });
  }, [total, onExit]);

  // A sent offer no longer auto-advances: sending several options to one owner is common, so ask.
  // "Send another" re-seeds a fresh propose desk for the SAME league/partner; "Next league" moves on.
  const onSent = useCallback(() => {
    const last = index + 1 >= total;
    appAlert('Offer sent', `Send another option to ${(cur && cur.partnerName) || 'this owner'} in ${cur ? cur.name : 'this league'}, or move on?`, [
      { text: 'Send another', onPress: () => setReseed((n) => n + 1) },
      { text: last ? 'Done' : 'Next league', style: 'cancel', onPress: advance },
    ]);
  }, [index, total, cur, advance]);

  // Hardware back exits the whole wizard (the desk below consumes its own sheets first).
  useAndroidBack(useCallback(() => { onExit(); return true; }, [onExit]));

  if (!cur) return null;

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <Pressable onPress={onExit} hitSlop={10}><Text style={styles.close}>✕</Text></Pressable>
        <View style={styles.progressWrap}>
          <Text style={styles.step}>League {index + 1} of {total}</Text>
          <View style={styles.track}>
            {queue.map((_, i) => (
              <View key={i} style={[styles.pip, i <= index && styles.pipOn]} />
            ))}
          </View>
        </View>
        <Pressable onPress={advance} hitSlop={10}>
          <Text style={styles.skip}>{index + 1 < total ? 'Skip ›' : 'Done'}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  close: { color: colors.textDim, fontSize: 18, fontWeight: '800', width: 40 },
  skip: { color: colors.accent, fontSize: 14, fontWeight: '800', width: 52, textAlign: 'right' },
  progressWrap: { flex: 1, alignItems: 'center' },
  step: { color: colors.text, fontSize: 13, fontWeight: '800' },
  track: { flexDirection: 'row', gap: 4, marginTop: 5 },
  pip: { width: 16, height: 3, borderRadius: 2, backgroundColor: colors.border },
  pipOn: { backgroundColor: colors.accent },
  deck: { flex: 1 },
});
