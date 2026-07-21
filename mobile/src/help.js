// Single source of truth for the app's "how does it work?" explanations. The Help
// screen renders every topic; an InfoDot (ⓘ) next to a feature opens just one by id.
// Keep these honest to the backend logic — they describe what the app actually does.

export const HELP = [
  {
    id: 'values',
    title: 'Where player values come from',
    body: [
      'Player values come from FantasyCalc, a community consensus of dynasty trade value. We pull them live and normalize to a 0–100 scale, so the most valuable player sits near 100 and everyone else is relative to that.',
      'Values are format-aware: they’re fetched separately for 1QB vs Superflex and for your league’s PPR, because a QB is worth far more when you can start two. Each league is priced in its own format automatically.',
      'Draft picks are estimated by round on the same scale (a 1st ≈ 55, 2nd ≈ 28, 3rd ≈ 14, 4th ≈ 7), discounted a little for picks further in the future. “Trending” uses Sleeper add/drop momentum, not value.',
      'These are model estimates, not a market price — great for comparing, but your league’s tastes still matter.',
    ],
  },
  {
    id: 'ranking',
    title: 'Market value vs. My value (and Trending)',
    body: [
      'The Players list can rank three ways. Market value is the pure FantasyCalc consensus — what the player is worth to everyone.',
      'My value is that same market value re-ranked by YOUR convictions: tagging a player Target nudges his value up ~10% for you, tagging him Avoid nudges it down ~10%. So your Targets rise in the list and your Avoids sink — but the number shown stays the honest market value, only the order changes. Tag players with the ◎ / ⦸ icons on any player row.',
      'Trending ignores value entirely and ranks by add/drop momentum (how heavily a player is being picked up across fantasy right now) — good for catching breakouts and waiver hype, not for dynasty worth.',
    ],
  },
  {
    id: 'outlook',
    title: 'Team outlook: win-now, ascending, rebuilding, balanced',
    body: [
      'Each team’s outlook is computed per league from two things: roster strength (your total dynasty value ranked against the other teams) and core age (the average age of your five most valuable players).',
      'Win-now window — a top-tier roster (roughly the stronger half) with a veteran core (about 25+). You’re built to contend now.',
      'Ascending — a young core (about 24.5 or younger) that isn’t bottom-tier. A winner is forming; be patient with picks and youth.',
      'Rebuilding — a bottom-half roster by value. The move is to accumulate youth and picks.',
      'Balanced — middling on both axes, no strong lean either way.',
    ],
  },
  {
    id: 'tradeGrade',
    title: 'How trades are graded',
    body: [
      '“Market value · net” is the difference between the total value you’d receive and the total you’d give, on the 0–100 scale.',
      'The verdict is a heuristic: “You gain value” when you come out meaningfully ahead (net above ~5 and more than a ~12% edge), “You give up value” when you’re behind by that much, otherwise “Fair deal.”',
      '“For you” adjusts that by your own Target/Avoid tags (±10%) — so a player you’ve tagged Target counts for a bit more to you than the market says.',
      'The construction read checks roster fit, not just value: does the deal fill one of your starting-lineup needs or thin one out? It uses each team’s actual starting requirements.',
      'All of it is marked “est.” because the values underneath are estimates.',
    ],
  },
  {
    id: 'format',
    title: 'League format & the value lens',
    body: [
      'Leagues differ in two ways that move dynasty value most: how many QBs you can start (1QB vs Superflex/2QB) and PPR. A QB is worth far more in Superflex.',
      'The app detects each league’s format from its starting lineup and scoring rules, and prices that league accordingly.',
      'On the Players screen, the value lens toggle (1QB / Superflex) lets you re-price and re-sort the entire player pool through either market, so you can compare across formats.',
    ],
  },
  {
    id: 'tradeBait',
    title: 'Trade bait / On the Block',
    body: [
      '“On the Block” is your own list of players you’re shopping. Adding a player syncs to MFL’s trade-bait board, so your leaguemates see he’s available.',
      'On the trade desk, players your partner is shopping show a 🎣 badge, and each partner chip shows how many they have on the block — so you can see who’s actively dealing before you build an offer.',
      'You can jump between your Block list and the trade inbox from the link in either screen’s header.',
    ],
  },
  {
    id: 'counter',
    title: 'How the “counter” button works',
    body: [
      'A counter keeps the same players and shape as their offer, then rebalances the value in your favor.',
      'If their offer shortchanges you, the counter asks for one more of their players to reach fair — preferring one they’ve put on their block, or one that fills a need of yours.',
      'If the offer is already fair or in your favor, the counter doesn’t just re-send it — it asks for a small sweetener: their nearest next-rookie-draft 3rd pick (or a 4th if they hold no 3rd).',
    ],
  },
  {
    id: 'waivers',
    title: 'Waivers: FAAB, priority, and free agents',
    body: [
      'MFL leagues use one of three pickup systems, and the app adapts to each:',
      'FAAB — a blind-bid budget. You bid a dollar amount; highest bid wins. The app shows your remaining budget.',
      'Waiver priority — a first-come order. Claims are granted by your position in line, which resets after you win one.',
      'Free agents — immediate add/drop, no waiting. When your roster is full, a claim has to include a drop.',
    ],
  },
  {
    id: 'scores',
    title: 'Live scores & win probability',
    body: [
      'During games the scoreboard shows your live score, a projected final (current points plus the projections of players still to play), and a win probability.',
      'Win probability is estimated from the projected final margin, with uncertainty that shrinks as more of your players finish. “final” appears once every player is locked.',
      'A ⚡ marks a close game (a coin-flip-ish win probability).',
    ],
  },
];

export const HELP_BY_ID = Object.fromEntries(HELP.map((h) => [h.id, h]));
