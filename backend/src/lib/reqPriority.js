'use strict';

// Request-scoped MFL priority, carried ambiently so services don't have to thread a param.
//
// Fix A (priority inversion for the Home warm): a background fan-out — the mobile's Home pre-warm and
// the idle other-tab prefetch — should never delay a read the user is actively waiting on. Those runs
// share the SAME MFL account (cookie) as the user's foreground taps, and the fair queue is keyed by
// account, so within one session a tap otherwise queues in FIFO order BEHIND the warm's 15-league
// sweep. The MFL throttle already drains the NORMAL lane fully before the LOW lane, so the fix is to
// run every read spawned by a background request at LOW priority — then a foreground tap (NORMAL)
// preempts the queued warm instead of waiting it out.
//
// Threading `priority:'low'` through every service → mflRepo → exportRequest call would touch dozens
// of signatures. Instead the background HTTP request runs inside runLow(), and exportRequest reads the
// ambient priority when a call doesn't pass one explicitly. Callers that ALWAYS mean low (the Sunday
// warm worker, the player-DB refresh) still pass priority:'low' directly and are unaffected.

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

// Run fn within a low-priority context. Every MFL read it spawns (that doesn't override priority)
// inherits 'low'. Used by the priority middleware for requests the client flags as background.
function runLow(fn) {
  return als.run({ priority: 'low' }, fn);
}

// The ambient request priority, or 'normal' when there's no context (an ordinary foreground request,
// a worker outside any HTTP request). exportRequest uses this as the fallback when a call site doesn't
// pass an explicit priority.
function current() {
  const store = als.getStore();
  return (store && store.priority) || 'normal';
}

module.exports = { runLow, current };
