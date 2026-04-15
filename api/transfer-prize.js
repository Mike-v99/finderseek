// api/transfer-prize.js
// Automatically transfers the prize to the winner's Stripe Connect account
// Called when a seeker enters the correct 6-digit code

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

  const { huntId, winnerId } = req.body;
  if (!huntId || !winnerId) return res.status(400).json({ error: 'Missing huntId or winnerId' });

  try {
    // 1. Get the hunt details
    const { data: hunt, error: huntErr } = await supabase
      .from('hunts')
      .select('*')
      .eq('id', huntId)
      .single();

    if (huntErr || !hunt) return res.status(404).json({ error: 'Hunt not found' });
    if (hunt.escrow_status === 'paid') return res.status(400).json({ error: 'Already paid' });
    if (hunt.escrow_status !== 'funded') return res.status(400).json({ error: 'Escrow not funded' });

    // 2. Get winner's Connect account
    const { data: winner } = await supabase
      .from('profiles')
      .select('stripe_connect_id, email, username')
      .eq('id', winnerId)
      .single();

    if (!winner?.stripe_connect_id) {
      // Winner hasn't onboarded yet — mark as pending_payout
      await supabase
        .from('hunts')
        .update({
          winner_id: winnerId,
          escrow_status: 'pending_payout',
          found_at: new Date().toISOString(),
        })
        .eq('id', huntId);

      return res.status(200).json({
        success: false,
        needs_onboarding: true,
        message: 'Winner needs to set up payout account',
      });
    }

    // 3. Verify the Connect account can receive transfers
    const account = await stripe.accounts.retrieve(winner.stripe_connect_id);
    if (!account.charges_enabled || !account.payouts_enabled) {
      await supabase
        .from('hunts')
        .update({
          winner_id: winnerId,
          escrow_status: 'pending_payout',
          found_at: new Date().toISOString(),
        })
        .eq('id', huntId);

      return res.status(200).json({
        success: false,
        needs_onboarding: true,
        message: 'Winner account not fully verified yet',
      });
    }

    // 4. Calculate prize amount (exclude our 10% fee)
    const prizeAmountCents = Math.round(hunt.prize_amount * 100);

    // 5. Create the transfer
    const transfer = await stripe.transfers.create({
      amount: prizeAmountCents,
      currency: 'usd',
      destination: winner.stripe_connect_id,
      description: `FinderSeek prize for quest: ${hunt.title || huntId}`,
      metadata: {
        hunt_id: huntId,
        winner_id: winnerId,
        prize_amount: hunt.prize_amount,
      },
    });

    // 6. Update hunt status
    await supabase
      .from('hunts')
      .update({
        winner_id: winnerId,
        escrow_status: 'paid',
        stripe_transfer_id: transfer.id,
        found_at: new Date().toISOString(),
        paid_at: new Date().toISOString(),
      })
      .eq('id', huntId);

    console.log(`[Transfer] Prize $${hunt.prize_amount} sent to ${winner.username} (${transfer.id})`);

    return res.status(200).json({
      success: true,
      transferId: transfer.id,
      amount: hunt.prize_amount,
      message: `$${hunt.prize_amount} sent to winner!`,
    });

  } catch (err) {
    console.error('[Transfer Error]', err);
    return res.status(500).json({ error: err.message });
  }
};
