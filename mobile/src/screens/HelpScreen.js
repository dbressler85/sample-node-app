import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { colors } from '../theme';
import { HELP } from '../help';
import useAndroidBack from '../useAndroidBack';

// "How it works" reference — every explanation the ⓘ dots link to, in one place.
// Reached from Settings. Content lives in src/help.js so the dots and this screen
// never disagree.
export default function HelpScreen({ onBack }) {
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Settings</Text></Pressable>
        <Text style={styles.title}>How it works</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.intro}>
          The app leans on a few models to turn 15 leagues into one view. Here’s exactly how each number and label is figured — no black boxes.
        </Text>
        {HELP.map((topic) => (
          <View key={topic.id} style={styles.card}>
            <Text style={styles.cardTitle}>{topic.title}</Text>
            {topic.body.map((p, i) => (
              <Text key={i} style={styles.para}>{p}</Text>
            ))}
          </View>
        ))}
        <Text style={styles.footNote}>
          Values and grades are estimates to guide decisions, not gospel — your league’s tendencies always matter.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 70 },
  title: { color: colors.text, fontSize: 17, fontWeight: '900' },
  list: { padding: 16, paddingBottom: 40 },
  intro: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  para: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: 10 },
  footNote: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 17, fontStyle: 'italic' },
});
