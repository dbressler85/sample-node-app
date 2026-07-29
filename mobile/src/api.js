// Thin client for the Dynasty Central backend.
import { API_URL } from './config';
import { invalidateCaches } from './cache';

let authToken = null;

export function setToken(token) {
  authToken = token;
}

// Called when a request finds the session dead (401) or the backend unreachable,
// so the app can bounce back to the login screen.
let onAuthLost = null;
export function setAuthLostHandler(fn) {
  onAuthLost = fn;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Per-attempt request ceiling. Generous — the heaviest reads (a trade/waiver fan-out across ~15
// leagues on a cold backend) can legitimately take 20-30s — but finite, so a true stall errors out.
const REQUEST_TIMEOUT_MS = 45000;

async function request(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  // A network blip on resume (phone unlock) or a backend cold-start should NOT
  // log you out — your token is still valid. Retry idempotent GETs a couple times
  // with backoff, then surface the error WITHOUT clearing the session.
  const maxNetRetries = method === 'GET' ? 2 : 0;
  let res;
  for (let attempt = 0; ; attempt += 1) {
    // Hard timeout per attempt: a stalled connection (backend hung mid-response, dropped Wi‑Fi that
    // never RSTs) must FAIL, not hang forever — an awaited call that never settles strands the caller
    // (e.g. a trade-response spinner that never clears). Abort turns the stall into a catchable error.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      break;
    } catch (e) {
      if (attempt < maxNetRetries) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      // Unreachable/stalled ≠ logged out. Keep the session; the caller shows an error /
      // the user can pull-to-refresh once the backend/network is back.
      throw new Error(`Can't reach the backend at ${API_URL}. Check your connection and try again.`);
    } finally {
      clearTimeout(timer);
    }
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* non-JSON */
  }
  if (res.status === 401) {
    // A genuine auth rejection (token unknown to the server) → back to login.
    if (onAuthLost) onAuthLost('expired');
    throw new Error((data && data.error) || 'Session expired. Please log in again.');
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  // A successful write changes server state the cached screens reflect — mark their snapshots
  // stale so the next view refetches instead of showing pre-action data through the throttle.
  if (method !== 'GET') invalidateCaches();
  return data;
}

export const api = {
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  health: () => request('/api/health'),
  // Device-origin: fetch THIS session's MFL cookie (+ host/season) so the app can read straight from
  // MFL. Throws (404) when the backend hasn't enabled device reads — callers treat that as "off".
  mflCreds: () => request('/api/session/mfl-cookie'),
  me: () => request('/api/me'),
  leaguesList: () => request('/api/leagues'),
  roster: (leagueId) => request(`/api/leagues/${leagueId}/roster`),
  moveIr: (leagueId, moves) => request(`/api/leagues/${leagueId}/ir`, { method: 'POST', body: moves }),
  moveTaxi: (leagueId, moves) => request(`/api/leagues/${leagueId}/taxi`, { method: 'POST', body: moves }),
  // League hub (M5): standings, every team's roster (scouting), and a transaction feed.
  leagueStandings: (leagueId) => request(`/api/leagues/${leagueId}/standings`),
  leagueTeams: (leagueId) => request(`/api/leagues/${leagueId}/teams`),
  // Device-origin support: the franchise directory (names) and the global player dictionary, used to
  // enrich a rosters read the device fetched straight from MFL.
  franchiseDirectory: (leagueId) => request(`/api/leagues/${leagueId}/franchises`),
  playerLookup: (ids, leagueId) => request('/api/players/lookup', { method: 'POST', body: { ids, leagueId } }),
  // Device-origin exposure: the per-player enrichment (name/pos/team/age/value/availability + season/proj
  // points, tag, watched) for a set of rostered ids, so the device can assemble the cross-league grouping
  // on-device after fetching my roster in every league straight from MFL.
  exposureEnrich: (ids, primaryLeagueId) => request('/api/players/exposure-enrich', { method: 'POST', body: { ids, primaryLeagueId } }),
  // Best-effort beacon: report whether a read was served on-device or fell back, so /_metrics can show
  // the device-origin split. Never throws — measurement must not affect the read.
  reportDeviceRead: (read, source, meta) => request('/api/metrics/device-read', { method: 'POST', body: { read, source, ...(meta || {}) } }).catch(() => {}),
  leagueTransactions: (leagueId) => request(`/api/leagues/${leagueId}/transactions`),
  leaguePlayoffs: (leagueId) => request(`/api/leagues/${leagueId}/playoffs`),
  // Pin a league to the top of every cross-league view. `on` toggles: POST sets, DELETE clears.
  setPin: (leagueId, on) => request(`/api/leagues/${leagueId}/pin`, { method: on ? 'POST' : 'DELETE' }),

  // Command center (M1.5) — the Home screen composes from leaguesList +
  // per-league leagueTriage (progressive load), not a single /api/home call.
  leagueTriage: (leagueId) => request(`/api/home/league/${leagueId}`),
  // Device-origin: the app supplies this league's rosters it fetched from MFL on-device.
  leagueTriageDevice: (leagueId, deviceRosters) => request(`/api/home/league/${leagueId}`, { method: 'POST', body: { deviceRosters } }),
  onDeck: () => request('/api/ondeck'),
  portfolio: () => request('/api/portfolio'),
  // Device-origin portfolio: the same dashboard, but the app supplies the per-league rosters it fetched
  // straight from MFL on-device (the heavy all-franchise fan-out) so the backend only aggregates.
  portfolioDevice: (deviceRosters) => request('/api/portfolio', { method: 'POST', body: { deviceRosters } }),
  // Shop (or un-shop) a holding across every league you roster him in.
  portfolioShop: (playerId, on, leagueIds) => request(`/api/portfolio/holdings/${playerId}/bait`, { method: 'POST', body: { on, leagueIds } }),
  registerPush: (expoPushToken, prefs) => request('/api/push/register', { method: 'POST', body: { expoPushToken, prefs } }),
  unregisterPush: () => request('/api/push/unregister', { method: 'POST' }),
  pushPrefs: () => request('/api/push/prefs'),
  setPushPrefs: (prefs) => request('/api/push/prefs', { method: 'POST', body: { prefs } }),
  // Fire a diagnostic push to this device now; returns Expo's verdict { ok, reason, errors }.
  pushTest: () => request('/api/push/test', { method: 'POST' }),
  scoreboard: () => request('/api/scoreboard'),
  exposure: () => request('/api/players/exposure'),
  news: () => request('/api/news'),

  // Waivers / FAAB / free agents (M3)
  waiverBoard: (leagueId, { position, sort } = {}) => {
    const q = new URLSearchParams();
    if (position) q.set('position', position);
    if (sort) q.set('sort', sort);
    const qs = q.toString();
    return request(`/api/leagues/${leagueId}/waivers${qs ? `?${qs}` : ''}`);
  },
  // Player hub (M4)
  playerSearch: (q, { position, status, format, tep } = {}) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (position) p.set('position', position);
    if (status) p.set('status', status);
    if (format) p.set('format', format);
    if (tep) p.set('tep', '1');
    return request(`/api/players/search?${p.toString()}`);
  },
  // `tep` (bool) is the independent TE-premium lens — orthogonal to the 1QB/2QB `format`.
  playerRankings: (type = 'value', position, format, offset, tep) => {
    const p = new URLSearchParams({ type });
    if (position) p.set('position', position);
    if (format) p.set('format', format);
    if (tep) p.set('tep', '1');
    if (offset) p.set('offset', String(offset));
    return request(`/api/players/rankings?${p.toString()}`);
  },
  playerProfile: (id) => request(`/api/players/${id}`),
  comparePlayers: (ids) => request(`/api/players/compare?ids=${ids.map(encodeURIComponent).join(',')}`),
  playerAddPreview: (id) => request(`/api/players/${id}/add/preview`),
  playerAdd: (id, leagues) => request(`/api/players/${id}/add`, { method: 'POST', body: { leagues } }),
  playerTradePreview: (id, leagueIds) => request(`/api/players/${id}/trade/preview${leagueIds && leagueIds.length ? `?leagues=${leagueIds.map(encodeURIComponent).join(',')}` : ''}`),
  playerTrade: (id, leagues) => request(`/api/players/${id}/trade`, { method: 'POST', body: { leagues } }),
  playerDrop: (id, leagues) => request(`/api/players/${id}/drop`, { method: 'POST', body: { leagues } }),

  // Trophy case — championships won across leagues/seasons.
  trophies: () => request('/api/trophies'),
  addTrophy: (body) => request('/api/trophies', { method: 'POST', body }),
  removeTrophy: (id) => request(`/api/trophies/${id}`, { method: 'DELETE' }),
  // Scan MFL playoff history across your leagues and add every championship found (source auto).
  detectTrophies: () => request('/api/trophies/detect', { method: 'POST', body: {} }),

  // Cross-league watchlist. `format` ('1qb'|'sf') + `tep` (bool) re-price the list through the value lens.
  watchlist: (format, tep) => {
    const p = new URLSearchParams();
    if (format) p.set('format', format);
    if (tep) p.set('tep', '1');
    const qs = p.toString();
    return request(`/api/watchlist${qs ? `?${qs}` : ''}`);
  },
  watchlistAlerts: () => request('/api/watchlist/alerts'),
  // Target / Avoid personal tags (±10% personal-value overlay). tag: 'target'|'avoid'|null.
  tags: () => request('/api/tags'),
  setTag: (id, tag) => request(`/api/players/${id}/tag`, { method: 'POST', body: { tag } }),
  watchAdd: (id) => request(`/api/watchlist/${id}`, { method: 'POST' }),
  watchRemove: (id) => request(`/api/watchlist/${id}`, { method: 'DELETE' }),

  // Drafts (M6)
  drafts: () => request('/api/drafts'),
  // Device-origin drafts: the same overview, but the app supplies the per-league draftResults+calendar
  // reads it fetched straight from MFL on-device so the fan-out leaves the shared backend IP.
  draftsDevice: (deviceReads) => request('/api/drafts', { method: 'POST', body: { deviceReads } }),
  pickInventory: () => request('/api/picks'),
  // Device-origin: the app supplies each league's assets/futureDraftPicks/draftResults it fetched on-device.
  pickInventoryDevice: (deviceReads) => request('/api/picks', { method: 'POST', body: { deviceReads } }),
  leagueDraft: (leagueId, position) =>
    request(`/api/leagues/${leagueId}/draft${position ? `?position=${position}` : ''}`),
  draftList: (leagueId, position) =>
    request(`/api/leagues/${leagueId}/draftlist${position ? `?position=${position}` : ''}`),
  saveDraftList: (leagueId, players) =>
    request(`/api/leagues/${leagueId}/draftlist`, { method: 'POST', body: { players } }),
  makeDraftPick: (leagueId, playerId, comments) =>
    request(`/api/leagues/${leagueId}/draft/pick`, { method: 'POST', body: { playerId, comments } }),

  // Trades (M5)
  trades: () => request('/api/trades'),
  leagueTrades: (leagueId) => request(`/api/leagues/${leagueId}/trades`),
  tradeFit: (leagueId) => request(`/api/leagues/${leagueId}/trades/fit`),
  suggestTrade: (leagueId, targetId, partnerId) => request(`/api/leagues/${leagueId}/trades/suggest?target=${targetId}&partner=${partnerId}`),
  // Counter-ask: given what you'd send (array of player/pick ids) to a partner, what to ask for.
  askTrade: (leagueId, sendIds, partnerId) =>
    request(`/api/leagues/${leagueId}/trades/ask?send=${encodeURIComponent((sendIds || []).join(','))}&partner=${partnerId}`),
  // Full deal from zero with a partner — both sides proposed at once.
  fullDeal: (leagueId, partnerId) => request(`/api/leagues/${leagueId}/trades/deal?partner=${partnerId}`),
  // Pick Capital shop/acquire: ranked trade partners for a pick-oriented deal (intent 'shop'|'acquire'),
  // each with a pre-built suggested deal.
  pickPartners: (leagueId, intent) => request(`/api/leagues/${leagueId}/trades/pick-partners?intent=${intent}`),
  // Manual per-league trade deadline (MFL exposes none). Pass 'YYYY-MM-DD' or null to clear.
  setTradeDeadline: (leagueId, deadline) => request(`/api/leagues/${leagueId}/trade-deadline`, { method: 'POST', body: { deadline } }),
  counterTrade: (leagueId, offerId) => request(`/api/leagues/${leagueId}/trades/counter?offer=${offerId}`),
  proposeTrade: (leagueId, body) => request(`/api/leagues/${leagueId}/trades`, { method: 'POST', body }),
  // action: 'accept' | 'reject' | 'revoke' (withdraw your own outgoing offer). `comments` is an
  // optional note MFL delivers to the originator on a reject.
  respondTrade: (leagueId, tradeId, action, comments) =>
    request(`/api/leagues/${leagueId}/trades/${tradeId}/respond`, { method: 'POST', body: { action, comments: comments || undefined } }),

  // Trade bait ("on the block") — centralized across leagues.
  tradeBait: () => request('/api/tradebait'),
  tradeMarket: () => request('/api/tradebait/market'),
  // Stepped market load: the light league list, then one league's rival blocks on expand.
  tradeMarketLeagues: () => request('/api/tradebait/market/leagues'),
  tradeMarketLeague: (leagueId) => request(`/api/tradebait/market/${leagueId}`),
  // Block editor: light per-league list (current checked tokens + note); the roster checklist per
  // league comes from api.roster(). Save the whole league's block (players + picks) in one shot.
  blockEditor: () => request('/api/tradebait/editor'),
  saveBlock: (leagueId, tokens, note) => request(`/api/leagues/${leagueId}/tradebait`, { method: 'POST', body: { tokens, note } }),
  leagueBait: (leagueId) => request(`/api/leagues/${leagueId}/tradebait`),
  // Leagues where I roster this player (format + outlook + already-on-block), for the "shop him" wizard.
  tradebaitForPlayer: (playerId) => request(`/api/tradebait/for-player/${playerId}`),
  addBait: (leagueId, playerId, note) => request(`/api/leagues/${leagueId}/tradebait/${playerId}`, { method: 'POST', body: { note } }),
  removeBait: (leagueId, playerId) => request(`/api/leagues/${leagueId}/tradebait/${playerId}`, { method: 'DELETE' }),

  waiversOverview: () => request('/api/waivers/overview'),
  waiverSuggestions: () => request('/api/waivers/suggestions'),
  // ONE league's wizard suggestion — the wizard loads these lazily (current + prefetch next).
  waiverSuggestion: (leagueId, seedAddId) => request(`/api/leagues/${leagueId}/waivers/suggestion${seedAddId ? `?seedAddId=${encodeURIComponent(seedAddId)}` : ''}`),
  // `format` ('1qb'|'sf') re-prices the board through that value lens (matches the Players toggle).
  // NOTE (A-10): the free-agent POOL is fetched here on the BACKEND, not on-device — it's the one heavy
  // read (thousands/league) and is league-shareable, so the backend's cross-user cache serves it more
  // cheaply than every device re-downloading it on cellular. (The backend still exposes POST variants of
  // these two that accept device-supplied pools; the app no longer uses them.)
  bestAvailable: (format, tep) => {
    const p = new URLSearchParams();
    if (format) p.set('format', format);
    if (tep) p.set('tep', '1');
    const qs = p.toString();
    return request(`/api/waivers/best-available${qs ? `?${qs}` : ''}`);
  },
  waiverPending: () => request('/api/waivers/pending'),
  previewClaim: (leagueId, body) => request(`/api/leagues/${leagueId}/waivers/preview`, { method: 'POST', body }),
  submitClaim: (leagueId, body) => request(`/api/leagues/${leagueId}/waivers`, { method: 'POST', body }),
  previewMultiClaim: (leagueId, claims) => request(`/api/leagues/${leagueId}/waivers/multi/preview`, { method: 'POST', body: { claims } }),
  submitMultiClaim: (leagueId, claims) => request(`/api/leagues/${leagueId}/waivers/multi`, { method: 'POST', body: { claims } }),
  cancelClaim: (leagueId, claimId) => request(`/api/leagues/${leagueId}/waivers/${claimId}`, { method: 'DELETE' }),
  reorderClaims: (leagueId, order) => request(`/api/leagues/${leagueId}/waivers/reorder`, { method: 'POST', body: { order } }),

  // Lineups (M2 / M2.5). mode: 'auto' | 'safe' | 'balanced' | 'aggressive'
  lineups: (mode = 'auto') => request(`/api/lineups?mode=${mode}`),
  // Device-origin: the app supplies each league's rosters it fetched on-device (the per-user fan-out);
  // the optimizer + projections stay backend.
  lineupsDevice: (mode, deviceReads) => request('/api/lineups', { method: 'POST', body: { mode, deviceReads } }),
  lineupDetail: (leagueId, mode = 'auto') => request(`/api/leagues/${leagueId}/lineup?mode=${mode}`),
  // Preview "Set All" as per-league diffs, writing nothing.
  planLineups: (mode = 'auto') => request(`/api/lineups/plan?mode=${mode}`),
  applyLineup: (leagueId, starters, mode = 'auto') =>
    request(`/api/leagues/${leagueId}/lineup`, { method: 'POST', body: { starters: starters || undefined, mode } }),
  // Set all lineups at once. `leagues` optionally narrows to selected leagueIds.
  applyAllLineups: (mode = 'auto', leagues) =>
    request('/api/lineups/apply', { method: 'POST', body: { mode, leagues: leagues || undefined } }),
};

// Map a raw thrown error message to human copy for user-facing surfaces — hides dev/system strings
// ("Network request failed", "Failed to fetch", aborts/timeouts) behind a plain, actionable line,
// while letting meaningful server messages (e.g. "Invalid username or password") pass through.
export function friendlyError(msg) {
  const m = String(msg || '');
  if (!m || /network request failed|failed to fetch|timeout|timed out|aborted|abort|econn|enotfound|fetch failed|reach the backend/i.test(m)) {
    return 'Couldn’t reach the server — check your connection and try again.';
  }
  return m;
}
