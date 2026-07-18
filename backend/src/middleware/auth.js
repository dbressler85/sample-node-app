'use strict';

// Resolve the Bearer app token to an MFL session and attach it to the request.
const sessions = require('../store/sessions');

module.exports = function requireSession(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  const session = token ? sessions.get(token) : null;
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated. Log in and send Authorization: Bearer <token>.' });
  }
  req.session = session;
  req.token = token;
  req.mflCookie = session.cookie;
  next();
};
