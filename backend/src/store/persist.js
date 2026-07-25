'use strict';

// Durable, dependency-free state for the app stores. One JSON file holds a root
// object of namespaces; stores mutate their namespace and call touch(). Writes
// are debounced and atomic (write-temp + rename). If the filesystem is read-only
// (or any write fails), persistence disables itself and the app keeps running
// from memory — durability is a bonus, never a hard dependency.
//
// Point DATA_DIR at a mounted disk in production to survive restarts. Sessions
// are NOT stored here (they hold live credentials) — see store/sessions.js.

const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = path.join(config.dataDir, 'state.json');
const TMP = `${FILE}.tmp`;
let root = {};
let writable = true;
let timer = null;

// The state root must be a plain object (a map of namespaces). Guard against a file that parses to
// an array/null/scalar — otherwise ns() would set keys on the wrong shape and every store silently
// breaks.
function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function readState(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isPlainObject(parsed)) throw new Error('state root is not a plain object');
  return parsed;
}

// Never silently destroy an unreadable state file. The old code reset to empty and LEFT the corrupt
// file in place — so the next flush overwrote it, erasing any chance of recovery (watchlists, trophies,
// prefs, draft lists all live here). Instead, move it aside so an operator can inspect/restore it.
function backupCorrupt(file, e) {
  try {
    const bak = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, bak);
    console.log(`[persist] ${path.basename(file)} unreadable (${e.message}); preserved as ${path.basename(bak)}, starting empty`);
  } catch (e2) {
    console.log(`[persist] ${path.basename(file)} unreadable (${e.message}); could not preserve it (${e2.message}), starting empty`);
  }
}

function load() {
  // Prefer the committed file. If it's missing or corrupt, fall back to a leftover .tmp — a crash
  // between write-temp and rename can leave a COMPLETE tmp holding the newest state — before giving up
  // to empty. A corrupt source is backed up (not overwritten) so it stays recoverable.
  try {
    if (fs.existsSync(FILE)) {
      root = readState(FILE);
      console.log(`[persist] loaded state from ${FILE}`);
      return;
    }
  } catch (e) {
    backupCorrupt(FILE, e);
  }
  try {
    if (fs.existsSync(TMP)) {
      root = readState(TMP);
      console.log(`[persist] recovered state from leftover ${path.basename(TMP)} (interrupted write)`);
      return;
    }
  } catch (e) {
    backupCorrupt(TMP, e);
  }
  root = {};
}
load();

// Operational signal only: if the serialized state crosses this size, a store is likely accumulating
// unbounded (a seen-set or history that never trims). Latched so it warns on crossing up, not every
// 250ms write. Never truncates — durability wins; this just makes the growth visible in the logs.
const WARN_BYTES = 5 * 1024 * 1024;
let sizeWarned = false;
function checkSize(len) {
  if (len > WARN_BYTES) {
    if (!sizeWarned) {
      console.warn(`[persist] state is ${(len / 1048576).toFixed(1)}MB (> ${WARN_BYTES / 1048576}MB) — a store may be growing unbounded`);
      sizeWarned = true;
    }
  } else {
    sizeWarned = false;
  }
}

// Serialize the root, isolating a serialize failure (e.g. a circular reference introduced by a store
// bug) from the write path: a bad serialize skips THIS write and keeps both the in-memory state and
// durability for every other write, instead of disabling persistence forever. Returns null on failure.
function serialize() {
  try {
    const data = JSON.stringify(root);
    checkSize(data.length);
    return data;
  } catch (e) {
    console.warn(`[persist] could not serialize state (${e.message}); skipping this write, keeping memory + durability`);
    return null;
  }
}

let writing = false; // an async flush is in flight
let dirtyDuringWrite = false; // a touch() landed mid-write → re-flush after

// Async debounced write — OFF the event loop's critical path. `writeFileSync` here stalled the single
// loop for every concurrent request during the write, and it's driven hot (the notifications tick
// touch()es per device). Serialize once, write-temp + rename atomically via fs.promises. Only one
// flush runs at a time; a touch() during a write sets a dirty flag so we re-flush once it finishes.
async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!writable || writing) { if (writing) dirtyDuringWrite = true; return; }
  const data = serialize();
  if (data == null) return; // serialize failed — keep memory + durability, skip just this write
  writing = true;
  try {
    await fs.promises.mkdir(config.dataDir, { recursive: true });
    await fs.promises.writeFile(TMP, data);
    await fs.promises.rename(TMP, FILE); // atomic replace
  } catch (e) {
    writable = false;
    console.log(`[persist] writes disabled (${e.message}); continuing in memory`);
  } finally {
    writing = false;
    if (dirtyDuringWrite) { dirtyDuringWrite = false; scheduleWrite(); }
  }
}

// Synchronous flush — only for process shutdown (an async write wouldn't finish before exit) and the
// test reload helper. Never use on a hot request path.
function flushSync() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!writable) return;
  const data = serialize();
  if (data == null) return; // serialize failed — keep memory, skip just this write
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(TMP, data);
    fs.renameSync(TMP, FILE); // atomic replace
  } catch (e) {
    writable = false;
    console.log(`[persist] writes disabled (${e.message}); continuing in memory`);
  }
}

function scheduleWrite() {
  if (!writable || timer) return;
  timer = setTimeout(() => { flush().catch(() => {}); }, 250);
  if (timer.unref) timer.unref(); // don't keep the process alive for a pending write
}

// The (created-on-demand) sub-object for a namespace. Mutate it, then touch().
function ns(name) {
  if (!root[name]) root[name] = {};
  return root[name];
}

function touch() {
  scheduleWrite();
}

// Test helper: force a synchronous flush, drop the in-memory copy, and reload
// from disk — simulating a process restart.
function _reloadFromDisk() {
  flushSync();
  root = {};
  load();
}

module.exports = { ns, touch, flush, flushSync, _reloadFromDisk, _file: FILE };
