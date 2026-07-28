import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, TextInput, ActivityIndicator, Linking, Animated } from 'react-native';
import { api } from '../api';
import { exposurePreferDevice, bestAvailablePreferDevice } from '../mflDevice';
import { colors, positionColors, rgb } from '../theme';
import AvailabilityBadge from '../components/AvailabilityBadge';
import AddAcrossSheet from '../components/AddAcrossSheet';
import { TargetIcon, AvoidIcon, WatchIcon, GlowChip } from '../components/PlayerActionIcons';
import { getValue, setValue } from '../cache';
import { peekResource, primeResource } from '../useCachedResource';
import InfoDot from '../components/InfoDot';
import Pulse from '../components/Pulse';
import Reveal from '../components/Reveal';
import PartialNote from '../components/PartialNote';
import DeviceNote from '../components/DeviceNote';
import ValueCredit from '../components/ValueCredit';
import PopChip from '../components/PopChip';
import useActFlash from '../useActFlash';
import useAutoReload from '../useAutoReload';
import { ScreenTitle, Value } from '../components/Brand';

const TABS = [
  ['rankings', 'Rankings'],
  ['free', 'Free Agents'],
  ['watch', 'Watch'],
  ['mine', 'My Players'],
  ['news', 'News'],
];
// Only ever hand an http(s) URL to the OS opener — a hostile/compromised upstream news `url`
// must not be able to launch arbitrary schemes (tel:, sms:, market:, custom app deep links).
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const RANK_TYPES = [
  ['value', 'Market value'],
  ['winnow', 'Win-now'],
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
  ['PK', 'K'], // value is the canonical position (kickers are stored as PK); label stays "K"
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
const LIST_SORTS = [['default', 'Default'], ['value', 'Value'], ['proj', 'Proj'], ['season', 'Yr pts'], ['name', 'Name'], ['position', 'Pos']];
const POS_ORDER = { QB: 1, RB: 2, WR: 3, TE: 4, PK: 5, K: 5, DEF: 6 };
// Sort a player list by the chosen key. Numeric keys sort desc with nulls sinking to the bottom
// (a player with no known projection/points shouldn't float above one who has them).
function sortPlayers(list, key) {
  if (!key || key === 'default') return list;
  const arr = [...list];
  if (key === 'value') return arr.sort((a, b) => (b.value || 0) - (a.value || 0));
  if (key === 'proj') return arr.sort((a, b) => nullLast(a.weekProjection, b.weekProjection));
  if (key === 'season') return arr.sort((a, b) => nullLast(a.seasonPoints, b.seasonPoints));
  if (key === 'name') return arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  if (key === 'position') return arr.sort((a, b) => (POS_ORDER[a.position] || 9) - (POS_ORDER[b.position] || 9) || (b.value || 0) - (a.value || 0));
  return arr;
}
// Descending compare that keeps nulls/undefined at the end regardless of sort direction.
function nullLast(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
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
  const [free, setFree] = useState(null);
  const [error, setError] = useState(null);
  const [pos, setPos] = useState(null); // position filter (null = All), applies to rankings/search/mine
  const [format, setFormat] = useState('1qb'); // value lens: '1qb' | 'sf' — re-prices & resorts the board
  const [tep, setTep] = useState(false); // TE-premium lens: independent on/off, orthogonal to the QB lens
  const [newsQuery, setNewsQuery] = useState(''); // in-tab News filter
  const [newsSort, setNewsSort] = useState('impact'); // News tab sort: 'impact' | 'recent'
  const [listSort, setListSort] = useState('default'); // secondary sort for Rankings/My Players/Watch
  const [tagOverride, setTagOverride] = useState({}); // id -> 'target'|'avoid'|null (optimistic)
  const [watchOverride, setWatchOverride] = useState({}); // id -> bool (optimistic)
  const [addAcross, setAddAcross] = useState(null); // {id,name} → batch "claim across leagues" sheet

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
      api.playerSearch(q, { position: pos, format, tep }).then((r) => alive && setSearchRes(r)).catch((e) => alive && setError(e.message));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, pos, format, tep]);

  const tk = tep ? 'tep' : 'std'; // cache-key fragment for the TE-premium lens
  const rankKey = `players:rankings:${rankType}:${pos || 'all'}:${format}:${tk}`;
  const freeKey = `players:free:${format}:${tk}`; // free-agent board, per value lens — cached on the resource store

  const loadRankings = useCallback(async () => {
    try {
      const res = await api.playerRankings(rankType, pos, format, undefined, tep);
      setRankings(res);
      // In-memory (survives the tab-switch unmount, throttles re-entry) + disk page 0. Later
      // pages append in-memory and are re-fetched on scroll.
      primeResource(rankKey, res);
      setValue(rankKey, res);
    } catch (e) {
      setError(e.message);
    }
  }, [rankType, pos, format, tep, rankKey]);

  // Refetch My Players WITHOUT clearing the current list, so an auto-reload (below) fills in the leagues
  // a throttle dropped while the rows stay on screen and the loaded count just climbs.
  const reloadMine = useCallback(() => {
    exposurePreferDevice().then(setMine).catch((e) => setError(e.message));
  }, []);

  // Free agents: refetch and cache on the resource store (in-memory + disk), so re-entering the tab
  // repaints instantly from cache instead of blanking to a skeleton and re-running the heavy backend
  // fan-out every time. Fetches without clearing, so the current board stays up while it revalidates.
  const loadFree = useCallback(() => {
    bestAvailablePreferDevice(format, tep)
      .then((res) => { setFree(res); primeResource(freeKey, res); setValue(freeKey, res); })
      .catch((e) => setError(e.message));
  }, [format, tep, freeKey]);

  // Infinite scroll: fetch the next window and append. Guard on loadingMore so the
  // FlatList's onEndReached (which can fire repeatedly) only kicks off one fetch, and
  // stop once the server says there's nothing more.
  const loadMoreRankings = useCallback(async () => {
    if (loadingMore || !rankings || !rankings.hasMore) return;
    setLoadingMore(true);
    try {
      const res = await api.playerRankings(rankType, pos, format, rankings.players.length, tep);
      // Ignore a stale page if the rank type / filters changed while it was in flight.
      setRankings((cur) => {
        if (!(cur && cur.type === res.type && cur.position === res.position && cur.format === res.format)) return cur;
        const merged = { ...res, players: [...cur.players, ...res.players] };
        // Keep the in-memory snapshot in sync so returning to Players repaints the full paged
        // list, not just page 0. Preserve the last full-load timestamp so appended pages don't
        // reset the reload throttle.
        const at = (peekResource(rankKey) || {}).at || 0;
        primeResource(rankKey, merged, at);
        return merged;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, rankings, rankType, pos, format, tep]);

  // Rankings tab, stale-while-revalidate with the shared in-memory layer: returning to Players
  // (which fully unmounts on a tab switch) repaints the last list — including scrolled-in pages —
  // instantly and only reloads once it's stale, instead of blanking to a skeleton and refetching
  // every time. Cold (or a new filter with nothing cached) still paints disk then refreshes.
  // (Search is transient; My Players / News / Watch load fresh when opened.)
  const RANK_STALE_MS = 45 * 1000;
  useEffect(() => {
    if (tab !== 'rankings') return undefined;
    let alive = true;
    const hit = peekResource(rankKey);
    if (hit) {
      setRankings(hit.value);
      if (Date.now() - hit.at > RANK_STALE_MS) loadRankings();
      return () => { alive = false; };
    }
    setRankings(null);
    getValue(rankKey).then((cached) => {
      if (alive && cached != null) { setRankings(cached); primeResource(rankKey, cached, 0); } // at:0 → stale, will refresh
      if (alive) loadRankings();
    });
    return () => { alive = false; };
  }, [tab, rankKey, loadRankings]);

  useEffect(() => {
    // My Players is device-first: the roster fan-out across all leagues runs on-device (its own IP),
    // enriched + grouped via the backend; silently falls back to the backend on any device-read failure.
    if (tab === 'mine' && !mine) reloadMine();
    if (tab === 'news' && !news) api.news().then(setNews).catch((e) => setError(e.message));
    // Watchlist changes as you star players elsewhere, so refetch each open — but WITHOUT clearing the
    // current list (mirror My Players), so the prior watch stays on screen while it revalidates instead
    // of blanking to a spinner. Re-prices when `format` changes too.
    if (tab === 'watch') api.watchlist(format, tep).then(setWatch).catch((e) => setError(e.message));
  }, [tab, mine, news, format, tep, reloadMine]);

  // Free agents get the same stale-while-revalidate treatment as Rankings: paint the cached board at
  // once (instant re-entry), then refresh in the background if it's stale. The heavy cross-league
  // free-agent fan-out only re-runs when the cache is cold or aged out — not on every tab switch.
  const FREE_STALE_MS = 60 * 1000;
  useEffect(() => {
    if (tab !== 'free') return undefined;
    let alive = true;
    const hit = peekResource(freeKey);
    if (hit) {
      setFree(hit.value);
      if (Date.now() - hit.at > FREE_STALE_MS) loadFree();
      return () => { alive = false; };
    }
    setFree(null);
    getValue(freeKey).then((cached) => {
      if (alive && cached != null) { setFree(cached); primeResource(freeKey, cached, 0); } // at:0 → stale, refreshes
      if (alive) loadFree();
    });
    return () => { alive = false; };
  }, [tab, freeKey, loadFree]);

  // Auto-heal a partial My Players / Rankings load: if a throttle dropped some leagues, quietly re-fetch
  // (a few times, backing off) so the missing leagues fill in on their own — no "Retry" tap needed.
  const mineAuto = useAutoReload(tab === 'mine' ? mine : null, reloadMine, { key: 'mine' });
  const rankAuto = useAutoReload(tab === 'rankings' ? rankings : null, loadRankings, { key: `rankings:${rankKey}` });

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
  // even when the list is re-sorted by name/position (you still see where he ranks). Memoized
  // so it only rebuilds when the rankings change, not on every keystroke/state tick.
  const rankById = useMemo(() => {
    const m = {};
    if (rankings) rankings.players.forEach((p, i) => { m[p.id] = i + 1; });
    return m;
  }, [rankings]);

  // Each list's sorted (and filtered) data, memoized on its real inputs — so a FlatList doesn't
  // get a brand-new array identity (and re-sort 300+ rows) on every unrelated re-render.
  const searchData = useMemo(() => (searchRes ? sortPlayers(searchRes.players, listSort) : []), [searchRes, listSort]);
  const rankingsData = useMemo(() => (rankings ? sortPlayers(rankings.players, listSort) : []), [rankings, listSort]);
  const watchData = useMemo(() => (watch ? sortPlayers(watch.players, listSort) : []), [watch, listSort]);
  // Free agents: server sends them best-first (by value); default keeps that order. Position
  // filter reuses the shared `pos` chip; secondary sort reuses `listSort`.
  const freeData = useMemo(
    () => (free ? sortPlayers(free.players.filter((p) => !pos || p.position === pos), listSort) : []),
    [free, pos, listSort]
  );
  const mineData = useMemo(
    () => (mine ? sortPlayers(mine.players.filter((p) => !pos || p.position === pos), listSort) : []),
    [mine, pos, listSort]
  );
  const newsData = useMemo(
    () => (news ? sortNews(news.news.filter((n) => matchNews(n, newsQuery)), newsSort) : []),
    [news, newsQuery, newsSort]
  );

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
          <ValueLens format={format} setFormat={setFormat} tep={tep} setTep={setTep} />
          {searchRes && searchRes.players.length ? <SortRow value={listSort} onChange={setListSort} /> : null}
          {!searchRes ? (
            <PlayerListSkeleton />
          ) : (
            <FlatList
              data={searchData}
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
                {RANK_TYPES.map(([k, label]) => (
                  <Pressable key={k} style={[styles.typeChip, rankType === k && styles.typeChipActive]} onPress={() => setRankType(k)}>
                    <Text style={[styles.typeText, rankType === k && { color: colors.text }]}>{label}</Text>
                  </Pressable>
                ))}
                <View style={styles.typeInfo}><InfoDot id="ranking" size={16} /></View>
              </View>
              <PosFilter pos={pos} setPos={setPos} rankType={rankType} setRankType={setRankType} />
              <ValueLens format={format} setFormat={setFormat} tep={tep} setTep={setTep} />
              <SortRow value={listSort} onChange={setListSort} />
              {/* Honest partial-load signal: "owned in N leagues" counts are over the leagues that
                  loaded — if some were throttled, say so instead of showing a subset as the whole. */}
              {rankings ? <PartialNote loaded={rankings.leaguesLoaded} total={rankings.leaguesTotal} loading={rankAuto.retrying} onRetry={loadRankings} /> : null}
              <FlatList
                style={styles.grow}
                data={rankingsData}
                keyExtractor={(p) => p.id}
                extraData={{ tagOverride, watchOverride, listSort }}
                contentContainerStyle={styles.list}
                renderItem={({ item, index }) => <Reveal delay={Math.min(index, 12) * 32} animate={index < 14}><PlayerRow p={item} rank={rankById[item.id]} tag={resolveTag(item)} watched={resolveWatch(item)} showTrend={rankType === 'trending'} showWinNow={rankType === 'winnow'} {...rowActions} onPress={() => onOpenPlayer(item.id)} /></Reveal>}
                onEndReached={loadMoreRankings}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                  loadingMore ? (
                    <ActivityIndicator style={styles.loadMore} color={colors.gold} />
                  ) : rankingsData && rankingsData.length ? (
                    <ValueCredit center style={styles.credit} />
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
          ) : tab === 'free' ? (
            <>
              <View style={styles.freeIntro}>
                <Text style={styles.freeIntroText}>
                  {free
                    ? `Free agents available in one or more of your ${free.totalLeagues} league${free.totalLeagues === 1 ? '' : 's'}, most-available first. Tap a player to add him, or use Sort to rank by value.`
                    : 'Free agents available across your leagues.'}
                </Text>
              </View>
              <ValueLens format={format} setFormat={setFormat} tep={tep} setTep={setTep} />
              <PosFilter pos={pos} setPos={setPos} />
              <SortRow value={listSort} onChange={setListSort} />
              <FlatList
                data={freeData}
                keyExtractor={(p) => p.id}
                extraData={{ tagOverride, watchOverride, listSort }}
                contentContainerStyle={styles.list}
                renderItem={({ item, index }) => <Reveal delay={Math.min(index, 12) * 32} animate={index < 14}><PlayerRow p={item} sub={`free in ${item.leagueCount} league${item.leagueCount === 1 ? '' : 's'}`} tag={resolveTag(item)} watched={resolveWatch(item)} {...rowActions} onQuickAdd={() => setAddAcross({ id: item.id, name: item.name })} onPress={() => onOpenPlayer(item.id)} /></Reveal>}
                ListEmptyComponent={
                  !free ? (
                    <PlayerListSkeleton />
                  ) : (
                    <Text style={styles.note}>{pos ? `No ${pos}s are available in any of your leagues right now.` : 'No available players across your leagues right now.'}</Text>
                  )
                }
              />
            </>
          ) : tab === 'watch' ? (
            <>
              {watch && watch.players.length ? <ValueLens format={format} setFormat={setFormat} tep={tep} setTep={setTep} /> : null}
              {watch && watch.players.length ? <SortRow value={listSort} onChange={setListSort} /> : null}
              <FlatList
              data={watchData}
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
              {mine && mine._source === 'device' ? (
                <DeviceNote center text={`Your rosters live from MFL on-device · ${mine.totalLeagues} league${mine.totalLeagues === 1 ? '' : 's'}`} />
              ) : null}
              <PosFilter pos={pos} setPos={setPos} />
              <SortRow value={listSort} onChange={setListSort} />
              {/* Honest exposure: "N leagues" per row counts only the leagues we could read. Nulling `mine`
                  re-triggers the load effect (device-first, backend fallback). */}
              {mine ? <PartialNote loaded={mine.leaguesLoaded} total={mine.leaguesTotal} loading={mineAuto.retrying} onRetry={reloadMine} /> : null}
              <FlatList
                data={mineData}
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
                data={newsData}
                keyExtractor={(n) => n.id}
                contentContainerStyle={styles.list}
                renderItem={({ item }) => (
                  <NewsRow n={item} onPress={() => (isHttpUrl(item.url) ? Linking.openURL(item.url).catch(() => {}) : item.player.id && onOpenPlayer(item.player.id))} />
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

      {addAcross ? (
        <AddAcrossSheet
          player={addAcross}
          onClose={() => setAddAcross(null)}
          onDone={() => {
            setAddAcross(null);
            // Reflect the add: the player is no longer free, so refetch the board (kept on screen while it revalidates).
            if (tab === 'free') loadFree();
          }}
        />
      ) : null}
    </View>
  );
}

function PlayerRow({ p, rank, sub, tag, watched, showTrend, showWinNow, onTag, onWatch, onQuickAdd, onPress }) {
  const posColor = positionColors[p.position] || colors.textDim;
  const t = tag !== undefined ? tag : p.tag || null;
  const w = watched !== undefined ? watched : !!p.watched;
  const acts = !!(onTag && onWatch);
  // Texture: wash the row's accent when a Target/Avoid/Watch action lands on it, then settle. The
  // trigger is this row's own tag/watch state, so it fires on the action — not on scroll or re-sort.
  const flash = useActFlash(`${t || '-'}|${w ? 1 : 0}`);
  const flashColor = t === 'target' ? colors.good : t === 'avoid' ? colors.bad : w ? colors.watch : colors.accent;
  return (
    <Pressable style={({ pressed }) => [styles.row, { borderLeftColor: posColor, borderLeftWidth: 3 }, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: 12, backgroundColor: flashColor, opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.26] }) }]}
      />
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
        <PointsLine season={p.seasonPoints} proj={p.weekProjection} />
      </View>
      <View style={styles.rightCol}>
        {showTrend && p.trend ? (
          <View style={styles.trendBox}>
            <Text style={styles.trend}>▲ {Math.round(p.trend).toLocaleString()}</Text>
            <Text style={styles.trendUnit}>adds/48h</Text>
          </View>
        ) : showWinNow ? (
          p.winNow != null ? (
            <View style={styles.trendBox}>
              <Value size={16}>{p.winNow}</Value>
              <Text style={styles.trendUnit}>win-now</Text>
            </View>
          ) : null
        ) : p.value != null ? <Value size={16}>{p.value}</Value> : null}
        {acts || onQuickAdd ? (
          <View style={styles.actions}>
            {acts ? (
              <>
                <Pressable hitSlop={13} onPress={() => onTag(p.id, t === 'target' ? null : 'target', t)} accessibilityLabel="Target">
                  <GlowChip active={t === 'target'} triplet={rgb.good}><TargetIcon size={18} color={t === 'target' ? colors.good : colors.textDim} /></GlowChip>
                </Pressable>
                <Pressable hitSlop={13} onPress={() => onTag(p.id, t === 'avoid' ? null : 'avoid', t)} accessibilityLabel="Avoid">
                  <GlowChip active={t === 'avoid'} triplet={rgb.bad}><AvoidIcon size={18} color={t === 'avoid' ? colors.bad : colors.textDim} /></GlowChip>
                </Pressable>
                <Pressable hitSlop={13} onPress={() => onWatch(p.id, !w)} accessibilityLabel="Watch">
                  <GlowChip active={w} triplet={rgb.watch}><WatchIcon size={18} color={w ? colors.watch : colors.textDim} filled={w} /></GlowChip>
                </Pressable>
              </>
            ) : null}
            {/* +Add rides in the SAME row as the tag icons (not stacked below) so a free-agent row is
                the same height as a rankings row. */}
            {onQuickAdd ? (
              <Pressable
                onPress={onQuickAdd}
                hitSlop={6}
                style={({ pressed }) => [styles.quickAdd, pressed && { opacity: 0.7 }]}
                accessibilityLabel={`Add ${p.name} across leagues`}
              >
                <Text style={styles.quickAddText}>+ Add{p.leagueCount > 1 ? ` ${p.leagueCount}` : ''}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// While a player list loads, show its silhouette rather than a lone spinner — placeholder
// rows shaped like a PlayerRow (rank · badge · name/meta · value) breathing as one. Feels
// faster and doesn't jump the layout when the real rows land. One Pulse drives them all.
// Season-to-date points (SZN) + this week's projection (PROJ) — surfaced on every player row
// across the Players screen (especially useful for streaming free agents). Renders nothing when
// neither number is known (offseason projection, or a player MFL has no score for), so a row never
// shows an empty stat strip. Numbers are under the owner's primary league's scoring.
function PointsLine({ season, proj }) {
  if (season == null && proj == null) return null;
  return (
    <View style={styles.ptsLine}>
      {proj != null ? (
        <Text style={styles.ptsItem}>
          <Text style={styles.ptsLabel}>PROJ </Text>
          <Text style={styles.ptsProj}>{proj}</Text>
        </Text>
      ) : null}
      {season != null ? (
        <Text style={styles.ptsItem}>
          <Text style={styles.ptsLabel}>SZN </Text>
          <Text style={styles.ptsSeason}>{season}</Text>
        </Text>
      ) : null}
    </View>
  );
}

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
  // Wrapping row (not a horizontal scroll) so the position chips never side-scroll — they flow onto a
  // second line on a narrow screen.
  return (
    <View style={styles.posRow}>
      {POSITIONS.map(([k, label]) => (
        <PopChip key={label} active={pos === k} onPress={() => setPos(k)} style={styles.posChip} activeStyle={styles.posChipActive} textStyle={styles.posChipText} activeTextStyle={{ color: colors.text }} label={label} />
      ))}
      {setRankType ? (
        <Pressable
          style={[styles.posChip, styles.rookChip, rankType === 'rookies' && styles.rookChipActive]}
          onPress={() => setRankType(rankType === 'rookies' ? 'value' : 'rookies')}
        >
          <Text style={[styles.posChipText, rankType === 'rookies' && { color: colors.gold }]}>Rookies</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Value lens: re-price (and, where value drives order, re-sort) the whole board through a chosen
// market. Two INDEPENDENT axes: the 1QB↔2QB segmented control (a QB is worth far more in 2QB), and a
// TE-premium on/off pill (a TE is worth more when he scores extra per catch). They don't affect each
// other — you can view 1QB + TE-premium, 2QB + TE-premium, either alone, or neither.
function ValueLens({ format, setFormat, tep, setTep }) {
  return (
    <View style={styles.lensRow}>
      <View style={styles.lensLabelWrap}>
        <Text style={styles.lensLabel}>Value lens</Text>
        <InfoDot id="format" />
      </View>
      <View style={styles.lensControls}>
        <View style={styles.lensToggle}>
          {[['1qb', '1QB'], ['sf', '2QB']].map(([k, label]) => (
            <Pressable key={k} style={[styles.lensSeg, format === k && styles.lensSegActive]} onPress={() => setFormat(k)}>
              <Text style={[styles.lensSegText, format === k && styles.lensSegTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={[styles.tepToggle, tep && styles.tepToggleOn]}
          onPress={() => setTep((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: tep }}
          accessibilityLabel="TE premium"
        >
          <Text style={[styles.tepToggleText, tep && styles.tepToggleTextOn]}>TE PREM</Text>
        </Pressable>
      </View>
    </View>
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
        <PointsLine season={p.seasonPoints} proj={p.weekProjection} />
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
        <PopChip key={k} active={value === k} onPress={() => onChange(k)} style={styles.newsSortChip} activeStyle={styles.newsSortChipActive} textStyle={styles.newsSortText} activeTextStyle={{ color: colors.text }} label={label} />
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
  typeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, rowGap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  // flexGrow:0 keeps the horizontal strip at chip height instead of stretching to fill the
  // column (the same fix the positional filter needed).
  typeScroll: { flexGrow: 0, flexShrink: 0 },
  typeScrollRow: { alignItems: 'center', gap: 8, paddingRight: 8 },
  typeInfo: { justifyContent: 'center', paddingHorizontal: 4 },
  typeChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 6 },
  typeChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  typeText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  posScroll: { flexGrow: 0, flexShrink: 0 },
  posRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, rowGap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  posChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 5 },
  rookChip: { borderColor: colors.gold + '55' },
  rookChipActive: { backgroundColor: colors.gold + '22', borderColor: colors.gold },
  grow: { flex: 1 },
  posChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  posChipText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  // Label on the left, market toggle on the right — filling the row. (It used to be right-aligned, which
  // stranded a big blank rectangle on the left where the filter/sort rows below start, reading as an odd gap.)
  lensRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, gap: 10, paddingBottom: 6, paddingTop: 2 },
  lensLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lensLabel: { color: colors.textDim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  lensToggle: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 2 },
  lensSeg: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
  lensSegActive: { backgroundColor: colors.accent + '22', borderColor: colors.accent },
  lensSegText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  lensSegTextActive: { color: colors.accent },
  lensControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tepToggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  tepToggleOn: { backgroundColor: colors.accent + '22', borderColor: colors.accent },
  tepToggleText: { color: colors.textDim, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  tepToggleTextOn: { color: colors.accent },
  // Combined lens + sort strip: one row, thin divider between the two groups.
  // Height-constrain the horizontal controls strip (like typeScroll/posScroll) — without this
  // a horizontal ScrollView in the flex column balloons vertically and centers its chips,
  // stranding a big gap above and below the row.
  lensSortScroll: { flexGrow: 0, flexShrink: 0 },
  lensSortRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8, paddingTop: 2, paddingBottom: 6 },
  lsDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', minHeight: 22, backgroundColor: colors.border, marginHorizontal: 4 },
  rightCol: { alignItems: 'flex-end', marginLeft: 10, gap: 7 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  quickAdd: { borderWidth: 1, borderColor: colors.good, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  quickAddText: { color: colors.good, fontSize: 12, fontWeight: '800' },
  newsSearchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 6 },
  newsSortRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: 6, paddingHorizontal: 16, gap: 8, marginBottom: 6 },
  newsSortLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginRight: 2 },
  newsSortChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 5 },
  newsSortChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  newsSortText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  newsSearch: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 9 },
  freeIntro: { paddingHorizontal: 16, paddingBottom: 4, paddingTop: 2 },
  freeIntroText: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
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
  ptsLine: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  ptsItem: { fontSize: 12 },
  ptsLabel: { color: colors.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  ptsProj: { color: colors.accent, fontSize: 13, fontWeight: '900' },
  ptsSeason: { color: colors.text, fontSize: 13, fontWeight: '800' },
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
  credit: { marginTop: 12, marginBottom: 24 },
  errorBanner: { color: colors.bad, backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
