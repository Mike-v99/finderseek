// api/test-transfer.js
// Simple test endpoint - transfers money directly to a connected account
// Use this to verify Stripe Connect transfers work before building the full flow

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify request
  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.FINDERSEEK_NOTIFY_SECRET && secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { accountId, amount } = req.body;
  if (!accountId || !amount) {
    return res.status(400).json({ error: 'Missing accountId or amount' });
  }

  try {
    // Create a transfer to the connected account
    const transfer = await stripe.transfers.create({
      amount: parseInt(amount), // in cents
      currency: 'usd',
      destination: accountId,
      description: 'FinderSeek test transfer',
      metadata: {
        test: 'true',
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[Test Transfer] $${(amount/100).toFixed(2)} sent to ${accountId} — ${transfer.id}`);

    return res.status(200).json({
      success: true,
      transferId: transfer.id,
      amount: amount,
      amountDollars: (amount / 100).toFixed(2),
      destination: accountId,
      message: `$${(amount/100).toFixed(2)} transferred successfully!`,
    });

  } catch (err) {
    console.error('[Test Transfer Error]', err);
    return res.status(500).json({
      success: false,
      error: err.message,
      type: err.type,
      code: err.code,
    });
  }
};
