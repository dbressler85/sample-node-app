'use strict';

// Target / Avoid personal player tags: the store (set/get/clear, invalid-ignored), the
// ±10% value modifiers, and the profile surfacing the current tag.

process.env.MFL_DEMO_MODE = 'true';

const playerTags = require('../../src/store/playerTags');
const hub = require('../../src/services/playerhub');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const TOKEN = 'playertags-test-token';
const PID = '16002'; // a demo player

(async () => {
  // Clean slate.
  playerTags.set(TOKEN, PID, null);

  // Modifiers.
  assert(playerTags.modifier('target') === 1.1, 'target → ×1.10');
  assert(playerTags.modifier('avoid') === 0.9, 'avoid → ×0.90');
  assert(playerTags.modifier(null) === 1 && playerTags.modifier('bogus') === 1, 'untagged/unknown → ×1');

  // Set / get / all.
  assert(playerTags.set(TOKEN, PID, 'target') === 'target', 'set returns the applied tag');
  assert(playerTags.get(TOKEN, PID) === 'target', 'get reflects it');
  assert(playerTags.all(TOKEN)[PID] === 'target', 'all() includes it');

  // Overwrite, invalid ignored, clear.
  assert(playerTags.set(TOKEN, PID, 'avoid') === 'avoid', 'overwrite to avoid');
  assert(playerTags.set(TOKEN, PID, 'bogus') === null, 'invalid tag clears (not stored)');
  playerTags.set(TOKEN, PID, 'target');
  assert(playerTags.set(TOKEN, PID, null) === null, 'null clears');
  assert(playerTags.get(TOKEN, PID) === null && playerTags.all(TOKEN)[PID] === undefined, 'cleared everywhere');

  // Profile surfaces the current tag.
  let prof = await hub.profile('ck', TOKEN, PID);
  assert(prof.tag === null || prof.tag === undefined, 'profile: untagged reads null');
  playerTags.set(TOKEN, PID, 'target');
  prof = await hub.profile('ck', TOKEN, PID);
  assert(prof.tag === 'target', 'profile: reflects the set tag');

  // Cleanup.
  playerTags.set(TOKEN, PID, null);

  console.log('✓ player tags: store set/get/clear, invalid-ignored, ±10% modifiers, profile surfacing');
  console.log('\nPLAYER TAGS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
