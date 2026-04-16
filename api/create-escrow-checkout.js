// api/create-escrow-checkout.js
// Creates a Stripe Checkout session for FinderSeek Escrow (prize + 10% fee)
//
// Env vars needed in Vercel:
//   STRIPE_SECRET_KEY      — sk_live_...
//   SUPABASE_URL           — https://...supabase.co
//   SUPABASE_SERVICE_KEY   — service role key
//   NOTIFY_SECRET          — shared secret

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.NOTIFY_SECRET && secret !== process.env.FINDERSEEK_NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { userId, email, huntId, prizeAmount, totalCents } = req.body;
  if (!userId || !email || !huntId || !totalCents) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const origin = req.headers.origin || 'https://finderseek.com';

  try {
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
        'success_url': `${origin}/pirate.html?escrow=paid&hunt=${huntId}`,
        'cancel_url': `${origin}/pirate.html?escrow=cancelled`,
        'payment_intent_data[metadata][userId]': userId,
        'payment_intent_data[metadata][huntId]': huntId,
        'payment_intent_data[metadata][type]': 'escrow',
      })
    });

    const session = await r.json();
    if (session.error) throw new Error(session.error.message);

    // Mark quest as escrow_pending in Supabase
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
  } catch(e) {
    console.error('[create-escrow-checkout]', e);
    return res.status(500).json({ error: e.message });
  }
}
