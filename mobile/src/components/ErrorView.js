import React from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { colors, space, size, radius } from '../theme';
import Button from './Button';

// A recoverable error state. Always offers Retry so a failed load is never a dead-end;
// when given onRefresh it also stays pull-to-refreshable (wraps itself in a scroll view
// with a RefreshControl), matching the successful-list behavior. Uses the shared Button
// (so the Retry label passes contrast) and a bad-tinted bar instead of an emoji.
export default function ErrorView({ message, onRetry, onRefresh, refreshing }) {
  const body = (
    <View style={styles.wrap}>
      <View style={styles.bar} />
      <Text style={styles.title}>Couldn’t load this</Text>
      {message ? <Text style={styles.msg}>{message}</Text> : null}
      {onRetry ? <Button title="Retry" onPress={onRetry} style={styles.retry} /> : null}
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
  wrap: { alignItems: 'center', justifyContent: 'center', padding: space.xxxl, gap: space.xs },
  bar: { width: 30, height: 3, borderRadius: radius.pill, backgroundColor: colors.bad, marginBottom: space.md, opacity: 0.9 },
  title: { color: colors.text, fontSize: size.title, fontWeight: '800' },
  msg: { color: colors.textDim, fontSize: size.bodySm, textAlign: 'center', lineHeight: 20, marginTop: space.xs, maxWidth: 320 },
  retry: { marginTop: space.lg, paddingHorizontal: space.xxl },
  hint: { color: colors.textDim, fontSize: size.caption, marginTop: space.md },
});
