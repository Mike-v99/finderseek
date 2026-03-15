// api/cron-activate-hunts.js
// Vercel Cron Job — runs daily (Hobby plan) or every 15 min (Pro plan)
//
// 1. Activates scheduled quests whose starts_at has passed
// 2. Ends active hunts whose ends_at has passed (no winner)
// 3. Refunds escrow for expired quests with no winner
// 4. Sends notifications for expired quests
//
// Env vars needed:
//   CRON_SECRET           — Vercel cron auth
//   SUPABASE_URL          — https://...supabase.co
//   SUPABASE_SERVICE_KEY  — service role key
//   STRIPE_SECRET_KEY     — sk_live_... (for refunds)
//   NOTIFY_SECRET         — shared secret for notify API

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SB  = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const H   = { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const now = new Date().toISOString();
  const results = [];

  // Helper to call notify API
  async function fireNotify(event, huntId) {
    const origin = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://finderseek.com';
    return fetch(`${origin}/api/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finderseek-secret': process.env.NOTIFY_SECRET
      },
      body: JSON.stringify({ event, huntId })
    });
  }

  try {
    // ── 1. Activate scheduled quests ──────────────────────────────
    const activateRes = await fetch(`${SB}/rest/v1/hunts?status=eq.scheduled&starts_at=lte.${now}`, {
      method: 'PATCH',
      headers: { ...H, 'Prefer': 'return=representation' },
      body: JSON.stringify({ status: 'active' })
    });
    const activated = activateRes.ok ? await activateRes.json() : [];
    results.push(`activated:${activated.length}`);

    // Fire notifications for newly activated quests
    for (const hunt of activated) {
      fireNotify('hunt_approved', hunt.id).catch(() => {});
    }

    // ── 2. Find & end expired active quests (no winner) ──────────
    const expiredRes = await fetch(
      `${SB}/rest/v1/hunts?status=eq.active&ends_at=lte.${now}&winner_id=is.null&select=id,city,prize_desc,prize_value,pirate_id,payment_type,escrow_status,stripe_payment_intent`,
      { headers: H }
    );
    const expiredHunts = expiredRes.ok ? await expiredRes.json() : [];

    for (const hunt of expiredHunts) {
      // Mark as ended
      await fetch(`${SB}/rest/v1/hunts?id=eq.${hunt.id}`, {
        method: 'PATCH',
        headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'ended' })
      });

      // ── 3. Refund escrow if funded and no winner ──────────────
      if ((hunt.payment_type === 'escrow' || hunt.payment_type === 'finderseek') && hunt.escrow_status === 'funded' && hunt.stripe_payment_intent) {
        try {
          const refundAmount = hunt.prize_value || 0; // prize_value is in cents, excludes the 10% fee
          const refundParams = new URLSearchParams({
              'payment_intent': hunt.stripe_payment_intent,
              'reason': 'requested_by_customer',
              'metadata[type]': 'escrow_expired',
              'metadata[huntId]': hunt.id,
            });
          if (refundAmount > 0) refundParams.set('amount', refundAmount);
          const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: refundParams
          });
          const refund = await refundRes.json();

          if (refund.id) {
            await fetch(`${SB}/rest/v1/hunts?id=eq.${hunt.id}`, {
              method: 'PATCH',
              headers: { ...H, 'Prefer': 'return=minimal' },
              body: JSON.stringify({
                escrow_status: 'refunded',
                stripe_refund_id: refund.id
              })
            });
            results.push(`refunded:${hunt.id}`);
          } else {
            console.error(`[cron] refund failed for hunt ${hunt.id}:`, refund.error?.message);
            results.push(`refund_failed:${hunt.id}`);
          }
        } catch (e) {
          console.error(`[cron] refund error for hunt ${hunt.id}:`, e.message);
          results.push(`refund_error:${hunt.id}`);
        }
      }

      // ── 4. Notify pirate that quest expired ─────────────────────
      fireNotify('hunt_expired', hunt.id).catch(() => {});
    }

    results.push(`ended:${expiredHunts.length}`);

    // ── 5. Also end hunts WITH a winner that are still 'active' ─
    const wonButActive = await fetch(
      `${SB}/rest/v1/hunts?status=eq.active&winner_id=not.is.null`,
      { headers: H }
    );
    const wonHunts = wonButActive.ok ? await wonButActive.json() : [];
    if (wonHunts.length) {
      await fetch(`${SB}/rest/v1/hunts?status=eq.active&winner_id=not.is.null`, {
        method: 'PATCH',
        headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'ended' })
      });
      results.push(`force_ended_won:${wonHunts.length}`);
    }

    // ── 6. Safety net: refund any ended escrow quests with no winner that missed refund ─
    const missedRefunds = await fetch(
      `${SB}/rest/v1/hunts?status=eq.ended&winner_id=is.null&escrow_status=eq.funded&stripe_payment_intent=not.is.null&select=id,stripe_payment_intent,payment_type,prize_value`,
      { headers: H }
    );
    const missedList = missedRefunds.ok ? await missedRefunds.json() : [];
    for (const hunt of missedList) {
      try {
        const refundAmount = hunt.prize_value || 0;
        const refundParams = new URLSearchParams({
          'payment_intent': hunt.stripe_payment_intent,
          'reason': 'requested_by_customer',
        });
        if (refundAmount > 0) refundParams.set('amount', refundAmount);
        const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: refundParams
        });
        const refund = await refundRes.json();
        if (refund.id) {
          await fetch(`${SB}/rest/v1/hunts?id=eq.${hunt.id}`, {
            method: 'PATCH',
            headers: { ...H, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ escrow_status: 'refunded', stripe_refund_id: refund.id })
          });
          results.push(`late_refund:${hunt.id}`);
        }
      } catch(e) { results.push(`late_refund_err:${hunt.id}`); }
    }
    if (missedList.length) results.push(`missed_refunds_checked:${missedList.length}`);

    console.log('[cron]', results.join(' | '), 'at', now);
    return res.status(200).json({ ok: true, results, time: now });

  } catch (e) {
    console.error('[cron]', e);
    return res.status(500).json({ error: e.message });
  }
}
