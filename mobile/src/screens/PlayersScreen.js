import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, TextInput, ActivityIndicator, Linking, Animated } from 'react-native';
import { api, friendlyError } from '../api';
import { exposurePreferDevice, bestAvailablePreferDevice } from '../mflDevice';
import { colors, positionColors, rgb } from '../theme';
import AvailabilityBadge from '../components/AvailabilityBadge';
import AddAcrossSheet from '../components/AddAcrossSheet';
import { TargetIcon, AvoidIcon, WatchIcon, NeonToggle } from '../components/PlayerActionIcons';
import { getValue, setValue, onCacheInvalidate } from '../cache';
import { peekResource, primeResource } from '../useCachedResource';
import InfoDot from '../components/InfoDot';
import Pulse from '../components/Pulse';
import NavTools from '../components/NavTools';
import Reveal from '../components/Reveal';
import PartialNote from '../components/PartialNote';
import DeviceNote from '../components/DeviceNote';
import ValueCredit from '../components/ValueCredit';
import NewsCredit from '../components/NewsCredit';
import PopChip from '../components/PopChip';
import useActFlash from '../useActFlash';
import useAutoReload from '../useAutoReload';
import { ScreenTitle, Value } from '../components/Brand';
import { STALE } from '../staleTiers';

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
// Rank MODE — what the board is ordered by. Rookies is a mode too (rookie-only board), so it lives
// here with the others instead of being stranded on the end of the position row.
const RANK_TYPES = [
  ['value', 'Market'],
  ['winnow', 'Win-now'],
  ['myvalue', 'My value'],
  ['owned', 'Owned'],
  ['trending', 'Trending'],
  ['rookies', 'Rookies'],
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
// Free Agents leads with Value (its default) and relabels the server-order chip to what it actually is
// — availability across your leagues — so the sort you land on is also the first chip you see.
const FREE_SORTS = [['value', 'Value'], ['default', 'Availability'], ['proj', 'Proj'], ['season', 'Yr pts'], ['name', 'Name'], ['position', 'Pos']];
// Watch + My Players relabel the 'default' (server-order) chip to what that order ACTUALLY is, instead
// of an opaque "Default": the watchlist surfaces claimable/actionable players first (free → draftable →
// value), and My Players ranks by exposure (how many of your leagues you roster the player in, then value).
const WATCH_SORTS = [['default', 'Actionable'], ['value', 'Value'], ['proj', 'Proj'], ['season', 'Yr pts'], ['name', 'Name'], ['position', 'Pos']];
const MINE_SORTS = [['default', 'Exposure'], ['value', 'Value'], ['proj', 'Proj'], ['season', 'Yr pts'], ['name', 'Name'], ['position', 'Pos']];
// The sort each tab lands on before you touch it. Free Agents defaults to Value — when you're shopping
// the wire you want the best players first, not the server's most-leagues-available order (that order
// is still available as the "Availability" chip). Everything else keeps its natural list order.
const SORT_DEFAULTS = { rankings: 'default', free: 'value', watch: 'default', mine: 'default', search: 'default' };
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
// Re-price a row through the selected value lens using its attached `lensValues`
// (1qb / 1qb_tep / sf / sf_tep → { v: dynasty, w: win-now }). Lets Free Agents / Watch re-value +
// re-sort on a 1QB/2QB/TE-prem toggle with NO refetch, exactly like the Rankings board. Falls back to
// the row's server value for a player FantasyCalc has no lens value for (or a payload without lenses).
function priceByLens(p, lens) {
  const lv = p.lensValues && p.lensValues[lens];
  if (!lv) return p;
  return { ...p, value: lv.v != null ? lv.v : p.value, winNow: lv.w != null ? lv.w : p.winNow };
}

// Descending compare that keeps nulls/undefined at the end regardless of sort direction.
function nullLast(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

const NEWS_SORTS = [['recent', 'Recent'], ['impact', 'Impact']];
const SEV_RANK = { high: 3, medium: 2, low: 1 };
function sortNews(list, key) {
  const arr = [...list];
  if (key === 'recent') return arr.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  // impact: severity, then how many of your teams start him, then affected count.
  return arr.sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0) || (b.startingCount - a.startingCount) || (b.affectedCount - a.affectedCount));
}

export default function PlayersScreen({ active = true, onOpenPlayer, onStartWaiverWizard }) {
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
  const [newsSort, setNewsSort] = useState('recent'); // News tab sort: 'impact' | 'recent' (default: newest first)
  const [sortByTab, setSortByTab] = useState({}); // per-tab secondary sort; unset falls back to SORT_DEFAULTS
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
      api.playerSearch(q, { position: pos, format, tep }).then((r) => alive && setSearchRes(r)).catch((e) => alive && setError(friendlyError(e.message)));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, pos, format, tep]);

  const tk = tep ? 'tep' : 'std'; // cache-key fragment for the TE-premium lens
  const lens = `${format === 'sf' ? 'sf' : '1qb'}${tep ? '_tep' : ''}`; // selected value lens → lensValues key
  const rankKey = `players:rankings:${rankType}:${pos || 'all'}:${format}:${tk}`;
  // Free-agent + watch boards are LENS-AGNOSTIC keys: the fetched rows carry every lens in `lensValues`,
  // so a 1QB/2QB/TE-prem toggle re-prices them locally (see freeData/watchData) instead of changing the
  // cache key and re-running the heavy cross-league fan-out. Only the free-agent SET (who's available)
  // needs the network, and that doesn't move with the lens.
  const freeKey = 'players:free';

  const loadRankings = useCallback(async () => {
    try {
      const res = await api.playerRankings(rankType, pos, format, undefined, tep);
      setRankings(res);
      // In-memory (survives the tab-switch unmount, throttles re-entry) + disk page 0. Later
      // pages append in-memory and are re-fetched on scroll.
      primeResource(rankKey, res);
      setValue(rankKey, res);
    } catch (e) {
      setError(friendlyError(e.message));
    }
  }, [rankType, pos, format, tep, rankKey]);

  // Refetch My Players WITHOUT clearing the current list, so an auto-reload (below) fills in the leagues
  // a throttle dropped while the rows stay on screen and the loaded count just climbs.
  const reloadMine = useCallback(() => {
    exposurePreferDevice().then(setMine).catch((e) => setError(friendlyError(e.message)));
  }, []);

  // Free agents: refetch and cache on the resource store (in-memory + disk), so re-entering the tab
  // repaints instantly from cache instead of blanking to a skeleton and re-running the heavy backend
  // fan-out every time. Fetches without clearing, so the current board stays up while it revalidates.
  // Lens-agnostic: fetch the available SET once (rows carry all lenses), re-price locally on a toggle.
  const loadFree = useCallback(() => {
    bestAvailablePreferDevice()
      .then((res) => { setFree(res); primeResource(freeKey, res); setValue(freeKey, res); })
      .catch((e) => setError(friendlyError(e.message)));
  }, [freeKey]);

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
      setError(friendlyError(e.message));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, rankings, rankType, pos, format, tep]);

  // Rankings tab, stale-while-revalidate with the shared in-memory layer: returning to Players
  // (which fully unmounts on a tab switch) repaints the last list — including scrolled-in pages —
  // instantly and only reloads once it's stale, instead of blanking to a skeleton and refetching
  // every time. Cold (or a new filter with nothing cached) still paints disk then refreshes.
  // (Search is transient; My Players / News / Watch load fresh when opened.)
  // Values move ~twice a day (FantasyCalc) and the prime keeps them warm, so trust a painted board for
  // hours before a passive re-check — not 45s. A lens toggle re-prices locally; a pull-to-refresh or any
  // write still refreshes immediately.
  const RANK_STALE_MS = STALE.VALUES;
  useEffect(() => {
    if (tab !== 'rankings') return undefined;
    let alive = true;
    const hit = peekResource(rankKey);
    if (hit) {
      setRankings(hit.value);
      if (Date.now() - hit.at > RANK_STALE_MS) loadRankings();
      return () => { alive = false; };
    }
    // No in-memory snapshot for this exact lens/filter. But every row carries ALL its value lenses
    // (`lensValues`: 1qb / 1qb_tep / sf / sf_tep → { v: dynasty, w: win-now }), and market/win-now are
    // the same players re-ordered — so a 1QB/2QB/TE-prem OR market↔win-now toggle is a pure re-PRICE +
    // re-SORT, no refetch: don't blank to a skeleton, re-key what's on screen instantly. (A position
    // filter change alters the SET, so keep the rows up and let the background load bring the new one;
    // only a genuine cold start shows the skeleton.) The background load still runs to reconcile the
    // exact top-N at the pagination boundary.
    setRankings((cur) => {
      if (!cur || !cur.players) return cur; // cold → stays null → skeleton
      if ((rankType === 'value' || rankType === 'winnow') && (cur.position || null) === (pos || null)) {
        const lens = `${format === 'sf' ? 'sf' : '1qb'}${tep ? '_tep' : ''}`;
        const rekeyed = cur.players.map((p) => {
          const lv = p.lensValues && p.lensValues[lens];
          return lv ? { ...p, value: lv.v != null ? lv.v : p.value, winNow: lv.w != null ? lv.w : p.winNow } : p;
        });
        const k = rankType === 'winnow' ? 'winNow' : 'value';
        rekeyed.sort((a, b) => (b[k] == null ? -Infinity : b[k]) - (a[k] == null ? -Infinity : a[k]));
        return { ...cur, players: rekeyed, type: rankType, format: format === 'sf' ? 'sf' : '1qb' };
      }
      return cur; // keep the current rows up while the new metric loads
    });
    getValue(rankKey).then((cached) => {
      if (alive && cached != null) { setRankings(cached); primeResource(rankKey, cached, 0); } // at:0 → stale, will refresh
      if (alive) loadRankings();
    });
    return () => { alive = false; };
  }, [tab, rankKey, loadRankings, rankType, format, tep, pos]);

  useEffect(() => {
    // My Players is device-first: the roster fan-out across all leagues runs on-device (its own IP),
    // enriched + grouped via the backend; silently falls back to the backend on any device-read failure.
    if (tab === 'mine' && !mine) reloadMine();
    if (tab === 'news' && !news) api.news().then(setNews).catch((e) => setError(friendlyError(e.message)));
    // Watchlist changes as you star players elsewhere, so refetch each open — but WITHOUT clearing the
    // current list (mirror My Players), so the prior watch stays on screen while it revalidates instead
    // of blanking to a spinner. Lens-agnostic now: rows carry every lens, so a 1QB/2QB/TE-prem toggle
    // re-prices watchData locally (no refetch); we only re-pull to catch newly-starred players.
    if (tab === 'watch') api.watchlist().then(setWatch).catch((e) => setError(friendlyError(e.message)));
  }, [tab, mine, news, reloadMine]);

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

  // Focus-edge revalidation after an off-screen write. The rankings/free/mine/watch loaders above key on
  // `tab`/filters — NOT on `active` — so a write done in an overlay opened from this tab (add/drop/claim/
  // trade → global invalidateCaches while we're inactive) wouldn't reflect until you switch sub-tabs. The
  // shared-hook screens catch this on their own focus edge; this bespoke screen must do the same. Record
  // that a cache invalidation fired while away, then on the active false→true edge revalidate the CURRENT
  // sub-tab exactly once (no needless refetch when nothing changed).
  const dirtyRef = useRef(false);
  const wasActiveRef = useRef(active);
  useEffect(() => onCacheInvalidate(() => { dirtyRef.current = true; }), []);
  useEffect(() => {
    const became = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (!became || !dirtyRef.current) return;
    dirtyRef.current = false;
    if (tab === 'rankings') loadRankings();
    else if (tab === 'free') loadFree();
    else if (tab === 'mine') reloadMine();
    else if (tab === 'watch') api.watchlist().then(setWatch).catch((e) => setError(friendlyError(e.message)));
    else if (tab === 'news') api.news().then(setNews).catch((e) => setError(friendlyError(e.message)));
  }, [active, tab, loadRankings, loadFree, reloadMine]);

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

  // Secondary sort, remembered PER TAB (search has its own slot). Reading the current tab's stored
  // choice, or its SORT_DEFAULTS fallback, means Free Agents can default to Value while Rankings keeps
  // its rank order — and a sort you pick on one tab no longer leaks onto the others.
  const sortTab = searching ? 'search' : tab;
  const listSort = sortByTab[sortTab] || SORT_DEFAULTS[sortTab] || 'default';
  const setListSort = useCallback((k) => setSortByTab((m) => ({ ...m, [sortTab]: k })), [sortTab]);

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
  // Watch + Free re-price through the selected lens locally (their cache keys are lens-agnostic), so a
  // 1QB/2QB/TE-prem toggle is an instant re-value + re-sort with no refetch — the same feel as Rankings.
  const watchData = useMemo(
    () => (watch ? sortPlayers(watch.players.filter((p) => !pos || p.position === pos).map((p) => priceByLens(p, lens)), listSort) : []),
    [watch, listSort, lens, pos]
  );
  // Free agents: server sends them best-first (by value); default keeps that order. Position
  // filter reuses the shared `pos` chip; secondary sort reuses `listSort`.
  const freeData = useMemo(
    () => (free ? sortPlayers(free.players.filter((p) => !pos || p.position === pos).map((p) => priceByLens(p, lens)), listSort) : []),
    [free, pos, listSort, lens]
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
      <View style={[styles.header, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
        <ScreenTitle focused={active}>Players</ScreenTitle>
        <NavTools active={active} />
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
          <ChipSelect label="Pos" options={POSITIONS} value={pos} onChange={setPos} />
          <ValueLens format={format} setFormat={setFormat} tep={tep} setTep={setTep} />
          {searchRes && searchRes.players.length ? <ChipSelect label="Sort" options={LIST_SORTS} value={listSort} onChange={setListSort} /> : null}
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
              <ChipSelect label="Rank" info="ranking" options={RANK_TYPES} value={rankType} onChange={setRankType} />
              <ChipSelect label="Pos" options={POSITIONS} value={pos} onChange={setPos} />
              <ValueLens format={format} setFormat={setFormat} tep={tep} setTep={setTep} />
              <ChipSelect label="Sort" options={LIST_SORTS} value={listSort} onChange={setListSort} />
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
                    <ActivityIndicator style={styles.loadMore} color={colors.accent} />
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
                    ? `Free agents available in one or more of your ${free.totalLeagues} league${free.totalLeagues === 1 ? '' : 's'}, best value first. Tap a player to add him, or re-sort by availability, projection, or name.`
                    : 'Free agents available across your leagues.'}
                </Text>
              </View>
              <ChipSelect label="Pos" options={POSITIONS} value={pos} onChange={setPos} />
              <ValueLens format={format} setFormat={setFormat} tep={tep} setTep={setTep} />
              <ChipSelect label="Sort" options={FREE_SORTS} value={listSort} onChange={setListSort} />
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
              {watch && watch.players.length ? (
                <>
                  <ChipSelect label="Pos" options={POSITIONS} value={pos} onChange={setPos} />
                  <ValueLens format={format} setFormat={setFormat} tep={tep} setTep={setTep} />
                  <ChipSelect label="Sort" options={WATCH_SORTS} value={listSort} onChange={setListSort} />
                </>
              ) : null}
              <FlatList
              data={watchData}
              keyExtractor={(p) => p.id}
              extraData={{ listSort }}
              contentContainerStyle={styles.list}
              renderItem={({ item, index }) => <Reveal delay={Math.min(index, 12) * 32} animate={index < 14}><WatchRow p={item} onPress={() => onOpenPlayer(item.id)} onQuickAdd={() => setAddAcross({ id: item.id, name: item.name })} /></Reveal>}
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
              <ChipSelect label="Pos" options={POSITIONS} value={pos} onChange={setPos} />
              <ChipSelect label="Sort" options={MINE_SORTS} value={listSort} onChange={setListSort} />
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
              <ChipSelect label="Sort" options={NEWS_SORTS} value={newsSort} onChange={setNewsSort} />
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
                ListFooterComponent={newsData.length ? <NewsCredit center style={styles.credit} /> : null}
              />
            </>
          )}
        </>
      )}

      {addAcross ? (
        <AddAcrossSheet
          player={addAcross}
          onClose={() => setAddAcross(null)}
          // Hand the checked leagues + player to the waiver wizard to review each add/drop/bid before
          // filing — no auto-picked drop that you then have to go fix on the Waivers tab.
          onReview={onStartWaiverWizard ? (player, stubs) => { setAddAcross(null); onStartWaiverWizard(stubs, player.id); } : undefined}
          onDone={() => {
            setAddAcross(null);
            // Reflect the add: the player is no longer free, so refetch the active board (kept on screen
            // while it revalidates). Watch rows re-derive their "N free" count from the fresh watchlist.
            if (tab === 'free') loadFree();
            else if (tab === 'watch') api.watchlist().then(setWatch).catch(() => {});
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
                  <NeonToggle active={t === 'target'} triplet={rgb.good} renderGlyph={(on) => <TargetIcon size={18} color={on ? colors.good : colors.textDim} glow={on} />} />
                </Pressable>
                <Pressable hitSlop={13} onPress={() => onTag(p.id, t === 'avoid' ? null : 'avoid', t)} accessibilityLabel="Avoid">
                  <NeonToggle active={t === 'avoid'} triplet={rgb.bad} renderGlyph={(on) => <AvoidIcon size={18} color={on ? colors.bad : colors.textDim} glow={on} />} />
                </Pressable>
                <Pressable hitSlop={13} onPress={() => onWatch(p.id, !w)} accessibilityLabel="Watch">
                  <NeonToggle active={w} triplet={rgb.watch} renderGlyph={(on) => <WatchIcon size={18} color={on ? colors.watch : colors.textDim} filled={on} glow={on} />} />
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

// One labeled row of "pick one" chips — the single control grammar shared by every filter/sort on
// this screen (rank mode, position, list sort, news sort). A leading uppercase label names the row,
// an optional InfoDot explains it, then the chips. Every tab stacks these in the same order
// (Rank → Pos → Value → Sort) so the controls read as one tidy form, not a per-tab pile.
function ChipSelect({ label, info, options, value, onChange }) {
  return (
    <View style={styles.controlRow}>
      <Text style={styles.controlLabel}>{label}</Text>
      {info ? <InfoDot id={info} size={16} /> : null}
      {options.map(([k, lbl]) => (
        <PopChip
          key={String(k)}
          active={value === k}
          onPress={() => onChange(k)}
          style={styles.ctlChip}
          activeStyle={styles.ctlChipActive}
          textStyle={styles.ctlChipText}
          activeTextStyle={{ color: colors.text }}
          label={lbl}
        />
      ))}
    </View>
  );
}

// Value lens: re-price (and, where value drives order, re-sort) the whole board through a chosen
// market. Two INDEPENDENT axes: the 1QB↔2QB segmented control (a QB is worth far more in 2QB), and a
// TE-premium on/off pill (a TE is worth more when he scores extra per catch). They don't affect each
// other — you can view 1QB + TE-premium, 2QB + TE-premium, either alone, or neither. Shares the same
// labeled-row grammar (label · InfoDot · controls) as the ChipSelect rows so the stack stays uniform.
function ValueLens({ format, setFormat, tep, setTep }) {
  return (
    <View style={styles.controlRow}>
      <Text style={styles.controlLabel}>Value</Text>
      <InfoDot id="format" size={16} />
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
  );
}

function WatchRow({ p, onPress, onQuickAdd }) {
  const posColor = positionColors[p.position] || colors.textDim;
  const s = p.summary;
  // A watched player who's a free agent in one or more of your leagues is the whole point of the
  // watchlist — surface a one-tap add right on the row (opens the same across-leagues claim sheet as
  // Free Agents) so you don't have to open his profile to act. Only when he's actually free somewhere.
  const canAdd = !!(onQuickAdd && s.free > 0);
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
      <View style={styles.watchRight}>
        {p.value != null ? <Text style={styles.value}>{p.value}</Text> : null}
        {canAdd ? (
          <Pressable
            onPress={onQuickAdd}
            hitSlop={8}
            style={({ pressed }) => [styles.quickAdd, pressed && { opacity: 0.7 }]}
            accessibilityLabel={`Add ${p.name} across leagues`}
          >
            <Text style={styles.quickAddText}>+ Add{s.free > 1 ? ` ${s.free}` : ''}</Text>
          </Pressable>
        ) : null}
      </View>
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
  grow: { flex: 1 },
  // The single control grammar: one labeled, wrapping row of chips, used for every filter/sort
  // (rank mode, position, list sort, news sort) and the value lens. Uniform padding so a stack of
  // them reads as one tidy form. A short uppercase label leads each row; chips flow and wrap.
  controlRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, rowGap: 8, paddingHorizontal: 16, paddingVertical: 5 },
  controlLabel: { color: colors.violetText, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2, minWidth: 34 },
  ctlChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 5 },
  ctlChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  ctlChipText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  // Value-lens controls: a 1QB/2QB segmented toggle + a TE-premium pill, both distinct from the
  // pick-one chips above (a mode toggle, not a filter) — accent-tinted when engaged.
  lensToggle: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 2 },
  lensSeg: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
  lensSegActive: { backgroundColor: colors.accent + '22', borderColor: colors.accent },
  lensSegText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  lensSegTextActive: { color: colors.accent },
  tepToggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  tepToggleOn: { backgroundColor: colors.accent + '22', borderColor: colors.accent },
  tepToggleText: { color: colors.textDim, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  tepToggleTextOn: { color: colors.accent },
  rightCol: { alignItems: 'flex-end', marginLeft: 10, gap: 7 },
  watchRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  quickAdd: { borderWidth: 1, borderColor: colors.good, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  quickAddText: { color: colors.good, fontSize: 12, fontWeight: '800' },
  newsSearchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 6 },
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
  chipFree: { color: colors.good, backgroundColor: colors.good + '22' },
  chipDraftable: { color: colors.warn, backgroundColor: colors.warn + '22' },
  chipTrade: { color: colors.accent, backgroundColor: colors.accent + '22' },
  chipNews: { color: colors.accent, backgroundColor: colors.accent + '22' },
  mine: { color: colors.good, fontSize: 9, fontWeight: '900', marginLeft: 6, borderWidth: 1, borderColor: colors.good, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' },
  tagMark: { fontSize: 13, fontWeight: '900', marginLeft: 6 },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  ptsLine: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  ptsItem: { fontSize: 12 },
  ptsLabel: { color: colors.violetText, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  ptsProj: { color: colors.text, fontSize: 13, fontWeight: '900' },
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
