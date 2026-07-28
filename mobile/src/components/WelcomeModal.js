import React from 'react';
import { Modal, View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { displayXL, displayLabel } from '../typography';
import NeonCrest from './NeonCrest';
import NeonSign from './NeonSign';
import PressableScale from './PressableScale';

// First-run intro (shown once, after the login ceremony settles). Dual purpose: it orients a brand-new
// user AND buys time — while they read, the app is fanning out the (slow, first-time) per-league reads
// behind it, so the Hub is warm by the time they tap Enter.
const POINTS = [
  {
    glyph: 'swap',
    color: 'accent',
    title: 'One login, every league',
    body: 'Manage trades, waivers, lineups, and rosters across all of your MyFantasyLeague dynasty leagues at once — that’s the whole point: multi-league management without logging in league by league.',
  },
  {
    glyph: 'hourglass',
    color: 'warn',
    title: 'Loading your leagues now',
    body: 'In a lot of leagues? The first load takes a moment — we pull live data from MFL for each one, and MFL limits how fast we can read. It’s much quicker after this: everything caches on your device, so reopening is instant.',
  },
  {
    glyph: 'dollar',
    color: 'gold',
    title: 'Values from FantasyCalc',
    body: 'Player and pick values are live dynasty-market values from FantasyCalc, so trade grades and portfolio math reflect the real market — not a static list.',
  },
  {
    glyph: 'star',
    color: 'watch',
    title: 'Tap a player, anywhere',
    body: 'Open any player to see how you hold him across every league, his news, and his value. Star ☆ players to track them on your cross-league Watchlist.',
  },
  {
    glyph: 'lock',
    color: 'cold',
    title: 'Your credentials stay yours',
    body: 'Your MFL login goes only to your own backend, which signs in to MFL on your behalf. Your password is never stored.',
  },
];

export default function WelcomeModal({ visible, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} bounces={false}>
            <View style={styles.crestWrap}>
              <NeonCrest size={88} ignited animate={false} />
            </View>
            <Text style={[styles.kicker, displayLabel()]}>WELCOME TO</Text>
            <Text style={[styles.title, displayXL()]}>Dynasty Central</Text>
            <Text style={styles.sub}>All your dynasties, centralized.</Text>

            <View style={styles.points}>
              {POINTS.map((p) => (
                <View key={p.title} style={styles.point}>
                  <NeonSign glyph={p.glyph} color={p.color} grade="inline" size={18} style={styles.pointIcon} />
                  <View style={styles.pointText}>
                    <Text style={styles.pointTitle}>{p.title}</Text>
                    <Text style={styles.pointBody}>{p.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
          <PressableScale style={styles.btn} onPress={onClose}>
            <Text style={styles.btnText}>Enter</Text>
          </PressableScale>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(4,7,14,0.82)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '88%',
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
  },
  scroll: { paddingBottom: 6 },
  crestWrap: { alignItems: 'center', marginBottom: 6 },
  kicker: { color: colors.violetText, fontSize: 12, fontWeight: '700', letterSpacing: 4, textAlign: 'center', marginLeft: 4 },
  title: { color: colors.text, fontSize: 30, fontWeight: '900', textAlign: 'center', letterSpacing: -0.5, marginTop: 2 },
  sub: { color: colors.textDim, fontSize: 14, textAlign: 'center', marginTop: 6, marginBottom: 18 },
  points: { gap: 16 },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pointIcon: { marginTop: 2 },
  pointText: { flex: 1 },
  pointTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 2 },
  pointBody: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  btn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  btnText: { color: colors.onAccent, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
});
