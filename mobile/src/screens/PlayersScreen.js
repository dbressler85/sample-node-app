import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, TextInput, ActivityIndicator, Linking, ScrollView } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import AvailabilityBadge from '../components/AvailabilityBadge';
import { TargetIcon, AvoidIcon, WatchIcon } from '../components/PlayerActionIcons';
import { getValue, setValue } from '../cache';
import InfoDot from '../components/InfoDot';
import Pulse from '../components/Pulse';
import Reveal from '../components/Reveal';
import { ScreenTitle, Value } from '../components/Brand';

const TABS = [
  ['rankings', 'Rankings'],
  ['watch', 'Watch'],
  ['mine', 'My Players'],
  ['news', 'News'],
];
const RANK_TYPES = [
  ['value', 'Market value'],
  ['myvalue', 'My value'],
  ['owned', 'Most owned'],
  ['trending', 'Trending'],
];
const POSITIONS = [
  [null, 'All'],
  ['QB', 'QB'],
  ['RB', 'RB'],
  ['WR', 'WR'],
  ['TE', 'TE'],
  ['K', 'K'],
  ['DEF', 'DEF'],
];

function matchNews(n, q) {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return (n.headline && n.headline.toLowerCase().includes(t)) || (n.player && n.player.name && n.player.name.toLowerCase().includes(t));
}

// Compact "how long ago" for a news item's publish time (falls back to a short date).
function timeAgo(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Secondary sort for the player lists (Rankings / My Players / Watch). 'default' keeps the
// list's natural order (the rank type on Rankings; the server order elsewhere).
const LIST_SORTS = [['default', 'Default'], ['value', 'Value'], ['name', 'Name'], ['position', 'Pos']];
const POS_ORDER = { QB: 1, RB: 2, WR: 3, TE: 4, PK: 5, K: 5, DEF: 6 };
function sortPlayers(list, key) {
  if (!key || key === 'default') return list;
  const arr = [...list];
  if (key === 'value') return arr.sort((a, b) => (b.value || 0) - (a.value || 0));
  if (key === 'name') return arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  if (key === 'position') return arr.sort((a, b) => (POS_ORDER[a.position] || 9) - (POS_ORDER[b.position] || 9) || (b.value || 0) - (a.value || 0));
  return arr;
}

const NEWS_SORTS = [['impact', 'Impact'], ['recent', 'Recent']];
const SEV_RANK = { high: 3, medium: 2, low: 1 };
function sortNews(list, key) {
  const arr = [...list];
  if (key === 'recent') return arr.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  // impact: severity, then how many of your teams start him, then affected count.
  return arr.sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0) || (b.startingCount - a.startingCount) || (b.affectedCount - a.affectedCount));
}

export default function PlayersScreen({ onOpenPlayer }) {
  const [query, setQuery] = useState('');
  const [searchRes, setSearchRes] = useState(null);
  const [tab, setTab] = useState('rankings');
  const [rankType, setRankType] = useState('value');
  const [rankings, setRankings] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mine, setMine] = useState(null);
  const [news, setNews] = useState(null);
  const [watch, setWatch] = useState(null);
  const [error, setError] = useState(null);
  const [pos, setPos] = useState(null); // position filter (null = All), applies to rankings/search/mine
  const [format, setFormat] = useState('1qb'); // value lens: '1qb' | 'sf' — re-prices & resorts the board
  const [newsQuery, setNewsQuery] = useState(''); // in-tab News filter
  const [newsSort, setNewsSort] = useState('impact'); // News tab sort: 'impact' | 'recent'
  const [listSort, setListSort] = useState('default'); // secondary sort for Rankings/My Players/Watch
  const [tagOverride, setTagOverride] = useState({}); // id -> 'target'|'avoid'|null (optimistic)
  const [watchOverride, setWatchOverride] = useState({}); // id -> bool (optimistic)

  // Debounced search on query change (or the position filter) — wait ~300ms after the last
  // keystroke so a multi-character name fires one request, not one per letter.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchRes(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      api.playerSearch(q, { position: pos, format }).then((r) => alive && setSearchRes(r)).catch((e) => alive && setError(e.message));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, pos, format]);

  const loadRankings = useCallback(async () => {
    try {
      const res = await api.playerRankings(rankType, pos, format);
      setRankings(res);
      // Cache only page 0 — later pages append in-memory and are re-fetched on scroll.
      setValue(`players:rankings:${rankType}:${pos || 'all'}:${format}`, res);
    } catch (e) {
      setError(e.message);
    }
  }, [rankType, pos, format]);

  // Infinite scroll: fetch the next window and append. Guard on loadingMore so the
  // FlatList's onEndReached (which can fire repeatedly) only kicks off one fetch, and
  // stop once the server says there's nothing more.
  const loadMoreRankings = useCallback(async () => {
    if (loadingMore || !rankings || !rankings.hasMore) return;
    setLoadingMore(true);
    try {
      const res = await api.playerRankings(rankType, pos, format, rankings.players.length);
      // Ignore a stale page if the rank type / filters changed while it was in flight.
      setRankings((cur) =>
        cur && cur.type === res.type && cur.position === res.position && cur.format === res.format
          ? { ...res, players: [...cur.players, ...res.players] }
          : cur
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, rankings, rankType, pos, format]);

  // Rankings tab uses stale-while-revalidate: paint the cached list for this rank
  // type instantly, then refresh. (Search is transient; My Players / News / Watch
  // load fresh when opened.)
  useEffect(() => {
    if (tab !== 'rankings') return undefined;
    let alive = true;
    setRankings(null);
    getValue(`players:rankings:${rankType}:${pos || 'all'}:${format}`).then((cached) => {
      if (alive && cached != null) setRankings(cached);
      if (alive) loadRankings();
    });
    return () => { alive = false; };
  }, [tab, rankType, pos, format, loadRankings]);

  useEffect(() => {
    if (tab === 'mine' && !mine) api.exposure().then(setMine).catch((e) => setError(e.message));
    if (tab === 'news' && !news) api.news().then(setNews).catch((e) => setError(e.message));
    // Watchlist changes as you star players elsewhere, so refetch each time the
    // tab is opened rather than caching it.
    if (tab === 'watch') { setWatch(null); api.watchlist().then(setWatch).catch((e) => setError(e.message)); }
  }, [tab, mine, news]);

  // Inline Target/Avoid/Watch toggles. Optimistic: flip a per-id override immediately,
  // reconcile with the server, and revert the override if the write fails. Overrides win
  // over the row's server-sent tag/watched so every list reflects the action at once.
  const onTag = useCallback((id, next, prev) => {
    setTagOverride((m) => ({ ...m, [id]: next }));
    api.setTag(id, next).catch(() => { setTagOverride((m) => ({ ...m, [id]: prev })); setError('Could not update tag'); });
  }, []);
  const onWatch = useCallback((id, next) => {
    setWatchOverride((m) => ({ ...m, [id]: next }));
    (next ? api.watchAdd(id) : api.watchRemove(id)).catch(() => { setWatchOverride((m) => ({ ...m, [id]: !next })); setError('Could not update watchlist'); });
  }, []);
  const resolveTag = (p) => (p.id in tagOverride ? tagOverride[p.id] : (p.tag || null));
  const resolveWatch = (p) => (p.id in watchOverride ? watchOverride[p.id] : !!p.watched);
  const rowActions = { onTag, onWatch };

  const searching = query.trim().length >= 2;

  // A player's rank in the CURRENT rank type's natural order, so the rank number stays true
  // even when the list is re-sorted by name/position (you still see where he ranks).
  const rankById = {};
  if (rankings) rankings.players.forEach((p, i) => { rankById[p.id] = i + 1; });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ScreenTitle>Players</ScreenTitle>
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
        <>
          <PosFilter pos={pos} setPos={setPos} />
          {searchRes && searchRes.players.length ? (
            <LensSortRow format={format} setFormat={setFormat} sort={listSort} onSort={setListSort} />
          ) : (
            <ValueLens format={format} setFormat={setFormat} />
          )}
          {!searchRes ? (
            <PlayerListSkeleton />
          ) : (
            <FlatList
              data={sortPlayers(searchRes.players, listSort)}
              keyExtractor={(p) => p.id}
              extraData={{ tagOverride, watchOverride, listSort }}
              contentContainerStyle={styles.list}
              renderItem={({ item, index }) => <Reveal delay={Math.min(index, 12) * 32} animate={index < 14}><PlayerRow p={item} tag={resolveTag(item)} watched={resolveWatch(item)} {...rowActions} onPress={() => onOpenPlayer(item.id)} /></Reveal>}
              ListEmptyComponent={<Text style={styles.empty}>No players match “{query}”.</Text>}
            />
          )}
        </>
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
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll} contentContainerStyle={styles.typeScrollRow}>
                  {RANK_TYPES.map(([k, label]) => (
                    <Pressable key={k} style={[styles.typeChip, rankType === k && styles.typeChipActive]} onPress={() => setRankType(k)}>
                      <Text style={[styles.typeText, rankType === k && { color: colors.text }]}>{label}</Text>
                    </Pressable>
                  ))}
                  <View style={styles.typeInfo}><InfoDot id="ranking" size={16} /></View>
                </ScrollView>
              </View>
              <PosFilter pos={pos} setPos={setPos} rankType={rankType} setRankType={setRankType} />
              <LensSortRow format={format} setFormat={setFormat} sort={listSort} onSort={setListSort} />
              <FlatList
                style={styles.grow}
                data={rankings ? sortPlayers(rankings.players, listSort) : []}
                keyExtractor={(p) => p.id}
                extraData={{ tagOverride, watchOverride, listSort }}
                contentContainerStyle={styles.list}
                renderItem={({ item, index }) => <Reveal delay={Math.min(index, 12) * 32} animate={index < 14}><PlayerRow p={item} rank={rankById[item.id]} tag={resolveTag(item)} watched={resolveWatch(item)} showTrend={rankType === 'trending'} {...rowActions} onPress={() => onOpenPlayer(item.id)} /></Reveal>}
                onEndReached={loadMoreRankings}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                  loadingMore ? (
                    <ActivityIndicator style={styles.loadMore} color={colors.gold} />
                  ) : null
                }
                ListEmptyComponent={
                  !rankings ? (
                    <PlayerListSkeleton />
                  ) : (
                    <Text style={styles.note}>{rankings.note || 'No players to rank.'}</Text>
                  )
                }
              />
            </>
          ) : tab === 'watch' ? (
            <>
              {watch && watch.players.length ? <SortRow value={listSort} onChange={setListSort} /> : null}
              <FlatList
              data={watch ? sortPlayers(watch.players, listSort) : []}
              keyExtractor={(p) => p.id}
              extraData={{ listSort }}
              contentContainerStyle={styles.list}
              renderItem={({ item, index }) => <Reveal delay={Math.min(index, 12) * 32} animate={index < 14}><WatchRow p={item} onPress={() => onOpenPlayer(item.id)} /></Reveal>}
              ListEmptyComponent={
                !watch ? (
                  <Center><ActivityIndicator color={colors.accent} /></Center>
                ) : (
                  <Text style={styles.note}>No players on your watchlist yet. Open a player and tap ☆ Watch to track him across your leagues.</Text>
                )
              }
            />
            </>
          ) : tab === 'mine' ? (
            <>
              <PosFilter pos={pos} setPos={setPos} />
              <SortRow value={listSort} onChange={setListSort} />
              <FlatList
                data={mine ? sortPlayers(mine.players.filter((p) => !pos || p.position === pos), listSort) : []}
                keyExtractor={(p) => p.id}
                extraData={{ tagOverride, watchOverride }}
                contentContainerStyle={styles.list}
                renderItem={({ item, index }) => <Reveal delay={Math.min(index, 12) * 32} animate={index < 14}><PlayerRow p={item} sub={`${item.count} leagues · ${item.startingCount} starting`} tag={resolveTag(item)} watched={resolveWatch(item)} {...rowActions} onPress={() => onOpenPlayer(item.id)} /></Reveal>}
                ListEmptyComponent={
                  !mine ? (
                    <PlayerListSkeleton />
                  ) : (
                    <Text style={styles.note}>{pos ? `You don’t roster any ${pos}s.` : 'You don’t roster any players yet.'}</Text>
                  )
                }
              />
            </>
          ) : (
            <>
              <View style={styles.newsSearchWrap}>
                <TextInput
                  style={styles.newsSearch}
                  placeholder="Filter news…"
                  placeholderTextColor={colors.textDim}
                  value={newsQuery}
                  onChangeText={setNewsQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {newsQuery ? (
                  <Pressable onPress={() => setNewsQuery('')} hitSlop={10}>
                    <Text style={styles.clear}>✕</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.newsSortRow}>
                <Text style={styles.newsSortLabel}>Sort</Text>
                {NEWS_SORTS.map(([k, label]) => (
                  <Pressable key={k} style={[styles.newsSortChip, newsSort === k && styles.newsSortChipActive]} onPress={() => setNewsSort(k)}>
                    <Text style={[styles.newsSortText, newsSort === k && { color: colors.text }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <FlatList
                data={news ? sortNews(news.news.filter((n) => matchNews(n, newsQuery)), newsSort) : []}
                keyExtractor={(n) => n.id}
                contentContainerStyle={styles.list}
                renderItem={({ item }) => (
                  <NewsRow n={item} onPress={() => (item.url ? Linking.openURL(item.url).catch(() => {}) : item.player.id && onOpenPlayer(item.player.id))} />
                )}
                ListEmptyComponent={
                  !news ? (
                    <Center><ActivityIndicator color={colors.accent} /></Center>
                  ) : (
                    <Text style={styles.note}>{newsQuery ? `No news matches “${newsQuery}”.` : 'No news affecting your rostered players right now.'}</Text>
                  )
                }
              />
            </>
          )}
        </>
      )}
    </View>
  );
}

function PlayerRow({ p, rank, sub, tag, watched, showTrend, onTag, onWatch, onPress }) {
  const posColor = positionColors[p.position] || colors.textDim;
  const t = tag !== undefined ? tag : p.tag || null;
  const w = watched !== undefined ? watched : !!p.watched;
  const acts = !!(onTag && onWatch);
  return (
    <Pressable style={({ pressed }) => [styles.row, { borderLeftColor: posColor, borderLeftWidth: 3 }, pressed && { opacity: 0.7 }]} onPress={onPress}>
      {rank ? <Text style={styles.rank}>{rank}</Text> : null}
      <View style={[styles.posBadge, { backgroundColor: posColor + '22', borderColor: posColor }]}>
        <Text style={[styles.pos, { color: posColor }]}>{p.position}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
          <AvailabilityBadge availability={p.availability} style={{ marginLeft: 6 }} />
          {p.mineInLeagues > 0 || p.mine ? (
            <Text style={styles.mine}>{p.mineInLeagues > 1 ? `YOURS ×${p.mineInLeagues}` : 'YOURS'}</Text>
          ) : null}
        </View>
        <Text style={styles.meta}>
          {p.team}
          {p.age != null ? ` · ${p.age}y` : ''}
          {p.posRank ? ` · ${p.position}${p.posRank}` : ''}
          {p.leagueCount > 1 && p.leagueOwned != null ? ` · rostered ${p.leagueOwned}/${p.leagueCount}` : ''}
          {sub ? ` · ${sub}` : ''}
        </Text>
      </View>
      <View style={styles.rightCol}>
        {showTrend && p.trend ? (
          <View style={styles.trendBox}>
            <Text style={styles.trend}>▲ {Math.round(p.trend).toLocaleString()}</Text>
            <Text style={styles.trendUnit}>adds/48h</Text>
          </View>
        ) : p.value != null ? <Value size={16}>{p.value}</Value> : null}
        {acts ? (
          <View style={styles.actions}>
            <Pressable hitSlop={6} onPress={() => onTag(p.id, t === 'target' ? null : 'target', t)} accessibilityLabel="Target">
              <TargetIcon size={18} color={t === 'target' ? colors.good : colors.textDim} />
            </Pressable>
            <Pressable hitSlop={6} onPress={() => onTag(p.id, t === 'avoid' ? null : 'avoid', t)} accessibilityLabel="Avoid">
              <AvoidIcon size={18} color={t === 'avoid' ? colors.bad : colors.textDim} />
            </Pressable>
            <Pressable hitSlop={6} onPress={() => onWatch(p.id, !w)} accessibilityLabel="Watch">
              <WatchIcon size={18} color={w ? colors.gold : colors.textDim} filled={w} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// While a player list loads, show its silhouette rather than a lone spinner — placeholder
// rows shaped like a PlayerRow (rank · badge · name/meta · value) breathing as one. Feels
// faster and doesn't jump the layout when the real rows land. One Pulse drives them all.
function PlayerListSkeleton({ count = 9 }) {
  return (
    <Pulse min={0.45}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.skRow}>
          <View style={styles.skRank} />
          <View style={styles.skBadge} />
          <View style={{ flex: 1 }}>
            <View style={[styles.skBar, { width: '55%' }]} />
            <View style={[styles.skBar, { width: '36%', height: 9, marginTop: 7 }]} />
          </View>
          <View style={styles.skValue} />
        </View>
      ))}
    </Pulse>
  );
}

// `style={posScroll}` with flexGrow:0 (and alignItems:'center' on the row) keeps this
// horizontal strip at chip height — without it the ScrollView stretched to fill the
// column and the chips rendered as full-height bars while the list was loading.
// When given rankType/setRankType (rankings tab only) it also hosts the Rookies filter.
function PosFilter({ pos, setPos, rankType, setRankType }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.posScroll} contentContainerStyle={styles.posRow}>
      {POSITIONS.map(([k, label]) => (
        <Pressable key={label} style={[styles.posChip, pos === k && styles.posChipActive]} onPress={() => setPos(k)}>
          <Text style={[styles.posChipText, pos === k && { color: colors.text }]}>{label}</Text>
        </Pressable>
      ))}
      {setRankType ? (
        <Pressable
          style={[styles.posChip, styles.rookChip, rankType === 'rookies' && styles.rookChipActive]}
          onPress={() => setRankType(rankType === 'rookies' ? 'value' : 'rookies')}
        >
          <Text style={[styles.posChipText, rankType === 'rookies' && { color: colors.gold }]}>Rookies</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

// Value lens: re-price (and, where value drives order, re-sort) the whole board
// through a 1QB or Superflex market. QBs are worth far more in superflex.
function ValueLens({ format, setFormat }) {
  return (
    <View style={styles.lensRow}>
      <Text style={styles.lensLabel}>Value lens</Text>
      <InfoDot id="format" />
      <View style={styles.lensToggle}>
        {[['1qb', '1QB'], ['sf', 'Superflex']].map(([k, label]) => (
          <Pressable key={k} style={[styles.lensSeg, format === k && styles.lensSegActive]} onPress={() => setFormat(k)}>
            <Text style={[styles.lensSegText, format === k && styles.lensSegTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// Combined controls strip: the value lens (1QB / Superflex) and the list sort on ONE row,
// split by a thin divider — no "Value lens" label, to save vertical space. Horizontally
// scrollable so it never overflows on a narrow screen.
function LensSortRow({ format, setFormat, sort, onSort }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.lensSortScroll} contentContainerStyle={styles.lensSortRow}>
      <View style={styles.lensToggle}>
        {[['1qb', '1QB'], ['sf', 'Superflex']].map(([k, label]) => (
          <Pressable key={k} style={[styles.lensSeg, format === k && styles.lensSegActive]} onPress={() => setFormat(k)}>
            <Text style={[styles.lensSegText, format === k && styles.lensSegTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <InfoDot id="format" />
      <View style={styles.lsDivider} />
      <Text style={styles.newsSortLabel}>Sort</Text>
      {LIST_SORTS.map(([k, label]) => (
        <Pressable key={k} style={[styles.newsSortChip, sort === k && styles.newsSortChipActive]} onPress={() => onSort(k)}>
          <Text style={[styles.newsSortText, sort === k && { color: colors.text }]}>{label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function WatchRow({ p, onPress }) {
  const posColor = positionColors[p.position] || colors.textDim;
  const s = p.summary;
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={[styles.posBadge, { backgroundColor: posColor + '22', borderColor: posColor }]}>
        <Text style={[styles.pos, { color: posColor }]}>{p.position}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
          <AvailabilityBadge availability={p.availability} style={{ marginLeft: 6 }} />
        </View>
        <View style={styles.chipRow}>
          {s.mine > 0 ? <Text style={[styles.chip, styles.chipMine]}>{s.mine} rostered</Text> : null}
          {s.free > 0 ? <Text style={[styles.chip, styles.chipFree]}>{s.free} free</Text> : null}
          {s.draftable > 0 ? <Text style={[styles.chip, styles.chipDraftable]}>{s.draftable} draftable</Text> : null}
          {s.tradeTarget > 0 ? <Text style={[styles.chip, styles.chipTrade]}>{s.tradeTarget} on other teams</Text> : null}
          {p.news && p.news.length ? <Text style={[styles.chip, styles.chipNews]}>news</Text> : null}
        </View>
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
          {timeAgo(n.published) ? `${timeAgo(n.published)} · ` : ''}
          {n.affectedCount > 0 ? `${n.affectedCount} of your teams${n.startingCount ? ` · starting in ${n.startingCount}` : ''}` : 'Not on your rosters'}
        </Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

function SortRow({ value, onChange }) {
  return (
    <View style={styles.newsSortRow}>
      <Text style={styles.newsSortLabel}>Sort</Text>
      {LIST_SORTS.map(([k, label]) => (
        <Pressable key={k} style={[styles.newsSortChip, value === k && styles.newsSortChipActive]} onPress={() => onChange(k)}>
          <Text style={[styles.newsSortText, value === k && { color: colors.text }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Center({ children }) {
  return <View style={styles.center}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
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
  typeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  // flexGrow:0 keeps the horizontal strip at chip height instead of stretching to fill the
  // column (the same fix the positional filter needed).
  typeScroll: { flexGrow: 0, flexShrink: 0 },
  typeScrollRow: { alignItems: 'center', gap: 8, paddingRight: 8 },
  typeInfo: { justifyContent: 'center', paddingHorizontal: 4 },
  typeChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 6 },
  typeChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  typeText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  posScroll: { flexGrow: 0, flexShrink: 0 },
  posRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8, paddingVertical: 6 },
  posChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 5 },
  rookChip: { borderColor: colors.gold + '55' },
  rookChipActive: { backgroundColor: colors.gold + '22', borderColor: colors.gold },
  grow: { flex: 1 },
  posChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  posChipText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  lensRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 16, gap: 10, paddingBottom: 6, paddingTop: 2 },
  lensLabel: { color: colors.textDim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  lensToggle: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 2 },
  lensSeg: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
  lensSegActive: { backgroundColor: colors.gold + '22', borderColor: colors.gold },
  lensSegText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  lensSegTextActive: { color: colors.gold },
  // Combined lens + sort strip: one row, thin divider between the two groups.
  // Height-constrain the horizontal controls strip (like typeScroll/posScroll) — without this
  // a horizontal ScrollView in the flex column balloons vertically and centers its chips,
  // stranding a big gap above and below the row.
  lensSortScroll: { flexGrow: 0, flexShrink: 0 },
  lensSortRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8, paddingTop: 2, paddingBottom: 6 },
  lsDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', minHeight: 22, backgroundColor: colors.border, marginHorizontal: 4 },
  rightCol: { alignItems: 'flex-end', marginLeft: 10, gap: 7 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  newsSearchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 6 },
  newsSortRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8, marginBottom: 6 },
  newsSortLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginRight: 2 },
  newsSortChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 5 },
  newsSortChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  newsSortText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  newsSearch: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 9 },
  list: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10 },
  skRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10 },
  skRank: { width: 14, height: 12, borderRadius: 3, backgroundColor: colors.cardAlt, marginRight: 8 },
  skBadge: { width: 40, height: 22, borderRadius: 6, backgroundColor: colors.cardAlt, marginRight: 10 },
  skBar: { height: 12, borderRadius: 4, backgroundColor: colors.cardAlt },
  skValue: { width: 26, height: 14, borderRadius: 4, backgroundColor: colors.cardAlt, marginLeft: 10 },
  rank: { color: colors.textDim, fontSize: 13, fontWeight: '800', width: 22 },
  posBadge: { width: 40, paddingVertical: 2, borderRadius: 6, borderWidth: 1, alignItems: 'center', marginRight: 10 },
  pos: { fontSize: 11, fontWeight: '800' },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 5 },
  chip: { fontSize: 11, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  chipMine: { color: colors.good, backgroundColor: colors.good + '22' },
  chipFree: { color: colors.accent, backgroundColor: colors.accent + '22' },
  chipDraftable: { color: colors.warn, backgroundColor: colors.warn + '22' },
  chipTrade: { color: colors.gold, backgroundColor: colors.gold + '22' },
  chipNews: { color: colors.bad, backgroundColor: colors.bad + '22' },
  mine: { color: colors.good, fontSize: 9, fontWeight: '900', marginLeft: 6, borderWidth: 1, borderColor: colors.good, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' },
  tagMark: { fontSize: 13, fontWeight: '900', marginLeft: 6 },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  value: { color: colors.gold, fontSize: 15, fontWeight: '900', marginLeft: 10 },
  trendBox: { alignItems: 'flex-end', marginLeft: 10 },
  trend: { color: colors.good, fontSize: 14, fontWeight: '900' },
  trendUnit: { color: colors.textDim, fontSize: 9, fontWeight: '700', marginTop: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  newsHead: { color: colors.text, fontSize: 14, fontWeight: '700' },
  chev: { color: colors.textDim, fontSize: 20, marginLeft: 8 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 24 },
  note: { color: colors.textDim, textAlign: 'center', marginTop: 40, marginHorizontal: 28, fontSize: 14, lineHeight: 20 },
  loadMore: { paddingVertical: 20 },
  errorBanner: { color: colors.bad, backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
