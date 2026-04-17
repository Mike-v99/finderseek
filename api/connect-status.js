// api/connect-status.js
// Multi-action endpoint for Stripe Connect management:
//   action=status (default): returns connection + readiness + bank last4
//   action=dashboard:         returns a one-time login link to the Express dashboard
//   action=disconnect:        clears the Stripe Connect link from the user's profile

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.FINDERSEEK_NOTIFY_SECRET && secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const action = (req.query?.action || req.body?.action || 'status').toLowerCase();

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_id')
      .eq('id', userId)
      .single();

    // DISCONNECT: clear the link in the DB
    if (action === 'disconnect') {
      if (!profile?.stripe_connect_id) {
        return res.status(200).json({ ok: true, message: 'Already disconnected' });
      }
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ stripe_connect_id: null })
        .eq('id', userId);
      if (updErr) throw updErr;
      return res.status(200).json({ ok: true });
    }

    if (!profile?.stripe_connect_id) {
      return res.status(200).json({
        connected: false,
        ready: false,
        message: 'No payout account set up',
      });
    }

    // DASHBOARD LINK: generate one-time Express login
    if (action === 'dashboard') {
      const link = await stripe.accounts.createLoginLink(profile.stripe_connect_id);
      return res.status(200).json({ url: link.url });
    }

    // STATUS (default): check readiness + bank info
    const account = await stripe.accounts.retrieve(profile.stripe_connect_id);
    const bank = account.external_accounts?.data?.find(a => a.object === 'bank_account');

    return res.status(200).json({
      connected: true,
      ready: account.charges_enabled && account.payouts_enabled,
      details_submitted: account.details_submitted,
      accountId: profile.stripe_connect_id,
      bank_last4: bank?.last4 || null,
      message: account.payouts_enabled
        ? 'Account ready to receive payouts'
        : 'Account setup incomplete',
    });

  } catch (err) {
    console.error('[Connect Status Error]', err);
    return res.status(500).json({ error: err.message });
  }
}
