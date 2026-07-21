import React from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { colors } from '../theme';

// A recoverable error state. Always offers Retry so a failed load is never a dead-end;
// when given onRefresh it also stays pull-to-refreshable (wraps itself in a scroll view
// with a RefreshControl), matching the successful-list behavior.
export default function ErrorView({ message, onRetry, onRefresh, refreshing }) {
  const body = (
    <View style={styles.wrap}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>Couldn’t load this</Text>
      {message ? <Text style={styles.msg}>{message}</Text> : null}
      {onRetry ? (
        <Pressable style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]} onPress={onRetry}>
          <Text style={styles.btnText}>Retry</Text>
        </Pressable>
      ) : null}
      {onRefresh ? <Text style={styles.hint}>or pull down to refresh</Text> : null}
    </View>
  );
  if (!onRefresh) return body;
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center' },
  wrap: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 4 },
  icon: { fontSize: 34, marginBottom: 6 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  msg: { color: colors.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 4, maxWidth: 320 },
  btn: { marginTop: 16, backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 26, paddingVertical: 10 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 10 },
});
