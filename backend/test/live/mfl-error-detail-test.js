'use strict';
// mfl.errorDetail — surface MFL's real complaint on a write failure, never a bare "(500)".
// Precedence: MFL's parsed error message > its (tag-stripped) response body > the generic message.
process.env.MFL_DEMO_MODE = 'true';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

(async () => {
  // MFL's own error message wins.
  assert(mfl.errorDetail({ mflError: 'Invalid Franchise', body: '<x/>', message: 'nope' }) === 'Invalid Franchise', 'mflError preferred');

  // Else the response body, with tags/whitespace stripped and bounded.
  const e = { status: 500, body: '<error>\n  You cannot add a locked player.  </error>', message: 'MFL request failed (500) for import?TYPE=' };
  assert(mfl.errorDetail(e) === 'You cannot add a locked player.', `body stripped, got "${mfl.errorDetail(e)}"`);

  // Else fall back to the generic message.
  assert(mfl.errorDetail({ message: 'boom' }) === 'boom', 'message fallback');
  assert(mfl.errorDetail(null) === 'Unknown error.', 'null-safe');

  // A body that's only markup/whitespace → falls through to the message, not an empty string.
  assert(mfl.errorDetail({ body: '<a></a>  ', message: 'MFL request failed (502)' }) === 'MFL request failed (502)', 'empty-after-strip → message');

  // Length is bounded so a huge HTML error page can't flood the UI/logs.
  assert(mfl.errorDetail({ body: 'x'.repeat(1000) }).length === 300, 'body detail capped at 300');

  console.log('✓ errorDetail: mflError > stripped body > message, null-safe, bounded');
  console.log('\nMFL ERROR DETAIL HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
