// @generated DO NOT EDIT — copy of backend/src/lib/mflRead.js.
// Synced by backend/scripts/sync-mfl-read.js (npm run sync:mfl-read in backend/).
// Edit the backend canonical, then re-run the sync; a CI drift test keeps the two identical.

'use strict';

// Shared MFL READ core — the runtime-agnostic half of an MFL read: how to BUILD the request URL and
// how to PARSE the response, with the $t/id primitives both depend on. It is the first slice of the
// device-origin plan (docs/DEVICE_ORIGIN_MFL.md): the backend uses it today (mflRepo adopts the
// parse), and the mobile app will use the SAME code to fetch a read straight from MFL on-device —
// injecting its own transport (fetch) and credential (the user's cookie) around this pure core.
//
// STRICTLY DEPENDENCY-FREE and runtime-agnostic: no `config`, no Node-only APIs, no reliance on the
// WHATWG URL/searchParams (React Native's URL is partial) — the query string is assembled by hand so
// the exact same bytes run under Node and Hermes. CommonJS so the Node backend `require`s it and Metro
// transpiles it for Expo alike (same pattern as tradeMath.js / resourceStore.js).
//
// The mobile copy at mobile/src/mflRead.js is GENERATED from THIS file by scripts/sync-mfl-read.js and
// held identical by a CI drift test (test/live/mfl-read-sync-test.js). Edit the backend canonical,
// then `npm run sync:mfl-read`.
//
// Transport, throttling, the SSRF redirect-following, and the demo/live split stay per-runtime and are
// NOT here — this core only says "what URL" and "what shape".

// --- parse primitives (kept identical to lib/mfl.js; a parity test guards against divergence) ------

// MFL returns a single-child collection as an object and a multi-child one as an array; callers always
// want an array.
function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// Unwrap MFL's {$t:"…"} text wrapper to a plain string. A field comes back bare when its element has no
// attributes and {$t:…}-wrapped the moment it gains one — String()-ing the wrapped form silently yields
// "[object Object]". Collapses both forms (and a number) to a plain string.
function text(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return value.$t != null ? String(value.$t) : '';
  return String(value);
}

// Numeric read of an MFL leaf field, $t-tolerant. Returns `fallback` (default null) when absent/blank/
// non-numeric.
function num(value, fallback = null) {
  const s = text(value).trim();
  if (s === '') return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

// Round to one decimal (points for/against, potential points). Matches the backend's round1.
function round1(v) {
  return Math.round((num(v, 0) || 0) * 10) / 10;
}

// The canonical 4-digit zero-padded franchise id ("0005", never "5"). Unpadded ids 500 the write API
// and miss id-keyed lookups. $t-tolerant; blank/absent → '' so callers keep their own null-guard.
function fid(value) {
  const s = text(value).trim();
  return s ? s.padStart(4, '0') : '';
}

// --- host guard + URL builder (device-facing) ------------------------------------------------------

// SSRF guard: an outbound host ultimately derives from MFL data (a league's `url`), so every request —
// on the backend OR the device — must target an MFL host.
const MFL_HOST_RE = /(^|\.)myfantasyleague\.com$/i;
function isMflHost(host) {
  return MFL_HOST_RE.test(String(host || '').split(':')[0]);
}

// Build an MFL `export` URL: `https://<host>/<year>/export?TYPE=&L=&…&JSON=1`. Hand-assembled (no
// URL/searchParams) so it's byte-identical under Node and React Native. `year` must be a 4-digit season
// (the device passes the current season). The credential is NOT in the URL — the caller sends the
// user's cookie as a header. No APIKEY here (the device authenticates by cookie).
function buildExportUrl({ host, year, type, league = null, params = {} }) {
  if (!isMflHost(host)) throw new Error(`Refusing to build a request to a non-MyFantasyLeague host: ${host}`);
  if (!/^\d{4}$/.test(String(year || ''))) throw new Error(`export URL needs a 4-digit year, got: ${year}`);
  if (!type) throw new Error('export URL needs a TYPE');
  const q = [];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== '') q.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`); };
  add('TYPE', type);
  add('L', league);
  for (const [k, v] of Object.entries(params)) add(k, v);
  add('JSON', '1');
  return `https://${host}/${year}/export?${q.join('&')}`;
}

// --- read descriptors -----------------------------------------------------------------------------
// A descriptor pairs a read's request (how the device builds the URL) with its parse (the envelope
// unwrap the backend already used). Add one per migrated read path.

const reads = {
  // `rosters` -> every franchise's roster ({ id, player: [...] }). Authenticated (a league's rosters
  // require the owner's cookie for a private league). `parse` is exactly mflRepo.rosters' unwrap.
  rosters: {
    type: 'rosters',
    needsAuth: true,
    request({ host, year, league, params = {} }) {
      return { url: buildExportUrl({ host, year, type: 'rosters', league, params }), needsAuth: true };
    },
    parse(res) {
      return toArray(res && res.rosters && res.rosters.franchise);
    },
  },
  // `leagueStandings` -> per-franchise standings rows (returned in rank order). `parse` matches
  // mflRepo.standings' unwrap; assembleStandings maps the columns + adds names/rank/playoff line.
  standings: {
    type: 'leagueStandings',
    needsAuth: true,
    request({ host, year, league, params = {} }) {
      return { url: buildExportUrl({ host, year, type: 'leagueStandings', league, params }), needsAuth: true };
    },
    parse(res) {
      return toArray(res && res.leagueStandings && res.leagueStandings.franchise);
    },
  },
};

// Perform a full read from the device side: build the URL from a descriptor, fetch it with the user's
// cookie + the registered User-Agent via the INJECTED `fetchImpl` (React Native's global fetch on the
// device; a stub in tests), enforce MFL's rules — a 429 THROWS and is NOT retried ("that will make
// things worse") — and parse with the descriptor. Runtime-agnostic: the only per-runtime inputs (the
// fetch implementation and the SecureStore-held cookie) are injected, so this is the exact read the
// backend could run too. Throws on any non-OK status; fail-soft (show cached/degraded) is the caller's
// job, matching the backend's mflRepo behavior. The credential travels as a header, never in the URL.
async function readWith(fetchImpl, { descriptor, host, year, league = null, params = {}, cookie = null, userAgent = 'DynastyCentral/1.0' }) {
  const { url } = descriptor.request({ host, year, league, params });
  const headers = { Accept: 'application/json', 'User-Agent': userAgent };
  if (cookie) headers.Cookie = `MFL_USER_ID=${cookie}`;
  const res = await fetchImpl(url, { headers });
  if (res && res.status === 429) {
    const err = new Error('MFL rate limited (429) — not retrying');
    err.status = 429;
    throw err;
  }
  if (!res || !res.ok) {
    const err = new Error(`MFL read failed (${res ? res.status : 'no response'})`);
    err.status = res ? res.status : 0;
    throw err;
  }
  return descriptor.parse(await res.json());
}

// Shape one raw franchise roster into the normalized form a screen wants — demonstrates the id/text
// primitives on the device side (franchise id padded, player id/status as $t-safe strings). The
// backend's roster service does its own richer shaping; this is the minimal device-side shape.
function shapeRoster(franchise) {
  return {
    franchiseId: fid(franchise && franchise.id),
    players: toArray(franchise && franchise.player).map((p) => ({ id: text(p && p.id), status: text(p && p.status) })),
  };
}

// Join device-origin franchises (from reads.rosters → shapeRoster: [{ franchiseId, players:[{id,status}] }])
// with a player dictionary ({ id: { name, position, team, value } }, served by the backend from its
// GLOBAL cache — POST /api/players/lookup) into the shape a roster screen renders. This is the hybrid
// split (DEVICE_ORIGIN_MFL.md): per-user rosters come from the device (its own IP), the shared
// player/value data stays backend-cached. Pure; players sorted by value desc, totalValue summed.
function enrichRoster(franchises, dict) {
  const d = dict || {};
  return (franchises || []).map((f) => {
    const players = (f.players || [])
      .map((p) => {
        const info = d[p.id] || {};
        return {
          id: p.id,
          status: p.status,
          name: info.name || null,
          position: info.position || null,
          team: info.team || null,
          value: info.value != null ? info.value : null,
        };
      })
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    return {
      franchiseId: f.franchiseId,
      count: players.length,
      totalValue: Math.round(players.reduce((s, p) => s + (p.value || 0), 0)),
      players,
    };
  });
}

// MFL roster status → the screen's slot bucket (drives the IR/TAXI tag). Mirrors the backend's slotOf.
function rosterSlot(status) {
  const s = String(status || '').toUpperCase();
  if (s.includes('INJUR') || s === 'IR') return 'ir';
  if (s.includes('TAXI')) return 'taxi';
  return 'active';
}

// Assemble the FULL league-teams payload a roster screen renders — from device-origin franchises + the
// backend player dictionary + the franchise directory ({ franchises:{id:name}, mine }). Adds each team's
// name and `mine`, the per-player roster slot, and sorts teams by value. THROWS if the result is
// incomplete (any team missing its name, or no players anywhere) so the caller falls back to the backend
// instead of rendering a broken/partial screen — the render path is device-first but never degraded.
// Pure; matches the backend getTeams shape ({ teams:[{ franchiseId, name, mine, count, totalValue,
// players:[{ id, name, position, team, value, slot }] }] }).
function assembleTeams(franchises, playerDict, directory) {
  const dir = directory || {};
  const names = dir.franchises || {};
  const teams = enrichRoster(franchises, playerDict)
    .map((t) => ({
      franchiseId: t.franchiseId,
      name: names[t.franchiseId] || names[String(t.franchiseId)] || null,
      mine: String(t.franchiseId) === String(dir.mine),
      count: t.count,
      totalValue: t.totalValue,
      players: t.players.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, value: p.value, slot: rosterSlot(p.status) })),
    }))
    .sort((a, b) => b.totalValue - a.totalValue);
  if (!teams.length || teams.some((t) => !t.name) || !teams.some((t) => t.players.length)) {
    throw new Error('device league-teams payload incomplete — falling back to the backend');
  }
  return { teams };
}

// Assemble the standings payload (same shape as the backend getStandings) from device-origin
// leagueStandings rows (already in rank order) + the franchise directory ({ franchises:{id:name}, mine,
// playoffSpots }). Maps MFL's column ids (h2hw/pf/pa/strk/…) and flags the playoff line. THROWS if
// incomplete (any row missing its name) so the caller falls back to the backend.
function assembleStandings(rows, directory) {
  const dir = directory || {};
  const names = dir.franchises || {};
  const spots = dir.playoffSpots || null;
  const standings = (rows || []).map((f, i) => {
    const id = String((f && f.id) != null ? f.id : '');
    const w = num(f && f.h2hw) || 0;
    const l = num(f && f.h2hl) || 0;
    const t = num(f && f.h2ht) || 0;
    const numf = (k) => (f && f[k] != null && f[k] !== '' ? parseFloat(f[k]) : null);
    return {
      rank: i + 1,
      franchiseId: id,
      name: names[id] || null,
      mine: id === String(dir.mine),
      wins: w,
      losses: l,
      ties: t,
      record: `${w}-${l}${t > 0 ? `-${t}` : ''}`,
      pointsFor: round1(f && f.pf),
      pointsAgainst: round1(f && f.pa),
      streak: f && f.strk && String(f.strk) !== '-' ? String(f.strk) : null,
      allPlayPct: numf('all_play_pct'),
      winPct: numf('h2hpct'),
      potentialPoints: f && f.pp != null && f.pp !== '' ? round1(f.pp) : null,
      inPlayoffs: spots ? i < spots : null,
    };
  });
  if (!standings.length || standings.some((s) => !s.name)) {
    throw new Error('device standings incomplete — falling back to the backend');
  }
  return { standings, me: standings.find((s) => s.mine) || null, playoffSpots: spots };
}

module.exports = { toArray, text, num, fid, round1, isMflHost, buildExportUrl, reads, readWith, shapeRoster, enrichRoster, rosterSlot, assembleTeams, assembleStandings };
