'use strict';

// Beta bug-report service. Validates the user's note, formats it with the attached diagnostics, and
// DELIVERS it to the developer's private inbox via the mailer (webhook or SMTP). If no transport is
// configured — or a send fails — the report is persisted server-side so it's never lost. The
// destination address is never returned to the client.

const mailer = require('../lib/mailer');
const store = require('../store/bugReports');

const MAX_MESSAGE = 4000;
const MAX_DIAG = 20000;

function throwBad(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

// Defensive scrub: the client-collected diagnostics are structured and don't include secrets, but a
// future client change could slip one in — so redact anything token/cookie/password-like from the
// serialized blob before it's emailed/relayed/stored. Belt-and-suspenders; costs nothing.
function scrubSecrets(s) {
  return String(s)
    .replace(/("(?:password|token|cookie|authorization|auth|secret|bearer)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]');
}

function buildText(username, message, diagnostics) {
  let diagStr = '';
  try {
    diagStr = JSON.stringify(diagnostics, null, 2);
  } catch (e) {
    diagStr = String(diagnostics);
  }
  diagStr = scrubSecrets(diagStr);
  if (diagStr.length > MAX_DIAG) diagStr = `${diagStr.slice(0, MAX_DIAG)}\n…(truncated)`;
  return [
    `From: ${username || 'unknown'}`,
    `When: ${new Date().toISOString()}`,
    '',
    'What happened:',
    message,
    '',
    'Diagnostics:',
    diagStr,
  ].join('\n');
}

// Accept + deliver a report. `username` is the authenticated account (never taken from the client body),
// so a report can't be spoofed to look like it came from someone else.
async function submit(token, username, body) {
  const message = String((body && body.message) || '').trim().slice(0, MAX_MESSAGE);
  if (!message) throwBad('A description of what happened is required.');
  const diagnostics = (body && body.diagnostics) || {};
  const subject = `Dynasty Central bug report — ${username || 'user'}`;
  const text = buildText(username, message, diagnostics);

  let delivered = false;
  if (mailer.configured()) {
    try {
      await mailer.sendBugReport({ subject, text, username: username || null, message, diagnostics });
      delivered = true;
    } catch (e) {
      console.log(`[bugReport] delivery failed, persisting: ${e.message}`);
    }
  }
  // Persist ONLY when we couldn't deliver, so a configured prod inbox doesn't grow the store.
  if (!delivered) store.add(token, { username: username || null, message, diagnostics });

  // The response never reveals the destination — just whether it was sent or safely stored.
  return { ok: true, delivered };
}

module.exports = { submit };
