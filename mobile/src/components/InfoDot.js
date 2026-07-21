import React, { useState } from 'react';
import { Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { HELP_BY_ID } from '../help';

// A small ⓘ affordance placed next to a computed feature. Tapping opens a popover
// with that topic's explanation — the same content as the Help screen, keyed by id,
// so the two never drift. Fails safe: an unknown id renders nothing.
export default function InfoDot({ id, size = 14, color = colors.textDim, style }) {
  const [open, setOpen] = useState(false);
  const topic = HELP_BY_ID[id];
  if (!topic) return null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={12} style={style} accessibilityRole="button" accessibilityLabel={`How this works: ${topic.title}`}>
        <Text style={[styles.dot, { fontSize: size, color }]}>ⓘ</Text>
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
            <Pressable style={styles.close} onPress={() => setOpen(false)}>
              <Text style={styles.closeText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  dot: { fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: '#000A', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 440, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 20 },
  title: { color: colors.text, fontSize: 17, fontWeight: '900', marginBottom: 12 },
  para: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: 10 },
  close: { marginTop: 6, alignSelf: 'flex-end', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.accent },
  closeText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
