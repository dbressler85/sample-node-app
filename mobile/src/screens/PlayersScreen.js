import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, TextInput, ActivityIndicator, Linking } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import AvailabilityBadge from '../components/AvailabilityBadge';

const TABS = [
  ['rankings', 'Rankings'],
  ['mine', 'My Players'],
  ['news', 'News'],
];
const RANK_TYPES = [
  ['value', 'Value'],
  ['trending', 'Trending'],
  ['rookies', 'Rookies'],
];

export default function PlayersScreen({ onOpenPlayer }) {
  const [query, setQuery] = useState('');
  const [searchRes, setSearchRes] = useState(null);
  const [tab, setTab] = useState('rankings');
  const [rankType, setRankType] = useState('value');
  const [rankings, setRankings] = useState(null);
  const [mine, setMine] = useState(null);
  const [news, setNews] = useState(null);
  const [error, setError] = useState(null);

  // Debounced search on query change — wait ~300ms after the last keystroke so a
  // multi-character name fires one request, not one per letter.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchRes(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      api.playerSearch(q).then((r) => alive && setSearchRes(r)).catch((e) => alive && setError(e.message));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const loadRankings = useCallback(() => {
    api.playerRankings(rankType).then(setRankings).catch((e) => setError(e.message));
  }, [rankType]);

  useEffect(() => {
    if (tab === 'rankings') loadRankings();
    if (tab === 'mine' && !mine) api.exposure().then(setMine).catch((e) => setError(e.message));
    if (tab === 'news' && !news) api.news().then(setNews).catch((e) => setError(e.message));
  }, [tab, loadRankings, mine, news]);

  const searching = query.trim().length >= 2;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Players</Text>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search any player…"
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Text style={styles.clear}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Pressable onPress={() => setError(null)}>
          <Text style={styles.errorBanner}>{error} · tap to dismiss</Text>
        </Pressable>
      ) : null}

      {searching ? (
        !searchRes ? (
          <Center><ActivityIndicator color={colors.accent} /></Center>
        ) : (
          <FlatList
            data={searchRes.players}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => <PlayerRow p={item} onPress={() => onOpenPlayer(item.id)} />}
            ListEmptyComponent={<Text style={styles.empty}>No players match “{query}”.</Text>}
          />
        )
      ) : (
        <>
          <View style={styles.segment}>
            {TABS.map(([k, label]) => (
              <Pressable key={k} style={[styles.seg, tab === k && styles.segActive]} onPress={() => setTab(k)}>
                <Text style={[styles.segText, tab === k && styles.segTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {tab === 'rankings' ? (
            <>
              <View style={styles.typeRow}>
                {RANK_TYPES.map(([k, label]) => (
                  <Pressable key={k} style={[styles.typeChip, rankType === k && styles.typeChipActive]} onPress={() => setRankType(k)}>
                    <Text style={[styles.typeText, rankType === k && { color: colors.text }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <FlatList
                data={rankings ? rankings.players : []}
                keyExtractor={(p) => p.id}
                contentContainerStyle={styles.list}
                renderItem={({ item, index }) => <PlayerRow p={item} rank={index + 1} onPress={() => onOpenPlayer(item.id)} />}
                ListEmptyComponent={
                  !rankings ? (
                    <Center><ActivityIndicator color={colors.accent} /></Center>
                  ) : (
                    <Text style={styles.note}>{rankings.note || 'No players to rank.'}</Text>
                  )
                }
              />
            </>
          ) : tab === 'mine' ? (
            <FlatList
              data={mine ? mine.players : []}
              keyExtractor={(p) => p.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => <PlayerRow p={item} sub={`${item.count} leagues · ${item.startingCount} starting`} onPress={() => onOpenPlayer(item.id)} />}
              ListEmptyComponent={
                !mine ? (
                  <Center><ActivityIndicator color={colors.accent} /></Center>
                ) : (
                  <Text style={styles.note}>You don’t roster any players yet.</Text>
                )
              }
            />
          ) : (
            <FlatList
              data={news ? news.news : []}
              keyExtractor={(n) => n.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <NewsRow n={item} onPress={() => (item.url ? Linking.openURL(item.url).catch(() => {}) : item.player.id && onOpenPlayer(item.player.id))} />
              )}
              ListEmptyComponent={
                !news ? (
                  <Center><ActivityIndicator color={colors.accent} /></Center>
                ) : (
                  <Text style={styles.note}>No news affecting your rostered players right now.</Text>
                )
              }
            />
          )}
        </>
      )}
    </View>
  );
}

function PlayerRow({ p, rank, sub, onPress }) {
  const posColor = positionColors[p.position] || colors.textDim;
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} onPress={onPress}>
      {rank ? <Text style={styles.rank}>{rank}</Text> : null}
      <View style={[styles.posBadge, { backgroundColor: posColor + '22', borderColor: posColor }]}>
        <Text style={[styles.pos, { color: posColor }]}>{p.position}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
          <AvailabilityBadge availability={p.availability} style={{ marginLeft: 6 }} />
          {p.mine ? <Text style={styles.mine}>YOURS</Text> : null}
        </View>
        <Text style={styles.meta}>
          {p.team}
          {p.posRank ? ` · ${p.position}${p.posRank}` : ''}
          {p.ownership != null ? ` · ${p.ownership}% rost` : ''}
          {sub ? ` · ${sub}` : ''}
        </Text>
      </View>
      {p.value != null ? <Text style={styles.value}>{p.value}</Text> : null}
    </Pressable>
  );
}

function NewsRow({ n, onPress }) {
  const sev = n.severity === 'high' ? colors.bad : n.severity === 'medium' ? colors.warn : colors.textDim;
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={[styles.dot, { backgroundColor: sev }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.newsHead} numberOfLines={2}>{n.headline}</Text>
        <Text style={styles.meta}>
          {n.affectedCount > 0 ? `Affects ${n.affectedCount} of your teams${n.startingCount ? ` · starting in ${n.startingCount}` : ''}` : 'Not on your rosters'}
        </Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

function Center({ children }) {
  return <View style={styles.center}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { padding: 30, alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, marginBottom: 8 },
  search: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 12 },
  clear: { color: colors.textDim, fontSize: 16, paddingHorizontal: 6 },
  segment: { flexDirection: 'row', marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3, marginBottom: 6 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segActive: { backgroundColor: colors.cardAlt },
  segText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  segTextActive: { color: colors.text },
  typeRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, paddingVertical: 6 },
  typeChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 6 },
  typeChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  typeText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10 },
  rank: { color: colors.textDim, fontSize: 13, fontWeight: '800', width: 22 },
  posBadge: { width: 40, paddingVertical: 2, borderRadius: 6, borderWidth: 1, alignItems: 'center', marginRight: 10 },
  pos: { fontSize: 11, fontWeight: '800' },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  mine: { color: colors.good, fontSize: 9, fontWeight: '900', marginLeft: 6, borderWidth: 1, borderColor: colors.good, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  value: { color: colors.gold, fontSize: 15, fontWeight: '900', marginLeft: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  newsHead: { color: colors.text, fontSize: 14, fontWeight: '700' },
  chev: { color: colors.textDim, fontSize: 20, marginLeft: 8 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 24 },
  note: { color: colors.textDim, textAlign: 'center', marginTop: 40, marginHorizontal: 28, fontSize: 14, lineHeight: 20 },
  errorBanner: { color: colors.bad, backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
