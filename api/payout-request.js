// api/payout-request.js
// Handles winner payout via PayPal Payouts API (supports PayPal + Venmo)
// Falls back to email notification if PayPal Payouts fails or isn't configured
//
// Env vars needed:
//   PAYPAL_CLIENT_ID       — from developer.paypal.com app credentials
//   PAYPAL_CLIENT_SECRET   — from developer.paypal.com app credentials
//   PAYPAL_MODE            — 'sandbox' or 'live' (defaults to 'live')
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   RESEND_API_KEY
//   FINDERSEEK_NOTIFY_SECRET or NOTIFY_SECRET

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Send email via Resend using fetch (no SDK dependency)
async function sendEmail({ from, to, subject, html }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Resend error: ${r.status} ${err}`);
  }
  return r.json();
}

// ── PayPal OAuth2 access token ───────────────────────────
async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const mode = (process.env.PAYPAL_MODE || 'live').toLowerCase();
  const baseUrl = mode === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal auth failed: ${res.status} ${err}`);
  }

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
    const { data: hunt, error: huntErr } = await supabase
      .from('hunts')
      .select('id, title, prize_value, quest_id, status, payout_status, winner_id, payment_type, pirate_id, lat, lng')
      .eq('id', huntId)
      .single();

    if (huntErr || !hunt) {
      console.error('[payout-request] Hunt fetch error:', huntErr?.message, 'huntId:', huntId);
      return res.status(404).json({ error: 'Hunt not found', detail: huntErr?.message });
    }
    // Block quest creator from winning their own quest
    if (winnerId && hunt.pirate_id && winnerId === hunt.pirate_id) {
      return res.status(403).json({ error: 'Quest creators cannot claim their own prize.' });
    }

    // Duplicate claim guard — if already processing/sent, block double-payout
    if (hunt.status === 'ended' || hunt.payout_status === 'processing' || hunt.payout_status === 'sent') {
      return res.status(409).json({ error: 'This prize has already been claimed.', alreadyClaimed: true });
    }

    const { data: winner, error: winnerErr } = await supabase
      .from('profiles')
      .select('username, email')
      .eq('id', winnerId)
      .single();

    console.log('[payout-request] winner:', winner?.username, 'winnerErr:', winnerErr?.message);

    const prizeAmount = amount || (hunt.prize_value / 100).toFixed(2);
    const methodLabel = method === 'paypal' ? 'PayPal' : method === 'venmo' ? 'Venmo' : 'PayPal';

    console.log('[payout-request] Updating hunt status to ended...');
    // Mark hunt as processing
    const { error: updateErr } = await supabase.from('hunts').update({
      winner_id: winnerId,
      payout_method: method,
      payout_destination: destination,
      payout_status: 'processing',
      status: 'ended',
    }).eq('id', huntId);

    if (updateErr) {
      console.error('[payout-request] Hunt update error:', updateErr.message);
      return res.status(500).json({ error: 'Failed to update hunt: ' + updateErr.message });
    }
    console.log('[payout-request] Hunt updated OK');

    // ── Try PayPal Payouts API ────────────────────────────────
    let paypalSuccess = false;
    let paypalBatchId = null;

    if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
      try {
        const { token, baseUrl } = await getPayPalAccessToken();
        const senderBatchId = `finderseek_${huntId.replace(/-/g, '').slice(0, 16)}_${Date.now()}`;

        // Build payout item — PayPal uses EMAIL, Venmo uses PHONE
        const isVenmo = method === 'venmo';
        const payoutItem = {
          amount: { value: prizeAmount, currency: 'USD' },
          sender_item_id: `fs_${huntId.slice(0, 8)}`,
          note: `You won $${prizeAmount} on FinderSeek${hunt.quest_id ? ' (Quest ' + hunt.quest_id + ')' : ''}! Congrats!`,
          recipient_type: isVenmo ? 'PHONE' : 'EMAIL',
          receiver: destination,
          recipient_wallet: isVenmo ? 'VENMO' : 'PAYPAL',
        };

        const payoutBody = {
          sender_batch_header: {
            sender_batch_id: senderBatchId,
            email_subject: `You won $${prizeAmount} on FinderSeek!`,
            email_message: `Congratulations! You found the treasure and won $${prizeAmount}. The funds are on their way to your ${methodLabel} account.`,
          },
          items: [payoutItem],
        };

        const payoutRes = await fetch(`${baseUrl}/v1/payments/payouts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payoutBody),
        });

        const payoutData = await payoutRes.json();

        if (payoutRes.ok && payoutData.batch_header?.payout_batch_id) {
          paypalSuccess = true;
          paypalBatchId = payoutData.batch_header.payout_batch_id;

          await supabase.from('hunts').update({
            payout_status: 'sent',
            payout_order_id: paypalBatchId,
          }).eq('id', huntId);

          console.log(`[payout] ✓ PayPal ${methodLabel} $${prizeAmount} → ${destination} batch:${paypalBatchId}`);
        } else {
          console.error('[payout] PayPal Payouts failed:', JSON.stringify(payoutData));
        }
      } catch (e) {
        console.error('[payout] PayPal error:', e.message);
      }
    }

    // ── Email notification (always sent) ─────────────────────
    // Deep links pre-fill recipient + amount — one tap to send
    const note = encodeURIComponent('FinderSeek prize' + (hunt.quest_id ? ' - Quest ' + hunt.quest_id : ''));
    const paypalSendUrl = method === 'venmo'
      ? `https://venmo.com/?txn=pay&audience=private&recipients=${encodeURIComponent(destination)}&amount=${prizeAmount}&note=${note}`
      : `https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=${encodeURIComponent(destination)}&amount=${prizeAmount}&currency_code=USD&item_name=${note}&no_shipping=1&no_note=1`;
    // PayPal app deep link (opens app directly on mobile)
    const paypalAppUrl = `paypal://paypalme/send?email=${encodeURIComponent(destination)}&amount=${prizeAmount}&currencyCode=USD`;

    try {
      await sendEmail({
        from: 'FinderSeek <payments@finderseek.com>',
        to: 'payments@finderseek.com',
        subject: paypalSuccess
          ? `✅ Prize SENT — Quest ${hunt.quest_id || huntId.slice(0, 8)} — $${prizeAmount}`
          : `🚨 SEND $${prizeAmount} → ${destination} (${methodLabel})`,
        html: paypalSuccess
          ? `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
              <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:16px;padding:24px;text-align:center;">
                <div style="font-size:48px;margin-bottom:8px;">✅</div>
                <div style="font-size:24px;font-weight:700;color:#16a34a;margin-bottom:4px;">Prize Sent Automatically</div>
                <div style="font-size:32px;font-weight:700;color:#15803d;">$${prizeAmount}</div>
                <div style="font-size:16px;color:#666;margin-top:8px;">${methodLabel} → ${destination}</div>
                <div style="font-size:13px;color:#999;margin-top:4px;">Batch: ${paypalBatchId}</div>
              </div>
              <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px;">
                <tr><td style="padding:6px 0;color:#888;">Quest</td><td style="padding:6px 0;">${hunt.quest_id || '—'}</td></tr>
                <tr><td style="padding:6px 0;color:#888;">Winner</td><td style="padding:6px 0;">${winner?.username || winnerId}</td></tr>
              </table>
            </div>`
          : `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:20px;">

              <!-- Header -->
              <div style="background:#0a0810;border-radius:16px;padding:20px 24px;text-align:center;margin-bottom:12px;border:2px solid #e8a820;">
                <div style="font-size:13px;color:#e8a820;letter-spacing:2px;margin-bottom:6px;">ACTION REQUIRED · FINDERSEEK</div>
                <div style="font-size:42px;font-weight:700;color:#fff;">$${prizeAmount}</div>
                <div style="font-size:15px;color:rgba(255,255,255,.5);margin-top:4px;">Quest ${hunt.quest_id || huntId.slice(0,8)} · Won by ${winner?.username || 'winner'}</div>
              </div>

              <!-- Step 1: One-tap send button (pre-filled) -->
              <div style="margin-bottom:10px;">
                <div style="font-size:11px;color:#888;letter-spacing:1px;margin-bottom:6px;">STEP 1 — TAP TO OPEN ${methodLabel.toUpperCase()} PRE-FILLED</div>
                <a href="${paypalSendUrl}" style="display:block;background:${method === 'venmo' ? '#008CFF' : '#0070e0'};color:#fff;text-align:center;padding:18px 24px;border-radius:14px;font-size:19px;font-weight:700;text-decoration:none;">
                  ${method === 'venmo' ? '💙 Open Venmo · Send $' + prizeAmount : '🅿 Open PayPal · Send $' + prizeAmount}
                </a>
              </div>

              <!-- Step 2: Recipient clearly shown for manual fallback -->
              <div style="background:#f8f9fa;border:1.5px solid #e5e7eb;border-radius:14px;padding:16px 20px;margin-bottom:10px;">
                <div style="font-size:11px;color:#888;letter-spacing:1px;margin-bottom:8px;">STEP 2 — RECIPIENT (if link doesn't pre-fill)</div>
                <div style="font-size:26px;font-weight:600;color:#111;word-break:break-all;">${destination}</div>
                <div style="font-size:12px;color:#aaa;margin-top:4px;">Tap and hold to copy · Send via ${methodLabel}</div>
              </div>

              <!-- Confirm done button (mailto: to yourself as a receipt) -->
              <a href="mailto:payments@finderseek.com?subject=PAID%20-%20Quest%20${encodeURIComponent(hunt.quest_id || huntId.slice(0,8))}&body=Sent%20%24${prizeAmount}%20to%20${encodeURIComponent(destination)}%20via%20${encodeURIComponent(methodLabel)}" style="display:block;background:#15803d;color:#fff;text-align:center;padding:14px;border-radius:12px;font-size:16px;font-weight:600;text-decoration:none;margin-bottom:12px;">
                ✅ Tap here after sending (sends receipt to yourself)
              </a>

              <!-- Details -->
              <div style="font-size:12px;color:#bbb;text-align:center;padding:0 8px;">
                Winner has been told prize is on the way · Quest ${hunt.quest_id || '—'} · Hunt ID: ${huntId.slice(0,8)}
              </div>

            </div>`
      });
    } catch (e) { console.warn('[payout] Email failed:', e.message); }

    // Trigger prize_claimed notification (emails quest master + winner)
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
