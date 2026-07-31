'use strict';

// Bug-report delivery. Two optional transports, tried in order; the DESTINATION address never leaves the
// server (it's a config/env value), so a report can be sent to a personal inbox the client never sees:
//   1) a webhook — POST the report JSON to BUG_REPORT_WEBHOOK over HTTPS (proxy-friendly, no dependency);
//   2) SMTP — send via nodemailer to BUG_REPORT_TO using BUG_SMTP_URL.
// nodemailer is an OPTIONAL require: if it isn't installed the module still loads and `configured()`
// simply reports the webhook path only (or none), so the endpoint degrades to the persist fallback
// instead of crashing the server.

const config = require('../config');

let nodemailer = null;
try {
  // eslint-disable-next-line global-require
  nodemailer = require('nodemailer');
} catch (e) {
  nodemailer = null; // optional — the caller falls back to persisting the report
}

// Can we actually deliver a report right now (some transport is configured + available)?
function configured() {
  if (config.bugReportWebhook) return true;
  if (nodemailer && config.bugSmtpUrl && config.bugReportTo) return true;
  return false;
}

// Deliver one report. `payload` carries the structured report ({ subject, text, username, message,
// diagnostics }). Throws if no transport is configured (the caller treats that as "persist instead").
async function sendBugReport(payload) {
  if (config.bugReportWebhook) {
    // Bound the webhook call so a hung/slow relay can't hold the client's request open (which would
    // defeat the whole point of the persist fallback). Abort after 5s and let the caller persist instead.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(config.bugReportWebhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: payload.subject,
          text: payload.text,
          username: payload.username,
          message: payload.message,
          diagnostics: payload.diagnostics,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`bug-report webhook returned ${res.status}`);
      return { via: 'webhook' };
    } finally {
      clearTimeout(timer);
    }
  }
  if (nodemailer && config.bugSmtpUrl && config.bugReportTo) {
    const transport = nodemailer.createTransport(config.bugSmtpUrl);
    await transport.sendMail({
      from: config.bugReportFrom || config.bugReportTo,
      to: config.bugReportTo,
      subject: payload.subject,
      text: payload.text,
    });
    return { via: 'smtp' };
  }
  const err = new Error('no bug-report transport configured');
  err.code = 'NO_TRANSPORT';
  throw err;
}

module.exports = { configured, sendBugReport };
