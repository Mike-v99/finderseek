// api/payout-request.js
// Saves winner payout request (PayPal/Venmo) and emails FinderSeek admin

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
  if (!huntId || !winnerId || !method || !destination) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Get hunt details
    const { data: hunt } = await supabase
      .from('hunts')
      .select('id, title, prize_value, quest_id, status, escrow_status, winner_id')
      .eq('id', huntId)
      .single();

    if (!hunt) return res.status(404).json({ error: 'Hunt not found' });

    // Get winner profile
    const { data: winner } = await supabase
      .from('profiles')
      .select('username, email')
      .eq('id', winnerId)
      .single();

    const prizeAmount = amount || (hunt.prize_value / 100).toFixed(2);
    const methodLabel = method === 'paypal' ? 'PayPal' : 'Venmo';
    const destLabel = method === 'paypal' ? `Email: ${destination}` : `Phone: ${destination}`;

    // Save payout request to hunt
    await supabase
      .from('hunts')
      .update({
        winner_id: winnerId,
        payout_method: method,
        payout_destination: destination,
        payout_status: 'pending',
        status: 'won',
      })
      .eq('id', huntId);

    // Email admin
    await resend.emails.send({
      from: 'FinderSeek <noreply@finderseek.com>',
      to: 'admin@finderseek.com',
      subject: `💰 Prize Payout Needed — ${hunt.quest_id || huntId.slice(0,8)} — $${prizeAmount}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="color:#e8a820;">💰 Prize Payout Required</h2>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:8px 0;color:#666;">Quest ID</td><td style="padding:8px 0;font-weight:600;">${hunt.quest_id || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Hunt ID</td><td style="padding:8px 0;">${huntId}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Prize Amount</td><td style="padding:8px 0;font-weight:600;color:#22c55e;">$${prizeAmount}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Winner</td><td style="padding:8px 0;">${winner?.username || winnerId}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Winner Email</td><td style="padding:8px 0;">${winner?.email || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Payout Method</td><td style="padding:8px 0;font-weight:600;">${methodLabel}</td></tr>
            <tr><td style="padding:8px 0;color:#666;">Send To</td><td style="padding:8px 0;font-weight:600;color:#635bff;">${destination}</td></tr>
          </table>
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin-top:16px;">
            <strong>Action required:</strong> Send $${prizeAmount} via ${methodLabel} to ${destination}
          </div>
          <p style="color:#999;font-size:13px;margin-top:16px;">FinderSeek · ${new Date().toLocaleString()}</p>
        </div>
      `
    });

    console.log(`[payout-request] ${methodLabel} payout request: $${prizeAmount} → ${destination} for hunt ${huntId}`);

    return res.status(200).json({
      success: true,
      message: `Payout request submitted. You'll receive your $${prizeAmount} via ${methodLabel} shortly.`
    });

  } catch(err) {
    console.error('[payout-request] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
