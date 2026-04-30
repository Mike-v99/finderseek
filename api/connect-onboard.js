// api/connect-onboard.js
// Creates a Stripe Connect Express account for a winner and returns the onboarding URL
// Called when a winner claims a prize and needs to set up their payout

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify request is from our app (accept either secret name)
  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.FINDERSEEK_NOTIFY_SECRET && secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { userId, email } = req.body;
  if (!userId || !email) return res.status(400).json({ error: 'Missing userId or email' });

  try {
    // Check if user already has a Connect account
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_id')
      .eq('id', userId)
      .single();

    let accountId = profile?.stripe_connect_id;

    if (!accountId) {
      // Create Express account
      const account = await stripe.accounts.create({
        type: 'express',
        email: email,
        capabilities: { transfers: { requested: true } },
        metadata: { finderseek_user_id: userId },
      });
      accountId = account.id;

      // Set individual type after creation
      try {
        await stripe.accounts.update(accountId, { business_type: 'individual' });
      } catch(e) { console.warn('[connect-onboard] Could not set business_type:', e.message); }

      await supabase.from('profiles').update({ stripe_connect_id: accountId }).eq('id', userId);
    } else {
      // Update existing account to individual if needed
      try {
        const existing = await stripe.accounts.retrieve(accountId);
        if (existing.business_type !== 'individual') {
          await stripe.accounts.update(accountId, { business_type: 'individual' });
        }
      } catch(e) { console.warn('[connect-onboard] Could not update account:', e.message); }
    }

    const appUrl = process.env.APP_URL || 'https://finderseek.com';

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/profile.html?connect=refresh`,
      return_url: `${appUrl}/profile.html?connect=complete`,
      type: 'account_onboarding',
    });

    return res.status(200).json({
      url: accountLink.url,
      accountId: accountId,
    });

  } catch (err) {
    console.error('[Connect Onboard Error]', err.message);
    console.error('[Connect Onboard] type:', err.type);
    console.error('[Connect Onboard] param:', err.param);
    console.error('[Connect Onboard] code:', err.code);
    return res.status(500).json({ 
      error: err.message,
      param: err.param,
      code: err.code 
    });
  }
}
