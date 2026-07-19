// Thin client for the Dynasty Central backend.
import { API_URL } from './config';

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

async function request(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // Backend unreachable (down, cold-start timeout, wrong URL) → back to login.
    if (onAuthLost) onAuthLost('unreachable');
    throw new Error(`Can't reach the backend at ${API_URL}. Is it running and is the URL correct?`);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* non-JSON */
  }
  if (res.status === 401) {
    // Session expired or the server restarted (in-memory sessions are lost) → login.
    if (onAuthLost) onAuthLost('expired');
    throw new Error((data && data.error) || 'Session expired. Please log in again.');
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  dashboard: () => request('/api/dashboard'),
  leaguesList: () => request('/api/leagues'),
  roster: (leagueId) => request(`/api/leagues/${leagueId}/roster`),

  // Command center (M1.5)
  home: () => request('/api/home'),
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
  playerSearch: (q, { position, status } = {}) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (position) p.set('position', position);
    if (status) p.set('status', status);
    return request(`/api/players/search?${p.toString()}`);
  },
  playerRankings: (type = 'value', position) => {
    const p = new URLSearchParams({ type });
    if (position) p.set('position', position);
    return request(`/api/players/rankings?${p.toString()}`);
  },
  playerProfile: (id) => request(`/api/players/${id}`),
  playerAddPreview: (id) => request(`/api/players/${id}/add/preview`),
  playerAdd: (id, leagues) => request(`/api/players/${id}/add`, { method: 'POST', body: { leagues } }),
  playerDrop: (id, leagues) => request(`/api/players/${id}/drop`, { method: 'POST', body: { leagues } }),

  bestAvailable: () => request('/api/waivers/best-available'),
  waiverPending: () => request('/api/waivers/pending'),
  previewClaim: (leagueId, body) => request(`/api/leagues/${leagueId}/waivers/preview`, { method: 'POST', body }),
  submitClaim: (leagueId, body) => request(`/api/leagues/${leagueId}/waivers`, { method: 'POST', body }),
  cancelClaim: (leagueId, claimId) => request(`/api/leagues/${leagueId}/waivers/${claimId}`, { method: 'DELETE' }),

  // Lineups (M2 / M2.5). mode: 'auto' | 'safe' | 'balanced' | 'aggressive'
  lineups: (mode = 'auto') => request(`/api/lineups?mode=${mode}`),
  lineupDetail: (leagueId, mode = 'auto') => request(`/api/leagues/${leagueId}/lineup?mode=${mode}`),
  // Preview "Set All" as per-league diffs, writing nothing.
  planLineups: (mode = 'auto') => request(`/api/lineups/plan?mode=${mode}`),
  applyLineup: (leagueId, starters, mode = 'auto') =>
    request(`/api/leagues/${leagueId}/lineup`, { method: 'POST', body: { starters: starters || undefined, mode } }),
  // Set all lineups at once. `leagues` optionally narrows to selected leagueIds.
  applyAllLineups: (mode = 'auto', leagues) =>
    request('/api/lineups/apply', { method: 'POST', body: { mode, leagues: leagues || undefined } }),
};
