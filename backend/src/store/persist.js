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

function flush() {
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
  timer = setTimeout(flush, 250);
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
  flush();
  root = {};
  load();
}

module.exports = { ns, touch, flush, _reloadFromDisk, _file: FILE };
