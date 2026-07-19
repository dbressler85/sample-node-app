'use strict';

// Player news from ESPN's free, no-key NFL news feed. ESPN tags each article with
// the athletes it involves; we map those to our MFL players by name (ESPN keys by
// its own athlete ids, so name-match is the light, no-crosswalk route). The result
// is normalized into the app's news-item shape so exposure/playerhub can map each
// item to the leagues it affects.

const config = require('../config');
const playersLib = require('./players');

const TTL_MS = 20 * 60 * 1000; // 20 min — news moves faster than dynasty values
const ESPN_NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50';
let cache = { at: 0, articles: [] };

// Rough severity from the headline/blurb, since ESPN doesn't grade it.
function severityOf(text) {
  const t = String(text).toLowerCase();
  if (/\b(out|ruled out|injured reserve|\bir\b|suspend|torn|acl|mcl|surgery|carted|done for the)\b/.test(t)) return 'high';
  if (/\b(question|doubt|limited|dnp|day-to-day|game-time|expected to (play|miss))\b/.test(t)) return 'medium';
  return 'low';
}

// Normalize a name for matching across "Last, First" (MFL) and "First Last" (ESPN),
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

async function fetchEspn() {
  if (cache.articles.length && Date.now() - cache.at < TTL_MS) return cache.articles;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    let json;
    try {
      const res = await fetch(ESPN_NEWS_URL, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': config.userAgent } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const articles = (Array.isArray(json && json.articles) ? json.articles : []).map((a, i) => {
      const cats = Array.isArray(a.categories) ? a.categories : [];
      const athletes = cats
        .filter((c) => c.type === 'athlete')
        .map((c) => ({ name: (c.athlete && (c.athlete.displayName || c.athlete.description)) || c.description || '' }))
        .filter((x) => x.name);
      return {
        id: String(a.id || a.guid || `espn-${i}`),
        headline: a.headline || a.title || '',
        description: a.description || '',
        published: a.published || null,
        url: (a.links && a.links.web && a.links.web.href) || null,
        athletes,
      };
    });
    cache = { at: Date.now(), articles };
    return articles;
  } catch (e) {
    console.log(`[news] espn error=${e.message}`);
    return cache.articles.length ? cache.articles : []; // last-good on failure
  }
}

// ESPN articles mapped to the app's news-item shape, one item per tagged athlete
// that resolves to an MFL player: { id, playerId, headline, severity, url, published }.
async function mflNews(cookie) {
  const [articles, byId] = await Promise.all([fetchEspn(), playersLib.load(cookie)]);
  // Name -> [ids]. A normalized name can collide (two "Mike Williams"); when it
  // maps to more than one player we skip it rather than attribute news to the
  // wrong player. (Name-only matching has no id crosswalk, so ambiguity is real.)
  const nameToIds = new Map();
  for (const p of byId.values()) {
    const n = normName(p.name);
    if (!nameToIds.has(n)) nameToIds.set(n, []);
    nameToIds.get(n).push(p.id);
  }

  const items = [];
  const seen = new Set();
  let unmatched = 0;
  let ambiguous = 0;
  for (const a of articles) {
    for (const ath of a.athletes) {
      const ids = nameToIds.get(normName(ath.name));
      if (!ids) { unmatched += 1; continue; }
      if (ids.length > 1) { ambiguous += 1; continue; } // don't guess between namesakes
      const pid = ids[0];
      const key = `${a.id}-${pid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ id: key, playerId: pid, headline: a.headline, severity: severityOf(`${a.headline} ${a.description}`), url: a.url, published: a.published });
    }
  }
  console.log(`[news] espn matched=${items.length} unmatched=${unmatched} ambiguous=${ambiguous}`);
  return items;
}

module.exports = { mflNews, fetchEspn, normName, severityOf };
