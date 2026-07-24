'use strict';
// Player availability resolution. The unstartable-status set is derived from MFL's `injuries` feed;
// a live export confirmed it emits IR / IR-PUP / RETIRED / Holdout / Suspended / Out / Questionable
// (status is a clean value; the body part lives in a separate `details` field). Pins that each
// resolves to the right startable flag — before, IR-PUP/RETIRED/HOLDOUT fell through as startable.
process.env.MFL_DEMO_MODE = 'true';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const availability = require('../../src/lib/availability');

const player = { id: 'p1', team: 'KC' };
const res = (status) => availability.resolve(player, status ? { p1: status } : {}, {}, 1);

(async () => {
  // Statuses from the live injuries feed that make a player UNSTARTABLE.
  for (const s of ['Out', 'IR', 'IR-PUP', 'RETIRED', 'Holdout', 'Suspended', 'PUP', 'NFI']) {
    const a = res(s);
    assert(a.startable === false, `${s} → not startable (got startable=${a.startable})`);
    assert(a.severity === 3, `${s} → severity 3 (got ${a.severity})`);
  }
  console.log('✓ IR / IR-PUP / RETIRED / Holdout / Suspended / Out / PUP / NFI → unstartable');

  // Flagged-but-startable, and healthy.
  assert(res('Questionable').startable === true && res('Questionable').severity === 1, 'Questionable → startable, sev 1');
  assert(res('Doubtful').startable === true && res('Doubtful').severity === 2, 'Doubtful → startable, sev 2');
  assert(res(null).startable === true && res(null).status === 'ACTIVE', 'no injury entry → ACTIVE + startable');
  // An unknown/new status defaults to startable (fail-open) rather than benching a healthy player.
  assert(res('Probable').startable === true, 'an unknown status stays startable (fail-open)');
  console.log('✓ Questionable/Doubtful startable-but-flagged; ACTIVE + unknown startable');

  // Bye week overrides everything.
  const bye = availability.resolve(player, {}, { KC: 1 }, 1);
  assert(bye.startable === false && bye.status === 'BYE', 'bye week → not startable');
  console.log('✓ bye week → unstartable');

  console.log('\nAVAILABILITY HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
