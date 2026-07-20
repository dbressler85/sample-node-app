'use strict';

// Target/Avoid highlights on the non-trade surfaces: the waiver board floats a Target
// free agent to the top and sinks an Avoid, and the draft board carries each available
// player's tag for the UI to highlight.

process.env.MFL_DEMO_MODE = 'true';

const waivers = require('../../src/services/waivers');
const draft = require('../../src/services/draft');
const playerTags = require('../../src/store/playerTags');
const demo = require('../../src/demo/fixtures');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const TOKEN = 'tag-surfaces-token';

(async () => {
  const league = demo.leagues()[0].leagueId; // 64097

  // Two free agents in this league: 16002 and 16001. Tag one Target, one Avoid.
  const TARGET = '16002';
  const AVOID = '16001';
  playerTags.set(TOKEN, TARGET, 'target');
  playerTags.set(TOKEN, AVOID, 'avoid');

  const board = await waivers.getBoard('ck', TOKEN, league, {});
  const ids = board.freeAgents.map((p) => String(p.id));
  console.log('board order (head):', ids.slice(0, 5).join(', '));
  assert(ids[0] === TARGET, 'a Target free agent floats to the very top');
  assert(board.freeAgents[0].tag === 'target', 'and carries its tag for the badge');
  assert(ids.indexOf(AVOID) === ids.length - 1, 'an Avoid free agent sinks to the bottom');

  // Draft board carries tags on the available pool.
  playerTags.set(TOKEN, '19001', 'target'); // Marliss — available in the live demo draft
  const dl = await draft.getLeague('ck', TOKEN, '40750');
  const marliss = dl.available.find((p) => String(p.id) === '19001');
  assert(marliss && marliss.tag === 'target', 'draft available pool carries the player tag');

  // Cleanup.
  for (const id of [TARGET, AVOID, '19001']) playerTags.set(TOKEN, id, null);

  console.log('✓ tag surfaces: waiver board floats Targets / sinks Avoids; draft pool carries tags');
  console.log('\nTAG SURFACES HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
