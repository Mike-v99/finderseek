// api/create-checkout.js
// Creates a Stripe Checkout session for FinderSeek Gold
//
// Env vars needed in Vercel:
//   STRIPE_SECRET_KEY      — sk_live_... or sk_test_...
//   STRIPE_GOLD_PRICE_ID   — price_... (monthly recurring price from Stripe dashboard)
//   NOTIFY_SECRET          — shared secret to verify caller

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.NOTIFY_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, email, username } = req.body;
  if (!userId || !email) return res.status(400).json({ error: 'Missing userId or email' });

  const origin = req.headers.origin || 'https://finderseek.com';

  try {
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
        'metadata[userId]': userId,
        'metadata[username]': username || '',
        'success_url': `${origin}/profile.html?upgraded=1`,
        'cancel_url': `${origin}/pricing.html?cancelled=1`,
        'subscription_data[metadata][userId]': userId,
        'allow_promotion_codes': 'true',
      })
    });
    const session = await r.json();
    if (session.error) throw new Error(session.error.message);
    return res.status(200).json({ url: session.url });
  } catch(e) {
    console.error('[create-checkout]', e);
    return res.status(500).json({ error: e.message });
  }
}
