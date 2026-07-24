'use strict';
// My Draft List: the owner's ranked shortlist / auto-pick queue for a league's draft. A pre-draft
// tool to narrow the pool, and (during a draft) the source MFL auto-picks from. Round-trips through
// the API: read (empty) → save an ordered set → it comes back ranked with a nextUp and the add-pool
// excludes listed players → reorder → clear.
process.env.MFL_DEMO_MODE = 'true';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-draftlist-${process.pid}-${Date.now()}`);

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

    // Find a league that actually has a draft (scheduled/in-progress) so there's a pool to add from.
    const { drafts } = await j('/api/drafts', { headers: H });
    const withDraft = (drafts || []).find((d) => d.status !== 'complete' && d.status !== 'none') || (drafts || [])[0];
    assert(withDraft, 'demo has at least one draft');
    const lg = withDraft.leagueId;

    const before = await j(`/api/leagues/${lg}/draftlist`, { headers: H });
    assert(Array.isArray(before.list) && before.list.length === 0, 'list starts empty');
    assert(Array.isArray(before.available) && before.available.length >= 2, `add-pool is populated, got ${before.available.length}`);
    assert(before.nextUp == null, 'no next-up on an empty list');

    // Save the top 3 of the pool as our ranked list.
    const ids = before.available.slice(0, 3).map((p) => p.id);
    const saved = await j(`/api/leagues/${lg}/draftlist`, { method: 'POST', headers: JH, body: JSON.stringify({ players: ids }) });
    assert(saved.count === 3 && saved.list.length === 3, `saved 3, got ${saved.count}`);
    assert(saved.list.map((p) => p.id).join(',') === ids.join(','), 'order is preserved as ranked');
    assert(saved.list.every((p, i) => p.rank === i + 1), 'ranks are 1..N in order');
    assert(saved.nextUp && saved.nextUp.id === ids[0], 'next-up is the top-ranked (undrafted) player');
    assert(saved.available.every((p) => !ids.includes(p.id)), 'the add-pool now excludes listed players');
    console.log('✓ save writes a ranked list; next-up + add-pool reflect it');

    // Reorder (reverse) — whole-set replace keeps the new order.
    const rev = [...ids].reverse();
    const reordered = await j(`/api/leagues/${lg}/draftlist`, { method: 'POST', headers: JH, body: JSON.stringify({ players: rev }) });
    assert(reordered.list.map((p) => p.id).join(',') === rev.join(','), 'reorder replaces the order');
    assert(reordered.nextUp.id === rev[0], 'next-up follows the new top rank');
    console.log('✓ reorder is a whole-set replace');

    // Dedupe + clear.
    const dup = await j(`/api/leagues/${lg}/draftlist`, { method: 'POST', headers: JH, body: JSON.stringify({ players: [ids[0], ids[0], ids[1]] }) });
    assert(dup.count === 2, 'duplicate ids collapse');
    const cleared = await j(`/api/leagues/${lg}/draftlist`, { method: 'POST', headers: JH, body: JSON.stringify({ players: [] }) });
    assert(cleared.count === 0 && cleared.nextUp == null, 'empty save clears the list');
    console.log('✓ dedupes and clears');
  } finally {
    server.close();
  }

  console.log('\nDRAFT LIST HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
