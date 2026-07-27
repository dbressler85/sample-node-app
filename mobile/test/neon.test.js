'use strict';
// Pure-logic tests for the neon Punctuation register (src/neon.js) — the flicker plan, the event→sign
// map, and the spark specs. Runs under `node --test` (no react-native), same pattern as theme.test.js.
// The RN pieces (NeonSign/NeonSparks/Celebrate) consume this; asserting the plan here means the "how a
// sign turns on" and "reduce-motion is fully-lit-and-steady" contracts can't silently drift.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const neon = require('../src/neon');

test('flickerPlan (clean): false-starts → catches → settles fully lit', () => {
  const p = neon.flickerPlan({ tone: 'clean' });
  assert.equal(p.settled, 1, 'a clean sign settles fully lit');
  assert.ok(p.frames.length >= 6, 'has a multi-step ignition');
  assert.equal(p.frames[0].to, 0, 'starts dark (off)');
  assert.equal(p.frames[p.frames.length - 1].to, 1, 'ends at the steady full hum');
  // A real false-start: at least one early frame flicks bright then drops back near-dark.
  const dips = p.frames.filter((f) => f.to < 0.2).length;
  assert.ok(dips >= 2, 'has genuine false-starts (drops back out before catching)');
});

test('flickerPlan (broken): stutters and never fully catches', () => {
  const p = neon.flickerPlan({ tone: 'broken' });
  assert.ok(p.settled < 1, 'a broken sign settles a touch under full — the deadpan sad tube');
  assert.equal(p.frames[p.frames.length - 1].to, p.settled, 'ends at its (dim) settled value');
  assert.ok(p.frames.length > neon.flickerPlan({ tone: 'clean' }).frames.length, 'stutters more than a clean catch');
});

test('flickerPlan (reduce-motion): no animation, steady and fully lit', () => {
  for (const tone of ['clean', 'broken']) {
    const p = neon.flickerPlan({ tone, reduced: true });
    assert.equal(p.frames.length, 0, 'no flicker frames under reduce-motion');
    assert.equal(p.settled, 1, 'resolves to steady, fully-lit — never stranded/blank');
    assert.equal(neon.planDuration(p), 0, 'a reduce-motion plan takes no time');
  }
});

test('planDuration sums the ignition wall-clock', () => {
  const p = neon.flickerPlan({ tone: 'clean' });
  assert.equal(neon.planDuration(p), p.frames.reduce((s, f) => s + f.dur, 0));
  assert.ok(neon.planDuration(p) > 0);
});

test('every celebration event maps to a sign (§3.7)', () => {
  const events = ['offerSent', 'tradeAccepted', 'claimPlaced', 'matchupWon', 'offerRejected', 'offerWithdrawn', 'claimFailed', 'matchupLost'];
  for (const key of events) {
    const s = neon.signFor(key);
    assert.ok(s, `${key} has a sign`);
    assert.ok(s.sign || s.word, `${key} carries a glyph or a neon word`);
    assert.ok(neon.COLORS[s.color], `${key} uses a known neon color (${s.color})`);
    assert.ok(['clean', 'broken'].includes(s.tone), `${key} has a valid tone`);
    assert.ok(neon.SPARKS[s.spark], `${key} names a known spark mood (${s.spark})`);
  }
  assert.equal(neon.signFor('nope'), null, 'unknown event → no sign');
});

test('sad moments are broken-tone; happy moments are clean', () => {
  assert.equal(neon.signFor('offerRejected').tone, 'broken');
  assert.equal(neon.signFor('claimFailed').tone, 'broken');
  assert.equal(neon.signFor('matchupLost').tone, 'broken');
  assert.equal(neon.signFor('tradeAccepted').tone, 'clean');
  assert.equal(neon.signFor('matchupWon').tone, 'clean');
});

test('a win is the hero spark; sad moments are the sparse cold shower', () => {
  assert.equal(neon.signFor('matchupWon').spark, 'hero');
  const hero = neon.sparkSpec('hero');
  const cold = neon.sparkSpec('cold');
  assert.ok(hero.count > cold.count, 'the hero burst is bigger than the sad shower');
  assert.equal(cold.up, false, 'the sad shower falls, it does not launch');
  assert.deepEqual(neon.sparkSpec('???'), neon.SPARKS.clean, 'unknown mood falls back to clean');
});

test('color() resolves known keys and falls back to accent', () => {
  assert.equal(neon.color('gold').hex, '#F3C14A');
  assert.equal(neon.color('watch').rgb, '214,248,78');
  assert.equal(neon.color('nonsense').hex, neon.COLORS.accent.hex);
});
