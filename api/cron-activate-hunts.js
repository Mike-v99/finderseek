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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-finderseek-secret, x-admin-token");
  if (req.method === "OPTIONS") return res.status(200).end();
  const notifySecret = process.env.NOTIFY_SECRET || process.env.FINDERSEEK_NOTIFY_SECRET;
  const cronSecret   = process.env.CRON_SECRET;

  // ── On-demand single-hunt expiry (called by quest.html on page load) ──────
  // POST with x-finderseek-secret + body { huntId } to expire one specific hunt
  // immediately rather than waiting for the 8am cron. Auth uses NOTIFY_SECRET
  // so the client doesn't need the privileged CRON_SECRET.
  if (req.method === 'POST') {
    if (!notifySecret || req.headers['x-finderseek-secret'] !== notifySecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { huntId } = req.body || {};
    if (!huntId) return res.status(400).json({ error: 'Missing huntId' });

    const SB  = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    const H   = { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };

    try {
      // Fetch the specific hunt
      const r = await fetch(`${SB}/rest/v1/hunts?id=eq.${huntId}&select=id,city,prize_desc,prize_value,pirate_id,payment_type,escrow_status,stripe_payment_intent,status,ends_at,winner_id`, { headers: H });
      const rows = await r.json();
      const hunt = rows?.[0];

      if (!hunt) return res.status(404).json({ error: 'Hunt not found' });

      const now = new Date();
      const endsAt = hunt.ends_at ? new Date(hunt.ends_at) : null;

      // Only expire if: active, past ends_at, no winner
      if (hunt.status !== 'active' || !endsAt || endsAt > now || hunt.winner_id) {
        return res.status(200).json({ ok: true, skipped: true, reason: 'Not eligible for expiry', status: hunt.status });
      }

      // Mark as ended
      await fetch(`${SB}/rest/v1/hunts?id=eq.${huntId}`, {
        method: 'PATCH',
        headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'ended' })
      });

      const result = { huntId, ended: true, refunded: false, notified: false };

      // Refund escrow if funded
      if ((hunt.payment_type === 'escrow' || hunt.payment_type === 'finderseek') &&
          hunt.escrow_status === 'funded' && hunt.stripe_payment_intent) {
        try {
          const refundAmount = hunt.prize_value || 0;
          console.log(`[expire] refunding hunt ${huntId}: ${refundAmount} cents`);
          // Safety cap
          if (refundAmount > 11000) {
            console.error(`[expire] BLOCKED: refundAmount=${refundAmount} exceeds $110 cap for hunt ${huntId}`);
            result.refundError = 'Amount exceeds safety cap';
            break;
          }
          const refundParams = new URLSearchParams({
            'payment_intent': hunt.stripe_payment_intent,
            'reason': 'requested_by_customer',
            'metadata[type]': 'escrow_expired',
            'metadata[huntId]': huntId,
          });
          if (refundAmount > 0) refundParams.set('amount', refundAmount);
          const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: refundParams
          });
          const refund = await refundRes.json();
          if (refund.id) {
            await fetch(`${SB}/rest/v1/hunts?id=eq.${huntId}`, {
              method: 'PATCH',
              headers: { ...H, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ escrow_status: 'refunded', stripe_refund_id: refund.id })
            });
            console.log(`[expire] refund SUCCESS ${refund.id}`);
            result.refunded = true;
            result.refundId = refund.id;
          } else {
            console.error(`[expire] refund FAILED:`, JSON.stringify(refund.error));
            result.refundError = refund.error?.message;
          }
        } catch (e) {
          console.error(`[expire] refund error:`, e.message);
          result.refundError = e.message;
        }
      }

      // Send expiry notification + email
      try {
        if (notifySecret) {
          const notifyRes = await fetch('https://www.finderseek.com/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-finderseek-secret': notifySecret },
            body: JSON.stringify({ event: 'hunt_expired', huntId })
          });
          const body = await notifyRes.text();
          console.log(`[expire] notify -> ${notifyRes.status}: ${body.slice(0, 200)}`);
          result.notified = notifyRes.ok;
        }
      } catch (e) {
        console.error(`[expire] notify error:`, e.message);
      }

      return res.status(200).json({ ok: true, ...result });
    } catch (e) {
      console.error('[expire]', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Standard cron path (GET from Vercel scheduler) ───────────────────────
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SB  = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const H   = { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const now = new Date().toISOString();
  const results = [];

  // Helper to call notify API — always awaited so Vercel doesn't kill the promise
  async function fireNotify(event, huntId) {
    const notifySecret = process.env.NOTIFY_SECRET || process.env.FINDERSEEK_NOTIFY_SECRET;
    if (!notifySecret) {
      console.warn('[cron] NOTIFY_SECRET not set — skipping notify for', event, huntId);
      return;
    }
    try {
      const notifyRes = await fetch('https://www.finderseek.com/api/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-finderseek-secret': notifySecret
        },
        body: JSON.stringify({ event, huntId })
      });
      const body = await notifyRes.text();
      console.log(`[cron] notify(${event}, ${huntId}) -> ${notifyRes.status}: ${body.slice(0, 200)}`);
    } catch (e) {
      console.error(`[cron] notify error (non-fatal) for ${event} ${huntId}:`, e.message);
    }
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

    // Fire notifications for newly activated quests (awaited — Vercel kills fire-and-forget)
    for (const hunt of activated) {
      await fireNotify('hunt_approved', hunt.id);
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
          console.log(`[cron] attempting refund for hunt ${hunt.id}: prize_value=${refundAmount} cents, pi=${hunt.stripe_payment_intent}`);
          // Safety cap
          if (refundAmount > 11000) {
            console.error(`[cron] BLOCKED: refundAmount=${refundAmount} exceeds $110 cap for hunt ${hunt.id}`);
            results.push(`refund_blocked_cap:${hunt.id}`);
            continue;
          }
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
            console.log(`[cron] refund SUCCESS for hunt ${hunt.id}: refund_id=${refund.id} amount=${refundAmount}`);
            results.push(`refunded:${hunt.id}`);
          } else {
            console.error(`[cron] refund FAILED for hunt ${hunt.id}:`, JSON.stringify(refund.error));
            results.push(`refund_failed:${hunt.id}`);
          }
        } catch (e) {
          console.error(`[cron] refund error for hunt ${hunt.id}:`, e.message);
          results.push(`refund_error:${hunt.id}`);
        }
      } else {
        console.log(`[cron] hunt ${hunt.id} skipped refund: payment_type=${hunt.payment_type} escrow_status=${hunt.escrow_status} pi=${hunt.stripe_payment_intent || 'null'}`);
      }

      // ── 4. Notify pirate that quest expired (awaited — Vercel kills fire-and-forget)
      await fireNotify('hunt_expired', hunt.id);
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
