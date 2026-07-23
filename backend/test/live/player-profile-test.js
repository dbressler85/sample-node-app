'use strict';
// mflRepo.playerProfiles — bio (DOB, age, height/weight, ADP) from MFL's GLOBAL playerProfile.
// Pinned to a real sample; also confirms the request is global (no host/L → the api host).
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const mflRepo = require('../../src/lib/mflRepo');

let sent = null;
mfl.exportRequest = async (type, opts = {}) => {
  if (type !== 'playerProfile') return {};
  sent = opts;
  // Real sample shape (single player → object, not array).
  return { playerProfile: { id: '13130', name: 'McCaffrey, Christian SFO RB', player: { adp: 'N/A', height: `5' 11"`, weight: '210lbs', id: '13130', dob: 'Jun 7, 1996', age: '30' } } };
};

(async () => {
  const [bio] = await mflRepo.playerProfiles('ck', '13130');
  // Global request: no host / no L passed (exportRequest defaults to the api host).
  assert(sent && sent.P === '13130' && sent.host === undefined && sent.L === undefined, `global request, P only, got ${JSON.stringify({ P: sent.P, host: sent.host, L: sent.L })}`);
  assert(bio.id === '13130' && bio.name === 'McCaffrey, Christian SFO RB', 'id + name parsed');
  assert(bio.dob === 'Jun 7, 1996' && bio.age === 30, `dob + numeric age, got ${bio.dob} / ${bio.age}`);
  assert(bio.height === `5' 11"` && bio.weight === '210lbs', 'height + weight parsed');
  assert(bio.adp === null, `ADP "N/A" → null, got ${bio.adp}`);
  console.log('✓ playerProfiles: bio parsed; global (api-host) request; N/A ADP → null');

  // A real ADP value parses to a number.
  mfl.exportRequest = async () => ({ playerProfile: { id: '1', player: { adp: '12.4', id: '1' } } });
  const [b2] = await mflRepo.playerProfiles('ck', '1');
  assert(b2.adp === 12.4, `numeric ADP parsed, got ${b2.adp}`);
  console.log('✓ playerProfiles: numeric ADP parsed');

  console.log('\nPLAYER PROFILE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
