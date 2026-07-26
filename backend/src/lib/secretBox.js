'use strict';

// AES-256-GCM authenticated encryption bound to a secret + a domain SALT, so keys for different
// subsystems (live-session cookies vs. at-rest personal state) are derived independently and never
// collide. Shared by store/sessions.js (per-record session encryption) and store/persist.js
// (per-namespace at-rest encryption of personal data).
//
//   const box = secretBox(secret, 'dynasty-central/persist');
//   box.enc(obj) -> { iv, tag, ct }   (all base64)
//   box.dec(rec) -> obj | null        (null on wrong key / tampered / corrupt)

const crypto = require('crypto');

function secretBox(secret, salt) {
  const key = crypto.scryptSync(secret, salt, 32);

  function enc(obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
  }

  function dec(rec) {
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'base64'));
      d.setAuthTag(Buffer.from(rec.tag, 'base64'));
      return JSON.parse(Buffer.concat([d.update(Buffer.from(rec.ct, 'base64')), d.final()]).toString('utf8'));
    } catch (e) {
      return null; // wrong secret / tampered / corrupt
    }
  }

  return { enc, dec };
}

module.exports = secretBox;
