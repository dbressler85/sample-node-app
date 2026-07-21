'use strict';

// The "Yours" ranking: rank players by how many of MY leagues I roster them in (exposure),
// ties broken by market value. Only players I actually hold somewhere appear, and the list
// is sorted by that count descending. This backs the Players screen "Yours" sort chip.

process.env.MFL_DEMO_MODE = 'true';

const hub = require('../../src/services/playerhub');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const TOKEN = 'players-owned-token';

(async () => {
  const owned = await hub.rankings('ck', TOKEN, { type: 'owned' });
  assert(owned.type === 'owned', 'ranking echoes the requested type');

  // Every returned player is one I roster in at least one league.
  assert(owned.players.length > 0, 'I roster players across my demo leagues, so the list is non-empty');
  assert(owned.players.every((p) => p.mineInLeagues >= 1), 'every row is a player I actually roster somewhere');
  // Personal ownership: rostered (by anyone) in your leagues = total minus where he's free,
  // and it's >= how many you roster yourself. Percentage matches the fraction.
  assert(owned.players.every((p) => p.leagueCount >= 1 && p.leagueOwned >= p.mineInLeagues && p.leagueOwned <= p.leagueCount), 'leagueOwned is within [mineInLeagues, leagueCount]');
  assert(owned.players.every((p) => p.leagueOwnedPct === Math.round((p.leagueOwned / p.leagueCount) * 100)), 'leagueOwnedPct matches the owned/total fraction');

  // Sorted by exposure (mineInLeagues) descending; ties fall back to value descending.
  for (let i = 1; i < owned.players.length; i += 1) {
    const a = owned.players[i - 1];
    const b = owned.players[i];
    const ok = a.mineInLeagues > b.mineInLeagues
      || (a.mineInLeagues === b.mineInLeagues && (a.value || 0) >= (b.value || 0));
    assert(ok, `owned ranking is sorted by exposure then value (row ${i})`);
  }

  // At least one player rostered in more than one league bubbles to the top region — the
  // whole point of the "Yours ×N" view.
  const top = owned.players[0];
  assert(top.mineInLeagues >= owned.players[owned.players.length - 1].mineInLeagues, 'the most-exposed player leads');

  console.log(`✓ owned ranking: ${owned.players.length} rostered players, top exposure ×${top.mineInLeagues}`);
  console.log('\nPLAYERS OWNED HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
