'use strict';
// PO review, Step 1 — two verified integrity fixes:
//  (1) Personal data is keyed by a STABLE account, not the ephemeral session token,
//      so tags / watchlist / bait / lineups / pins / push survive a re-login (which
//      happens on every free-tier redeploy).
//  (2) The applied-lineup store is week-scoped and timestamped, so a set lineup can't
//      leak across weeks or permanently mask a later change.
process.env.MFL_DEMO_MODE = 'true';

const sessions = require('../../src/store/sessions');
const lineups = require('../../src/store/lineups');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  // --- (1) account key: stable + normalized, independent of the random token ------
  const t1 = sessions.create({ cookie: 'ck1', username: 'Manager_7' });
  const t2 = sessions.create({ cookie: 'ck2', username: 'manager_7' }); // same user re-logs in → new token
  assert(t1 !== t2, 'each login mints a fresh session token');

  const a1 = sessions.accountKey(sessions.get(t1));
  const a2 = sessions.accountKey(sessions.get(t2));
  assert(a1 === 'acct:manager_7', `account key is normalized (lowercased), got ${a1}`);
  assert(a1 === a2, 'the same MFL user resolves to the same account key across logins/tokens');
  assert(sessions.accountKey({ username: 'Someone_Else' }) !== a1, 'different users get different keys');
  assert(sessions.accountKey({}) === null, 'no username yields null (caller falls back to token)');
  console.log('✓ account key is stable per MFL user and independent of the ephemeral token');

  // getByAccount finds a live session so the push worker can still poll MFL
  const found = sessions.getByAccount(a1);
  assert(found && found.cookie, 'getByAccount returns a live session for the account');
  assert(sessions.getByAccount('acct:nobody') === null, 'getByAccount is null when no session matches');
  console.log('✓ getByAccount reaches a live session (push worker keeps working)');

  // personal data keyed by the account is reachable from the re-logged-in token
  lineups.set(a1, 'L9', 3, ['x', 'y']);
  assert(sessions.accountKey(sessions.get(t2)) === a1, 'the re-logged-in token maps to the same personal bucket');
  console.log('✓ personal data survives re-login (fresh token, same user, same bucket)');

  // --- (2) lineup store: week-scoped + stamped -----------------------------------
  const rec = lineups.get(a1, 'L9', 3);
  assert(rec && JSON.stringify(rec.starterIds) === JSON.stringify(['x', 'y']), 'applied lineup is retrievable for its week');
  assert(typeof rec.at === 'number' && rec.at > 0, 'the applied lineup is timestamped for the freshness policy');
  assert(lineups.get(a1, 'L9', 4) === null, 'a week-3 lineup does NOT leak into week 4');
  assert(lineups.get(a1, 'L8', 3) === null, 'lineups are isolated per league');
  console.log('✓ lineup store is week-scoped and stamped — no cross-week or cross-league bleed');

  sessions.destroy(t1); sessions.destroy(t2);
  console.log('\nINTEGRITY RE-KEY HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
