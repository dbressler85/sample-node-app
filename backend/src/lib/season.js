'use strict';

// Time-of-year dynasty advisory. ADVISORY ONLY — it never changes a value or a grade,
// it just nudges timing. The market is seasonal: rookie picks firm up between the end
// of the NFL season and the NFL draft (rookie hype, no veterans playing), and veterans
// firm up during the NFL season. So the edge is: don't sell picks cheap in-season, and
// don't sell veterans cheap in draft season — wait for the window that pays.
// Advisory tuned quarter by quarter — the dynasty market has a distinct rhythm across the
// calendar, so the message shifts with it. `holdToSell` names the asset currently at/near its
// peak (sell only high, or hold), so the app can lean trades toward the timing edge. Copy is
// deliberately terse — one punchy line, not a paragraph.
function advisory(date = new Date()) {
  const m = date.getUTCMonth() + 1; // 1-12

  // Jan: playoffs / championship. Win-now talent is worth the most; rebuilders dump picks.
  if (m === 1) {
    return { window: 'in-season', label: 'Playoffs', message: 'Win-now talent peaks; losing teams sell picks cheap. Cash in vets, buy picks.', holdToSell: 'vets' };
  }
  // Feb–Apr: rookie fever builds into the late-April draft. Picks peak, vets soft.
  if (m >= 2 && m <= 4) {
    return { window: 'draft-season', label: 'Draft season', message: 'Rookie picks near their peak; veterans are soft. Buy vets, hold your picks.', holdToSell: 'picks' };
  }
  // May–Jun: post-draft lull. Rookie-pick hype cools off its high; proven vets steady.
  if (m === 5 || m === 6) {
    return { window: 'offseason', label: 'Early offseason', message: 'Quiet market. Rookie-pick hype cools off its draft-day high; proven vets hold. Buy picks patiently.', holdToSell: null };
  }
  // Jul–Aug: training camp. Depth charts firm up; rookies without a path soften, starters rise,
  // and future picks slide as everyone pivots to winning THIS year.
  if (m === 7 || m === 8) {
    return { window: 'preseason', label: 'Training camp', message: 'Depth charts firm up: rookies blocked from a starting job cool, entrenched starters tick up, and future picks slide as focus shifts to winning now. Sell picks, buy the blocked youngsters low.', holdToSell: 'vets' };
  }
  // Sep–Dec: the season. Vets peak, picks are cheapest as contenders push.
  return { window: 'in-season', label: 'In-season', message: 'Veterans peak; picks are cheapest as contenders push. Sell vets high, buy picks.', holdToSell: 'vets' };
}

module.exports = { advisory };
