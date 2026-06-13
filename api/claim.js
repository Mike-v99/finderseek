// api/claim.js — Server-side PIN verification and winner assignment.
//
// This endpoint is the ONLY place a win can be judged. The finder_code
// column is revoked from browser-facing roles, so the PIN never leaves
// the server. Modes:
//
//   POST { huntId, code }                  → verify PIN (+ claim if signed in)
//   POST { huntId, mode: 'creator-code' }  → quest creator retrieves their PIN
//
// Auth: Authorization: Bearer <supabase user token> (optional for verify,
// required to actually claim or to read the creator code).

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY; // service role — bypasses RLS

const SVC_HEADERS = {
  'apikey': KEY,
  'Authorization': `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function sbGet(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: SVC_HEADERS });
  if (!r.ok) throw new Error(`Supabase GET ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SB}/auth/v1/user`, {
      headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch (e) { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SB || !KEY) return res.status(503).json({ error: 'Server not configured' });

  const { huntId, code, mode } = req.body || {};
  if (!huntId) return res.status(400).json({ error: 'Missing huntId' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;

  try {
    // ── Creator retrieving their own quest's PIN (for the funded modal) ──
    if (mode === 'creator-code') {
      const user = await getUserFromToken(token);
      if (!user) return res.status(401).json({ error: 'Sign in required' });
      const hunts = await sbGet(`hunts?id=eq.${encodeURIComponent(huntId)}&select=pirate_id,finder_code`);
      const hunt = hunts && hunts[0];
      if (!hunt) return res.status(404).json({ error: 'Quest not found' });
      if (hunt.pirate_id !== user.id) return res.status(403).json({ error: 'Not your quest' });
      return res.status(200).json({ ok: true, code: hunt.finder_code });
    }

    // ── Verify / claim ──
    if (!code || !/^\d{6}$/.test(String(code))) {
      return res.status(400).json({ ok: false, reason: 'bad_format', error: 'Enter all 6 digits' });
    }

    // Rate limit: max 8 wrong attempts per hunt+IP per 10 minutes
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    try {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const attempts = await sbGet(
        `claim_attempts?hunt_id=eq.${encodeURIComponent(huntId)}&ip=eq.${encodeURIComponent(ip)}&created_at=gte.${since}&select=id`
      );
      if (Array.isArray(attempts) && attempts.length >= 8) {
        return res.status(429).json({ ok: false, reason: 'rate_limited', error: 'Too many attempts — wait a few minutes and try again.' });
      }
    } catch (e) { console.warn('[claim] rate-limit check failed (continuing):', e.message); }

    const hunts = await sbGet(
      `hunts?id=eq.${encodeURIComponent(huntId)}&select=id,finder_code,status,starts_at,ends_at,winner_id,pirate_id,prize_value,quest_id,found_at`
    );
    const hunt = hunts && hunts[0];
    if (!hunt) return res.status(404).json({ ok: false, reason: 'not_found', error: 'Quest not found' });

    const now = Date.now();

    // Not started yet (scheduled, or start time in the future)
    if (hunt.status === 'scheduled' || (hunt.starts_at && new Date(hunt.starts_at).getTime() > now)) {
      return res.status(200).json({ ok: false, reason: 'not_started', startsAt: hunt.starts_at });
    }
    // Already won
    if (hunt.winner_id) {
      const user = await getUserFromToken(token);
      if (user && user.id === hunt.winner_id) {
        return res.status(200).json({ ok: true, claimed: true, already: true, userId: user.id });
      }
      return res.status(200).json({ ok: false, reason: 'already_claimed', error: 'This prize has already been claimed.' });
    }
    // Found-pending: quest ended because PIN was entered, but winner hasn't
    // signed in yet. Allow the finder to come back and complete the claim.
    const isFoundPending = hunt.status === 'ended' && !hunt.winner_id && !!hunt.found_at;

    // Ended / not active (but not found-pending — those can still be claimed)
    if (!isFoundPending && (hunt.status !== 'active' || (hunt.ends_at && new Date(hunt.ends_at).getTime() < now))) {
      return res.status(200).json({ ok: false, reason: 'ended', error: 'This quest has ended.' });
    }

    // ── PIN check (server-side, constant-ish response time) ──
    if (String(code) !== String(hunt.finder_code)) {
      // Log the failed attempt for rate limiting; small delay to slow brute force
      try {
        await fetch(`${SB}/rest/v1/claim_attempts`, {
          method: 'POST', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ hunt_id: huntId, ip }),
        });
      } catch (e) {}
      await sleep(400);
      return res.status(200).json({ ok: false, reason: 'wrong_code' });
    }

    // ── PIN correct ──
    const user = await getUserFromToken(token);

    if (!user) {
      // PIN correct but not signed in. The UI gates sign-in before PIN entry,
      // so this path should not normally be reached. Don't modify the quest —
      // just tell the client to sign in first.
      return res.status(200).json({ ok: false, reason: 'signin_required', error: 'Sign in to claim this prize.' });
    }

    if (user.id === hunt.pirate_id) {
      return res.status(403).json({ ok: false, reason: 'creator', error: "You can't win your own quest!" });
    }

    // Atomic claim: works for both active quests (normal) and found-pending
    // quests (delayed sign-in). The winner_id=is.null guard prevents races.
    const claimStatus = isFoundPending ? 'ended' : 'active';
    const patchRes = await fetch(
      `${SB}/rest/v1/hunts?id=eq.${encodeURIComponent(huntId)}&winner_id=is.null&status=eq.${claimStatus}`,
      {
        method: 'PATCH',
        headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify({ winner_id: user.id, found_at: hunt.found_at || new Date().toISOString(), status: 'ended' }),
      }
    );
    const patched = patchRes.ok ? await patchRes.json() : [];
    if (!Array.isArray(patched) || patched.length === 0) {
      // Race lost — someone claimed between our read and write
      return res.status(200).json({ ok: false, reason: 'already_claimed', error: 'This prize has already been claimed.' });
    }

    // Record the find (analytics / seeker count)
    try {
      await fetch(`${SB}/rest/v1/find_reports`, {
        method: 'POST', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ hunt_id: huntId, user_id: user.id, found_at: new Date().toISOString() }),
      });
    } catch (e) { console.warn('[claim] find_report insert failed:', e.message); }

    console.log('[claim] ✓ Winner set:', user.id, 'hunt:', huntId, hunt.quest_id || '');
    return res.status(200).json({ ok: true, claimed: true, userId: user.id });

  } catch (e) {
    console.error('[claim] Error:', e);
    return res.status(500).json({ ok: false, error: 'Something went wrong — try again.' });
  }
}
