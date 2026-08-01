'use strict';

// Honor the client's background-priority flag (Fix A). The mobile app tags reads it fires as a
// speculative background fan-out — the Home pre-warm and the idle other-tab prefetch — with
// `X-DC-Priority: low`. When present, we run the rest of the request inside a low-priority context so
// every MFL read it spawns lands in the LOW lane and a foreground tap (NORMAL) preempts it.
//
// Only 'low' is honored — a client can voluntarily DE-prioritize its own background work, but can
// never escalate above the normal lane (there is nothing above it, and this keeps the header from
// being a priority-boost lever). Anything else is ignored and the request runs at normal priority.
const reqPriority = require('../lib/reqPriority');

module.exports = function priorityFromHeader(req, res, next) {
  if (req.get('x-dc-priority') === 'low') {
    return reqPriority.runLow(next);
  }
  return next();
};
