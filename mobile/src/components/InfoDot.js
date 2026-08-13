import React, { useState } from 'react';
import { Text, View, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { GlyphMark } from './NeonGlyphs';
import { HELP_BY_ID } from '../help';
import { useNavTools } from './NavTools';

// A small info affordance placed next to a computed feature. Tapping opens a popover
// with that topic's explanation — the same content as the Help screen, keyed by id,
// so the two never drift. Fails safe: an unknown id renders nothing. The popover also
// offers "Open full guide" → the Help screen scrolled to this topic (#10). The mark is the
// shared vector `info` glyph (DESIGN_SYSTEM.md §11 — no emoji), replacing the bare ⓘ.
export default function InfoDot({ id, size = 14, color = colors.textDim, style }) {
  const [open, setOpen] = useState(false);
  const { openHelp } = useNavTools();
  const topic = HELP_BY_ID[id];
  if (!topic) return null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={16} style={style} accessibilityRole="button" accessibilityLabel={`How this works: ${topic.title}`}>
        <GlyphMark name="info" size={size + 3} color={color} weight={1.8} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>{topic.title}</Text>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {topic.body.map((p, i) => (
                <Text key={i} style={styles.para}>{p}</Text>
              ))}
            </ScrollView>
            <View style={styles.actions}>
              {openHelp ? (
                <Pressable onPress={() => { setOpen(false); openHelp(id); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open the full guide at this topic">
                  <Text style={styles.guideText}>Open full guide ›</Text>
                </Pressable>
              ) : null}
              <View style={{ flex: 1 }} />
              <Pressable style={styles.close} onPress={() => setOpen(false)}>
                <Text style={styles.closeText}>Got it</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 440, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 20 },
  title: { color: colors.text, fontSize: 17, fontWeight: '900', marginBottom: 12 },
  para: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  guideText: { color: colors.accent, fontWeight: '800', fontSize: 13 },
  close: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.accent },
  closeText: { color: colors.onAccent, fontWeight: '800', fontSize: 14 },
});
