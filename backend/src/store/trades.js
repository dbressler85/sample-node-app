'use strict';

// In-memory trade offers per session token + league. Seeded lazily from demo
// fixtures so the app starts with realistic incoming offers, then reflects
// responds (accept/reject remove the offer) and proposals (add an outgoing one).
// Swap for a real store before hosting (like sessions/waivers).

let counter = 5000;
const store = new Map(); // token -> Map(leagueId -> offer[])

function leagueMap(token) {
  if (!store.has(token)) store.set(token, new Map());
  return store.get(token);
}

function ensure(token, leagueId, seed) {
  const m = leagueMap(token);
  if (!m.has(leagueId)) {
    m.set(
      leagueId,
      (seed || []).map((o, i) => ({ id: o.id || `seed-${leagueId}-${i}`, direction: 'incoming', status: 'pending', ...o }))
    );
  }
  return m.get(leagueId);
}

function list(token, leagueId, seed) {
  return ensure(token, leagueId, seed);
}

function add(token, leagueId, seed, offer) {
  const arr = ensure(token, leagueId, seed);
  const withId = { id: `t${counter++}`, status: 'pending', ...offer };
  arr.push(withId);
  return withId;
}

// Mark an offer resolved (accepted/rejected) and return it.
function resolve(token, leagueId, seed, offerId, status) {
  const arr = ensure(token, leagueId, seed);
  const offer = arr.find((o) => String(o.id) === String(offerId));
  if (!offer) return null;
  offer.status = status;
  return offer;
}

module.exports = { list, add, resolve };
