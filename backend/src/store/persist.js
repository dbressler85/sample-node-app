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
let root = {};
let writable = true;
let timer = null;

function load() {
  try {
    if (fs.existsSync(FILE)) {
      root = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
      console.log(`[persist] loaded state from ${FILE}`);
    }
  } catch (e) {
    console.log(`[persist] load failed (${e.message}); starting empty`);
    root = {};
  }
}
load();

let writing = false; // an async flush is in flight
let dirtyDuringWrite = false; // a touch() landed mid-write → re-flush after

// Async debounced write — OFF the event loop's critical path. `writeFileSync` here stalled the single
// loop for every concurrent request during the write, and it's driven hot (the notifications tick
// touch()es per device). Serialize once, write-temp + rename atomically via fs.promises. Only one
// flush runs at a time; a touch() during a write sets a dirty flag so we re-flush once it finishes.
async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!writable || writing) { if (writing) dirtyDuringWrite = true; return; }
  writing = true;
  try {
    await fs.promises.mkdir(config.dataDir, { recursive: true });
    const tmp = `${FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(root));
    await fs.promises.rename(tmp, FILE); // atomic replace
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
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(root));
    fs.renameSync(tmp, FILE); // atomic replace
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
