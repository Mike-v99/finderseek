// api/connect-status.js
// Checks if a user's Stripe Connect account is fully set up and can receive payouts

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['x-finderseek-secret'] !== process.env.FINDERSEEK_NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_id')
      .eq('id', userId)
      .single();

    if (!profile?.stripe_connect_id) {
      return res.status(200).json({
        connected: false,
        ready: false,
        message: 'No payout account set up',
      });
    }

    const account = await stripe.accounts.retrieve(profile.stripe_connect_id);

    return res.status(200).json({
      connected: true,
      ready: account.charges_enabled && account.payouts_enabled,
      details_submitted: account.details_submitted,
      accountId: profile.stripe_connect_id,
      message: account.payouts_enabled
        ? 'Account ready to receive payouts'
        : 'Account setup incomplete',
    });

  } catch (err) {
    console.error('[Connect Status Error]', err);
    return res.status(500).json({ error: err.message });
  }
};
