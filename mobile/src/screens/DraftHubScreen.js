import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import ErrorView from '../components/ErrorView';
import useAndroidBack from '../useAndroidBack';
import usePoll from '../usePoll';

// Cross-league draft hub: every league's draft in one place, grouped by what needs
// you now — on the clock first, then live, then scheduled, then done. During draft
// season a manager running several drafts can see where it's their turn and jump
// straight in, instead of hunting league by league. (Returning from a pick
// remounts this screen, so it re-fetches the latest state.)

function formatWhen(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const pad = (n) => String(n).padStart(2, '0');
// round.pick (e.g. 4.05), plus overall as an ordinal (41st).
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export default function DraftHubScreen({ onBack, onOpenDraft }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.drafts());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const drafts = (data && data.drafts) || [];
  // Poll while any draft is live or on the clock, so a new "your turn" appears
  // across leagues without a manual refresh.
  usePoll(load, 15000, drafts.some((d) => d.myOnClock || d.status === 'in_progress'));
  const onClock = drafts.filter((d) => d.myOnClock);
  const live = drafts.filter((d) => !d.myOnClock && d.status === 'in_progress');
  const scheduled = drafts.filter((d) => d.status === 'scheduled')
    .sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0));
  const done = drafts.filter((d) => d.status === 'complete');
  const summary = data && data.summary;

  const open = (d) => onOpenDraft({ leagueId: d.leagueId, name: d.name });

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Home</Text>
        </Pressable>
        <Text style={styles.title}>Draft Hub</Text>
        <View style={{ width: 54 }} />
      </View>
      {summary ? (
        <Text style={styles.subtitle}>
          {summary.onClock ? <Text style={{ color: colors.gold, fontWeight: '800' }}>{`${summary.onClock} on the clock`}</Text> : 'None on the clock'}
          {`  ·  ${summary.live} live  ·  ${summary.scheduled} scheduled`}
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <ErrorView message={error} onRetry={() => { setLoading(true); load(); }} refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
      ) : drafts.length === 0 ? (
        <View style={styles.center}><Text style={styles.emptyText}>No drafts across your leagues right now.</Text></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
        >
          {onClock.length ? (
            <Section label="On the clock — you">
              {onClock.map((d) => (
                <Pressable key={d.leagueId} style={({ pressed }) => [styles.row, styles.rowClock, pressed && { opacity: 0.75 }]} onPress={() => open(d)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
                    <Text style={styles.subClock}>Your pick is in{d.type ? ` · ${d.type}` : ''}</Text>
                  </View>
                  <Text style={styles.pickPill}>PICK</Text>
                </Pressable>
              ))}
            </Section>
          ) : null}

          {live.length ? (
            <Section label={`Live · ${live.length}`}>
              {live.map((d) => (
                <Row key={d.leagueId} d={d} onPress={() => open(d)}
                  sub={d.myNextPick ? `Live · your pick ${d.myNextPick.round}.${pad(d.myNextPick.pick)} · ${ordinal(d.myNextPick.overall)} overall` : `Live · ${d.picksMade} picks made`} />
              ))}
            </Section>
          ) : null}

          {scheduled.length ? (
            <Section label={`Scheduled · ${scheduled.length}`}>
              {scheduled.map((d) => (
                <Row key={d.leagueId} d={d} onPress={() => open(d)}
                  sub={`Scheduled${formatWhen(d.startTime) ? ` · ${formatWhen(d.startTime)}` : ''}`} />
              ))}
            </Section>
          ) : null}

          {done.length ? (
            <Section label={`Completed · ${done.length}`}>
              {done.map((d) => (
                <Row key={d.leagueId} d={d} muted onPress={() => open(d)} sub={`Complete · ${d.picksMade} picks`} />
              ))}
            </Section>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Section({ label, children }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={styles.section}>{label}</Text>
      {children}
    </View>
  );
}

function Row({ d, sub, onPress, muted }) {
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, muted && { color: colors.textDim }]} numberOfLines={1}>{d.name}</Text>
        <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 54 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4 },
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 },
  section: { color: colors.textDim, fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 14, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 15, marginBottom: 8 },
  rowClock: { borderColor: colors.gold, backgroundColor: colors.cardAlt },
  name: { color: colors.text, fontSize: 15, fontWeight: '800' },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  subClock: { color: colors.gold, fontSize: 12, marginTop: 3, fontWeight: '700' },
  pickPill: { color: '#20180a', backgroundColor: colors.gold, fontSize: 11, fontWeight: '900', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', letterSpacing: 0.5 },
  chev: { color: colors.textDim, fontSize: 20, fontWeight: '700', marginLeft: 8 },
  error: { color: colors.bad, textAlign: 'center' },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center' },
});
