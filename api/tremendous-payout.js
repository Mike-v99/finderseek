// api/tremendous-payout.js
// Sends prize money to winner via Tremendous (PayPal, Venmo, bank transfer)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.FINDERSEEK_NOTIFY_SECRET && secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { huntId, winnerId, method, destination, amount, questId } = req.body;
  if (!huntId || !destination || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const apiKey = process.env.TREMENDOUS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Tremendous API key not configured' });

  // Sandbox vs production URL
  const isSandbox = apiKey.startsWith('TEST_');
  const baseUrl = isSandbox
    ? 'https://testflight.tremendous.com/api/v2'
    : 'https://www.tremendous.com/api/v2';

  try {
    // Get funding source ID
    const fsRes = await fetch(`${baseUrl}/funding_sources`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const fsData = await fsRes.json();
    const fundingSource = fsData.funding_sources?.find(f =>
      f.method === 'balance' && f.meta?.available_cents > 0
    );
    const fundingSourceId = fundingSource?.id || 'balance';
    console.log(`[tremendous] Using funding source: ${fundingSourceId} (available: $${(fundingSource?.meta?.available_cents || 0) / 100})`);

    // Map method to Tremendous delivery method
    // Winners choose how to receive via Tremendous's redemption page
    // We send to their email and they pick PayPal/Venmo/bank/gift card
    const amountCents = Math.round(parseFloat(amount) * 100);

    // Build the order
    const order = {
      payment: {
        funding_source_id: fundingSourceId,
      },
      reward: {
        value: {
          denomination: parseFloat(amount),
          currency_code: 'USD',
        },
        delivery: {
          method: 'EMAIL',
          meta: {
            email: destination,
          },
        },
        recipient: {
          email: destination,
          name: 'FinderSeek Winner',
        },
        message: `🏆 Congratulations! You won $${amount} on FinderSeek${questId ? ' (Quest ' + questId + ')' : ''}! Click below to choose how you want to receive your prize — PayPal, Venmo, bank transfer, or gift cards.`,
        // Let recipient choose their preferred payout method
        products: ['PAYPAL', 'VENMO', 'DIRECT_DEPOSIT'],
      },
      external_id: `finderseek_${huntId}`, // idempotency key
    };

    console.log(`[tremendous] Sending $${amount} to ${destination} for hunt ${huntId}`);

    const orderRes = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(order),
    });

    const orderData = await orderRes.json();

    if (!orderRes.ok) {
      console.error('[tremendous] Order failed:', JSON.stringify(orderData));
      throw new Error(orderData.errors?.message || 'Tremendous order failed');
    }

    console.log(`[tremendous] ✓ Order created: ${orderData.order?.id} status: ${orderData.order?.status}`);

    return res.status(200).json({
      success: true,
      orderId: orderData.order?.id,
      status: orderData.order?.status,
      message: `Prize sent! Check ${destination} for your reward email.`,
    });

  } catch(err) {
    console.error('[tremendous] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
