'use strict';

// Session store mapping an opaque app token -> MFL login state. The mobile app
// never sees the MFL cookie or password; it holds only this token and sends it as
// a Bearer credential. The backend swaps it for the MFL cookie on each request.
//
// The working copy is always in memory (fast, and the historical behavior). Since
// a session holds the live MFL cookie, it is only persisted to disk when an
// operator supplies SESSION_SECRET — and then ENCRYPTED at rest (AES-256-GCM).
// Without the secret, sessions stay in memory and are lost on restart (safe
// default). With it, they survive restarts. Point DATA_DIR at a mounted disk.

const crypto = require('crypto');
const config = require('../config');
const persist = require('./persist');
const secretBox = require('../lib/secretBox');

// Sliding idle timeout: a session stays valid as long as it's used at least once
// every IDLE_TTL_MS. Active users effectively never get logged out; only a truly
// dormant session (or an expired MFL cookie) forces a re-login. Override with
// SESSION_IDLE_TTL_MS.
const IDLE_TTL_MS = Number(process.env.SESSION_IDLE_TTL_MS) || 30 * 24 * 60 * 60 * 1000; // 30d
// Only re-persist the sliding timestamp when it has advanced by this much, so a
// refresh on every request doesn't rewrite the encrypted blob constantly.
const PERSIST_REFRESH_MS = 60 * 60 * 1000; // 1h
const mem = new Map(); // token -> { cookie, username, createdAt, lastSeen }

const PERSIST = !!config.sessionSecret;
// Per-record AES-256-GCM (domain-salted, shared with store/persist.js via lib/secretBox). Sessions are
// self-encrypted per record; persist.js leaves the `sessions` namespace as-is (it's already ciphertext).
const _box = PERSIST ? secretBox(config.sessionSecret, 'dynasty-central/sessions') : null;
const box = () => persist.ns('sessions'); // token -> { iv, tag, ct } (encrypted)
const enc = (obj) => _box.enc(obj);
const dec = (rec) => _box.dec(rec);

// On boot, hydrate memory from any persisted (encrypted) sessions, dropping
// expired or undecryptable ones.
if (PERSIST) {
  const b = box();
  let restored = 0;
  for (const [token, rec] of Object.entries(b)) {
    const s = dec(rec);
    if (s && Date.now() - (s.lastSeen || s.createdAt) <= IDLE_TTL_MS) { mem.set(token, s); restored += 1; }
    else delete b[token];
  }
  persist.touch();
  console.log(`[sessions] persistence ON (encrypted at rest); restored ${restored}`);
} else {
  console.log('[sessions] persistence OFF — set SESSION_SECRET (+ a durable DATA_DIR) to keep users logged in across backend restarts');
}

function create({ cookie, username }) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const s = { cookie, username, createdAt: now, lastSeen: now };
  mem.set(token, s);
  if (PERSIST) { box()[token] = enc(s); persist.touch(); }
  return token;
}

function get(token) {
  const s = mem.get(token);
  if (!s) return null;
  const now = Date.now();
  const last = s.lastSeen || s.createdAt;
  if (now - last > IDLE_TTL_MS) {
    destroy(token);
    return null;
  }
  // Sliding refresh: every use pushes the idle deadline out. Persist only
  // occasionally so we don't rewrite the encrypted record on every request.
  s.lastSeen = now;
  if (PERSIST && now - last > PERSIST_REFRESH_MS) { box()[token] = enc(s); persist.touch(); }
  return s;
}

function destroy(token) {
  mem.delete(token);
  if (PERSIST && box()[token]) { delete box()[token]; persist.touch(); }
}

// A stable per-MFL-account key for a session — the anchor for all PERSONAL data
// (tags, watchlist, trade bait, waiver claims, lineup overrides, pins, push prefs).
// The session token itself is random and re-minted on every login, so keying
// personal data by it silently orphans everything on re-login (and every free-tier
// redeploy forces a re-login). Keying by account survives both. Returns null when
// there's no username (pathological / pre-login), so callers can fall back to token.
function accountKey(session) {
  const u = session && session.username != null ? String(session.username).trim().toLowerCase() : '';
  return u ? `acct:${u}` : null;
}

// Find a live session for an account key, so the push worker (which needs a live
// MFL cookie to poll) can reach whatever session that account currently holds.
// Returns the most-recently-seen match, honoring the same idle expiry as get().
function getByAccount(acct) {
  if (!acct) return null;
  let bestToken = null;
  let bestSeen = -1;
  for (const [token, s] of mem.entries()) {
    if (accountKey(s) !== acct) continue;
    const seen = s.lastSeen || s.createdAt || 0;
    if (seen > bestSeen) { bestSeen = seen; bestToken = token; }
  }
  return bestToken ? get(bestToken) : null;
}

// Every currently-valid session (non-expired), as { cookie, username, lastSeen }. Used by the
// Sunday pre-warm worker, which needs a live MFL cookie per active account to prime that account's
// leagues into the shared cache before kickoff. Does NOT slide the idle timeout (a background warm
// shouldn't keep a dormant session alive) — it reads lastSeen without touching it.
function active() {
  const now = Date.now();
  const out = [];
  for (const s of mem.values()) {
    const last = s.lastSeen || s.createdAt || 0;
    if (now - last <= IDLE_TTL_MS) out.push({ cookie: s.cookie, username: s.username, lastSeen: last });
  }
  return out;
}

module.exports = { create, get, destroy, accountKey, getByAccount, active };
