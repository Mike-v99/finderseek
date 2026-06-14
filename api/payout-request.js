// api/payout-request.js
// Handles winner payout via PayPal Payouts API (supports PayPal + Venmo)
// Falls back to email notification if PayPal Payouts fails or isn't configured
//
// Env vars needed:
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   RESEND_API_KEY
//   FINDERSEEK_NOTIFY_SECRET or NOTIFY_SECRET

// ── Supabase REST helpers (no SDK — avoids WebSocket crash on Node 20) ──
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(table, filter) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
  });
  const d = await r.json();
  return Array.isArray(d) ? (d[0] || null) : d;
}

async function sbPatch(table, filter, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`DB update failed: ${e}`); }
}

// ── Resend email via fetch (no SDK) ──
async function sendEmail({ from, to, subject, html }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`Resend error: ${r.status} ${e}`); }
  return r.json();
}

// ── PayPal OAuth2 token ──
async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const mode = (process.env.PAYPAL_MODE || 'live').toLowerCase();
  const baseUrl = mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data = await res.json();
  return { token: data.access_token, baseUrl };
}

// Verify a Supabase user access token (same pattern as api/claim.js).
async function getUserFromToken(token) {
  if (!token || !SB_URL || !SB_KEY) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch (e) { return null; }
}

// ── Audit log: one row per payout decision. Fire-and-forget — a logging
// failure must NEVER block or break a payout. Writes to the payout_audit
// table (see the CREATE TABLE in the deploy notes). Columns are text-typed
// so even a malformed/attacker-supplied value is always recorded.
async function logPayoutAudit(row) {
  try {
    if (!SB_URL || !SB_KEY) return;
    await fetch(`${SB_URL}/rest/v1/payout_audit`, {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(row),
    });
  } catch (e) { console.warn('[payout] audit log failed:', e.message); }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-finderseek-secret, x-admin-token, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Client IP for the audit trail (same derivation as api/claim.js)
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

  // ── Identify the caller (this does NOT authorize the payout yet) ──
  // Authorization is decided AFTER the hunt loads, because every proof below is
  // checked against the hunt's OWN winner_id / finder_code — never against a
  // value supplied in the request body.
  const secret = req.headers['x-finderseek-secret'];
  const secretOk = !!secret && (secret === process.env.FINDERSEEK_NOTIFY_SECRET || secret === process.env.NOTIFY_SECRET);
  let authedUser = null;
  if (!secretOk) {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
    authedUser = await getUserFromToken(bearer);
  }

  // winnerId from the body is UNTRUSTED — knowing a UUID must never pay anyone.
  // It is honored only for env-secret (admin/cron) callers; everyone else is
  // paid out to the hunt's recorded winner_id.
  let { huntId, winnerId: bodyWinnerId, method, destination, amount, claimCode } = req.body;
  if (!huntId || !destination) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let proofType = 'unknown'; // 'secret' | 'jwt' | 'pin' | 'rejected' — set after auth

  try {
    // Fetch hunt — the source of truth for winner_id and finder_code
    const hunt = await sbGet('hunts', `id=eq.${huntId}&select=id,finder_code,prize_value,quest_id,status,payout_status,winner_id,payment_type,pirate_id`);
    if (!hunt || !hunt.id) { console.error('[payout] Hunt not found:', huntId, hunt); return res.status(404).json({ error: 'Hunt not found' }); }

    // ── Authorization: require ONE independent proof, all checked vs. the DB ──
    //   secretOk : trusted internal/admin/cron caller (env secret header)
    //   jwtOk    : the actual winner is signed in (token user === hunt.winner_id)
    //   pinOk    : caller proved physical possession of the envelope's PIN
    // The body winnerId is NOT a proof and cannot satisfy any of these.
    const jwtOk = !!(authedUser && hunt.winner_id && authedUser.id === hunt.winner_id);
    const pinOk = !!(claimCode && hunt.finder_code && String(claimCode) === String(hunt.finder_code) && hunt.winner_id);
    proofType = secretOk ? 'secret' : jwtOk ? 'jwt' : pinOk ? 'pin' : 'rejected';

    if (!secretOk && !jwtOk && !pinOk) {
      console.warn('[payout] Rejected: no valid proof. hunt.winner_id=', hunt.winner_id, 'token=', authedUser && authedUser.id, 'pinSent=', !!claimCode);
      await logPayoutAudit({
        hunt_id: String(huntId), quest_id: hunt.quest_id || null,
        winner_id: bodyWinnerId ? String(bodyWinnerId) : null, // the UUID that was *attempted*
        proof_type: 'rejected', outcome: 'rejected',
        destination: destination ? String(destination) : null,
        amount: amount ? String(amount) : null, method: method || null, ip,
      });
      return res.status(403).json({ error: 'Winner not verified for this quest. Claim the prize in the app first.' });
    }

    // Resolve the trusted recipient. Non-admin callers are ALWAYS paid to the
    // recorded winner; only env-secret tooling may name a specific winnerId.
    const winnerId = secretOk ? (bodyWinnerId || hunt.winner_id) : hunt.winner_id;
    if (!winnerId) {
      await logPayoutAudit({ hunt_id: String(huntId), quest_id: hunt.quest_id || null, proof_type: proofType, outcome: 'no_winner', destination: String(destination), amount: amount ? String(amount) : null, method: method || null, ip });
      return res.status(409).json({ error: 'No winner recorded for this quest yet. Claim the prize first.' });
    }

    // Block creator from being paid for their own quest (defense in depth)
    if (hunt.pirate_id && winnerId === hunt.pirate_id) {
      return res.status(403).json({ error: 'Quest creators cannot claim their own prize.' });
    }

    // Duplicate claim guard
    if (hunt.payout_status === 'processing' || hunt.payout_status === 'sent') {
      await logPayoutAudit({ hunt_id: String(huntId), quest_id: hunt.quest_id || null, winner_id: String(winnerId), proof_type: proofType, outcome: 'duplicate', destination: String(destination), amount: amount ? String(amount) : null, method: method || null, ip });
      return res.status(409).json({ error: 'This prize has already been claimed.', alreadyClaimed: true });
    }

    // Fetch winner profile
    const winner = await sbGet('profiles', `id=eq.${winnerId}&select=username,email`);
    console.log('[payout] winner:', winner?.username, 'method:', method, 'dest:', destination);

    const prizeAmount = amount || (hunt.prize_value / 100).toFixed(2);
    const methodLabel = method === 'venmo' ? 'Venmo' : 'PayPal';

    // Mark hunt as processing — only set winner_id if it's a valid UUID
    const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(winnerId);
    await sbPatch('hunts', `id=eq.${huntId}`, {
      ...(isValidUuid ? { winner_id: winnerId } : {}),
      payout_method: method,
      payout_destination: destination,
      payout_status: 'processing',
      status: 'ended',
    });
    console.log('[payout] Hunt marked ended');

    // ── Try PayPal Payouts API ──
    let paypalSuccess = false;
    let paypalBatchId = null;

    if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
      try {
        const { token, baseUrl } = await getPayPalAccessToken();
        const senderBatchId = `fs_${huntId.replace(/-/g,'').slice(0,16)}_${Date.now()}`;
        const isVenmo = method === 'venmo';
        const payoutBody = {
          sender_batch_header: {
            sender_batch_id: senderBatchId,
            email_subject: `You won $${prizeAmount} on FinderSeek!`,
            email_message: `Congratulations! You found the treasure and won $${prizeAmount}.`,
          },
          items: [{
            amount: { value: prizeAmount, currency: 'USD' },
            sender_item_id: `fs_${huntId.slice(0,8)}`,
            note: `FinderSeek prize${hunt.quest_id ? ' - Quest ' + hunt.quest_id : ''}`,
            recipient_type: isVenmo ? 'PHONE' : 'EMAIL',
            receiver: destination,
            recipient_wallet: isVenmo ? 'VENMO' : 'PAYPAL',
          }],
        };
        const payoutRes = await fetch(`${baseUrl}/v1/payments/payouts`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payoutBody),
        });
        const payoutData = await payoutRes.json();
        if (payoutRes.ok && payoutData.batch_header?.payout_batch_id) {
          paypalSuccess = true;
          paypalBatchId = payoutData.batch_header.payout_batch_id;
          await sbPatch('hunts', `id=eq.${huntId}`, { payout_status: 'sent', payout_order_id: paypalBatchId });
          console.log('[payout] PayPal sent:', paypalBatchId);
        } else {
          console.error('[payout] PayPal failed:', JSON.stringify(payoutData));
        }
      } catch (e) { console.error('[payout] PayPal error:', e.message); }
    }

    // ── Manual payout email ──

    try {
      await sendEmail({
        from: 'FinderSeek <payments@finderseek.com>',
        // Ops alert recipient — payments@ has no mailbox, so default to a real
        // inbox. Override with PAYOUT_ALERT_EMAIL env var in Vercel if desired.
        to: process.env.PAYOUT_ALERT_EMAIL || 'payments@finderseek.com',
        subject: paypalSuccess
          ? `✅ Prize SENT — Quest ${hunt.quest_id || huntId.slice(0,8)} — $${prizeAmount}`
          : `🚨 SEND $${prizeAmount} → ${destination} (${methodLabel})`,
        html: paypalSuccess
          ? `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="color-scheme" content="light"/><meta name="supported-color-schemes" content="light"/></head>
            <body style="margin:0;padding:0;background:#ffffff;"><div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;background:#ffffff;padding:24px 20px;color:#1a1a1a;">
              <div style="font-size:22px;font-weight:800;color:#1a1a1a;">Finder<span style="font-style:italic;color:#c9890c;">Seek</span></div>
              <div style="height:1px;background:#ececec;margin:14px 0 22px;font-size:0;line-height:0;">&nbsp;</div>
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:24px;text-align:center;">
                <div style="font-size:44px;">&#9989;</div>
                <div style="font-size:22px;font-weight:800;color:#15803d;margin-top:4px;">Prize Sent Automatically</div>
                <div style="font-size:30px;font-weight:800;color:#111111;margin:6px 0;">$${prizeAmount}</div>
                <div style="font-size:15px;color:#444444;">${methodLabel} &rarr; ${destination}</div>
                <div style="font-size:12px;color:#888888;margin-top:6px;">Batch: ${paypalBatchId}</div>
              </div>
              <p style="margin-top:18px;font-size:14px;color:#444444;">Winner: ${winner?.username || winnerId} &middot; Quest: ${hunt.quest_id || '\u2014'}</p>
            </div></body></html>`
          : `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="color-scheme" content="light"/><meta name="supported-color-schemes" content="light"/></head>
            <body style="margin:0;padding:0;background:#ffffff;"><div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;background:#ffffff;padding:24px 20px;color:#1a1a1a;">
              <div style="font-size:22px;font-weight:800;color:#1a1a1a;">Finder<span style="font-style:italic;color:#c9890c;">Seek</span></div>
              <div style="height:1px;background:#ececec;margin:14px 0 22px;font-size:0;line-height:0;">&nbsp;</div>
              <div style="font-size:19px;font-weight:800;color:#111111;margin-bottom:6px;">Someone won your quest! &#127881;</div>
              <div style="font-size:14px;color:#444444;margin-bottom:18px;">Quest ${hunt.quest_id || huntId.slice(0,8)} has been claimed. Send the prize when ready.</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border:1px solid #e6e6e6;border-radius:10px;margin-bottom:16px;"><tr><td style="padding:14px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="font-size:13px;color:#777777;">Winner ${methodLabel}</td><td align="right" style="font-size:13px;color:#111111;font-weight:600;">${destination}</td></tr>
                  <tr><td style="font-size:13px;color:#777777;padding-top:8px;">Amount to send</td><td align="right" style="font-size:13px;color:#15803d;font-weight:700;padding-top:8px;">$${prizeAmount}</td></tr>
                </table>
              </td></tr></table>
              <div style="background:#fff8e1;border:1px solid #f0d264;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
                <div style="font-size:13px;font-weight:700;color:#7a5c00;margin-bottom:6px;">How to pay manually</div>
                <div style="font-size:13px;color:#444444;line-height:1.8;">
                  1. Open PayPal (app or paypal.com) and choose <strong style="color:#111111;">Send</strong><br/>
                  2. Paste the winner's ${methodLabel}: <span style="font-family:monospace;background:#ffffff;border:1px solid #dddddd;border-radius:6px;padding:2px 8px;color:#111111;">${destination}</span><br/>
                  3. Send <strong style="color:#111111;">$${prizeAmount} USD</strong> with note: FinderSeek prize${hunt.quest_id ? ' - Quest ' + hunt.quest_id : ''}
                </div>
              </div>
              <a href="https://www.paypal.com/myaccount/transfer/homepage/send" style="display:block;background:#003087;color:#ffffff;text-align:center;padding:14px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">Open PayPal Send Money &rarr;</a>
              <div style="font-size:12px;color:#888888;text-align:center;line-height:1.5;margin-top:8px;">Copy the winner's address above, then paste it in PayPal's Send flow.</div>
            </div></body></html>`
      });
      console.log('[payout] Ops alert emailed to', process.env.PAYOUT_ALERT_EMAIL || 'payments@finderseek.com');
    } catch (e) { console.warn('[payout] Email failed:', e.message); }

    // ── Notify quest master + winner ──
    try {
      const notifySecret = process.env.NOTIFY_SECRET || process.env.FINDERSEEK_NOTIFY_SECRET;
      if (notifySecret) {
        await fetch('https://www.finderseek.com/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-finderseek-secret': notifySecret },
          body: JSON.stringify({ event: 'prize_claimed', huntId, winnerEmail: destination })
        });
      }
    } catch (e) { console.warn('[payout] Notify failed:', e.message); }

    await logPayoutAudit({
      hunt_id: String(huntId), quest_id: hunt.quest_id || null, winner_id: String(winnerId),
      proof_type: proofType, outcome: paypalSuccess ? 'sent' : 'processing',
      destination: String(destination), amount: String(prizeAmount), method: method || 'paypal',
      batch_id: paypalBatchId || null, ip,
    });

    return res.status(200).json({
      success: true,
      automated: paypalSuccess,
      batchId: paypalBatchId,
      message: paypalSuccess
        ? `Your prize is on its way! Check your ${methodLabel} for $${prizeAmount}.`
        : `Prize request received! You'll receive your $${prizeAmount} within 24 hours.`
    });

  } catch (err) {
    console.error('[payout-request] Error:', err.message);
    await logPayoutAudit({ hunt_id: huntId ? String(huntId) : null, winner_id: bodyWinnerId ? String(bodyWinnerId) : null, proof_type: proofType, outcome: 'error', destination: destination ? String(destination) : null, amount: amount ? String(amount) : null, method: method || null, error_msg: String(err.message || err).slice(0, 300), ip });
    return res.status(500).json({ error: err.message });
  }
}
