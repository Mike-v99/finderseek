// api/create-checkout.js
// PayPal Orders API for quest escrow payments.
//
// Env vars:
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, NOTIFY_SECRET

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-finderseek-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.NOTIFY_SECRET && secret !== process.env.FINDERSEEK_NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};

  try {
    return await createEscrowOrder(body, res);
  } catch(e) {
    console.error('[create-checkout]', e);
    return res.status(500).json({ error: e.message });
  }
}

async function getPayPalToken() {
  const mode = process.env.PAYPAL_MODE || 'sandbox';
  const base = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');

  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error('PayPal auth failed: ' + (data.error_description || JSON.stringify(data)));
  return { token: data.access_token, base };
}

async function createEscrowOrder({ userId, email, huntId, prizeAmount, totalCents }, res) {
  if (!userId || !huntId || !totalCents) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const total = (totalCents / 100).toFixed(2);
  const prize = parseFloat(prizeAmount || 0).toFixed(2);
  const { token, base } = await getPayPalToken();

  const r = await fetch(`${base}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: huntId,
        description: `FinderSeek Quest — $${prize} Prize`,
        custom_id: JSON.stringify({ userId, huntId, prizeAmount: prize }),
        amount: {
          currency_code: 'USD',
          value: total,
          breakdown: { item_total: { currency_code: 'USD', value: total } }
        },
        items: [{
          name: `Quest Prize ($${prize}) + Fee`,
          description: `Prize held in escrow. Paid to the winner automatically.`,
          unit_amount: { currency_code: 'USD', value: total },
          quantity: '1',
          category: 'DIGITAL_GOODS',
        }]
      }],
    })
  });

  const order = await r.json();
  if (!r.ok || !order.id) {
    console.error('[paypal] Order failed:', order);
    throw new Error(order.details?.[0]?.description || order.message || 'PayPal order failed');
  }

  console.log('[paypal] Order created:', order.id, 'hunt:', huntId);

  // Mark hunt as pending in Supabase
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
      prize_value: Math.round(parseFloat(prize) * 100),
      paypal_order_id: order.id,
    })
  });

  return res.status(200).json({ orderId: order.id });
}
