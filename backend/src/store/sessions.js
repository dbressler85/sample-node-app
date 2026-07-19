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

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const mem = new Map(); // token -> { cookie, username, createdAt }

const PERSIST = !!config.sessionSecret;
const key = PERSIST ? crypto.scryptSync(config.sessionSecret, 'dynasty-central/sessions', 32) : null;
const box = () => persist.ns('sessions'); // token -> { iv, tag, ct } (encrypted)

function enc(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function dec(rec) {
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'base64'));
    d.setAuthTag(Buffer.from(rec.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(rec.ct, 'base64')), d.final()]).toString('utf8'));
  } catch (e) {
    return null; // wrong secret / tampered / corrupt — treat as no session
  }
}

// On boot, hydrate memory from any persisted (encrypted) sessions, dropping
// expired or undecryptable ones.
if (PERSIST) {
  const b = box();
  let restored = 0;
  for (const [token, rec] of Object.entries(b)) {
    const s = dec(rec);
    if (s && Date.now() - s.createdAt <= SESSION_TTL_MS) { mem.set(token, s); restored += 1; }
    else delete b[token];
  }
  persist.touch();
  console.log(`[sessions] persistence ON (encrypted at rest); restored ${restored}`);
} else {
  console.log('[sessions] persistence OFF — set SESSION_SECRET to persist sessions across restarts');
}

function create({ cookie, username }) {
  const token = crypto.randomBytes(24).toString('hex');
  const s = { cookie, username, createdAt: Date.now() };
  mem.set(token, s);
  if (PERSIST) { box()[token] = enc(s); persist.touch(); }
  return token;
}

function get(token) {
  const s = mem.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    destroy(token);
    return null;
  }
  return s;
}

function destroy(token) {
  mem.delete(token);
  if (PERSIST && box()[token]) { delete box()[token]; persist.touch(); }
}

module.exports = { create, get, destroy };
