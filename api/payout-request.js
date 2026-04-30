// api/payout-request.js
// Handles winner payout — calls Tremendous API automatically
// Falls back to email notification if Tremendous fails

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
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
    const { data: hunt } = await supabase
      .from('hunts')
      .select('id, title, prize_value, quest_id, status, escrow_status')
      .eq('id', huntId)
      .single();

    if (!hunt) return res.status(404).json({ error: 'Hunt not found' });

    const { data: winner } = await supabase
      .from('profiles')
      .select('username, email')
      .eq('id', winnerId)
      .single();

    const prizeAmount = amount || (hunt.prize_value / 100).toFixed(2);
    const methodLabel = method === 'paypal' ? 'PayPal' : method === 'venmo' ? 'Venmo' : 'Bank Transfer';

    await supabase.from('hunts').update({
      winner_id: winnerId,
      payout_method: method,
      payout_destination: destination,
      payout_status: 'processing',
      status: 'won',
    }).eq('id', huntId);

    // ── Try Tremendous ────────────────────────────────────────
    let tremendousSuccess = false;
    let tremendousOrderId = null;

    if (process.env.TREMENDOUS_API_KEY) {
      try {
        const apiKey = process.env.TREMENDOUS_API_KEY;
        const baseUrl = apiKey.startsWith('TEST_')
          ? 'https://testflight.tremendous.com/api/v2'
          : 'https://www.tremendous.com/api/v2';

        const fsRes = await fetch(`${baseUrl}/funding_sources`, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const fsData = await fsRes.json();
        const fs = fsData.funding_sources?.find(f => f.method === 'balance');
        const fundingSourceId = fs?.id || 'balance';

        const orderRes = await fetch(`${baseUrl}/orders`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payment: { funding_source_id: fundingSourceId },
            reward: {
              value: { denomination: parseFloat(prizeAmount), currency_code: 'USD' },
              delivery: { method: 'EMAIL', meta: { email: destination } },
              recipient: { email: destination, name: winner?.username || 'FinderSeek Winner' },
              message: `🏆 You won $${prizeAmount} on FinderSeek${hunt.quest_id ? ' (Quest ' + hunt.quest_id + ')' : ''}! Choose how you want your prize — PayPal, Venmo, bank transfer, and more.`,
            },
            external_id: `finderseek_${huntId}`,
          }),
        });

        const orderData = await orderRes.json();
        if (orderRes.ok && orderData.order?.id) {
          tremendousSuccess = true;
          tremendousOrderId = orderData.order.id;
          await supabase.from('hunts').update({ payout_status: 'sent' }).eq('id', huntId);
          console.log(`[payout] ✓ Tremendous $${prizeAmount} → ${destination} order:${tremendousOrderId}`);
        } else {
          console.error('[payout] Tremendous failed:', JSON.stringify(orderData));
        }
      } catch(e) { console.error('[payout] Tremendous error:', e.message); }
    }

    // ── Email notification ────────────────────────────────────
    try {
      await resend.emails.send({
        from: 'FinderSeek <payments@finderseek.com>',
        to: 'mike@finderseek.com',
        subject: `💰 Prize ${tremendousSuccess ? 'SENT ✓' : 'NEEDS MANUAL SEND'} — ${hunt.quest_id || huntId.slice(0,8)} — $${prizeAmount}`,
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="color:${tremendousSuccess ? '#22c55e' : '#e8a820'};">${tremendousSuccess ? '✅ Prize Automatically Sent' : '⚠️ Manual Payout Required'}</h2>
          ${tremendousSuccess
            ? `<p style="color:#16a34a;">Tremendous sent $${prizeAmount} to ${destination}. Order: ${tremendousOrderId}</p>`
            : `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin-bottom:16px;"><strong>Action required:</strong> Send $${prizeAmount} via ${methodLabel} to ${destination}</div>`
          }
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#666;">Quest ID</td><td style="padding:8px 0;font-weight:600;">${hunt.quest_id || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Prize</td><td style="padding:8px 0;color:#22c55e;font-weight:600;">$${prizeAmount}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Winner</td><td style="padding:8px 0;">${winner?.username || winnerId}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Send To</td><td style="padding:8px 0;font-weight:600;">${destination}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Method</td><td style="padding:8px 0;">${methodLabel}</td></tr>
          </table>
        </div>`
      });
    } catch(e) { console.warn('[payout] Email failed:', e.message); }

    return res.status(200).json({
      success: true,
      automated: tremendousSuccess,
      orderId: tremendousOrderId,
      message: tremendousSuccess
        ? `Your prize is on its way! Check ${destination} for your reward email.`
        : `Prize request received! You'll receive your $${prizeAmount} within 24 hours.`
    });

  } catch(err) {
    console.error('[payout-request] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
