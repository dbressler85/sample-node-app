'use strict';
// Edit a PENDING FAAB claim's bid in place (PATCH /api/leagues/:id/waivers/:claimId). The user hit a
// dead-end: a claim's bid was uneditable — only cancelable. This asserts the edit round-trips (demo:
// the store is patched; live: the round is REPLACE-resubmitted with the new bid), and that a bogus
// claim id 404s rather than silently no-op'ing.
process.env.MFL_DEMO_MODE = 'true';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-wedit-${process.pid}-${Date.now()}`);

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const app = require('../../src/app');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (p, o) => (await fetch(`${base}${p}`, o)).json();
  const raw = async (p, o) => fetch(`${base}${p}`, o);
  try {
    const { token } = await j('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'demo' }),
    });
    const H = { Authorization: `Bearer ${token}` };
    const JH = { ...H, 'Content-Type': 'application/json' };

    // Find the demo FAAB pending claim (Dynasty Warlords rosters one: add Mims, $15).
    const pend0 = await j('/api/waivers/pending', { headers: H });
    const claim = (pend0.pending || []).find((c) => c.system === 'faab' && c.bid != null);
    assert(claim, `a FAAB pending claim exists to edit, got ${JSON.stringify(pend0.pending)}`);
    const startBid = claim.bid;
    assert(claim.leagueId && claim.id, 'the pending claim carries a leagueId + id to target');

    // Edit its bid. The response echoes the edit; the next pending read must reflect the new number.
    const newBid = startBid + 12;
    const res = await j(`/api/leagues/${claim.leagueId}/waivers/${claim.id}`, { method: 'PATCH', headers: JH, body: JSON.stringify({ bid: newBid }) });
    assert(res && res.edited === claim.id, `edit echoes the claim id, got ${JSON.stringify(res)}`);

    const pend1 = await j('/api/waivers/pending', { headers: H });
    const after = (pend1.pending || []).find((c) => c.id === claim.id && c.leagueId === claim.leagueId);
    assert(after && after.bid === newBid, `the pending claim's bid is now $${newBid}, got ${after && after.bid}`);
    // The claim is still there (edited, not canceled) — same add, same id.
    assert(after.add && claim.add && after.add.id === claim.add.id, 'the edited claim keeps its add player (not replaced)');
    console.log(`✓ Edit a pending FAAB bid in place: $${startBid} → $${after.bid} (claim survives, not canceled)`);

    // A bogus claim id 404s (never a silent no-op that would look like success).
    const bogus = await raw(`/api/leagues/${claim.leagueId}/waivers/does-not-exist`, { method: 'PATCH', headers: JH, body: JSON.stringify({ bid: 5 }) });
    assert(bogus.status === 404, `editing an unknown claim 404s, got ${bogus.status}`);
    console.log('✓ Editing an unknown claim id 404s (no silent no-op)');
  } finally {
    server.close();
  }

  console.log('\nWAIVERS EDIT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
