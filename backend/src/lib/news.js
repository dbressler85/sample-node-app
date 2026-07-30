'use strict';

// Player news from RotoBaller's partner feed. RotoBaller licenses its fantasy
// player-news feed (XML/RSS or JSON) to partners for embedding — commercial use is
// permitted under that partnership, with attribution + a link back to the source
// (the app shows a "News · RotoBaller" credit and each item deep-links to the story).
//
// The partner feed URL is account-specific (and may carry a partner key), so it is
// NEVER committed — it comes from config.newsFeedUrl (env ROTOBALLER_FEED_URL). When
// it's unset, live news is empty rather than falling back to any unlicensed source.
//
// Items are mapped to our MFL players by name — RotoBaller tags each item with the
// player it's about (an explicit player field when the feed carries one), and we fall
// back to scanning the headline for a known player name. The result is normalized into
// the app's news-item shape so exposure/playerhub can map each item to the leagues it
// affects.

const config = require('../config');
const playersLib = require('./players');

let cache = { at: 0, articles: [] };

// Rough severity from the headline/blurb + any feed category tags (injury/breaking),
// since the feed doesn't hand us a graded level.
function severityOf(text) {
  const t = String(text).toLowerCase();
  if (/\b(out|ruled out|injured reserve|\bir\b|suspend|torn|acl|mcl|surgery|carted|done for the)\b/.test(t)) return 'high';
  if (/\b(question|doubt|limited|dnp|day-to-day|game-time|expected to (play|miss))\b/.test(t)) return 'medium';
  return 'low';
}

// Normalize a name for matching across "Last, First" (MFL) and "First Last" (feed),
// dropping suffixes and punctuation.
function normName(name) {
  let n = String(name || '').toLowerCase();
  if (n.includes(',')) {
    const [last, first] = n.split(',');
    n = `${first} ${last}`;
  }
  return n
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- feed decoding (RSS/Atom or JSON, no XML dependency) ---------------------

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#x2019;/gi, '’')
    .replace(/&amp;/g, '&')
    .trim();
}

// First inner text of <name ...>…</name> inside a block (any namespace prefix ok).
function xmlTag(block, name) {
  const m = block.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}
// All inner texts of a repeated tag (e.g. <category>).
function xmlTagAll(block, name) {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push(decodeEntities(m[1]));
  return out;
}

// A feed item's explicit player name(s), if the feed tags them. Partner feeds carry a
// player field; we probe the likely element names (and a category tagged as a player)
// so we don't depend on one exact spelling.
function xmlPlayerNames(block) {
  const names = [];
  for (const t of ['player', 'playername', 'player_name', 'athlete']) {
    for (const v of xmlTagAll(block, t)) if (v) names.push(v);
  }
  // <category domain="player">Name</category> style tags.
  const re = /<category\b[^>]*\b(?:domain|scheme)="[^"]*player[^"]*"[^>]*>([\s\S]*?)<\/category>/gi;
  let m;
  while ((m = re.exec(block))) { const v = decodeEntities(m[1]); if (v) names.push(v); }
  return names;
}

function parseRss(xml) {
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  return blocks.map((b, i) => {
    const headline = xmlTag(b, 'title');
    const description = xmlTag(b, 'description') || xmlTag(b, 'summary') || xmlTag(b, 'content');
    // RSS <link>URL</link>; Atom <link href="URL"/>.
    let url = xmlTag(b, 'link');
    if (!url) { const lm = b.match(/<link\b[^>]*\bhref="([^"]+)"/i); if (lm) url = decodeEntities(lm[1]); }
    const published = xmlTag(b, 'pubDate') || xmlTag(b, 'published') || xmlTag(b, 'updated') || null;
    const id = xmlTag(b, 'guid') || xmlTag(b, 'id') || url || `rb-${i}`;
    return {
      id: String(id),
      headline,
      description,
      url: url || null,
      published: published || null,
      tags: xmlTagAll(b, 'category').map((c) => c.toLowerCase()),
      playerNames: xmlPlayerNames(b),
    };
  });
}

function parseJsonFeed(json) {
  const arr = Array.isArray(json)
    ? json
    : (json && (json.items || json.articles || json.news || json.data)) || [];
  return (Array.isArray(arr) ? arr : []).map((a, i) => {
    const player = a.player || a.playerName || a.player_name || a.athlete;
    const players = Array.isArray(a.players) ? a.players : [];
    const playerNames = [
      ...(typeof player === 'string' ? [player] : player && player.name ? [player.name] : []),
      ...players.map((p) => (typeof p === 'string' ? p : p && p.name) || '').filter(Boolean),
    ];
    const rawTags = a.tags || a.categories || a.meta || [];
    return {
      id: String(a.id || a.guid || a.url || a.link || `rb-${i}`),
      headline: a.title || a.headline || '',
      description: a.description || a.summary || a.content_text || a.content || '',
      url: a.url || a.link || (a.links && a.links.web && a.links.web.href) || null,
      published: a.date_published || a.published || a.pubDate || a.date || null,
      tags: (Array.isArray(rawTags) ? rawTags : [rawTags]).map((t) => String((t && t.name) || t).toLowerCase()),
      playerNames,
    };
  });
}

// Fetch + normalize the configured feed into raw articles. Detects JSON vs XML by the
// response content-type / leading character. Serves a last-good snapshot on failure and
// an empty list when no feed URL is configured (never falls back to an unlicensed source).
async function fetchFeed() {
  if (!config.newsFeedUrl) return [];
  if (cache.articles.length && Date.now() - cache.at < config.newsCacheTtlMs) return cache.articles;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    let body;
    let ctype;
    try {
      const res = await fetch(config.newsFeedUrl, {
        signal: ctrl.signal,
        headers: { Accept: 'application/rss+xml, application/xml, application/json;q=0.9, */*;q=0.8', 'User-Agent': config.userAgent },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ctype = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      body = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const looksJson = /json/i.test(ctype) || /^\s*[[{]/.test(body);
    let articles;
    if (looksJson) {
      let json;
      try { json = JSON.parse(body); } catch { json = null; }
      articles = json ? parseJsonFeed(json) : [];
    } else {
      articles = parseRss(body);
    }
    articles = articles.filter((a) => a.headline);
    cache = { at: Date.now(), articles };
    return articles;
  } catch (e) {
    console.log(`[news] rotoballer error=${e.message}`);
    return cache.articles.length ? cache.articles : []; // last-good on failure
  }
}

// Name -> [ids] index over the full player DB. Rebuilding it means normName()
// (three regexes) over thousands of players; it depends only on the player DB, so
// memoize it by the byId Map's identity — players.load returns the same cached Map
// until the 24h refresh, when a new Map reference misses and rebuilds. A normalized
// name can collide (two "Mike Williams"); a name mapping to more than one id is
// skipped by callers rather than mis-attributed.
const nameIndexCache = new WeakMap(); // byId Map -> nameToIds Map
function nameToIdIndex(byId) {
  let idx = nameIndexCache.get(byId);
  if (idx) return idx;
  idx = new Map();
  for (const p of byId.values()) {
    const n = normName(p.name);
    if (!idx.has(n)) idx.set(n, []);
    idx.get(n).push(p.id);
  }
  nameIndexCache.set(byId, idx);
  return idx;
}

// Resolve the players an article is about: prefer the feed's explicit player tag(s);
// otherwise scan the headline for a known player name. Scanning tests consecutive
// 3- then 2-word windows left-to-right (player names are 2–3 tokens), advancing past a
// hit so we don't re-match its words — cheap (a few lookups per article) and reuses the
// exact-name index, so a namesake collision (>1 id) is left for the caller to skip
// rather than guessed. Returns unique { name, ids } candidates.
function resolveAthletes(article, nameToIds) {
  const out = [];
  const seenName = new Set();
  const add = (name) => {
    const n = normName(name);
    if (!n || seenName.has(n)) return;
    seenName.add(n);
    const ids = nameToIds.get(n);
    if (ids) out.push({ name: n, ids });
  };

  if (article.playerNames && article.playerNames.length) {
    for (const name of article.playerNames) add(name);
    if (out.length) return out;
  }

  // Headline scan fallback.
  const words = normName(article.headline).split(' ').filter(Boolean);
  for (let i = 0; i < words.length; ) {
    let matched = false;
    for (const span of [3, 2]) {
      if (i + span > words.length) continue;
      const cand = words.slice(i, i + span).join(' ');
      if (nameToIds.has(cand)) { add(cand); i += span; matched = true; break; }
    }
    if (!matched) i += 1;
  }
  return out;
}

// Feed articles mapped to the app's news-item shape, one item per tagged player
// that resolves to an MFL player: { id, playerId, headline, severity, url, published }.
async function mflNews(cookie) {
  const [articles, byId] = await Promise.all([fetchFeed(), playersLib.load(cookie)]);
  const nameToIds = nameToIdIndex(byId);

  const items = [];
  const seen = new Set();
  let unmatched = 0;
  let ambiguous = 0;
  for (const a of articles) {
    const athletes = resolveAthletes(a, nameToIds);
    if (!athletes.length) { unmatched += 1; continue; }
    const tagText = (a.tags || []).join(' ');
    let severity = severityOf(`${a.headline} ${a.description} ${tagText}`);
    if (severity === 'low' && /injur|breaking|ruled out|suspend/.test(tagText)) severity = 'medium';
    for (const ath of athletes) {
      if (ath.ids.length > 1) { ambiguous += 1; continue; } // don't guess between namesakes
      const pid = ath.ids[0];
      const key = `${a.id}-${pid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ id: key, playerId: pid, headline: a.headline, severity, url: a.url, published: a.published });
    }
  }
  console.log(`[news] rotoballer matched=${items.length} unmatched=${unmatched} ambiguous=${ambiguous}`);
  return items;
}

module.exports = { mflNews, fetchFeed, normName, severityOf };
