'use strict';

// Device-first read orchestration, extracted from mflDevice so its fallback / `_source` tag / beacon logic
// is unit-testable off-device (A-12) — mflDevice itself can't be required in a node test because it pulls in
// React-Native-only modules (SecureStore, AsyncStorage). Dependencies are INJECTED: mflDevice wires the real
// ones; a test wires fakes + the real (pure) deviceHealth.
//
//   ready()            → whether to attempt the device path (flag on + creds + not in the offline cooldown)
//   health             → deviceHealth (classifyError / noteResult / shouldBeacon)
//   beacon(name,src,m) → fire the /_metrics beacon (null when device reads are off — no beacon at all)
//   onCookieExpired()  → U-7: refresh creds after an expired-cookie device failure
//   version            → shared-core version stamped on the beacon (A-6)
//   now()              → clock (injectable for deterministic latency in tests)
function createPreferDevice({ ready, health, beacon, onCookieExpired, version, now = () => Date.now() }) {
  return async function preferDevice(readName, deviceFn, backendFn) {
    let payload = null;
    let reason = null;
    let ms = null;
    if (await ready()) {
      const t0 = now();
      try {
        payload = { ...(await deviceFn()), _source: 'device' };
        ms = now() - t0;
      } catch (e) {
        reason = health.classifyError(e); // device attempted → record why we're falling back
        if (reason === 'cookie_expired' && onCookieExpired) onCookieExpired();
      }
    }
    health.noteResult(payload ? null : reason); // a network failure opens the offline cooldown; a success clears it
    if (!payload) {
      const t0 = now();
      payload = { ...(await backendFn()), _source: 'backend' };
      ms = now() - t0;
    }
    // Beacon the served path + latency + reason + shared-core version — but not while we believe the network
    // is down (it would just POST to a dead backend, U-3), and never when device reads are off (beacon null).
    if (beacon && health.shouldBeacon()) beacon(readName, payload._source, { ms, reason, ver: version });
    return payload;
  };
}

module.exports = createPreferDevice;
