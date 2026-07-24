'use strict';
// Block editor + bulk save: the editor lists EVERY league (so you can add to any) with its current
// checked tokens + the one asking-price note; saving replaces the whole league's block in one shot.
process.env.MFL_DEMO_MODE = 'true';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-baited-${process.pid}-${Date.now()}`);

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const app = require('../../src/app');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (p, o) => (await fetch(`${base}${p}`, o)).json();
  try {
    const { token } = await j('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'demo' }),
    });
    const H = { Authorization: `Bearer ${token}` };
    const JH = { ...H, 'Content-Type': 'application/json' };

    const ed = await j('/api/tradebait/editor', { headers: H });
    assert(Array.isArray(ed.leagues) && ed.leagues.length >= 1, 'editor lists leagues');
    assert(ed.leagues.every((l) => l.leagueId && 'note' in l && Array.isArray(l.blockTokens)), 'every league carries note + blockTokens');
    const lg = ed.leagues[0];

    // Save a whole block: a player + a pick, with ONE league note.
    const save = await j(`/api/leagues/${lg.leagueId}/tradebait`, { method: 'POST', headers: JH, body: JSON.stringify({ tokens: ['13593', 'DP_01_05'], note: 'a 1st + a young WR' }) });
    assert(save.ok && save.count === 2 && save.note === 'a 1st + a young WR', `save returns the set + note, got ${JSON.stringify(save)}`);

    const ed2 = await j('/api/tradebait/editor', { headers: H });
    const lg2 = ed2.leagues.find((l) => l.leagueId === lg.leagueId);
    assert(lg2.count === 2 && new Set(lg2.blockTokens).size === 2, 'editor reflects the saved 2-asset block');
    assert(lg2.blockTokens.includes('13593') && lg2.blockTokens.includes('DP_01_05'), 'both the player and the pick are checked');
    assert(lg2.note === 'a 1st + a young WR', 'the single league note round-trips');
    console.log('✓ editor lists all leagues; bulk save writes players + picks + one note');

    // Re-saving with a subset removes the rest (whole-set replace, not additive).
    await j(`/api/leagues/${lg.leagueId}/tradebait`, { method: 'POST', headers: JH, body: JSON.stringify({ tokens: ['13593'], note: '' }) });
    const ed3 = await j('/api/tradebait/editor', { headers: H });
    const lg3 = ed3.leagues.find((l) => l.leagueId === lg.leagueId);
    assert(lg3.count === 1 && lg3.blockTokens[0] === '13593' && lg3.note === '', 'a subset save replaces the whole block + clears the note');

    // Clearing entirely.
    await j(`/api/leagues/${lg.leagueId}/tradebait`, { method: 'POST', headers: JH, body: JSON.stringify({ tokens: [], note: '' }) });
    const ed4 = await j('/api/tradebait/editor', { headers: H });
    assert(ed4.leagues.find((l) => l.leagueId === lg.leagueId).count === 0, 'saving an empty set clears the block');
    console.log('✓ whole-set replace: subset trims, empty clears');
  } finally {
    server.close();
  }

  console.log('\nTRADEBAIT EDITOR HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
