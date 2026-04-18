// api/create-checkout.js
// Unified Stripe Checkout session creator.
// Handles BOTH Gold subscription (type=gold) and quest escrow (type=escrow).
//
// Env vars needed in Vercel:
//   STRIPE_SECRET_KEY      — sk_live_... or sk_test_...
//   STRIPE_GOLD_PRICE_ID   — price_... for Gold subscription
//   SUPABASE_URL           — https://...supabase.co
//   SUPABASE_SERVICE_KEY   — service role key
//   NOTIFY_SECRET          — shared secret

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.NOTIFY_SECRET && secret !== process.env.FINDERSEEK_NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  const type = body.type || 'gold'; // default to gold for backwards compat
  const origin = req.headers.origin || 'https://finderseek.com';

  try {
    if (type === 'gold') {
      return await createGoldCheckout(body, origin, res);
    } else if (type === 'escrow') {
      return await createEscrowCheckout(body, origin, res);
    } else {
      return res.status(400).json({ error: 'Invalid checkout type. Use "gold" or "escrow".' });
    }
  } catch(e) {
    console.error('[create-checkout]', type, e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── GOLD SUBSCRIPTION ──────────────────────────────────
async function createGoldCheckout({ userId, email, username }, origin, res) {
  if (!userId || !email) {
    return res.status(400).json({ error: 'Missing userId or email' });
  }

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      'mode': 'subscription',
      'customer_email': email,
      'line_items[0][price]': process.env.STRIPE_GOLD_PRICE_ID,
      'line_items[0][quantity]': '1',
      'subscription_data[trial_period_days]': '30',
      'subscription_data[metadata][userId]': userId,
      'subscription_data[metadata][username]': username || '',
      'metadata[userId]': userId,
      'success_url': `${origin}/gold.html?upgraded=true`,
      'cancel_url': `${origin}/gold.html?cancelled=true`,
    })
  });

  const session = await r.json();
  if (session.error) throw new Error(session.error.message);

  return res.status(200).json({ url: session.url });
}

// ─── QUEST ESCROW ───────────────────────────────────────
async function createEscrowCheckout({ userId, email, huntId, prizeAmount, totalCents }, origin, res) {
  if (!userId || !email || !huntId || !totalCents) {
    return res.status(400).json({ error: 'Missing required fields for escrow' });
  }

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      'mode': 'payment',
      'customer_email': email,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': totalCents,
      'line_items[0][price_data][product_data][name]': `FinderSeek Escrow — $${prizeAmount} Prize`,
      'line_items[0][price_data][product_data][description]': `Prize: $${prizeAmount} + 10% FinderSeek fee. Held securely and paid to the winner automatically.`,
      'line_items[0][quantity]': '1',
      'metadata[userId]': userId,
      'metadata[huntId]': huntId,
      'metadata[prizeAmount]': prizeAmount,
      'metadata[type]': 'escrow',
      'success_url': `${origin}/profile.html?quest=funded&id=${huntId}`,
      'cancel_url': `${origin}/newquest.html?escrow=cancelled`,
      'payment_intent_data[metadata][userId]': userId,
      'payment_intent_data[metadata][huntId]': huntId,
      'payment_intent_data[metadata][type]': 'escrow',
    })
  });

  const session = await r.json();
  if (session.error) throw new Error(session.error.message);

  // Mark hunt as escrow_pending in Supabase
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/hunts?id=eq.${huntId}`, {
    method: 'PATCH',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      payment_type: 'escrow',
      escrow_status: 'pending',
      prize_value: prizeAmount * 100,
      stripe_escrow_session: session.id
    })
  });

  return res.status(200).json({ url: session.url });
}
