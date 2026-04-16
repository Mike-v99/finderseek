// api/admin-login.js
// Validates admin password against server-side env var and returns a signed token.
// The token is an HMAC-signed payload the admin panel sends on subsequent requests.
//
// Env vars needed:
//   ADMIN_PASSWORD       — the actual admin password (set in Vercel)
//   ADMIN_TOKEN_SECRET   — secret used to sign tokens (generate a random 32+ char string)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Missing password' });

  const expected = process.env.ADMIN_PASSWORD;
  const tokenSecret = process.env.ADMIN_TOKEN_SECRET;

  if (!expected || !tokenSecret) {
    console.error('[admin-login] Missing ADMIN_PASSWORD or ADMIN_TOKEN_SECRET env var');
    return res.status(500).json({ error: 'Server not configured' });
  }

  // Constant-time comparison to prevent timing attacks
  if (!safeCompare(password, expected)) {
    // Slight delay on failure to slow down brute-force attempts
    await new Promise(r => setTimeout(r, 500));
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Create a signed token valid for 24 hours
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const payload = `admin.${expiresAt}`;
  const signature = await hmacSign(payload, tokenSecret);
  const token = `${payload}.${signature}`;

  return res.status(200).json({
    token,
    expiresAt,
    expiresIn: 24 * 60 * 60,
  });
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
