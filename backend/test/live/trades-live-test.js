'use strict';
// Stubbed LIVE-mode harness for trades: pendingTrades -> analyzed offers,
// rosters -> partners, and respond/propose -> MFL import calls.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'Mine WR', position: 'WR', team: 'AAA' },
  { id: '2', name: 'Mine RB', position: 'RB', team: 'BBB' },
  { id: '20', name: 'Rival WR', position: 'WR', team: 'CCC' },
  { id: '30', name: 'Other RB', position: 'RB', team: 'DDD' },
];

const imported = [];
mfl.importRequest = async (type, params) => { imported.push({ type, params }); return { status: 'ok' }; };

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Dynasty', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: { starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] }, franchises: { franchise: [{ id: '0001', name: 'My Team' }, { id: '0002', name: 'Rival Squad' }, { id: '0003', name: 'Third Team' }] } } };
    case 'rosters': {
      const all = { '0001': ['1', '2'], '0002': ['20'], '0003': ['30'] };
      const ids = opts.FRANCHISE ? { [opts.FRANCHISE]: all[opts.FRANCHISE] || [] } : all;
      return { rosters: { franchise: Object.entries(ids).map(([id, list]) => ({ id, player: list.map((pid) => ({ id: pid, status: 'starter' })) })) } };
    }
    case 'pendingTrades':
      // MFL returns EVERY pending trade involving my franchise, both directions:
      //  • INCOMING — 0002 gives up player 20 + $15 FAAB for my player 1 (I'm `offeredto`).
      //  • OUTGOING — I (0001) offered my player 1 to 0003 for their player 30 (I'm `offeringteam`).
      return { pendingTrades: { pendingTrade: [
        { trade_id: 'TR9', offeringteam: '0002', offeredto: '0001', willGiveUp: '20,BB_15', willReceiveInReturn: '1' },
        { trade_id: 'TR10', offeringteam: '0001', offeredto: '0003', willGiveUp: '1', willReceiveInReturn: '30' },
      ] } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'nflSchedule':
      return { nflSchedule: { matchup: ['AAA', 'BBB', 'CCC', 'DDD'].map((t) => ({ team: [{ id: t }] })) } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [{ year: '2027', round: '1', originalPickForFranchise: '0003' }] } } };
    default:
      return {};
  }
};

// Enrichment (FantasyCalc): Rival WR valuable (9000 -> 100), Mine WR mid (4500 -> 50).
const FC = [
  { player: { mflId: '20', sleeperId: 's20', maybeAge: 24 }, value: 9000, overallRank: 1 },
  { player: { mflId: '1', sleeperId: 's1', maybeAge: 27 }, value: 4500, overallRank: 25 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const trades = require('../../src/services/trades');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TK = 'tk';

  // Overview: the incoming offer, resolved + value-analyzed.
  const ov = await trades.getOverview(CK, TK);
  console.log('overview:', JSON.stringify(ov.offers.map((o) => ({ id: o.id, get: o.acquire.map((a) => a.name), give: o.send.map((a) => a.name), an: o.analysis }))));
  assert(ov.offers.length === 1, 'one incoming offer');
  const o = ov.offers[0];
  assert(o.acquire[0].name === 'Rival WR' && o.send[0].name === 'Mine WR', 'offer sides resolved');
  assert(o.acquire[0].value === 100 && o.send[0].value === 50, 'enrichment values on assets');
  assert(o.analysis.verdict === 'favorable', `favorable (100 vs 50), got ${o.analysis.verdict}`);
  assert(o.withName === 'Rival Squad', 'offering team name resolved');
  // FAAB (BB_15) parses as a first-class 'faab' asset — not a bogus "Player BB_15" — with the
  // dollar amount and a light value, and it's on the correct (acquire) side.
  const faab = o.acquire.find((a) => a.kind === 'faab');
  assert(faab && faab.amount === 15 && /\$15/.test(faab.name), `FAAB asset parsed ($15), got ${JSON.stringify(faab)}`);
  assert(!o.acquire.concat(o.send).some((a) => a.name === 'Player BB_15'), 'FAAB is never rendered as a bogus player');
  assert(o.canRespond === true, 'incoming offer with a trade id is respondable');
  console.log('✓ live FAAB: BB_15 → $15 FAAB asset on the acquire side (value ' + faab.value + ')');
  // The hub lists every league so you can START a trade in any of them, not just
  // respond to offers sitting in the inbox.
  assert(Array.isArray(ov.leagues) && ov.leagues.length === 1, 'overview carries the league list for proposing');
  assert(ov.leagues[0].leagueId === '1000' && ov.leagues[0].name === 'Dynasty', 'league entry has id + name');
  console.log('✓ live overview: offer analyzed (get 100 vs give 50 -> favorable) + league list for proposing');

  // League detail: partners from live rosters + my players.
  const lg = await trades.getLeague(CK, TK, '1000');
  assert(lg.partners.length === 2, `two partners (0002,0003), got ${lg.partners.length}`);
  assert(lg.partners.find((p) => p.name === 'Rival Squad').players[0].name === 'Rival WR', 'partner roster resolved');
  assert(lg.myPlayers.some((p) => p.name === 'Mine WR'), 'my tradeable players listed');
  const pick = lg.myPicks.find((p) => p.name === '2027 1st');
  assert(pick && pick.id === 'FP_0003_2027_1', `pick carries real MFL token, got ${pick && pick.id}`);
  console.log(`✓ live league: ${lg.partners.length} partners, ${lg.myPlayers.length} my players, pick token ${pick.id}`);

  // The desk shows BOTH directions — including offers I SENT, so I can see/withdraw them.
  const inOffer = lg.offers.find((of) => of.direction === 'incoming');
  const sentOffer = lg.offers.find((of) => of.direction === 'outgoing');
  assert(inOffer && inOffer.id === 'TR9' && inOffer.canRespond === true && inOffer.canRevoke === false, `incoming offer respondable, got ${JSON.stringify(inOffer && { d: inOffer.direction, r: inOffer.canRespond })}`);
  assert(sentOffer, 'my SENT offer is visible on the desk (the other side of the coin)');
  assert(sentOffer.id === 'TR10' && sentOffer.withName === 'Third Team', `sent offer targets the right team, got ${JSON.stringify({ id: sentOffer.id, with: sentOffer.withName })}`);
  assert(sentOffer.canRevoke === true && sentOffer.canRespond === false, 'a sent offer is WITHDRAWABLE (revoke), not accept/rejectable');
  // Perspective stays MINE: I give my player 1 (Mine WR), I receive their player 30 (Other RB).
  assert(sentOffer.send.some((a) => a.name === 'Mine WR'), `sent offer: I give my player, got ${JSON.stringify(sentOffer.send.map((a) => a.name))}`);
  assert(sentOffer.acquire.some((a) => a.name === 'Other RB'), `sent offer: I receive their player, got ${JSON.stringify(sentOffer.acquire.map((a) => a.name))}`);
  console.log('✓ live desk: SENT offer visible (direction outgoing, withdrawable, my-perspective sides)');

  // The cross-league OVERVIEW stays an inbox — incoming only (a "what needs my response" view).
  assert(ov.offers.every((of) => of.direction === 'incoming'), 'cross-league overview is incoming-only (inbox)');
  console.log('✓ cross-league overview stays incoming-only (inbox)');

  // Respond (accept) -> MFL import tradeResponse.
  await trades.respond(CK, TK, '1000', 'TR9', 'accept');
  const resp = imported.find((c) => c.type === 'tradeResponse');
  assert(resp && resp.params.TRADE_ID === 'TR9' && resp.params.RESPONSE === 'accept', 'tradeResponse imported to MFL');
  console.log('✓ live respond: tradeResponse sent to MFL', JSON.stringify({ TRADE_ID: resp.params.TRADE_ID, RESPONSE: resp.params.RESPONSE }));

  // A reject must drop the league's cached MFL reads so the inbox refetch reflects the removal
  // right away — the offer is no longer pending on MFL, but pendingTrades is cached (~12s), so
  // without this the resolved offer would linger on the Trades screen until the TTL lapsed.
  const invalidated = [];
  const realInvalidate = mfl.invalidateLeague;
  mfl.invalidateLeague = (ck, lid) => { invalidated.push(String(lid)); return realInvalidate.call(mfl, ck, lid); };
  await trades.respond(CK, TK, '1000', 'TR9', 'reject');
  mfl.invalidateLeague = realInvalidate;
  const rej = imported.filter((c) => c.type === 'tradeResponse').pop();
  assert(rej && rej.params.RESPONSE === 'reject', 'reject sent to MFL as tradeResponse');
  assert(invalidated.includes('1000'), 'reject invalidated the league cache so the inbox refetches fresh');
  console.log('✓ live respond: reject invalidates the league cache (resolved offer clears on refetch)');

  // Propose a player + a future PICK for their player -> MFL import tradeProposal.
  const prop = await trades.propose(CK, TK, '1000', { toFranchiseId: '0002', give: ['1', 'FP_0003_2027_1'], receive: ['20'] });
  const tp = imported.find((c) => c.type === 'tradeProposal');
  assert(tp && tp.params.OFFEREDTO === '0002', 'tradeProposal imported to right team');
  assert(tp.params.WILL_GIVE_UP === '1,FP_0003_2027_1', `give includes the real pick token, got ${tp.params.WILL_GIVE_UP}`);
  assert(tp.params.WILL_RECEIVE === '20', 'receive is the player');
  assert(prop.offer.direction === 'outgoing', 'proposal stored as outgoing');
  console.log('✓ live propose: pick token in proposal', JSON.stringify({ GIVE: tp.params.WILL_GIVE_UP, RECEIVE: tp.params.WILL_RECEIVE }));

  // Cross-league targeting: shop Rival WR (id 20, owned by 0002 in league 1000).
  // He's not on my roster and IS on a partner roster -> a trade target, worth 100.
  // My best is Mine WR (value 50), so suggestGive assembles a package led by him.
  const pv = await trades.crossLeaguePreview(CK, TK, '20');
  console.log('preview:', JSON.stringify(pv.leagues.map((l) => ({ lg: l.leagueId, own: l.partnerName, give: l.suggestedGive.map((g) => g.name), tv: l.targetValue }))));
  assert(pv.player.name === 'Rival WR', 'preview names the target');
  assert(pv.leagues.length === 1, `one league where he's a trade target, got ${pv.leagues.length}`);
  const tl = pv.leagues[0];
  assert(tl.leagueId === '1000' && tl.partnerFranchiseId === '0002' && tl.partnerName === 'Rival Squad', 'owner resolved');
  assert(tl.targetValue === 100, `target value from enrichment, got ${tl.targetValue}`);
  assert(tl.suggestedGive.some((g) => g.name === 'Mine WR'), 'give led by my most valuable player');
  assert(!tl.suggestedGive.some((g) => g.id === '20'), 'target himself never appears in the give');
  console.log(`✓ cross-league preview: target in 1 league, give ${tl.suggestedGive.map((g) => g.name).join('+')} (${tl.giveValue} for ${tl.targetValue})`);

  // Propose across the selected league(s) -> one MFL tradeProposal per selection.
  imported.length = 0;
  const sent = await trades.crossLeaguePropose(CK, TK, '20', [{ leagueId: '1000', partnerFranchiseId: '0002', giveIds: ['1'] }]);
  assert(sent.summary.requested === 1 && sent.summary.submitted === 1, `1 of 1 submitted, got ${sent.summary.submitted}/${sent.summary.requested}`);
  const xp = imported.find((c) => c.type === 'tradeProposal');
  assert(xp && xp.params.OFFEREDTO === '0002' && xp.params.WILL_GIVE_UP === '1' && xp.params.WILL_RECEIVE === '20', 'cross-league proposal hit MFL with right sides');
  console.log('✓ cross-league propose: offer sent', JSON.stringify({ OFFEREDTO: xp.params.OFFEREDTO, GIVE: xp.params.WILL_GIVE_UP, RECEIVE: xp.params.WILL_RECEIVE }));

  console.log('\nLIVE TRADES HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
