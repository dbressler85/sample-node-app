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
  // `transactions` -> the recent-activity feed (raw rows). `parse` matches mflRepo.transactions'
  // unwrap; parseTransactions splits each row's payload and assembleTransactions resolves the names.
  transactions: {
    type: 'transactions',
    needsAuth: true,
    request({ host, year, league, params = {} }) {
      return { url: buildExportUrl({ host, year, type: 'transactions', league, params }), needsAuth: true };
    },
    parse(res) {
      return toArray(res && res.transactions && res.transactions.transaction);
    },
  },
  // `freeAgents` -> the league unit(s); each nests player[]. The waivers service flattens to ids.
  freeAgents: {
    type: 'freeAgents',
    needsAuth: true,
    request({ host, year, league, params = {} }) {
      return { url: buildExportUrl({ host, year, type: 'freeAgents', league, params }), needsAuth: true };
    },
    parse(res) {
      return toArray(res && res.freeAgents && res.freeAgents.leagueUnit);
    },
  },
  // `assets` -> every franchise's tradable assets (raw); mflRepo.assetsFromRaw normalizes, the picks
  // service shapes. The authoritative source for pick inventory.
  assets: {
    type: 'assets',
    needsAuth: true,
    request({ host, year, league, params = {} }) {
      return { url: buildExportUrl({ host, year, type: 'assets', league, params }), needsAuth: true };
    },
    parse(res) {
      return toArray(res && res.assets && res.assets.franchise);
    },
  },
  // `futureDraftPicks` -> per-franchise future picks (raw); the picks service finds mine + builds tokens.
  futureDraftPicks: {
    type: 'futureDraftPicks',
    needsAuth: true,
    request({ host, year, league, params = {} }) {
      return { url: buildExportUrl({ host, year, type: 'futureDraftPicks', league, params }), needsAuth: true };
    },
    parse(res) {
      return toArray(res && res.futureDraftPicks && res.futureDraftPicks.franchise);
    },
  },
  // `draftResults` -> the draft unit(s) (each nests draftPick[]); the draft service parses order/status.
  draftResults: {
    type: 'draftResults',
    needsAuth: true,
    request({ host, year, league, params = {} }) {
      return { url: buildExportUrl({ host, year, type: 'draftResults', league, params }), needsAuth: true };
    },
    parse(res) {
      return toArray(res && res.draftResults && res.draftResults.draftUnit);
    },
  },
  // `calendar` -> league calendar events (DRAFT_START, waiver/lock windows).
  calendar: {
    type: 'calendar',
    needsAuth: true,
    request({ host, year, league, params = {} }) {
      return { url: buildExportUrl({ host, year, type: 'calendar', league, params }), needsAuth: true };
    },
    parse(res) {
      return toArray(res && res.calendar && res.calendar.event);
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
    // Read `status` OR `roster_status` — MFL emits the reserve marker (IR/TAXI) under either key depending
    // on the export, and the backend's getTeams reads `p.status || p.roster_status` (services/league.js).
    // Taking only `status` mis-tagged an IR/taxi player as active on the device Rosters tab (M-2).
    players: toArray(franchise && franchise.player).map((p) => ({ id: text(p && p.id), status: text(p && p.status) || text(p && p.roster_status) })),
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

// MFL roster status → the screen's scouting slot (drives the IR/TAXI tag; starter folds to active).
// EXACT-token match against the same vocabularies as the backend's rosterStatus.rosterSlot (long forms
// from the rosters export AND the short codes IR/TAXI/TS) — never a substring test, so a status that
// merely contains "TS"/"IR" can't false-positive, and the short taxi code `TS` correctly reads as taxi.
function rosterSlot(status) {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'INJURED_RESERVE' || s === 'IR') return 'ir';
  if (s === 'TAXI_SQUAD' || s === 'TAXI' || s === 'TS') return 'taxi';
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
  // Carry the same top-level fields as the backend getTeams ({ leagueId, name, format, teams }) so the
  // device and fallback payloads are identical — a consumer reading `data.format`/`data.name` can't break
  // only on the device path (M-2). Sourced from the franchise directory the device already fetches.
  return { leagueId: dir.leagueId != null ? String(dir.leagueId) : null, name: dir.name || null, format: dir.format || null, teams };
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
  // Same top-level shape/order as the backend getStandings ({ leagueId, name, playoffSpots, me, standings })
  // so device and fallback are identical (M-2). leagueId/name come from the directory.
  return { leagueId: dir.leagueId != null ? String(dir.leagueId) : null, name: dir.name || null, playoffSpots: spots, me: standings.find((s) => s.mine) || null, standings };
}

// Human labels for MFL transaction types (matches the backend TXN_LABEL).
const TXN_LABEL = {
  TRADE: 'Trade', WAIVER: 'Waiver', BBID_WAIVER: 'Waiver (FAAB)', FREE_AGENT: 'Free agent',
  IR: 'IR move', TAXI: 'Taxi move', AUCTION_WON: 'Auction', AUCTION_INIT: 'Auction',
};
const csvIds = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// Split each raw transaction row's `transaction` payload into structured ids (matches the backend's
// parseLiveTransactions). TRADE payloads are gave|received|withFranchise; everything else is
// added|dropped. Single-sourced here so the device and backend parse transactions identically.
function parseTransactions(rows) {
  return (rows || []).map((t, i) => {
    const type = String((t && t.type) || '').toUpperCase();
    const payload = String((t && t.transaction) || '');
    const base = { id: `${(t && t.timestamp) || 't'}:${i}`, type, at: num(t && t.timestamp), franchiseId: String((t && t.franchise) || '') };
    if (type === 'TRADE') {
      const p = payload.split('|');
      return { ...base, withFranchiseId: p[2] ? fid(p[2]) : null, droppedIds: csvIds(p[0]), addedIds: csvIds(p[1]) };
    }
    const [added, dropped] = payload.split('|');
    return { ...base, addedIds: csvIds(added), droppedIds: csvIds(dropped) };
  });
}

// Assemble the transactions payload (same shape as the backend getTransactions) from device-origin raw
// rows + an ASSET dictionary ({ id: {name, position} } covering players AND draft-pick tokens, served by
// /api/players/lookup) + the franchise directory. Best-effort like the backend: an unresolved asset/
// franchise falls back to its id rather than throwing (transactions is a feed, not a scoreboard) — but
// an entirely empty directory (a failed fetch) throws so the caller falls back instead of showing ids.
function assembleTransactions(rawRows, assetDict, directory, limit = 40) {
  const dir = directory || {};
  const names = dir.franchises || {};
  const dict = assetDict || {};
  const asset = (id) => { const s = String(id); const info = dict[s] || {}; return { id: s, name: info.name || s, position: info.position || null }; };
  const franchise = (id) => (id ? { id: String(id), name: names[String(id)] || `Team ${id}` } : null);
  const parsed = parseTransactions(rawRows);
  if (parsed.length && Object.keys(names).length === 0) {
    throw new Error('device transactions: empty franchise directory — falling back to the backend');
  }
  const transactions = parsed.slice(0, limit).map((t) => ({
    id: t.id,
    type: t.type,
    typeLabel: TXN_LABEL[t.type] || (t.type ? t.type.replace(/_/g, ' ').toLowerCase() : 'Move'),
    at: t.at || null,
    franchise: franchise(t.franchiseId),
    withFranchise: franchise(t.withFranchiseId),
    added: (t.addedIds || []).map(asset),
    dropped: (t.droppedIds || []).map(asset),
  }));
  // Same top-level shape as the backend getTransactions ({ leagueId, name, transactions }) so device and
  // fallback are identical (M-2). leagueId/name come from the directory.
  return { leagueId: dir.leagueId != null ? String(dir.leagueId) : null, name: dir.name || null, transactions };
}

// Full roster-slot bucket for EXPOSURE: starter kept DISTINCT from bench (unlike rosterSlot's scouting
// fold, which lumps starter into active). Mirrors the backend rosterStatus.rosterSlot vocabulary + the
// standing BUCKETS labels ('starter'|'bench'|'ir'|'taxi'), matching EXACT tokens (never a substring) so
// a normal status can't false-positive into a reserve slot.
function exposureBucket(status) {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'INJURED_RESERVE' || s === 'IR') return 'ir';
  if (s === 'TAXI_SQUAD' || s === 'TAXI' || s === 'TS') return 'taxi';
  if (s === 'STARTER') return 'starter';
  return 'bench';
}

// Assemble the cross-league exposure payload (same shape as the backend getExposure) from device-origin
// per-league rosters + a per-player enrichment dictionary. This is the device-origin half of the moat
// feature (docs/DEVICE_ORIGIN_MFL.md): the device fetches MY roster in every league straight from MFL
// (its own IP — the fan-out that trips the shared limiter), and this pure function groups a player across
// those leagues while the GLOBAL enrichment (name/pos/team/age/value/availability + season/proj points,
// tag, watched — served by POST /api/players/exposure-enrich) stays backend-cached.
//   perLeagueRosters: [{ leagueId, name, players:[{ id, status }] }]  (device: reads.rosters FRANCHISE=me → shapeRoster)
//   enrichDict:       { [id]: { name, position, team, age, value, availability, seasonPoints, weekProjection, tag, watched } }
//   totalLeagues:     the account's league count (exposurePct denominator; NOT just the leagues that returned a roster)
// THROWS if there are rostered ids but an empty enrichment dictionary (a failed fetch) so the caller
// falls back to the backend rather than rendering nameless rows.
function assembleExposure(perLeagueRosters, enrichDict, totalLeagues) {
  const dict = enrichDict || {};
  const rosters = perLeagueRosters || [];
  const total = totalLeagues != null ? totalLeagues : rosters.length;
  const map = new Map();
  for (const lg of rosters) {
    for (const p of lg.players || []) {
      const id = text(p && p.id);
      if (!id) continue;
      const bucket = exposureBucket(p && p.status);
      if (!map.has(id)) {
        const info = dict[id] || {};
        map.set(id, {
          id,
          name: info.name || null,
          position: info.position || null,
          team: info.team || null,
          age: info.age != null ? info.age : null,
          value: info.value != null ? info.value : null,
          availability: info.availability || null,
          leagues: [],
          seasonPoints: info.seasonPoints != null ? info.seasonPoints : null,
          weekProjection: info.weekProjection != null ? info.weekProjection : null,
          tag: info.tag || null,
          watched: !!info.watched,
        });
      }
      map.get(id).leagues.push({ leagueId: String(lg.leagueId), name: lg.name, starting: bucket === 'starter', bucket });
    }
  }
  if (map.size && Object.keys(dict).length === 0) {
    throw new Error('device exposure: empty enrichment dictionary — falling back to the backend');
  }
  const players = [...map.values()]
    .map((p) => ({
      ...p,
      count: p.leagues.length,
      startingCount: p.leagues.filter((l) => l.starting).length,
      exposurePct: total ? Math.round((p.leagues.length / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || (b.value || 0) - (a.value || 0));
  return {
    totalLeagues: total,
    players,
    summary: { uniquePlayers: players.length, multiLeague: players.filter((p) => p.count > 1).length },
  };
}

module.exports = { toArray, text, num, fid, round1, isMflHost, buildExportUrl, reads, readWith, shapeRoster, enrichRoster, rosterSlot, assembleTeams, assembleStandings, parseTransactions, assembleTransactions, exposureBucket, assembleExposure };
