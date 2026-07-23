'use strict';
// MFL's XML→JSON serialization returns a text node as a bare string only when its element has no
// attributes; add an attribute/child and the SAME text comes back wrapped as {"$t":"…"}. Code that
// String()s the wrapped form gets "[object Object]" and silently mis-parses (this is the class of
// bug behind the PPR "Standard" mislabel and the "OK" write-rejection). mfl.text/mfl.num collapse
// both shapes; this pins them and proves the repo normalizers survive a $t-wrapped payload.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

// 1) text(): plain string, {$t}, number, blank/absent, and a non-$t object (→ '' by design).
assert(mfl.text('FP_0005_2027_1') === 'FP_0005_2027_1', 'plain string passes through');
assert(mfl.text({ $t: 'FP_0005_2027_1' }) === 'FP_0005_2027_1', '{$t} unwrapped');
assert(mfl.text(12) === '12', 'number → string');
assert(mfl.text(null) === '' && mfl.text(undefined) === '', 'null/undefined → ""');
assert(mfl.text({ nope: 1 }) === '', 'non-$t object → "" (leaf-only helper)');

// 2) num(): plain, wrapped, blank → fallback, non-numeric → fallback.
assert(mfl.num('12') === 12 && mfl.num({ $t: '12' }) === 12, 'num parses plain + wrapped');
assert(mfl.num('') === null && mfl.num(undefined) === null, 'blank/absent → null fallback');
assert(mfl.num('N/A', 0) === 0, 'non-numeric → given fallback');
assert(mfl.num({ $t: '3.5' }) === 3.5, 'wrapped decimal');
console.log('✓ text()/num() collapse plain, {$t}, number, and blank forms');

// 3) cleanName(): strip HTML an owner put in a team/league name, decode common entities.
assert(mfl.cleanName("<font color='green'>Kellen</font>") === 'Kellen', 'strips <font> styling');
assert(mfl.cleanName('<b>Team</b> Legend') === 'Team Legend', 'strips <b> and keeps text');
assert(mfl.cleanName('Smith &amp; Sons') === 'Smith & Sons', 'decodes &amp;');
assert(mfl.cleanName('Plain Team') === 'Plain Team', 'plain name unchanged');
assert(mfl.cleanName({ $t: '<i>Rebuild</i>' }) === 'Rebuild', 'unwraps $t then strips');
console.log('✓ cleanName() strips team-name HTML');

const mflRepo = require('../../src/lib/mflRepo');
const league = { leagueId: 'L1', host: 'www49.myfantasyleague.com', franchiseId: '0001' };

// A fully $t-WRAPPED payload for every reader we hardened — mirrors what MFL sends when the
// elements carry attributes. Everything must parse exactly as if the fields were bare strings.
const t = (s) => ({ $t: String(s) });
mfl.exportRequest = async (type) => {
  switch (type) {
    case 'pendingWaivers':
      return { pendingWaivers: { blindBidWaiverRequest: {
        round: t('2'), timestamp: t('1725000000'), addsDrops: t('14080_12_14849,13133_0_0000'),
      } } };
    case 'assets':
      return { assets: { franchise: {
        id: t('0005'),
        players: { player: [{ id: t('14080') }, { id: t('13133') }] },
        blindBiddingDollars: { amount: t('120') },
        futureYearDraftPicks: { draftPick: [{ pick: t('FP_0005_2027_1'), description: t('<b>2027</b> 1st') }] },
      } } };
    case 'playerProfile':
      return { playerProfile: { id: t('14080'), name: t('Smith, Star'), player: {
        dob: t('2001-05-20'), age: t('24'), height: t('73'), weight: t('210'), adp: t('12.4'),
      } } };
    case 'playerRosterStatus':
      return { playerRosterStatuses: { playerStatus: [
        { id: t('14080'), is_fa: t('1'), cant_add: t('0'), locked: t('0') },
        { id: t('13133'), roster_franchise: { franchise_id: t('0003'), status: t('S') } },
      ] } };
    default:
      return {};
  }
};

(async () => {
  const pw = await mflRepo.pendingWaivers(league, 'ck');
  assert(pw.length === 1 && pw[0].round === 2 && pw[0].timestamp === 1725000000, 'pendingWaivers: round/timestamp parsed from $t');
  assert(pw[0].picks[0].add === '14080' && pw[0].picks[0].bid === 12 && pw[0].picks[0].drop === '14849', 'faab pick add/bid/drop parsed');
  assert(pw[0].picks[1].drop === null, '0000 drop → null');
  console.log('✓ pendingWaivers survives a $t-wrapped payload');

  const [fr] = await mflRepo.assets(league, 'ck');
  assert(fr.id === '0005' && fr.faab === 120, 'assets: id + FAAB from $t');
  assert(fr.playerIds.join(',') === '14080,13133', 'assets: player ids from $t');
  assert(fr.picks[0].token === 'FP_0005_2027_1' && fr.picks[0].kind === 'future' && fr.picks[0].year === 2027 && fr.picks[0].round === 1, 'assets: pick token parsed (was breaking on [object Object])');
  assert(fr.picks[0].description === '2027 1st', 'assets: HTML stripped from $t description');
  console.log('✓ assets survives a $t-wrapped payload (pick token no longer "[object Object]")');

  const [prof] = await mflRepo.playerProfiles('ck', '14080');
  assert(prof.id === '14080' && prof.age === 24 && prof.adp === 12.4 && prof.dob === '2001-05-20', 'playerProfile: bio parsed from $t');
  console.log('✓ playerProfile survives a $t-wrapped payload');

  const st = await mflRepo.playerRosterStatus(league, 'ck', ['14080', '13133']);
  assert(st[0].isFreeAgent === true && st[0].franchises.length === 0, 'rosterStatus: FA flag from $t');
  assert(st[1].franchises.length === 1 && st[1].franchises[0].franchiseId === '0003' && st[1].franchises[0].status === 'S', 'rosterStatus: rostered franchise from $t');
  console.log('✓ playerRosterStatus survives a $t-wrapped payload');

  console.log('\nMFL TEXT/$t HARDENING HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
