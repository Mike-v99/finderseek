// api/_admin-auth.js
// Shared helper for verifying admin tokens issued by /api/admin-login.
// Import this in any endpoint that requires admin auth.
//
// Usage:
//   import { verifyAdminToken } from './_admin-auth.js';
//
//   export default async function handler(req, res) {
//     const valid = await verifyAdminToken(req.headers['x-admin-token']);
//     if (!valid) return res.status(401).json({ error: 'Unauthorized' });
//     // ... handler logic ...
//   }

export async function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [prefix, expiresStr, signature] = parts;
  if (prefix !== 'admin') return false;

  const expiresAt = parseInt(expiresStr, 10);
  if (!expiresAt || Date.now() > expiresAt) return false;

  const tokenSecret = process.env.ADMIN_TOKEN_SECRET;
  if (!tokenSecret) return false;

  const payload = `${prefix}.${expiresStr}`;
  const expectedSig = await hmacSign(payload, tokenSecret);

  return safeCompare(signature, expectedSig);
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSign(message, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, msgData);
  return Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
