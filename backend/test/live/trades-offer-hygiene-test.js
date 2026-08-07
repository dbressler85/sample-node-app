'use strict';
// Trade-offer hygiene (PO review): (1) a DEAD offer — one whose players/picks were already traded or
// used — can't be accepted OR rejected on MFL, so it lingers until timeout; we detect it (validity
// flag) and let the user locally DISMISS it out of their inbox. (2) markOfferValidity is unit-tested
// against synthetic authoritative ownership.
process.env.MFL_DEMO_MODE = 'true';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-trhyg-${process.pid}-${Date.now()}`);

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const trades = require('../../src/services/trades');

// ── Unit: markOfferValidity over an authoritative owner index ──────────────────────────────────────
(() => {
  // 0001 = me; 0002 = the other team. Owner index straight from `assets` shape.
  const idx = trades.ownerIndexFromAssets([
    { id: '0001', playerIds: ['100'], picks: [{ token: 'FP_0001_2027_1' }] },
    { id: '0002', playerIds: ['200'], picks: [] },
  ]);

  // A clean incoming offer: I acquire 200 (theirs) for 100 (mine) — both owners line up → valid.
  const good = { direction: 'incoming', withFranchiseId: '0002', withName: 'Them', acquire: [{ kind: 'player', id: '200', name: 'Their Guy' }], send: [{ kind: 'player', id: '100', name: 'My Guy' }] };
  trades.markOfferValidity(good, idx, '0001');
  assert(!good.invalid, `a clean offer is not flagged, got ${JSON.stringify(good)}`);

  // Sender no longer owns what they offered (200 is not theirs anymore — say I now hold it) → invalid.
  const idx2 = trades.ownerIndexFromAssets([{ id: '0001', playerIds: ['100', '200'], picks: [] }, { id: '0002', playerIds: [], picks: [] }]);
  const stale = { direction: 'incoming', withFranchiseId: '0002', withName: 'Them', acquire: [{ kind: 'player', id: '200', name: 'Their Guy' }], send: [{ kind: 'player', id: '100', name: 'My Guy' }] };
  trades.markOfferValidity(stale, idx2, '0001');
  assert(stale.invalid && /Them no longer own Their Guy/.test(stale.invalidReason), `sender-no-longer-owns is flagged, got ${JSON.stringify(stale)}`);

  // I no longer own what I'd send → invalid on my side.
  const idx3 = trades.ownerIndexFromAssets([{ id: '0002', playerIds: ['100', '200'], picks: [] }]);
  const mine = { direction: 'incoming', withFranchiseId: '0002', withName: 'Them', acquire: [{ kind: 'player', id: '200', name: 'Their Guy' }], send: [{ kind: 'player', id: '100', name: 'My Guy' }] };
  trades.markOfferValidity(mine, idx3, '0001');
  assert(mine.invalid && /You no longer own My Guy/.test(mine.invalidReason), `send-no-longer-mine is flagged, got ${JSON.stringify(mine)}`);

  // No authoritative index (read failed) → never a false "invalid".
  const unknown = { direction: 'incoming', withFranchiseId: '0002', acquire: [{ kind: 'player', id: '999', name: 'X' }], send: [] };
  trades.markOfferValidity(unknown, new Map(), '0001');
  assert(!unknown.invalid, 'no owner index → offer left unflagged (no false positive)');

  console.log('✓ markOfferValidity flags dead offers (either side) and never false-positives without data');
})();

// ── End-to-end: dismiss a lingering offer out of the inbox ─────────────────────────────────────────
(async () => {
  const app = require('../../src/app');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (p, o) => (await fetch(`${base}${p}`, o)).json();
  try {
    const { token } = await j('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'demo' }) });
    const H = { Authorization: `Bearer ${token}` };

    const ov0 = await j('/api/trades', { headers: H });
    const offer = (ov0.offers || [])[0];
    assert(offer && offer.id && offer.leagueId, `an incoming demo offer exists to dismiss, got ${JSON.stringify(ov0.offers)}`);

    const res = await j(`/api/leagues/${offer.leagueId}/trades/${offer.id}/dismiss`, { method: 'POST', headers: H });
    assert(res && res.ok && res.dismissed === String(offer.id), `dismiss echoes the id, got ${JSON.stringify(res)}`);

    const ov1 = await j('/api/trades', { headers: H });
    assert(!(ov1.offers || []).some((o) => o.id === offer.id && o.leagueId === offer.leagueId), 'the dismissed offer is gone from the inbox');
    console.log(`✓ Dismiss removes a lingering offer (${offer.id}) from the inbox without an MFL reject`);
  } finally {
    server.close();
  }
  console.log('\nTRADE OFFER HYGIENE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
