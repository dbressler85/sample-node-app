'use strict';

// Unit tests for the entitlement core (src/entitlement/core.js) — the reverse-trial math + the free/Pro
// gate resolution. core.js is pure + dependency-free (no react-native), so it loads in plain node like
// theme.js. Run: npm test.

const test = require('node:test');
const assert = require('node:assert');
const core = require('../src/entitlement/core');

const NOW = 1_700_000_000_000; // fixed clock
const { DAY_MS } = core;

test('trialStatus: not started → full window, not in trial', () => {
  const s = core.trialStatus(NOW, null);
  assert.equal(s.started, false);
  assert.equal(s.inTrial, false);
  assert.equal(s.daysLeft, core.TRIAL_DAYS);
  assert.equal(s.endsAt, null);
});

test('trialStatus: mid-trial → inTrial with a ceil daysLeft', () => {
  const s = core.trialStatus(NOW, NOW - 2 * DAY_MS); // 2 days in of 7
  assert.equal(s.started, true);
  assert.equal(s.inTrial, true);
  assert.equal(s.daysLeft, 5);
});

test('trialStatus: partial day remaining rounds up', () => {
  const s = core.trialStatus(NOW, NOW - 6.2 * DAY_MS); // ~0.8 day left
  assert.equal(s.inTrial, true);
  assert.equal(s.daysLeft, 1, 'a fraction of a day still reads as 1 day left');
});

test('trialStatus: exactly at the boundary and past it → expired, 0 days', () => {
  assert.equal(core.trialStatus(NOW, NOW - core.TRIAL_DAYS * DAY_MS).inTrial, false);
  const past = core.trialStatus(NOW, NOW - 10 * DAY_MS);
  assert.equal(past.inTrial, false);
  assert.equal(past.daysLeft, 0);
});

test('deriveTier: an active subscription always wins, even past the trial', () => {
  const t = core.deriveTier({ subscribed: true, trialStartedAt: NOW - 30 * DAY_MS, now: NOW });
  assert.equal(t.isPro, true);
  assert.equal(t.reason, 'subscribed');
});

test('deriveTier: in-trial grants Pro', () => {
  const t = core.deriveTier({ subscribed: false, trialStartedAt: NOW - 1 * DAY_MS, now: NOW });
  assert.equal(t.isPro, true);
  assert.equal(t.reason, 'trial');
});

test('deriveTier: lapsed trial → free/expired; never started → free/none', () => {
  const expired = core.deriveTier({ subscribed: false, trialStartedAt: NOW - 8 * DAY_MS, now: NOW });
  assert.equal(expired.isPro, false);
  assert.equal(expired.reason, 'expired');
  const none = core.deriveTier({ subscribed: false, trialStartedAt: null, now: NOW });
  assert.equal(none.isPro, false);
  assert.equal(none.reason, 'none');
});

test('canUse: enforcement OFF allows everything (the dormant default)', () => {
  assert.equal(core.canUse('waivers.file', { isPro: false, enforced: false }), true);
  assert.equal(core.canUse('trades.propose', { isPro: false, enforced: false }), true);
});

test('canUse: enforced — reads + unlisted actions are always free', () => {
  assert.equal(core.canUse('home.view', { isPro: false, enforced: true }), true);
  assert.equal(core.canUse('players.rankings', { isPro: false, enforced: true }), true);
});

test('canUse: enforced — FREE_ACTIONS stay free even without Pro', () => {
  assert.equal(core.canUse('watchlist.toggle', { isPro: false, enforced: true }), true);
  assert.equal(core.canUse('tags.set', { isPro: false, enforced: true }), true);
  assert.equal(core.canUse('notifications.onClock', { isPro: false, enforced: true }), true);
});

test('canUse: enforced — gated actions require Pro', () => {
  for (const action of Object.keys(core.PRO_ACTIONS)) {
    assert.equal(core.canUse(action, { isPro: false, enforced: true }), false, `${action} blocked for free`);
    assert.equal(core.canUse(action, { isPro: true, enforced: true }), true, `${action} allowed for Pro`);
  }
});

test('isGatedAction + actionLabel', () => {
  assert.equal(core.isGatedAction('waivers.file'), true);
  assert.equal(core.isGatedAction('home.view'), false);
  assert.equal(core.actionLabel('waivers.file'), 'Filing waiver claims');
  assert.equal(core.actionLabel('unknown'), 'This');
});
