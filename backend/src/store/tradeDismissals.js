'use strict';

// Locally-dismissed incoming trade offers, per session token + league. MFL has no "remove this offer"
// call and won't let you reject a DEAD offer (a player/pick in it was already traded or used) — it just
// lingers in the inbox until it times out. Dismiss takes it out of the user's inbox on OUR side. The set
// is pruned against what MFL still lists, so it can't grow forever and a recycled trade id can't wrongly
// hide a fresh offer. Durable via store/persist.

const persist = require('./persist');

const db = () => persist.ns('tradeDismissals'); // token -> { leagueId -> [tradeId] }

function list(token, leagueId) {
  const d = db();
  return (d[token] && d[token][String(leagueId)]) || [];
}

function add(token, leagueId, id) {
  const d = db();
  if (!d[token]) d[token] = {};
  const key = String(leagueId);
  const cur = d[token][key] || [];
  if (!cur.includes(String(id))) {
    d[token][key] = [...cur, String(id)];
    persist.touch();
  }
  return d[token][key];
}

// Drop dismissed ids MFL no longer lists (the offer timed out / resolved), so the set stays bounded and
// a reused trade id can never silently hide a brand-new offer.
function prune(token, leagueId, liveIds) {
  const d = db();
  const key = String(leagueId);
  if (!d[token] || !d[token][key]) return;
  const live = new Set((liveIds || []).map(String));
  const kept = d[token][key].filter((id) => live.has(id));
  if (kept.length !== d[token][key].length) {
    d[token][key] = kept;
    persist.touch();
  }
}

module.exports = { list, add, prune };
