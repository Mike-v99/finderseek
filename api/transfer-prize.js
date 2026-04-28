// api/transfer-prize.js
// Automatically transfers the prize to the winner's Stripe Connect account
// Called when a seeker enters the correct 6-digit code

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Accept either secret name
  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.FINDERSEEK_NOTIFY_SECRET && secret !== process.env.NOTIFY_SECRET) {
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

    // 4. Calculate prize amount — prize_value is stored in cents already
    const prizeAmountCents = hunt.prize_value || 0;

    // ── SAFETY GUARDS — multiple layers to prevent wrong transfer amount ──
    // Guard 1: must be positive
    if (prizeAmountCents <= 0) {
      console.error(`[Transfer] BLOCKED: invalid prize_value=${prizeAmountCents} for hunt ${huntId}`);
      return res.status(400).json({ error: 'Invalid prize amount' });
    }
    // Guard 2: hard cap — FinderSeek max prize is $100 = 10000 cents
    // If this ever exceeds $110 (11000 cents) something is very wrong
    const MAX_PRIZE_CENTS = 11000; // $110 absolute ceiling
    if (prizeAmountCents > MAX_PRIZE_CENTS) {
      console.error(`[Transfer] BLOCKED: prize_value=${prizeAmountCents} cents exceeds max ${MAX_PRIZE_CENTS} for hunt ${huntId}. Possible unit error (dollars sent instead of cents, or multiplied twice).`);
      return res.status(400).json({ error: `Transfer blocked: amount ${prizeAmountCents} cents exceeds safety limit. Manual review required.` });
    }
    // Guard 3: cross-check against escrow_amount if available
    if (hunt.escrow_amount && Math.abs(hunt.escrow_amount - prizeAmountCents) > 1100) {
      // escrow_amount includes the 10% fee so allow up to 10% + $1 difference
      const diff = Math.abs(hunt.escrow_amount - prizeAmountCents);
      const tenPct = Math.round(hunt.escrow_amount * 0.12); // 12% tolerance
      if (diff > tenPct) {
        console.error(`[Transfer] BLOCKED: prize_value=${prizeAmountCents} doesn't match escrow_amount=${hunt.escrow_amount} for hunt ${huntId}`);
        return res.status(400).json({ error: 'Transfer blocked: prize amount mismatch. Manual review required.' });
      }
    }
    // Guard 4: sanity check — must be a round cent amount matching a valid prize tier
    const VALID_PRIZE_CENTS = [1000, 2000, 3000, 5000, 7500, 10000]; // $10,$20,$30,$50,$75,$100
    if (!VALID_PRIZE_CENTS.includes(prizeAmountCents)) {
      console.warn(`[Transfer] WARNING: prize_value=${prizeAmountCents} not a standard prize tier. Proceeding but flagging.`);
      // Don't block — allow non-standard amounts but log it
    }
    console.log(`[Transfer] Safety checks passed: $${(prizeAmountCents/100).toFixed(2)} for hunt ${huntId}`);

    // 5. Create the transfer
    const transfer = await stripe.transfers.create({
      amount: prizeAmountCents,
      currency: 'usd',
      destination: winner.stripe_connect_id,
      description: `FinderSeek prize for quest: ${hunt.title || huntId}`,
      metadata: {
        hunt_id: huntId,
        winner_id: winnerId,
        prize_amount_cents: prizeAmountCents,
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

    // 7. Update winner's stats (finds_count + total_won)
    try {
      await supabase.rpc('record_quest_win', {
        p_user_id: winnerId,
        p_prize_value_cents: prizeAmountCents,
      });
    } catch (rpcErr) {
      // Non-fatal — transfer already succeeded
      console.error('[Transfer] Stats update failed (non-fatal):', rpcErr);
    }

    console.log(`[Transfer] Prize $${(prizeAmountCents/100).toFixed(2)} sent to ${winner.username} (${transfer.id})`);


    // Notify pirate + winner. AWAIT so Vercel doesn't kill the background
    // promise after the function returns. Wrapped in try/catch — money
    // has already moved, we must still return success to the client even
    // if email delivery fails.
    try {
      const notifySecret = process.env.NOTIFY_SECRET || process.env.FINDERSEEK_NOTIFY_SECRET;
      if (notifySecret) {
        const notifyRes = await fetch(`https://www.finderseek.com/api/notify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-finderseek-secret': notifySecret,
          },
          body: JSON.stringify({ event: 'prize_claimed', huntId }),
        });
        const notifyBody = await notifyRes.text();
        console.log(`[Transfer] notify response ${notifyRes.status}: ${notifyBody.slice(0, 200)}`);
      } else {
        console.warn('[Transfer] NOTIFY_SECRET not set — skipping claim emails');
      }
    } catch (notifyErr) {
      console.error('[Transfer] notify error (non-fatal):', notifyErr.message);
    }

    return res.status(200).json({
      success: true,
      transferId: transfer.id,
      amount: (prizeAmountCents / 100).toFixed(2),
      message: `$${(prizeAmountCents/100).toFixed(2)} sent to winner!`,
    });

  } catch (err) {
    console.error('[Transfer Error]', err);
    return res.status(500).json({ error: err.message });
  }
}
