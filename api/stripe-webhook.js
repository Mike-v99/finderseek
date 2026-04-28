// api/stripe-webhook.js
// Handles Stripe subscription lifecycle events + escrow payments
//
// Env vars needed in Vercel:
//   STRIPE_SECRET_KEY       — sk_live_... or sk_test_...
//   STRIPE_WEBHOOK_SECRET   — whsec_... (from Stripe dashboard → Webhooks)
//   SUPABASE_URL            — https://qeiuycuasjkopxfkmggp.supabase.co
//   SUPABASE_SERVICE_KEY    — service role key (from Supabase → Settings → API)
//
// Register this webhook URL in Stripe dashboard:
//   https://finderseek.com/api/stripe-webhook
//
// Events to enable in Stripe:
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_failed
//   payment_intent.succeeded        ← ADD THIS for escrow

import { buffer } from 'micro';

export const config = { api: { bodyParser: false } };

async function verifyStripeSignature(req, secret) {
  const sig = req.headers['stripe-signature'];
  const buf = await buffer(req);
  const payload = buf.toString('utf8');

  const parts = sig.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k === 't') acc.timestamp = v;
    if (k === 'v1') acc.signatures.push(v);
    return acc;
  }, { timestamp: '', signatures: [] });

  const signedPayload = `${parts.timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(signedPayload);

  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig2 = await crypto.subtle.sign('HMAC', key, msgData);
  const expectedSig = Array.from(new Uint8Array(sig2)).map(b => b.toString(16).padStart(2,'0')).join('');

  if (!parts.signatures.includes(expectedSig)) throw new Error('Invalid signature');

  const tolerance = 300;
  if (Math.abs(Date.now() / 1000 - parseInt(parts.timestamp)) > tolerance) throw new Error('Timestamp too old');

  return JSON.parse(payload);
}

async function sbPatch(path, body) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Supabase patch failed: ${await r.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    event = await verifyStripeSignature(req, process.env.STRIPE_WEBHOOK_SECRET);
  } catch(e) {
    console.error('[webhook] sig error:', e.message);
    return res.status(400).json({ error: e.message });
  }

  const obj = event.data.object;
  const userId = obj.metadata?.userId || obj.subscription_details?.metadata?.userId;

  try {
    switch (event.type) {

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        if (!userId) break;
        const isActive = ['active', 'trialing'].includes(obj.status);
        const expiresAt = obj.current_period_end
          ? new Date(obj.current_period_end * 1000).toISOString()
          : null;
        await sbPatch(`profiles?id=eq.${userId}`, {
          is_pro: isActive,
          pro_since: isActive ? new Date().toISOString() : null,
          pro_expires: expiresAt,
          stripe_customer_id: obj.customer,
          stripe_subscription_id: obj.id,
        });
        console.log(`[webhook] ${event.type} → user ${userId} is_pro=${isActive}`);

        // Send welcome email only on new subscription creation when active/trialing
        if (event.type === 'customer.subscription.created' && isActive) {
          try {
            const sbUrl = process.env.SUPABASE_URL;
            const sbKey = process.env.SUPABASE_SERVICE_KEY;
            const pr = await fetch(`${sbUrl}/rest/v1/profiles?id=eq.${userId}&select=email,username`, {
              headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` }
            });
            const pd = await pr.json();
            const profile = pd && pd[0];
            if (profile?.email) {
              const isTrial = obj.status === 'trialing';
              const trialEnd = obj.trial_end ? new Date(obj.trial_end * 1000).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : null;
              const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="background:#06050a;margin:0;padding:0;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#0e0c14;border:1px solid rgba(201,137,12,.2);border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#1a1628,#0e0c14);padding:32px 36px 24px;border-bottom:1px solid rgba(255,255,255,.06);">
    <div style="font-size:22px;font-weight:800;color:#f5ead8;letter-spacing:1px;">Finder<em style="font-style:italic;color:#c9890c;">Seek</em></div>
  </div>
  <div style="padding:28px 36px 32px;">
    <h1 style="font-size:26px;font-weight:800;color:#f5ead8;margin:0 0 10px;">👑 Welcome to Gold${profile.username ? ', ' + profile.username : ''}!</h1>
    <p style="font-size:15px;color:#c8b48a;line-height:1.7;margin:0 0 16px;">${isTrial ? `Your 30-day free trial is now active. You won't be charged until <strong style="color:#f5ead8;">${trialEnd}</strong>.` : 'Your Gold membership is now active.'}</p>
    <p style="font-size:15px;color:#c8b48a;line-height:1.7;margin:0 0 20px;">Here's what you now have access to:</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);color:#4ade80;font-size:14px;">⚡ Instant finder clue alerts</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);color:#4ade80;font-size:14px;">🗺️ 50ft precision map radius</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);color:#4ade80;font-size:14px;">🔔 City quest alerts</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);color:#e8a820;font-size:14px;">📊 Quest analytics</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);color:#e8a820;font-size:14px;">📌 3 pinned quests</td></tr>
      <tr><td style="padding:8px 0;color:#e8a820;font-size:14px;">✏️ Edit AI clues</td></tr>
    </table>
    <a href="https://finderseek.com" style="display:block;text-align:center;background:linear-gradient(135deg,#92400e,#f59e0b);color:#0a0500;text-decoration:none;border-radius:12px;padding:14px;font-size:16px;font-weight:700;">Start Finding Treasure →</a>
    <p style="font-size:13px;color:rgba(255,255,255,.3);margin-top:20px;text-align:center;">$3.99/mo · Cancel anytime from your profile · 🔒 Powered by Stripe</p>
  </div>
</div></body></html>`;
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  from: 'FinderSeek <notifications@finderseek.com>',
                  to: profile.email,
                  subject: isTrial ? '👑 Your Gold trial has started — welcome!' : '👑 Welcome to FinderSeek Gold!',
                  html
                })
              });
              console.log(`[webhook] welcome email sent to ${profile.email}`);
            }
          } catch(emailErr) {
            console.error('[webhook] welcome email error (non-fatal):', emailErr.message);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        if (!userId) break;
        await sbPatch(`profiles?id=eq.${userId}`, {
          is_pro: false,
          pro_expires: new Date().toISOString(),
        });
        console.log(`[webhook] subscription.deleted → user ${userId} downgraded`);

        // Send cancellation confirmation email
        try {
          const sbUrl = process.env.SUPABASE_URL;
          const sbKey = process.env.SUPABASE_SERVICE_KEY;
          const pr = await fetch(`${sbUrl}/rest/v1/profiles?id=eq.${userId}&select=email,username`, {
            headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` }
          });
          const pd = await pr.json();
          const profile = pd && pd[0];
          if (profile?.email) {
            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="background:#06050a;margin:0;padding:0;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#0e0c14;border:1px solid rgba(148,163,184,.15);border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#1a1628,#0e0c14);padding:32px 36px 24px;border-bottom:1px solid rgba(255,255,255,.06);">
    <div style="font-size:22px;font-weight:800;color:#f5ead8;letter-spacing:1px;">Finder<em style="font-style:italic;color:#c9890c;">Seek</em></div>
  </div>
  <div style="padding:28px 36px 32px;">
    <h1 style="font-size:22px;font-weight:800;color:#f5ead8;margin:0 0 10px;">Gold membership cancelled</h1>
    <p style="font-size:15px;color:#c8b48a;line-height:1.7;margin:0 0 16px;">Hi${profile.username ? ' ' + profile.username : ''}, your FinderSeek Gold membership has been cancelled. You'll revert to the free tier at the end of your current billing period.</p>
    <p style="font-size:15px;color:#c8b48a;line-height:1.7;margin:0 0 24px;">You can always resubscribe from the Gold page whenever you're ready.</p>
    <a href="https://finderseek.com/gold.html" style="display:block;text-align:center;background:rgba(255,255,255,.06);color:#f5ead8;text-decoration:none;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px;font-size:15px;">Resubscribe to Gold →</a>
  </div>
</div></body></html>`;
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'FinderSeek <notifications@finderseek.com>',
                to: profile.email,
                subject: 'Your FinderSeek Gold membership has been cancelled',
                html
              })
            });
          }
        } catch(emailErr) {
          console.error('[webhook] cancellation email error (non-fatal):', emailErr.message);
        }
        break;
      }

      case 'invoice.payment_failed': {
        console.log(`[webhook] payment_failed for customer ${obj.customer}`);
        break;
      }

      // ── ESCROW: Prize payment from Pirate ─────────────────────
      case 'payment_intent.succeeded': {
        const type = obj.metadata?.type;
        const huntId = obj.metadata?.huntId;
        if (type !== 'escrow' || !huntId) break;

        const prizeAmount = parseInt(obj.metadata?.prizeAmount || 0);
        const stripePaymentId = obj.id;

        // Mark quest escrow as funded — hunt can now go active
        await sbPatch(`hunts?id=eq.${huntId}`, {
          escrow_status: 'funded',
          escrow_amount: prizeAmount * 100,
          stripe_payment_intent: stripePaymentId,
          status: 'active',
        });

        console.log(`[webhook] escrow funded → hunt ${huntId} prize $${prizeAmount}`);

        // Generate quest ID (TXA-0001 format) using state from hunt
        try {
          const huntRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/hunts?id=eq.${huntId}&select=state_code,quest_id`, {
            headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
          });
          const huntData = await huntRes.json();
          const hunt = huntData && huntData[0];
          if (hunt && !hunt.quest_id) {
            const stateCode = (hunt.state_code || 'US').toUpperCase().slice(0,2);
            const idRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/generate_quest_id`, {
              method: 'POST',
              headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ p_state: stateCode })
            });
            const questId = await idRes.json();
            if (questId) {
              await sbPatch(`hunts?id=eq.${huntId}`, { quest_id: questId });
              console.log(`[webhook] quest ID assigned: ${questId} for hunt ${huntId}`);
            }
          }
        } catch (qidErr) {
          console.error('[webhook] quest ID generation error (non-fatal):', qidErr.message);
        }

        // Notify the creator (+ city seekers, followers).
        // We AWAIT this rather than fire-and-forget because Vercel
        // serverless functions may terminate background promises
        // after `return res.status(200)`. Stripe gives us 30 seconds
        // to respond, so a few hundred ms for notify is safe.
        // Wrapped in try/catch so a notify failure never causes us
        // to return non-200 to Stripe (would trigger retry + double-flip).
        try {
          const notifySecret = process.env.NOTIFY_SECRET || process.env.FINDERSEEK_NOTIFY_SECRET;
          if (notifySecret) {
            const notifyRes = await fetch(`https://www.finderseek.com/api/notify`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-finderseek-secret': notifySecret,
              },
              body: JSON.stringify({ event: 'hunt_approved', huntId }),
            });
            const notifyBody = await notifyRes.text();
            console.log(`[webhook] notify response ${notifyRes.status}: ${notifyBody.slice(0, 200)}`);
          } else {
            console.warn('[webhook] NOTIFY_SECRET not set — skipping creator email');
          }
        } catch (notifyErr) {
          console.error('[webhook] notify error (non-fatal):', notifyErr.message);
        }

        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch(e) {
    console.error('[webhook] handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}
