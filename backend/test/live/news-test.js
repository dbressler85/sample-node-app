'use strict';
// Stubbed LIVE-mode harness for RotoBaller player news: the partner feed (RSS) is
// name-matched to MFL players, mapped to the leagues it affects, and league-wide items
// about players you don't roster are filtered out. Same-headline re-posts collapse to
// one row.
process.env.MFL_DEMO_MODE = 'false';
process.env.ROTOBALLER_FEED_URL = 'https://feed.rotoballer.com/nfl';
delete process.env.MFL_WEEK; // offseason is fine for news

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'Mahomes, Patrick', position: 'QB', team: 'KCC' }, // rostered
  { id: '2', name: 'Kelce, Travis', position: 'TE', team: 'KCC' }, // NOT rostered
];

// RotoBaller partner feed (RSS 2.0): each <item> tags the player it's about via an
// explicit <player> element (and the name is also in the title). a1 and a3 are the same
// story re-posted (different links) — they must collapse to a single row on the tab.
const RB_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>RotoBaller NFL Player News</title>
  <item>
    <title>Patrick Mahomes ruled OUT with ankle injury</title>
    <description><![CDATA[The Chiefs QB will not play Sunday.]]></description>
    <player>Patrick Mahomes</player>
    <category>Injuries</category>
    <pubDate>Sat, 18 Jul 2026 12:00:00 GMT</pubDate>
    <link>https://www.rotoballer.com/nfl/a1</link>
    <guid>rb-a1</guid>
  </item>
  <item>
    <title>Travis Kelce questionable for Week 1</title>
    <description>Limited in practice.</description>
    <player>Travis Kelce</player>
    <pubDate>Sat, 18 Jul 2026 13:00:00 GMT</pubDate>
    <link>https://www.rotoballer.com/nfl/a2</link>
    <guid>rb-a2</guid>
  </item>
  <item>
    <title>Patrick Mahomes ruled OUT with ankle injury</title>
    <description>The Chiefs QB will not play Sunday.</description>
    <player>Patrick Mahomes</player>
    <pubDate>Sat, 18 Jul 2026 12:30:00 GMT</pubDate>
    <link>https://www.rotoballer.com/nfl/a3</link>
    <guid>rb-a3</guid>
  </item>
</channel></rss>`;

global.fetch = async (url) => {
  if (String(url).includes('rotoballer')) return { ok: true, headers: { get: () => 'application/rss+xml' }, text: async () => RB_RSS };
  return { ok: true, headers: { get: () => 'application/json' }, json: async () => [] }; // fantasycalc/sleeper empty
};

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Dynasty', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'rosters':
      return { rosters: { franchise: [{ id: opts.FRANCHISE || '0001', player: [{ id: '1', status: 'starter' }] }] } }; // only Mahomes
    case 'league':
      return { league: { starters: { position: [{ name: 'QB', limit: '1' }] }, franchises: { franchise: [{ id: '0001', name: 'My Team' }] } } };
    default:
      return {};
  }
};

const exposure = require('../../src/services/exposure');
const playerhub = require('../../src/services/playerhub');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TK = 'tk';

  const { news } = await exposure.getNews(CK);
  console.log('news:', JSON.stringify(news.map((n) => ({ p: n.player.id, sev: n.severity, aff: n.affectedCount, url: !!n.url }))));
  // Only the rostered player's news survives — AND the two same-headline Mahomes items
  // collapse to a single row (no duplicate headlines on the tab).
  assert(news.length === 1, `rostered + deduped by headline → 1 row, got ${news.length}`);
  const item = news[0];
  assert(item.player.id === '1', 'RotoBaller item name-matched to the MFL player');
  assert(item.affectedCount === 1 && item.startingCount === 1, 'mapped to the league I roster him in (starting)');
  assert(item.severity === 'high', `"ruled OUT" graded high, got ${item.severity}`);
  assert(item.url && item.url.includes('rotoballer.com'), 'article link carried through');
  assert(!news.some((n) => n.player.id === '2'), 'league-wide news about a non-rostered player is filtered out');
  console.log(`✓ /api/news: RotoBaller "${item.headline}" → your team (starting), severity ${item.severity}`);

  const prof = await playerhub.profile(CK, TK, '1');
  assert(prof.news.length === 1 && /Mahomes/.test(prof.news[0].headline) && prof.news[0].url, 'player profile shows his RotoBaller news with a link');
  console.log(`✓ profile news: ${prof.news.length} item — "${prof.news[0].headline}"`);

  console.log('\nLIVE NEWS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
