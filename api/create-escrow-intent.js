// api/create-escrow-intent.js
// Creates a Stripe PaymentIntent for the embedded escrow payment modal
// (used by newquest.html and review.html's "Fund Quest" flow).
//
// Env vars needed in Vercel:
//   STRIPE_SECRET_KEY      — sk_live_... or sk_test_...
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

  try {
    // Create PaymentIntent via Stripe API
    const r = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'amount': totalCents,
        'currency': 'usd',
        'receipt_email': email,
        'description': `FinderSeek Escrow — $${prizeAmount} Prize`,
        'metadata[userId]': userId,
        'metadata[huntId]': huntId,
        'metadata[prizeAmount]': prizeAmount,
        'metadata[type]': 'escrow',
        'automatic_payment_methods[enabled]': 'true',
      })
    });

    const intent = await r.json();
    if (intent.error) throw new Error(intent.error.message);

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
        stripe_payment_intent: intent.id
      })
    });

    return res.status(200).json({ clientSecret: intent.client_secret, intentId: intent.id });
  } catch(e) {
    console.error('[create-escrow-intent]', e);
    return res.status(500).json({ error: e.message });
  }
}
