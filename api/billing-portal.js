// api/billing-portal.js
// Creates a Stripe Billing Portal session for managing an existing subscription
//
// Env vars needed:
//   STRIPE_SECRET_KEY     — sk_live_... or sk_test_...
//   SUPABASE_URL          — https://...supabase.co
//   SUPABASE_SERVICE_KEY  — service role key
//   NOTIFY_SECRET         — shared secret

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-finderseek-secret, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.NOTIFY_SECRET && secret !== process.env.FINDERSEEK_NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  try {
    // Look up the Stripe customer ID from the user's profile
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (pErr || !profile?.stripe_customer_id) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const origin = req.headers.origin || 'https://finderseek.com';

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/gold.html`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[billing-portal]', err);
    return res.status(500).json({ error: err.message });
  }
}
