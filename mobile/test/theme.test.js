'use strict';

// Guards the design-system token module (src/theme.js) so the scales + glow recipe don't drift.
// theme.js is deliberately dependency-free (no react-native import), so it loads in plain node. Run: npm test.

const test = require('node:test');
const assert = require('node:assert');
const theme = require('../src/theme');

test('color law: value gold, neon accents, and the onAccent contrast fix are all present', () => {
  const c = theme.colors;
  assert.equal(c.gold, '#F3C14A', 'championship gold (value) is fixed');
  assert.equal(c.watch, '#E4F24A', 'watch is Acid Yellow (ratified), pushed green-ward so it never collides with value gold');
  assert.equal(c.onAccent, '#08101E', 'dark ink for labels on accent/gold fills (white fails AA)');
  assert.ok(c.scrim && c.watch !== c.gold, 'scrim exists; watch is not the value gold');
});

test('scales are present and monotonically increasing', () => {
  const asc = (o, keys) => keys.every((k, i) => i === 0 || o[keys[i - 1]] < o[k]);
  assert.ok(asc(theme.space, ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'xxxl']), 'space ascends');
  assert.ok(asc(theme.size, ['micro', 'caption', 'bodySm', 'body', 'bodyLg', 'title', 'display', 'hero', 'mega']), 'size ascends');
  assert.ok(theme.radius.sm < theme.radius.md && theme.radius.md < theme.radius.lg && theme.radius.pill >= 999, 'radius ordered');
  assert.equal(theme.size.micro, 11, 'type floor is 11');
  assert.ok(theme.motion.fast < theme.motion.base && theme.motion.base < theme.motion.slow, 'motion durations ordered');
});

test('glow() builds the neon recipe: lit edge + interior wash + colored halo', () => {
  const g = theme.glow(theme.rgb.watch);
  assert.equal(g.borderColor, 'rgba(228,242,74,0.55)', 'edge at 0.55');
  assert.equal(g.backgroundColor, 'rgba(228,242,74,0.12)', 'wash at 0.12');
  assert.equal(g.shadowColor, 'rgb(228,242,74)', 'halo tinted to the accent');
  assert.equal(g.shadowOffset.width, 0, 'halo is centered (a glow, not a drop shadow)');
  assert.ok(!('elevation' in g), 'no Android elevation — a tinted glow, never a grey box');
});

test('glow() alphas are tunable', () => {
  const g = theme.glow('255,100,112', { edge: 0.7, wash: 0.2, halo: 0.5, radius: 20 });
  assert.equal(g.borderColor, 'rgba(255,100,112,0.7)');
  assert.equal(g.backgroundColor, 'rgba(255,100,112,0.2)');
  assert.equal(g.shadowOpacity, 0.5);
  assert.equal(g.shadowRadius, 20);
});
