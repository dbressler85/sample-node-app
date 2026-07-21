'use strict';

// Time-of-year dynasty advisory. ADVISORY ONLY — it never changes a value or a grade,
// it just nudges timing. The market is seasonal: rookie picks firm up between the end
// of the NFL season and the NFL draft (rookie hype, no veterans playing), and veterans
// firm up during the NFL season. So the edge is: don't sell picks cheap in-season, and
// don't sell veterans cheap in draft season — wait for the window that pays.
function advisory(date = new Date()) {
  const m = date.getUTCMonth() + 1; // 1-12

  // Feb–Apr: draft / rookie-hype season (up to the late-April NFL draft).
  if (m >= 2 && m <= 4) {
    return {
      window: 'draft-season',
      label: 'Draft season',
      message: 'Rookie picks are near their peak and veterans are soft right now. Good window to buy vets and hold your picks — a poor one to sell picks.',
      holdToSell: 'picks', // don't sell these cheap now; wait
    };
  }

  // Aug–Jan: the NFL season (Jan = playoffs/championship, veterans still peaking).
  if (m >= 8 || m === 1) {
    return {
      window: 'in-season',
      label: 'In-season',
      message: 'Veterans are peaking and picks are discounted right now. Good window to sell vets high and buy picks — a poor one to sell veterans cheap.',
      holdToSell: 'vets',
    };
  }

  // May–Jul: the quiet offseason.
  return {
    window: 'offseason',
    label: 'Offseason',
    message: 'Values are stable in the summer lull. Picks firm up in draft season (Feb–Apr); veterans firm up once the NFL season starts.',
    holdToSell: null,
  };
}

module.exports = { advisory };
