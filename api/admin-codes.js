// api/admin-codes.js
// Returns finder_code (the prize-claim PIN) for every hunt, keyed by hunt id.
//
// WHY THIS EXISTS:
//   finder_code is revoked from the anon/authenticated Postgres roles (column-level
//   lockdown) so it can never leak to the app or website. The admin panel reads data
//   with the anon key, so it cannot see finder_code directly. This endpoint reads it
//   with the Supabase SERVICE ROLE key (which bypasses the lockdown) — but only after
//   verifying the caller holds a valid admin token: the exact same HMAC token issued
//   by /api/admin-login and signed with ADMIN_TOKEN_SECRET.
//
// Env vars needed:
//   ADMIN_TOKEN_SECRET          — same secret /api/admin-login signs with
//   SUPABASE_SERVICE_ROLE_KEY   — Supabase service role key (bypasses RLS + grants)
//        (also accepts SUPABASE_SERVICE_KEY or SERVICE_ROLE_KEY if that's your name)

const SB_URL = 'https://qeiuycuasjkopxfkmggp.supabase.co';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Verify the admin token (same scheme as /api/admin-login) ──
  const token = req.headers['x-admin-token'] || '';
  const tokenSecret = process.env.ADMIN_TOKEN_SECRET;
  if (!tokenSecret) {
    console.error('[admin-codes] Missing ADMIN_TOKEN_SECRET env var');
    return res.status(500).json({ error: 'Server not configured' });
  }
  const ok = await verifyAdminToken(token, tokenSecret);
  if (!ok) return res.status(401).json({ error: 'Unauthorized' });

  // ── 2. Read finder_code with the service role key ──
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || process.env.SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('[admin-codes] Missing service role key env var (looked for SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY / SERVICE_ROLE_KEY)');
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    const r = await fetch(SB_URL + '/rest/v1/hunts?select=id,finder_code', {
      headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey }
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('[admin-codes] Supabase read failed:', r.status, txt);
      return res.status(502).json({ error: 'Database read failed' });
    }
    const rows = await r.json();
    const codes = {};
    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (row && row.id) codes[row.id] = row.finder_code || '';
    });
    return res.status(200).json({ codes });
  } catch (e) {
    console.error('[admin-codes] error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// Verify a token of the form  admin.<expiresAt>.<hexHmac>  signed with ADMIN_TOKEN_SECRET.
// Mirrors the signing in /api/admin-login exactly.
async function verifyAdminToken(token, secret) {
  try {
    if (typeof token !== 'string' || !token) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const prefix = parts[0], expiresAtStr = parts[1], signature = parts[2];
    if (prefix !== 'admin') return false;
    const expiresAt = parseInt(expiresAtStr, 10);
    if (!expiresAt || Date.now() >= expiresAt) return false; // expired or invalid
    const payload = 'admin.' + expiresAtStr;
    const expected = await hmacSign(payload, secret);
    return safeCompare(signature, expected);
  } catch (e) {
    return false;
  }
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSign(message, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
