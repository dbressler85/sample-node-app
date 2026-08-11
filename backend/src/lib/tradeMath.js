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

// The value of an asset under a given lens. Dynasty uses `value`; win-now uses `winNow`
// (FantasyCalc redraft value) when the asset carries one, falling back to dynasty value for a
// player FantasyCalc doesn't cover. Picks/FAAB set their own winNow (picks ~0 — they don't help
// THIS season), so a contender giving picks for a stud reads correctly in the win-now lens.
function lensValue(x, lens) {
  if (lens === 'winNow') return x.winNow != null ? x.winNow : (x.value || 0);
  return x.value || 0;
}

// One lens's read of a deal: the two sums, the net, and a verdict.
function analyzeLens(receive, send, lens) {
  const sum = (a) => round1((a || []).reduce((s, x) => s + lensValue(x, lens), 0));
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

// Value analysis of a deal from one side's perspective. receive/send are asset lists with a numeric
// `value` (and, optionally, `winNow`). The top-level fields are the DYNASTY read (unchanged, so every
// existing caller is untouched); `winNow` is the redraft/this-season read, present only when some
// asset carries a winNow value. Callers pair this with leadingLens() + the team's outlook to decide
// which read leads the verdict.
function analyze(receive, send) {
  const dyn = analyzeLens(receive, send, 'value');
  const hasWinNow = [...(receive || []), ...(send || [])].some((x) => x && x.winNow != null);
  const winNow = hasWinNow ? analyzeLens(receive, send, 'winNow') : null;
  return { ...dyn, winNow };
}

// Which lens should LEAD the verdict for a team with this outlook, and that lens's read. A team
// whose window is NOW (outlook 'win-now') is judged on win-now value — a deal that's dynasty-favorable
// but sheds this-season production should read as a warning, not a win. Everyone else leads on
// dynasty value (the future is what they're optimizing). Falls back to dynasty whenever the win-now
// read is missing, so this is always safe to call.
function leadingLens(analysis, outlook) {
  const winLead = outlook === 'win-now' && analysis && analysis.winNow;
  const lens = winLead ? 'winNow' : 'dynasty';
  const read = lens === 'winNow' ? analysis.winNow : analysis;
  return { lens, verdict: read.verdict, net: read.net, acquireValue: read.acquireValue, sendValue: read.sendValue };
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
      // A "hole" is an EMPTY starting spot — no rostered body left to field. Measure it against total
      // rostered bodies (valued or not), not just startable-valued players: a team that keeps another
      // player at the position (even one FantasyCalc can't value, or a lower-ranked body) isn't left
      // with "no starter". Without a body count, fall back to the startable count (old behavior).
      const bodies = d.bodies != null ? d.bodies : d.startable;
      const recvAtPos = (receive || []).filter((p) => p.position === pos).length;
      const bodiesLeft = bodies - gaveList.length + recvAtPos;
      if (d.startable - gaveStartable + recvStartable < d.slots && bodiesLeft < d.slots) holes.push(pos);
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

// Reconcile the value verdict and the roster-construction rating into ONE bottom line, so a deal
// that's good on VALUE but bad for ROSTER (or vice-versa) doesn't just show two contradicting badges.
// Deterministic over value verdict (favorable/fair/unfavorable) × construction rating
// (good/caution/neutral). `tone` drives the color: good / warn / bad / neutral. Single-sourced here so
// the backend's authoritative offer analysis and the mobile desk's live builder preview read alike.
const BOTTOM_LINE = {
  favorable: {
    good: { tone: 'good', text: 'Green light — you gain value and it fits your roster.' },
    caution: { tone: 'warn', text: 'Value’s in your favor, but it dents your roster — weigh the need first.' },
    neutral: { tone: 'good', text: 'A clean value gain with no roster downside.' },
  },
  fair: {
    good: { tone: 'good', text: 'Even on value and it fills a need — a fair deal worth doing.' },
    caution: { tone: 'warn', text: 'Even on value but it opens a hole — lean pass unless you can backfill.' },
    neutral: { tone: 'neutral', text: 'A fair, roster-neutral swap.' },
  },
  unfavorable: {
    good: { tone: 'warn', text: 'You’d pay a value premium, but it fills a real need — OK if you’re contending.' },
    caution: { tone: 'bad', text: 'Loses value and weakens your roster — pass.' },
    neutral: { tone: 'bad', text: 'You come out light on value with no roster gain — pass.' },
  },
};
function bottomLine(verdict, rating) {
  const byV = BOTTOM_LINE[verdict] || BOTTOM_LINE.fair;
  return byV[rating] || byV.neutral;
}

module.exports = { NET_MIN, RATIO_MIN, TAG_MOD, round1, analyze, analyzeLens, leadingLens, personalAnalyze, constructionRating, BOTTOM_LINE, bottomLine };
