// api/admin-create-quest.js
// Creates a test quest with clues for testing purposes
// Protected by ADMIN_PASSWORD env var

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check
  const { password, userId, prizeCents, expiryMins } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  if (!userId) return res.status(400).json({ error: 'User ID required' });

  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (expiryMins || 10) * 60 * 1000);
    const prize = prizeCents || 100;

    // Insert hunt
    const { data: hunts, error: huntErr } = await supabase
      .from('hunts')
      .insert([{
        week_label: 'TEST · $' + (prize/100).toFixed(2) + ' · ' + now.toLocaleTimeString(),
        prize_desc: '$' + (prize/100).toFixed(2) + ' Cash',
        prize_value: prize,
        status: 'active',
        escrow_status: 'funded',
        escrow_amount: Math.round(prize * 1.1),
        pirate_id: userId,
        created_by: userId,
        finder_code: '000000',
        starts_at: now.toISOString(),
        ends_at: expiresAt.toISOString(),
        lat: 30.2913,
        lng: -95.4758,
        state_code: 'TX',
        city: 'Conroe',
        stripe_payment_intent: 'pi_test_' + Math.random().toString(36).slice(2,10),
        hiding_spot: 'Test location · Conroe TX',
        payment_type: 'finderseek',
        clue_persona: 'pirate',
        clue_count: 3,
      }])
      .select();

    if (huntErr) throw new Error(JSON.stringify(huntErr));
    const hunt = hunts[0];

    // Insert test clues
    const { error: clueErr } = await supabase
      .from('clues')
      .insert([
        { hunt_id: hunt.id, clue_number: 1, tier: 'free', clue_text: 'Test clue 1 — head to the starting point to begin your hunt!', clue_question: 'What color is the sky?', clue_answer: 'blue', reveal_at: now.toISOString(), is_photo: false, is_finder: false, day_label: 'Day 1', date_label: 'Test' },
        { hunt_id: hunt.id, clue_number: 2, tier: 'free', clue_text: 'Test clue 2 — you are getting closer to the treasure!', clue_question: 'What is 2 + 2?', clue_answer: '4', reveal_at: null, is_photo: false, is_finder: false, day_label: 'Day 1', date_label: 'Test' },
        { hunt_id: hunt.id, clue_number: 3, tier: 'free', clue_text: 'Test clue 3 — the treasure is near! Enter the PIN 000000 to claim.', clue_question: 'What number comes after 2?', clue_answer: '3', reveal_at: null, is_photo: true, photo_url: 'map:100', is_finder: false, day_label: 'Day 1', date_label: 'Test' },
      ]);

    if (clueErr) console.warn('Clue insert error:', JSON.stringify(clueErr));

    return res.status(200).json({
      success: true,
      huntId: hunt.id,
      expiresAt: expiresAt.toISOString(),
      prize: (prize/100).toFixed(2),
    });

  } catch(err) {
    console.error('[admin-create-quest]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
