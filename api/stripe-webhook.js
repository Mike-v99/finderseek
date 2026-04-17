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
        break;
      }

      case 'customer.subscription.deleted': {
        if (!userId) break;
        await sbPatch(`profiles?id=eq.${userId}`, {
          is_pro: false,
          pro_expires: new Date().toISOString(),
        });
        console.log(`[webhook] subscription.deleted → user ${userId} downgraded`);
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
