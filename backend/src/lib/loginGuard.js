'use strict';

// In-memory, per-IP failed-login throttle for POST /api/auth/login. That endpoint
// forwards whatever credentials it's given straight to MFL, so without a gate the
// backend is an open credential-stuffing / brute-force proxy against MFL accounts.
// This locks a source IP once it accumulates too many FAILED attempts within a
// window; a successful login clears the IP. Not a WAF — an attacker rotating IPs can
// still get through — but it stops naive stuffing from one source.

const config = require('../config');

const WINDOW_MS = config.loginFailWindowMs;
const MAX_FAILS = config.loginMaxFails;
const fails = new Map(); // ip -> { count, resetAt }

function sweep(now) {
  for (const [ip, r] of fails) if (now >= r.resetAt) fails.delete(ip);
}

// Is this IP currently locked out? { blocked, retryAfter } (retryAfter in seconds).
function check(ip, now = Date.now()) {
  const r = fails.get(ip);
  if (!r || now >= r.resetAt) return { blocked: false };
  if (r.count >= MAX_FAILS) return { blocked: true, retryAfter: Math.max(1, Math.ceil((r.resetAt - now) / 1000)) };
  return { blocked: false };
}

// Record a failed attempt from this IP (opening a fresh window if needed).
function fail(ip, now = Date.now()) {
  if (fails.size > 10000) sweep(now); // bound memory under churn
  let r = fails.get(ip);
  if (!r || now >= r.resetAt) { r = { count: 0, resetAt: now + WINDOW_MS }; fails.set(ip, r); }
  r.count += 1;
}

// A success clears the IP's failure streak.
function succeed(ip) {
  fails.delete(ip);
}

module.exports = { check, fail, succeed, _clear: () => fails.clear() };
