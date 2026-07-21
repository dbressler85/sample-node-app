'use strict';

// Time-of-year dynasty advisory. ADVISORY ONLY — it never changes a value or a grade,
// it just nudges timing. The market is seasonal:
//   • Rookie PICKS peak from the end of the NFL regular season through the late-April draft
//     (rookie hype, no veterans playing). They then slide all summer to a late-summer TROUGH,
//     and climb again through the NFL regular season as it winds back toward that peak. So the
//     edge on picks is: SELL in the Jan→draft peak, BUY cheap in summer, HOLD as they climb
//     in-season — never sell picks into the summer dip.
//   • Veterans firm up during the NFL season (production is visible, contenders push) and go
//     soft in draft season. So: sell vets in-season, buy vets in draft season.
// Advisory tuned quarter by quarter. `holdToSell` names the asset currently at/near its peak
// (sell only high, or hold) so the app can highlight the timing edge; null in the buy/accumulate
// windows. Copy is deliberately terse — one punchy line, not a paragraph.
function advisory(date = new Date()) {
  const m = date.getUTCMonth() + 1; // 1-12

  // Jan: playoffs / championship. Win-now vets peak. The regular season is over, so picks now
  // ENTER their strongest window (Jan→draft) — this is where you start cashing picks, not buying.
  if (m === 1) {
    return { window: 'in-season', label: 'Playoffs', message: 'Win-now vets peak in the championship — cash them in. With the season over, picks enter their strongest window; start shopping yours into the spring.', holdToSell: 'vets' };
  }
  // Feb–Apr: rookie fever builds into the late-April draft. Picks are AT their peak, vets soft.
  // This is the prime window to sell picks (top of the market), not hold them.
  if (m >= 2 && m <= 4) {
    return { window: 'draft-season', label: 'Draft season', message: 'Rookie picks peak into the late-April draft; veterans are soft. Sell picks high now, buy vets low.', holdToSell: 'picks' };
  }
  // May–Jun: post-draft lull. Picks slide off their draft-day peak toward the summer low — a
  // buy/accumulate window, never a sell-picks window.
  if (m === 5 || m === 6) {
    return { window: 'offseason', label: 'Early offseason', message: 'Post-draft lull: rookie-pick hype cools and picks drift toward their summer low. A time to accumulate picks patiently, not move them; hold vets.', holdToSell: null };
  }
  // Jul–Aug: training camp. Depth charts firm up (blocked rookies cool, entrenched starters tick
  // up), and picks sit near their SUMMER LOW — the cheapest they get. Buy picks and blocked
  // youngsters low; do NOT sell picks into this dip.
  if (m === 7 || m === 8) {
    return { window: 'preseason', label: 'Training camp', message: 'Depth charts firm up: rookies blocked from a starting job cool, entrenched starters tick up. Picks sit near their summer low — buy them cheap to sell next spring, and grab blocked youngsters low.', holdToSell: null };
  }
  // Sep–Dec: the season. Vets peak as contenders push. Picks are climbing back off their summer
  // low toward the end-of-season peak — hold them (or buy early before they run), don't sell cheap.
  return { window: 'in-season', label: 'In-season', message: 'Veterans peak as contenders push — sell vets high. Picks climb toward their end-of-season peak; hold them (buy early-season before they run).', holdToSell: 'vets' };
}

module.exports = { advisory };
