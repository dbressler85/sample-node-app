'use strict';

// metrics.summaryLine() — the compact two-pipe health line logged periodically to the server logs so the
// device-vs-backend read mix, fallback reasons (a 'network' spike = device timeouts), and throttle
// pressure are visible without hitting /_metrics. It must stay SILENT when idle and, once there's traffic,
// report the device share, fallbacks + reasons, and the 429/503 counts.

const test = require('node:test');
const assert = require('node:assert');
const metrics = require('../src/lib/metrics');

test('summaryLine is null when idle (a quiet server logs nothing)', () => {
  metrics._reset();
  assert.equal(metrics.summaryLine(), null);
});

test('summaryLine reports device share, fallbacks + reasons, and throttle counts', () => {
  metrics._reset();
  // 3 reads served on-device, 2 fell back to the backend (one for a network timeout, one rate-limited).
  metrics.recordDeviceRead('rosters', 'device', { ms: 400 });
  metrics.recordDeviceRead('rosters', 'device', { ms: 600 });
  metrics.recordDeviceRead('lineups', 'device', { ms: 500 });
  metrics.recordDeviceRead('rosters', 'backend', { ms: 1200, reason: 'network' });
  metrics.recordDeviceRead('lineups', 'backend', { ms: 1400, reason: 'rate_limited' });
  metrics.record429();
  metrics.record503();
  metrics.record503();

  const line = metrics.summaryLine();
  assert.ok(line, 'a line is produced once there is traffic');
  assert.match(line, /device=3 backend=2 \(60% device\)/, `device share, got: ${line}`);
  assert.match(line, /fallbacks=2/, `fallback count, got: ${line}`);
  assert.match(line, /network:1/, `network fallback reason surfaced (the device-timeout signal), got: ${line}`);
  assert.match(line, /rate_limited:1/, `rate-limited fallback reason surfaced, got: ${line}`);
  assert.match(line, /429=1 503=2/, `throttle counts, got: ${line}`);
  assert.match(line, /device \+\d+% faster|device -\d+% faster|lat dev\/back=/, `latency comparison present, got: ${line}`);
});

test('summaryLine surfaces activity even with no device reads (backend-only load)', () => {
  metrics._reset();
  metrics.recordFetch('rosters'); // an MFL fetch happened (callsLast5Min > 0) though no device beacons
  const line = metrics.summaryLine();
  assert.ok(line, 'backend-only traffic still logs a line');
  assert.match(line, /device=0 backend=0/, `no device beacons yet, got: ${line}`);
});
