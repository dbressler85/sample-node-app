import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme';
import { GlyphMark } from './NeonGlyphs';

// A one-time instructional note the daily power user can retire. It renders its children (rich text
// allowed) with a corner ✕; dismissing persists a per-`id` flag so the note stays gone across launches
// (usability backlog #27 — persistent explainers were a standing vertical tax). Best-effort storage:
// any error just means the note might reappear, never a crash. Starts hidden until the flag resolves,
// so a note you've already dismissed never flashes in on open.
const PREFIX = 'dc_note_dismissed_';

export default function DismissibleNote({ id, style, children }) {
  const [state, setState] = useState('loading'); // 'loading' | 'shown' | 'hidden'
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(PREFIX + id)
      .then((v) => { if (alive) setState(v === '1' ? 'hidden' : 'shown'); })
      .catch(() => { if (alive) setState('shown'); });
    return () => { alive = false; };
  }, [id]);

  if (state !== 'shown') return null;

  const dismiss = () => {
    setState('hidden');
    AsyncStorage.setItem(PREFIX + id, '1').catch(() => {});
  };

  return (
    <View style={[styles.wrap, style]}>
      {children}
      <Pressable onPress={dismiss} hitSlop={10} style={styles.x} accessibilityRole="button" accessibilityLabel="Dismiss this tip">
        <GlyphMark name="x" size={14} color={colors.textDim} weight={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Reserve room on the right so the content never runs under the dismiss control.
  wrap: { position: 'relative', paddingRight: 24 },
  x: { position: 'absolute', right: 2, top: -2, paddingHorizontal: 6, paddingVertical: 4 },
});
