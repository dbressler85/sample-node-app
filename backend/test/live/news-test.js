'use strict';
// Stubbed LIVE-mode harness for ESPN news (source A): the general NFL feed is
// name-matched to MFL players, mapped to the leagues it affects, and league-wide
// items about players you don't roster are filtered out.
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK; // offseason is fine for news

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'Mahomes, Patrick', position: 'QB', team: 'KCC' }, // rostered
  { id: '2', name: 'Kelce, Travis', position: 'TE', team: 'KCC' }, // NOT rostered
];

// ESPN news feed shape: articles with athlete-tagged categories.
const ESPN = {
  articles: [
    {
      id: 'a1',
      headline: 'Patrick Mahomes ruled OUT with ankle injury',
      description: 'The Chiefs QB will not play Sunday.',
      published: '2026-07-18T12:00:00Z',
      links: { web: { href: 'https://www.espn.com/nfl/story/a1' } },
      categories: [{ type: 'athlete', athlete: { displayName: 'Patrick Mahomes' } }],
    },
    {
      id: 'a2',
      headline: 'Travis Kelce questionable for Week 1',
      description: 'Limited in practice.',
      published: '2026-07-18T13:00:00Z',
      links: { web: { href: 'https://www.espn.com/nfl/story/a2' } },
      categories: [{ type: 'athlete', athlete: { displayName: 'Travis Kelce' } }],
    },
  ],
};

global.fetch = async (url) => {
  if (String(url).includes('espn.com/apis')) return { ok: true, json: async () => ESPN };
  return { ok: true, json: async () => [] }; // fantasycalc/sleeper empty
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
  assert(news.length === 1, `only the rostered player's news survives, got ${news.length}`);
  const item = news[0];
  assert(item.player.id === '1', 'ESPN article name-matched to the MFL player');
  assert(item.affectedCount === 1 && item.startingCount === 1, 'mapped to the league I roster him in (starting)');
  assert(item.severity === 'high', `"ruled OUT" graded high, got ${item.severity}`);
  assert(item.url && item.url.includes('espn.com'), 'article link carried through');
  assert(!news.some((n) => n.player.id === '2'), 'league-wide news about a non-rostered player is filtered out');
  console.log(`✓ /api/news: ESPN "${item.headline}" → your team (starting), severity ${item.severity}`);

  const prof = await playerhub.profile(CK, TK, '1');
  assert(prof.news.length === 1 && /Mahomes/.test(prof.news[0].headline) && prof.news[0].url, 'player profile shows his ESPN news with a link');
  console.log(`✓ profile news: ${prof.news.length} item — "${prof.news[0].headline}"`);

  console.log('\nLIVE NEWS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
