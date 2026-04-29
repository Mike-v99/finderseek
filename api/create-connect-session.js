// api/create-connect-session.js
// Creates a Stripe AccountSession for embedded Connect components
// This lets us render Stripe's onboarding UI inside our own page

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

  const { userId, email } = req.body;
  if (!userId || !email) return res.status(400).json({ error: 'Missing userId or email' });

  try {
    // Get or create Stripe Connect account
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_id')
      .eq('id', userId)
      .single();

    let accountId = profile?.stripe_connect_id;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: email,
        capabilities: { transfers: { requested: true } },
        metadata: { finderseek_user_id: userId },
      });
      accountId = account.id;
      await supabase.from('profiles').update({ stripe_connect_id: accountId }).eq('id', userId);
    }

    // Create AccountSession for embedded component
    const accountSession = await stripe.accountSessions.create({
      account: accountId,
      components: {
        account_onboarding: { enabled: true },
      },
    });

    return res.status(200).json({
      client_secret: accountSession.client_secret,
      account_id: accountId,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || '',
    });

  } catch (err) {
    console.error('[Create Connect Session]', err.message, err.param);
    return res.status(500).json({ error: err.message, param: err.param });
  }
}
