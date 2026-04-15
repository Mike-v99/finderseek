import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.FINDERSEEK_NOTIFY_SECRET && secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { accountId, amount } = req.body;
  if (!accountId || !amount) return res.status(400).json({ error: 'Missing accountId or amount' });

  try {
    const transfer = await stripe.transfers.create({
      amount: parseInt(amount),
      currency: 'usd',
      destination: accountId,
      description: 'FinderSeek test transfer',
    });
    return res.status(200).json({ success: true, transferId: transfer.id, amount, message: '$' + (amount/100).toFixed(2) + ' transferred!' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
