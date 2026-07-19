'use strict';

// End-to-end smoke test of the backend in DEMO mode. Boots the app on an
// ephemeral port and exercises the full login -> dashboard -> roster flow.
// Run: npm run smoke   (exits non-zero on any failure)

process.env.MFL_DEMO_MODE = 'true';
const app = require('../src/app');

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (res) => ({ status: res.status, body: await res.json() });

  try {
    let r = await j(await fetch(`${base}/api/health`));
    assert(r.status === 200 && r.body.ok, 'health ok');
    assert(r.body.demoMode === true, 'demo mode on');
    console.log('✓ health', r.body);

    r = await j(
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'demo', password: 'demo' }),
      })
    );
    assert(r.status === 200 && r.body.token, 'login returns token');
    const token = r.body.token;
    console.log('✓ login token acquired');

    const authed = { headers: { Authorization: `Bearer ${token}` } };

    r = await j(await fetch(`${base}/api/dashboard`, authed));
    assert(r.status === 200, 'dashboard 200');
    assert(Array.isArray(r.body.leagues) && r.body.leagues.length === 3, 'dashboard has 3 leagues');
    assert(r.body.leagues.every((l) => l.matchup && l.matchup.me), 'every league has a matchup');
    console.log(`✓ dashboard: ${r.body.leagues.length} leagues`);
    for (const l of r.body.leagues) {
      console.log(
        `    - ${l.name} (${l.record}, #${l.standingRank}) ` +
          `${l.matchup.me.score} vs ${l.matchup.opponent.score} [${l.matchup.opponent.name}]`
      );
    }

    const leagueId = r.body.leagues[0].leagueId;
    r = await j(await fetch(`${base}/api/leagues/${leagueId}/roster`, authed));
    assert(r.status === 200, 'roster 200');
    assert(r.body.starters.length > 0, 'roster has starters');
    assert(r.body.starters.every((p) => p.name && !/^Player /.test(p.name)), 'starter names resolved');
    console.log(`✓ roster for ${r.body.name}: ${r.body.starters.length} starters, ${r.body.bench.length} bench`);
    console.log(`    starters: ${r.body.starters.map((p) => `${p.name} (${p.position})`).join(', ')}`);

    // --- M1.5: command center ---
    // Dynasty roster context.
    const dr = (await j(await fetch(`${base}/api/leagues/64097/roster`, authed))).body;
    assert(dr.starters.every((p) => p.value != null && p.age != null), 'roster players carry age + dynasty value');
    assert(dr.summary && dr.summary.outlook && dr.summary.rosterValue > 0, 'roster has a dynasty team summary');
    assert(Array.isArray(dr.picks), 'roster lists rookie picks');
    console.log(
      `✓ dynasty roster: value ${dr.summary.rosterValue}, core age ${dr.summary.coreAge} (${dr.summary.outlook}), picks: ${dr.picks.join(', ')}`
    );

    // Portfolio + triage home.
    const home = (await j(await fetch(`${base}/api/home`, authed))).body;
    assert(home.portfolio && home.portfolio.leagues === 3, 'home rolls up all leagues');
    assert(Array.isArray(home.triage) && home.triage.length >= 1, 'home has a triage queue');
    assert(home.triage[0].severity === 'high', 'triage is sorted most-urgent first');
    assert(home.portfolio.tradeOffers >= 1, 'trade offers surfaced');
    console.log(
      `✓ home: ${home.portfolio.leagues} leagues · ${home.portfolio.needAttention} need attention ` +
        `(${home.portfolio.injuries} inj, ${home.portfolio.lineupsToSet} unset, ${home.portfolio.holes} holes, ` +
        `${home.portfolio.tradeOffers} trades) · ${home.triage.length} to-dos`
    );
    for (const t of home.triage.slice(0, 4)) console.log(`    [${t.severity}] ${t.leagueName}: ${t.title}`);

    // Progressive per-league triage (drives instant + streamed Home loading).
    const oneLeague = (await j(await fetch(`${base}/api/home/league/64097`, authed))).body;
    assert(oneLeague.leagueId === '64097' && Array.isArray(oneLeague.items), 'per-league triage returns items');
    assert(typeof oneLeague.status === 'string', 'per-league triage returns a status');
    console.log(`✓ per-league triage: ${oneLeague.name} → ${oneLeague.status}, ${oneLeague.items.length} item(s)`);

    // Live scoreboard.
    const sb = (await j(await fetch(`${base}/api/scoreboard`, authed))).body;
    assert(sb.games.length === 3, 'scoreboard has all games');
    assert(sb.games.every((g) => g.winProb >= 0 && g.winProb <= 1 && g.me.yetToPlay != null), 'games have win prob + players left');
    // Closest game first among non-locked.
    const liveGames = sb.games.filter((g) => !g.locked);
    if (liveGames.length >= 2) {
      assert(Math.abs(liveGames[0].winProb - 0.5) <= Math.abs(liveGames[1].winProb - 0.5), 'closest game sorts first');
    }
    console.log(`✓ scoreboard: ${sb.summary.live} live, ${sb.summary.close} close`);
    for (const g of sb.games)
      console.log(
        `    ${g.name}: ${g.me.score}-${g.opp.score} vs ${g.opponent} · ${Math.round(g.winProb * 100)}% (${g.me.yetToPlay} to play)${g.close ? ' ⚡close' : ''}`
      );

    // Player exposure (the cross-league moat).
    const exp = (await j(await fetch(`${base}/api/players/exposure`, authed))).body;
    assert(exp.players.length > 0 && exp.summary.multiLeague >= 1, 'exposure finds multi-league players');
    const topExp = exp.players[0];
    assert(topExp.count >= 1 && topExp.leagues.every((l) => typeof l.starting === 'boolean'), 'exposure records starting per league');
    console.log(`✓ exposure: ${exp.summary.uniquePlayers} players, ${exp.summary.multiLeague} rostered in multiple leagues`);
    for (const p of exp.players.filter((x) => x.count > 1).slice(0, 4))
      console.log(`    ${p.name} — ${p.count} leagues (${p.startingCount} starting), value ${p.value}`);

    // News mapped to impact.
    const news = (await j(await fetch(`${base}/api/news`, authed))).body;
    assert(news.news.length > 0, 'news feed present');
    const harrison = news.news.find((n) => n.player.id === '15859');
    assert(harrison && harrison.affectedCount >= 1, 'news maps to affected teams');
    console.log(`✓ news→impact: "${harrison.headline}" affects ${harrison.affectedCount} of your teams (${harrison.startingCount} starting)`);

    // --- M3: waivers / FAAB / free agents ---
    // Board respects the per-league system.
    const faab = (await j(await fetch(`${base}/api/leagues/64097/waivers`, authed))).body; // faab
    const free = (await j(await fetch(`${base}/api/leagues/19622/waivers`, authed))).body; // free, full roster
    assert(faab.system === 'faab' && faab.settings.faabRemaining > 0, 'faab league reports budget');
    assert(free.system === 'free' && free.rosterFull === true, 'free league with full roster flagged');
    assert(faab.freeAgents.length > 0 && faab.freeAgents.every((p) => p.value != null), 'board lists valued free agents');
    console.log(
      `✓ waiver boards: FAAB ($${faab.settings.faabRemaining} left, ${faab.freeAgents.length} FAs), ` +
        `free league roster ${free.rosterCount}/${free.settings.rosterSize} (full: ${free.rosterFull})`
    );

    // Filter + sort.
    const rbs = (await j(await fetch(`${base}/api/leagues/64097/waivers?position=RB&sort=projection`, authed))).body;
    assert(rbs.freeAgents.every((p) => p.position === 'RB'), 'position filter works');
    console.log(`✓ filter/sort: ${rbs.freeAgents.length} RBs by projection`);

    // Sort by ownership %.
    const byOwn = (await j(await fetch(`${base}/api/leagues/64097/waivers?sort=ownership`, authed))).body;
    assert(byOwn.freeAgents.every((p) => p.ownership != null), 'free agents carry ownership %');
    for (let k = 1; k < byOwn.freeAgents.length; k++) {
      assert(byOwn.freeAgents[k - 1].ownership >= byOwn.freeAgents[k].ownership, 'sorted by ownership desc');
    }
    console.log(`✓ ownership sort: ${byOwn.freeAgents.map((p) => `${p.name.split(',')[0]} ${p.ownership}%`).join(', ')}`);

    // Preview fills smart assists: suggested drop (roster full) + suggested bid.
    const prevFull = (await j(
      await fetch(`${base}/api/leagues/19622/waivers/preview`, {
        method: 'POST',
        headers: { ...authed.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addId: '16002' }),
      })
    )).body;
    assert(prevFull.dropRequired && prevFull.suggestedDrop, 'full roster -> a drop is suggested');
    assert(prevFull.valid, 'preview with suggested drop is valid');
    console.log(`✓ smart drop: adding ${prevFull.add.name} suggests dropping ${prevFull.suggestedDrop.name} (value ${prevFull.suggestedDrop.value})`);

    const prevBid = (await j(
      await fetch(`${base}/api/leagues/64097/waivers/preview`, {
        method: 'POST',
        headers: { ...authed.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addId: '16002' }),
      })
    )).body;
    assert(prevBid.suggestedBid > 0 && prevBid.bid === prevBid.suggestedBid, 'faab preview suggests a bid');
    assert(prevBid.budgetAfter === faab.settings.faabRemaining - prevBid.bid, 'budget-after computed');
    console.log(`✓ bid guidance: ${prevBid.add.name} → $${prevBid.suggestedBid} (budget after $${prevBid.budgetAfter})`);

    // Validation: over-budget bid rejected.
    const bad = (await j(
      await fetch(`${base}/api/leagues/64097/waivers/preview`, {
        method: 'POST',
        headers: { ...authed.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addId: '16002', bid: 9999 }),
      })
    )).body;
    assert(!bad.valid && bad.errors.some((e) => /budget/i.test(e)), 'over-budget bid is rejected');
    console.log('✓ validation: over-budget bid blocked');

    // Submit a claim; it appears in pending.
    const sub = (await j(
      await fetch(`${base}/api/leagues/64097/waivers`, {
        method: 'POST',
        headers: { ...authed.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addId: '16002', bid: 20 }),
      })
    )).body;
    assert(sub.submitted && sub.board.pending.some((c) => c.id === sub.submitted.id), 'submitted claim is now pending');
    console.log(`✓ submit: claimed ${sub.submitted.add.name} for $${sub.submitted.bid} (${sub.board.pending.length} pending)`);

    // Cancel it.
    const canceled = (await j(await fetch(`${base}/api/leagues/64097/waivers/${sub.submitted.id}`, { method: 'DELETE', ...authed }))).body;
    assert(!canceled.board.pending.some((c) => c.id === sub.submitted.id), 'canceled claim removed from pending');
    console.log('✓ cancel: claim withdrawn');

    // Cross-league best available.
    const ba = (await j(await fetch(`${base}/api/waivers/best-available`, authed))).body;
    assert(ba.players.length > 0, 'best-available has players');
    const multi = ba.players.find((p) => p.leagueCount > 1);
    assert(multi, 'a free agent is available in multiple leagues');
    console.log(`✓ best available: ${multi.name} is free in ${multi.leagueCount} of your leagues`);

    // Pending across leagues + triage deep-link.
    const pend = (await j(await fetch(`${base}/api/waivers/pending`, authed))).body;
    assert(pend.summary.pending >= 1, 'aggregate pending claims present');
    const homeW = (await j(await fetch(`${base}/api/home`, authed))).body;
    assert(homeW.triage.some((t) => t.action === 'waiver'), 'triage deep-links a waiver action');
    console.log(`✓ pending across leagues: ${pend.summary.pending}; triage routes the bye-week hole to waivers`);

    // --- M4: player hub ---
    const postJson = (path, body) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { ...authed.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    // Universe search.
    const srch = (await j(await fetch(`${base}/api/players/search?q=jeff`, authed))).body;
    assert(srch.players.some((p) => p.name.includes('Jefferson')), 'search finds a player by name');
    assert(srch.players.every((p) => 'mine' in p), 'search results annotate your ownership');
    console.log(`✓ search "jeff": ${srch.players.length} hit(s), top ${srch.players[0].name} (value ${srch.players[0].value})`);

    // Rankings.
    const rkValue = (await j(await fetch(`${base}/api/players/rankings?type=value`, authed))).body;
    for (let k = 1; k < rkValue.players.length; k++) assert(rkValue.players[k - 1].value >= rkValue.players[k].value, 'value rankings sorted desc');
    const rkTrend = (await j(await fetch(`${base}/api/players/rankings?type=trending`, authed))).body;
    assert(rkTrend.players.length > 0, 'trending rankings present');
    console.log(`✓ rankings: #1 value ${rkValue.players[0].name}; trending #1 ${rkTrend.players[0].name}`);

    // Profile of a rostered star.
    const prof = (await j(await fetch(`${base}/api/players/13593`, authed))).body; // Jefferson
    assert(prof.outlook && prof.outlook.floor <= prof.outlook.median && prof.outlook.median <= prof.outlook.ceiling, 'profile projection has floor<=median<=ceiling');
    assert(prof.season && prof.gameLog.length >= 1, 'profile has season + game log');
    assert(prof.schedule.upcoming.length >= 1 && prof.schedule.avgDifficulty != null, 'profile has upcoming schedule difficulty');
    assert(prof.crossLeague.some((c) => c.relation === 'rostered'), 'profile shows leagues you roster him');
    console.log(
      `✓ profile ${prof.name}: #${prof.overallRank} overall (${prof.position}${prof.posRank}), ` +
        `${prof.season.ppg} ppg, sched diff ${prof.schedule.avgDifficulty}, rostered in ${prof.actions.dropLeagues.length} of your leagues`
    );

    // Profile of a free agent → cross-league add options.
    const faProf = (await j(await fetch(`${base}/api/players/16002`, authed))).body; // Tracy
    assert(faProf.actions.addLeagues.length >= 2, 'free agent is addable in multiple leagues');
    console.log(`✓ cross-league: ${faProf.name} is available to add in ${faProf.actions.addLeagues.length} of your leagues`);

    // Preview + submit the player-centric add across leagues.
    const prevAdd = (await j(await fetch(`${base}/api/players/16002/add/preview`, authed))).body;
    assert(prevAdd.leagues.length === faProf.actions.addLeagues.length, 'add preview covers each eligible league');
    console.log(`✓ add preview: ${prevAdd.leagues.map((l) => `${l.name.split(' ')[0]}${l.suggestedBid != null ? ` $${l.suggestedBid}` : ''}`).join(', ')}`);
    const doneAdd = (await j(
      await postJson('/api/players/16002/add', { leagues: prevAdd.leagues.map((l) => ({ leagueId: l.leagueId })) })
    )).body;
    assert(doneAdd.summary.submitted === prevAdd.leagues.length, 'add submitted across all chosen leagues');
    console.log(`✓ ADD ACROSS LEAGUES: ${faProf.name} claimed in ${doneAdd.summary.submitted} leagues at once`);

    // Player-centric drop.
    const dropRes = (await j(await postJson('/api/players/13593/drop', { leagues: ['64097'] }))).body;
    assert(dropRes.summary.dropped === 1, 'drop recorded');
    const profAfter = (await j(await fetch(`${base}/api/players/13593`, authed))).body;
    assert(profAfter.crossLeague.find((c) => c.leagueId === '64097').relation === 'dropped', 'profile reflects the drop');
    console.log('✓ drop: player-centric drop reflected in the profile');

    // --- M2 / M2.5: lineups ---
    r = await j(await fetch(`${base}/api/lineups?mode=auto`, authed));
    assert(r.status === 200, 'lineups overview 200');
    assert(r.body.leagues.length === 3, 'lineups overview has 3 leagues');
    const before = r.body.summary;
    assert(before.needAttention >= 1, 'at least one league needs attention');
    assert(before.risky >= 1, 'at least one league has an unavailable current starter (risk)');
    assert(r.body.leagues[0].status === 'risk', 'most urgent (risk) league sorts first');
    console.log(
      `✓ lineups overview: ${before.needAttention}/${before.total} need attention, ` +
        `${before.risky} risky, +${before.pointsAvailable} pts available`
    );
    for (const l of r.body.leagues) {
      const w = (l.warnings || []).map((x) => `${x.name}${x.status ? ` [${x.status}]` : ''}`).join(', ');
      const mu = l.matchup ? ` vs ${l.matchup.opponent} (win ${Math.round(l.matchup.winProb * 100)}%)` : '';
      console.log(`    - ${l.name} [${l.format}]: ${l.status}${mu}${w ? ` — ⚠ ${w}` : ''}`);
    }

    // Format awareness: same player, different scoring -> different points.
    const std = (await j(await fetch(`${base}/api/leagues/64097/lineup`, authed))).body; // standard
    const tep = (await j(await fetch(`${base}/api/leagues/19622/lineup`, authed))).body; // PPR + TE premium
    const kStd = std.players.find((p) => p.id === '12171');
    const kTep = tep.players.find((p) => p.id === '12171');
    assert(kTep.median > kStd.median, 'TE premium + PPR raises Kelce vs standard');
    console.log(`✓ format-aware: Kelce ${kStd.median} ("${std.format}") vs ${kTep.median} ("${tep.format}")`);

    // Kicker & defense scoring is ALSO per-league: the same free-agent kicker
    // (Bass) and D/ST (Cowboys) are worth more in Keeper Kings (long-FG + big-play
    // defense scoring) than in Dynasty Warlords (plain scale).
    const kdStd = (await j(await fetch(`${base}/api/leagues/64097/waivers`, authed))).body; // Warlords
    const kdBig = (await j(await fetch(`${base}/api/leagues/19622/waivers`, authed))).body; // Keeper Kings
    const proj = (board, id) => board.freeAgents.find((p) => p.id === id).projection;
    assert(proj(kdBig, '17002') > proj(kdStd, '17002'), 'kicker scores higher under distance-weighted FG scoring');
    assert(proj(kdBig, '18002') > proj(kdStd, '18002'), 'defense scores higher under big-play scoring');
    console.log(
      `✓ per-league K/DEF scoring: Bass ${proj(kdStd, '17002')}→${proj(kdBig, '17002')}, ` +
        `Cowboys D/ST ${proj(kdStd, '18002')}→${proj(kdBig, '18002')} (Warlords→Keeper Kings)`
    );

    // Availability: no OUT/bye/injured player is ever in an optimal lineup, and
    // every player has a sane floor <= median <= ceiling band.
    for (const lg of ['64097', '40750', '19622']) {
      const d = (await j(await fetch(`${base}/api/leagues/${lg}/lineup?mode=auto`, authed))).body;
      const byId = new Map(d.players.map((p) => [p.id, p]));
      const badStarter = d.optimal.starterIds.find((id) => !byId.get(id).availability.startable);
      assert(!badStarter, `no unavailable player starts in optimal (${d.name})`);
      assert(d.players.every((p) => p.floor <= p.median && p.median <= p.ceiling), `floor<=median<=ceiling (${d.name})`);
      if (d.matchup) assert(d.matchup.winProb >= 0 && d.matchup.winProb <= 1, 'win prob in [0,1]');
    }
    const sf = (await j(await fetch(`${base}/api/leagues/40750/lineup?mode=auto`, authed))).body;
    assert(sf.warnings.some((w) => w.status === 'OUT'), 'Superflex flags its OUT starter');
    assert(!sf.optimal.starterIds.includes('15859'), 'optimal benches the OUT player (Harrison)');
    console.log(`✓ availability: optimal lineups never start OUT/bye players; ${sf.name} benches its OUT starter`);

    // Modes: safe maximizes floor, aggressive maximizes ceiling.
    const bal = (await j(await fetch(`${base}/api/leagues/40750/lineup?mode=balanced`, authed))).body;
    const safe = (await j(await fetch(`${base}/api/leagues/40750/lineup?mode=safe`, authed))).body;
    const agg = (await j(await fetch(`${base}/api/leagues/40750/lineup?mode=aggressive`, authed))).body;
    assert(safe.optimal.floor >= bal.optimal.floor, 'safe mode maximizes floor');
    assert(agg.optimal.ceiling >= bal.optimal.ceiling, 'aggressive mode maximizes ceiling');
    console.log(
      `✓ modes: safe floor ${safe.optimal.floor} >= balanced ${bal.optimal.floor}; ` +
        `aggressive ceiling ${agg.optimal.ceiling} >= balanced ${bal.optimal.ceiling}`
    );

    // Plan: a diff preview of "Set All", writing nothing.
    r = await j(await fetch(`${base}/api/lineups/plan?mode=auto`, authed));
    assert(r.status === 200 && r.body.summary.leaguesWithChanges >= 1, 'plan has changes to review');
    const changed = r.body.leagues.filter((l) => l.changed);
    assert(changed.every((l) => Array.isArray(l.adds) && Array.isArray(l.drops)), 'plan items carry adds/drops');
    console.log(`✓ Set-All preview (no writes): ${r.body.summary.leaguesWithChanges} leagues would change`);
    for (const l of changed) {
      console.log(
        `    - ${l.name}: +${l.gained} pts · IN ${l.adds.map((p) => p.name).join(', ') || '—'} · ` +
          `OUT ${l.drops.map((p) => p.name).join(', ') || '—'}`
      );
    }

    // THE HEADLINE: set all lineups in one call.
    r = await j(
      await fetch(`${base}/api/lineups/apply`, {
        method: 'POST',
        headers: { ...authed.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'auto' }),
      })
    );
    assert(r.status === 200 && r.body.summary.leaguesUpdated >= 1, 'apply-all updated leagues');
    assert(r.body.summary.pointsGained > 0, 'apply-all gained points');
    console.log(`✓ SET ALL LINEUPS: ${r.body.summary.leaguesUpdated} updated, +${r.body.summary.pointsGained} pts`);

    // After applying: no risk remains (never starting unavailable players); any
    // league still flagged is 'incomplete' (a bye left a slot with no healthy option).
    r = await j(await fetch(`${base}/api/lineups?mode=auto`, authed));
    assert(r.body.summary.risky === 0, 'no risky lineups after set-all');
    assert(
      r.body.leagues.every((l) => l.status === 'optimal' || l.status === 'incomplete'),
      'remaining flags are only unfillable (bye) slots'
    );
    console.log(
      `✓ after set-all: 0 risky; ${r.body.leagues.filter((l) => l.status === 'incomplete').length} ` +
        `league(s) need a waiver pickup (bye-week hole)`
    );

    // --- M5: trades ---
    const trOverview = (await j(await fetch(`${base}/api/trades`, authed))).body;
    assert(trOverview.offers.length === 2, 'two pending trade offers across leagues');
    const t1 = trOverview.offers.find((o) => o.id === 't1');
    assert(t1 && t1.acquire[0].name.includes('Gibbs') && t1.send[0].name.includes('Nix'), 'offer resolves players on both sides');
    assert(t1.analysis.acquireValue > t1.analysis.sendValue && t1.analysis.verdict === 'favorable', 'value analysis flags a favorable offer');
    console.log(`✓ trade offers: ${trOverview.offers.length} pending; t1 IN ${t1.acquire.map((a) => a.name.split(',')[0])} (${t1.analysis.acquireValue}) OUT ${t1.send.map((a) => a.name.split(',')[0])} (${t1.analysis.sendValue}) → ${t1.analysis.verdict}`);

    // League detail: offers + my players + partners to build a proposal.
    const trLeague = (await j(await fetch(`${base}/api/leagues/40750/trades`, authed))).body;
    assert(trLeague.myPlayers.length > 0 && trLeague.partners.length > 0, 'league trade view has my players + partners');
    assert(trLeague.partners[0].players.every((p) => 'value' in p), 'partner rosters carry value');
    console.log(`✓ trade builder: ${trLeague.myPlayers.length} of my players, ${trLeague.partners.length} partners (${trLeague.partners.map((p) => p.name).join(', ')})`);

    // Propose a trade.
    const proposal = (await j(
      await fetch(`${base}/api/leagues/40750/trades`, {
        method: 'POST',
        headers: { ...authed.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ toFranchiseId: '0002', give: ['15870'], receive: ['14802'] }),
      })
    )).body;
    assert(proposal.ok && proposal.offer.direction === 'outgoing', 'proposal submitted as an outgoing offer');
    console.log(`✓ propose: sent ${proposal.offer.send.map((a) => a.name.split(',')[0])} for ${proposal.offer.acquire.map((a) => a.name.split(',')[0])} → ${proposal.offer.withName}`);

    // Reject an incoming offer; it disappears from the overview.
    const rej = (await j(
      await fetch(`${base}/api/leagues/40750/trades/t1/respond`, {
        method: 'POST',
        headers: { ...authed.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      })
    )).body;
    assert(rej.ok && rej.action === 'reject', 'reject recorded');
    const after = (await j(await fetch(`${base}/api/trades`, authed))).body;
    assert(!after.offers.some((o) => o.id === 't1'), 'rejected offer removed from pending');
    console.log(`✓ respond: rejected t1; pending now ${after.offers.length}`);

    // --- M6: drafts ---
    const drafts = (await j(await fetch(`${base}/api/drafts`, authed))).body;
    assert(drafts.drafts.length === 3, 'draft state for all leagues');
    assert(drafts.summary.scheduled >= 1 && drafts.summary.live >= 1, 'detects scheduled + in-progress drafts');
    assert(drafts.summary.onClock === 1, 'flags the one league where I am on the clock');
    console.log(
      `✓ drafts overview: ${drafts.summary.live} live, ${drafts.summary.scheduled} scheduled, ${drafts.summary.onClock} on the clock` +
        `\n    ${drafts.drafts.map((d) => `${d.name.split(' ')[0]}:${d.status}${d.myOnClock ? ' (MY PICK)' : ''}`).join(', ')}`
    );

    // The live draft where I'm on the clock.
    const live = drafts.drafts.find((d) => d.myOnClock);
    const dl = (await j(await fetch(`${base}/api/leagues/${live.leagueId}/draft`, authed))).body;
    assert(dl.status === 'in_progress' && dl.onClock && dl.onClock.mine, 'my league draft is live and on my pick');
    assert(dl.board.some((s) => s.player) && dl.board.some((s) => !s.playerId), 'board shows made + upcoming picks');
    assert(dl.available.length > 0 && dl.available[0].value >= (dl.available[1] || {}).value, 'available pool ranked by dynasty value');
    console.log(
      `✓ draft board (${dl.name}): on the clock 1.${String(dl.onClock.pick).padStart(2, '0')}; ` +
        `top available ${dl.available[0].name.split(',')[0]} (${dl.available[0].value})`
    );

    // Make the pick; it lands on the board and I'm no longer on the clock.
    const topPick = dl.available[0];
    const afterPick = (await j(
      await fetch(`${base}/api/leagues/${live.leagueId}/draft/pick`, {
        method: 'POST',
        headers: { ...authed.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: topPick.id }),
      })
    )).body;
    assert(afterPick.board.some((s) => s.player && s.player.id === topPick.id), 'pick recorded on the board');
    // Clock advances to the next slot (may still be me on a snake wrap).
    assert(!afterPick.onClock || afterPick.onClock.overall > dl.onClock.overall, 'clock advances after picking');
    assert(!afterPick.available.some((p) => p.id === topPick.id), 'drafted player leaves the available pool');
    console.log(`✓ make pick: drafted ${topPick.name.split(',')[0]}; ${afterPick.myPicks.filter((p) => p.player).length} of my picks made`);

    // Scheduled draft carries a start time and no picks yet.
    const sched = drafts.drafts.find((d) => d.status === 'scheduled');
    assert(sched && sched.startTime, 'scheduled draft has a start time');
    console.log(`✓ scheduled: ${sched.name} draft at ${sched.startTime}`);

    r = await j(await fetch(`${base}/api/dashboard`));
    assert(r.status === 401, 'dashboard without token is 401');
    console.log('✓ auth required (401 without token)');

    console.log('\nALL SMOKE CHECKS PASSED');
  } finally {
    server.close();
  }
})().catch((err) => {
  console.error('\nSMOKE FAILED:', err.message);
  process.exit(1);
});
