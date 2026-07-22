// @generated DO NOT EDIT — copy of backend/src/lib/tradeMath.js.
// Synced by backend/scripts/sync-trade-math.js (npm run sync:trade-math in backend/).
// Edit the backend canonical, then re-run the sync; a CI drift test keeps the two identical.

'use strict';

// Shared trade math — the ONE source of truth for the value verdict and roster-construction
// rating that appear in BOTH the backend's authoritative trade analysis (services/trades.js +
// lib/tradefit.js) and the mobile trade desk's instant local preview (screens/TradesScreen.js).
//
// Before this module the two sides each carried their own copy of `analyze()` and the
// construction heuristic; they had already drifted, so the client's live preview could contradict
// the server's verdict on the same deal. Keeping the math here — pure, dependency-free, taking
// plain { value, position, tag } objects and returning plain data — means a tuning change moves
// both sides together (UX_GUARDRAILS C6: the pure fn stays client-side for the instant preview,
// it's just no longer a fork).
//
// The RATING is single-sourced here; the human REASON string is NOT — each surface writes its own
// wording (the backend is verbose, the mobile chip is terse) from the structured result's
// `branch`. So the wording can differ while the verdict can't.
//
// CommonJS on purpose so the Node backend `require`s it and the Expo app imports it alike (Metro
// transpiles CJS — same pattern as resourceStore.js). The mobile copy at mobile/src/tradeMath.js
// is GENERATED from THIS file by scripts/sync-trade-math.js and held identical by a CI drift test
// (test/live/trade-math-sync-test.js). Edit THIS file, then run: npm run sync:trade-math.

// Value verdict tilts "favorable"/"unfavorable" only when the net is both meaningful in absolute
// terms (> NET_MIN) AND relative to the larger side (> RATIO_MIN).
const NET_MIN = 5;
const RATIO_MIN = 0.12;

// Personal-value lens: your Targets are worth a touch more to you, Avoids a touch less.
const TAG_MOD = { target: 1.1, avoid: 0.9 };

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Value analysis of a deal from one side's perspective. receive/send are asset lists with a
// numeric `value`. Returns the two sums, the net, and a verdict ('favorable'|'fair'|'unfavorable').
function analyze(receive, send) {
  const sum = (a) => round1((a || []).reduce((s, x) => s + (x.value || 0), 0));
  const acquireValue = sum(receive);
  const sendValue = sum(send);
  const net = round1(acquireValue - sendValue);
  const scale = Math.max(acquireValue, sendValue, 1);
  const ratio = net / scale;
  let verdict = 'fair';
  if (net > NET_MIN && ratio > RATIO_MIN) verdict = 'favorable';
  else if (net < -NET_MIN && ratio < -RATIO_MIN) verdict = 'unfavorable';
  return { acquireValue, sendValue, net, verdict };
}

// The same analysis over Target/Avoid-adjusted values. Returns null when nothing in the deal is
// tagged, so a caller shows the "for you" line only when it differs from the market read.
function personalAnalyze(receive, send) {
  const all = [...(receive || []), ...(send || [])];
  if (!all.some((x) => x.tag)) return null;
  const scaled = (arr) => (arr || []).map((x) => ({ ...x, value: (x.value || 0) * (TAG_MOD[x.tag] || 1) }));
  return analyze(scaled(receive), scaled(send));
}

// Roster-construction RATING — does a deal fix a hole or open one? Independent of raw value.
// give/receive are this side's outgoing/incoming players (each with a `position`); needs/surplus
// are that team's league-relative needs/surplus; depth (optional) enables hole detection.
// `subject` is 'you' (default) or 'they'. Returns the structured verdict — rating plus a `branch`
// the caller turns into prose, and the position lists behind it. NO reason string on purpose.
function constructionRating(give, receive, needs, surplus, subject, depth) {
  const you = subject !== 'they';
  const needSet = new Set((needs || []).map((n) => n.pos));
  const surSet = new Set((surplus || []).map((s) => s.pos));
  const giveFromNeed = (give || []).filter((p) => needSet.has(p.position));
  const giveFromSurplus = (give || []).filter((p) => surSet.has(p.position));
  const recvFillsNeed = (receive || []).filter((p) => needSet.has(p.position));
  const recvOntoSurplus = (receive || []).filter((p) => surSet.has(p.position));

  // Holes: a deal that drops a starting spot below the startable-quality players you must field —
  // even when it wasn't a pre-existing "need" (this is what catches "trading your only good RB").
  // Backfilled if you receive a startable player at the same spot.
  const holes = [];
  if (depth) {
    const givenByPos = {};
    for (const p of give || []) if (p && p.position) (givenByPos[p.position] || (givenByPos[p.position] = [])).push(p);
    for (const [pos, gaveList] of Object.entries(givenByPos)) {
      const d = depth[pos];
      if (!d) continue;
      const gaveStartable = gaveList.filter((p) => p.value != null && p.value >= d.threshold).length;
      if (!gaveStartable) continue;
      const recvStartable = (receive || []).filter((p) => p.position === pos && p.value != null && p.value >= d.threshold).length;
      if (d.startable - gaveStartable + recvStartable < d.slots) holes.push(pos);
    }
  }

  const score =
    recvFillsNeed.length * 2 + // getting what they're thin at — strong plus
    giveFromSurplus.length - // dealing from depth — plus
    giveFromNeed.length * 2 - // dealing away a need — strong minus
    recvOntoSurplus.length * 0.5; // piling onto a strength — minor minus

  const fills = [...new Set(recvFillsNeed.map((p) => p.position))];
  const thins = [...new Set(giveFromNeed.map((p) => p.position))];
  const fromDepth = [...new Set(giveFromSurplus.map((p) => p.position))];

  // Branch (single-sourced decision) → rating. Callers switch on `branch` for the wording.
  let branch;
  if (holes.length) branch = 'hole';
  else if (thins.length && !fills.length) branch = 'thin';
  else if (score >= 2) branch = 'fit';
  else if (score <= -1) branch = 'weak';
  else branch = 'neutral';
  const rating = branch === 'fit' ? 'good' : branch === 'neutral' ? 'neutral' : 'caution';

  return { rating, branch, you, score, fills, thins, fromDepth, holes };
}

module.exports = { NET_MIN, RATIO_MIN, TAG_MOD, round1, analyze, personalAnalyze, constructionRating };
