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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-finderseek-secret, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.FINDERSEEK_NOTIFY_SECRET && secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { huntId, winnerId, method, destination, amount } = req.body;
  if (!huntId || !winnerId || !destination) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Fetch hunt
    const hunt = await sbGet('hunts', `id=eq.${huntId}&select=id,title,prize_value,quest_id,status,payout_status,winner_id,payment_type,pirate_id`);
    if (!hunt) { console.error('[payout] Hunt not found:', huntId); return res.status(404).json({ error: 'Hunt not found' }); }

    // Block creator from winning own quest
    if (winnerId && hunt.pirate_id && winnerId === hunt.pirate_id) {
      return res.status(403).json({ error: 'Quest creators cannot claim their own prize.' });
    }

    // Duplicate claim guard
    if (hunt.payout_status === 'processing' || hunt.payout_status === 'sent') {
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
    const note = encodeURIComponent('FinderSeek prize' + (hunt.quest_id ? ' - Quest ' + hunt.quest_id : ''));
    const paypalSendUrl = `https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=${encodeURIComponent(destination)}&amount=${prizeAmount}&currency_code=USD&item_name=${note}&no_shipping=1`;

    try {
      await sendEmail({
        from: 'FinderSeek <payments@finderseek.com>',
        to: 'payments@finderseek.com',
        subject: paypalSuccess
          ? `✅ Prize SENT — Quest ${hunt.quest_id || huntId.slice(0,8)} — $${prizeAmount}`
          : `🚨 SEND $${prizeAmount} → ${destination} (${methodLabel})`,
        html: paypalSuccess
          ? `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;"><div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:16px;padding:24px;text-align:center;"><div style="font-size:48px;">✅</div><div style="font-size:24px;font-weight:700;color:#16a34a;">Prize Sent Automatically</div><div style="font-size:32px;font-weight:700;color:#15803d;">$${prizeAmount}</div><div style="font-size:16px;color:#666;">${methodLabel} → ${destination}</div><div style="font-size:13px;color:#999;">Batch: ${paypalBatchId}</div></div><p style="margin-top:16px;font-size:14px;color:#666;">Winner: ${winner?.username || winnerId} · Quest: ${hunt.quest_id || '—'}</p></div>`
          : `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;">
              <div style="background:#003087;padding:16px;text-align:center;">` + '<svg width="80" height="22" viewBox="0 0 124 33" xmlns="http://www.w3.org/2000/svg"><path d="M46.211 6.749h-6.839a.95.95 0 0 0-.939.802l-2.766 17.537a.57.57 0 0 0 .564.658h3.265a.95.95 0 0 0 .939-.803l.746-4.73a.95.95 0 0 1 .938-.803h2.165c4.505 0 7.105-2.18 7.784-6.5.306-1.89.013-3.375-.872-4.415-.972-1.142-2.696-1.746-4.985-1.746zM47 13.154c-.374 2.454-2.249 2.454-4.062 2.454h-1.032l.724-4.583a.57.57 0 0 1 .563-.481h.473c1.235 0 2.4 0 3.002.704.359.42.469 1.044.332 1.906z" fill="white"/><path d="M94.992 6.749h-6.84a.95.95 0 0 0-.938.802l-2.766 17.537a.569.569 0 0 0 .562.658h3.51a.665.665 0 0 0 .656-.562l.785-4.971a.95.95 0 0 1 .938-.803h2.164c4.506 0 7.105-2.18 7.785-6.5.307-1.89.012-3.375-.873-4.415-.971-1.142-2.694-1.746-4.983-1.746zm.789 6.405c-.373 2.454-2.248 2.454-4.062 2.454h-1.031l.725-4.583a.568.568 0 0 1 .562-.481h.473c1.234 0 2.4 0 3.002.704.359.42.468 1.044.331 1.906z" fill="#009CDE"/><path d="M7.266 29.154l.523-3.322-1.165-.027H1.061L4.927 1.292a.316.316 0 0 1 .314-.268h9.38c3.114 0 5.263.648 6.385 1.927.526.6.861 1.227 1.023 1.917.17.724.173 1.589.007 2.644l-.012.077v.676l.526.298a3.69 3.69 0 0 1 1.065.812c.45.513.741 1.165.864 1.938.127.795.085 1.741-.123 2.812-.24 1.232-.628 2.305-1.152 3.183a6.547 6.547 0 0 1-1.825 2.025 7.435 7.435 0 0 1-2.457 1.109 11.627 11.627 0 0 1-3.085.368h-.733a2.219 2.219 0 0 0-2.196 1.875l-.055.301-.924 5.855-.042.215c-.011.068-.03.102-.058.125a.155.155 0 0 1-.096.035H7.266z" fill="white"/></svg>' + `</div>
              <div style="padding:20px;">
                <div style="font-size:18px;font-weight:600;color:#111;margin-bottom:6px;">Someone won your quest! 🎉</div>
                <div style="font-size:14px;color:#666;margin-bottom:16px;">Quest ${hunt.quest_id || huntId.slice(0,8)} has been claimed. Send the prize when ready.</div>
                <div style="background:#f8f9fa;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
                  <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                    <span style="font-size:13px;color:#888;">Winner PayPal</span>
                    <span style="font-size:13px;color:#111;font-weight:500;">${destination}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;">
                    <span style="font-size:13px;color:#888;">Amount to send</span>
                    <span style="font-size:13px;color:#16a34a;font-weight:600;">$${prizeAmount}</span>
                  </div>
                </div>
                <a href="${paypalSendUrl}" style="display:block;background:#003087;color:#fff;text-align:center;padding:14px;border-radius:10px;font-size:15px;font-weight:600;text-decoration:none;margin-bottom:8px;">Send $${prizeAmount} via PayPal →</a>
                <div style="font-size:12px;color:#888;text-align:center;line-height:1.5;">Opens PayPal pre-filled with the recipient and amount. Just confirm and send.</div>
              </div>
            </div>`
      });
      console.log('[payout] Email sent to payments@finderseek.com');
    } catch (e) { console.warn('[payout] Email failed:', e.message); }

    // ── Notify quest master + winner ──
    try {
      const notifySecret = process.env.NOTIFY_SECRET || process.env.FINDERSEEK_NOTIFY_SECRET;
      if (notifySecret) {
        await fetch('https://www.finderseek.com/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-finderseek-secret': notifySecret },
          body: JSON.stringify({ event: 'prize_claimed', huntId })
        });
      }
    } catch (e) { console.warn('[payout] Notify failed:', e.message); }

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
    return res.status(500).json({ error: err.message });
  }
}
