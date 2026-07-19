'use strict';

// A tiny per-key TTL memo that COALESCES concurrent calls. The in-flight promise
// is cached, so N callers asking for the same key while a fetch is outstanding
// share one fetch instead of each firing their own — the common case when a
// single screen fans several endpoints at the same league's roster at once. A
// rejected result is never cached (the entry is dropped) so the next call retries.
function createMemo({ ttlMs, max = 256 } = {}) {
  const map = new Map(); // key -> { at, promise }

  function get(key, produce) {
    const hit = map.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.promise;

    const promise = Promise.resolve().then(produce);
    const entry = { at: Date.now(), promise };
    map.set(key, entry);
    // Don't cache failures: if this produce rejects, drop the entry (unless a
    // newer one has already replaced it) so a transient error isn't sticky.
    promise.catch(() => {
      if (map.get(key) === entry) map.delete(key);
    });
    // Bound memory: prune expired entries when the map grows.
    if (map.size > max) {
      const cutoff = Date.now() - ttlMs;
      for (const [k, v] of map) if (v.at < cutoff) map.delete(k);
    }
    return promise;
  }

  function invalidate(key) {
    map.delete(key);
  }
  function clear() {
    map.clear();
  }

  return { get, invalidate, clear };
}

module.exports = { createMemo };
