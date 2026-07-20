'use strict';

// Per-owner league preferences: PIN the leagues you care about (they sort to the top of
// every cross-league view) and MUTE the ones you don't (finished/bye teams drop out of
// Home triage, On Deck, and exposure). Pin and mute are opposite intents, so setting one
// clears the other. Durable via store/persist.

const persist = require('./persist');

const db = () => persist.ns('leaguePrefs'); // token -> { pinned: [leagueId], muted: [leagueId] }

function get(token) {
  const e = db()[token] || {};
  return { pinned: (e.pinned || []).map(String), muted: (e.muted || []).map(String) };
}

function ensure(token) {
  const d = db();
  if (!d[token]) d[token] = { pinned: [], muted: [] };
  if (!d[token].pinned) d[token].pinned = [];
  if (!d[token].muted) d[token].muted = [];
  return d[token];
}

function toggle(list, id, on) {
  const i = list.indexOf(id);
  if (on && i < 0) list.push(id);
  else if (!on && i >= 0) list.splice(i, 1);
}

function setPin(token, leagueId, on) {
  const e = ensure(token);
  const id = String(leagueId);
  toggle(e.pinned, id, on);
  if (on) toggle(e.muted, id, false); // pinning un-mutes
  persist.touch();
  return true;
}

function setMute(token, leagueId, on) {
  const e = ensure(token);
  const id = String(leagueId);
  toggle(e.muted, id, on);
  if (on) toggle(e.pinned, id, false); // muting un-pins
  persist.touch();
  return true;
}

module.exports = { get, setPin, setMute };
