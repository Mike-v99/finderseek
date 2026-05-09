// api/cron-activate-hunts.js
// Vercel Cron Job — runs daily (Hobby plan) or every 15 min (Pro plan)
//
// 1. Activates scheduled quests whose starts_at has passed
// 2. Ends active hunts whose ends_at has passed (no winner)
// 3. Refunds escrow (prize amount only, keeps the 10% platform fee) for
//    expired quests with no winner — via PayPal Captures Refund API.
// 4. Sends notifications for expired quests
//
// Env vars needed:
//   CRON_SECRET           — Vercel cron auth
//   SUPABASE_URL          — https://...supabase.co
//   SUPABASE_SERVICE_KEY  — service role key
//   PAYPAL_CLIENT_ID      — live or sandbox client id
//   PAYPAL_CLIENT_SECRET  — matching secret
//   PAYPAL_MODE           — 'live' or 'sandbox' (defaults to 'live')
//   NOTIFY_SECRET         — shared secret for notify API

// ── PayPal helpers ────────────────────────────────────────────────────
async function getPayPalToken() {
  const mode = (process.env.PAYPAL_MODE || 'live').toLowerCase();
  const base = mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const cid = process.env.PAYPAL_CLIENT_ID;
  const csec = process.env.PAYPAL_CLIENT_SECRET;
  if (!cid || !csec) throw new Error('PayPal credentials not configured');
  const auth = Buffer.from(`${cid}:${csec}`).toString('base64');
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('PayPal auth failed: ' + JSON.stringify(data));
  return { token: data.access_token, base };
}

// Refund a captured PayPal payment. amountUsd is a number like 1.00 (dollars).
// Returns { ok, refundId, error }.
async function paypalRefundCapture(captureId, amountUsd, huntId) {
  try {
    const { token, base } = await getPayPalToken();
    const body = {
      amount: { value: Number(amountUsd).toFixed(2), currency_code: 'USD' },
      note_to_payer: 'FinderSeek quest expired with no winner — prize amount refunded',
      invoice_id: `FS-EXPIRE-${huntId}`,
    };
    const r = await fetch(`${base}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Idempotency guard — re-running the cron won't double-refund
        'PayPal-Request-Id': `expire-${huntId}`
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (data.id && (data.status === 'COMPLETED' || data.status === 'PENDING')) {
      return { ok: true, refundId: data.id, status: data.status };
    }
    return { ok: false, error: data?.message || data?.details?.[0]?.description || JSON.stringify(data) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

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
      const r = await fetch(`${SB}/rest/v1/hunts?id=eq.${huntId}&select=id,city,prize_desc,prize_value,pirate_id,payment_type,escrow_status,stripe_payment_intent,paypal_capture_id,status,ends_at,winner_id`, { headers: H });
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

      // Refund escrow if funded — refunds PRIZE only, keeps the 10% platform fee
      if ((hunt.payment_type === 'escrow' || hunt.payment_type === 'finderseek') &&
          hunt.escrow_status === 'funded' && hunt.paypal_capture_id) {
        const refundCents = hunt.prize_value || 0; // prize_value in cents, EXCLUDES the platform fee
        const refundDollars = refundCents / 100;
        console.log(`[expire] refunding hunt ${huntId}: $${refundDollars.toFixed(2)} (capture ${hunt.paypal_capture_id})`);
        // Safety cap
        if (refundCents > 11000) {
          console.error(`[expire] BLOCKED: refundAmount=${refundCents} exceeds $110 cap for hunt ${huntId}`);
          result.refundError = 'Amount exceeds safety cap';
        } else if (refundCents <= 0) {
          result.refundError = 'Invalid prize value';
        } else {
          const r2 = await paypalRefundCapture(hunt.paypal_capture_id, refundDollars, huntId);
          if (r2.ok) {
            await fetch(`${SB}/rest/v1/hunts?id=eq.${huntId}`, {
              method: 'PATCH',
              headers: { ...H, 'Prefer': 'return=minimal' },
              // We reuse stripe_refund_id column to store the PayPal refund id —
              // saves an SQL migration. Rename later if you care.
              body: JSON.stringify({ escrow_status: 'refunded', stripe_refund_id: r2.refundId })
            });
            console.log(`[expire] refund SUCCESS ${r2.refundId} status=${r2.status}`);
            result.refunded = true;
            result.refundId = r2.refundId;
          } else {
            console.error(`[expire] refund FAILED:`, r2.error);
            result.refundError = r2.error;
          }
        }
      } else if ((hunt.payment_type === 'escrow' || hunt.payment_type === 'finderseek') &&
                 hunt.escrow_status === 'funded' && !hunt.paypal_capture_id) {
        // Legacy Stripe-funded quest with no PayPal capture id — log and skip
        console.warn(`[expire] hunt ${huntId} is escrow/funded but has no paypal_capture_id (legacy Stripe quest?). Skipping refund.`);
        result.refundError = 'Legacy Stripe payment — refund manually';
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
      `${SB}/rest/v1/hunts?status=eq.active&ends_at=lte.${now}&winner_id=is.null&select=id,city,prize_desc,prize_value,pirate_id,payment_type,escrow_status,stripe_payment_intent,paypal_capture_id`,
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
      // Refund the PRIZE only (10% platform fee is non-refundable).
      if ((hunt.payment_type === 'escrow' || hunt.payment_type === 'finderseek') && hunt.escrow_status === 'funded' && hunt.paypal_capture_id) {
        const refundCents = hunt.prize_value || 0; // cents, EXCLUDES platform fee
        const refundDollars = refundCents / 100;
        console.log(`[cron] attempting refund for hunt ${hunt.id}: $${refundDollars.toFixed(2)} (capture ${hunt.paypal_capture_id})`);
        // Safety cap
        if (refundCents > 11000) {
          console.error(`[cron] BLOCKED: refundAmount=${refundCents} exceeds $110 cap for hunt ${hunt.id}`);
          results.push(`refund_blocked_cap:${hunt.id}`);
        } else if (refundCents <= 0) {
          results.push(`refund_skipped_zero:${hunt.id}`);
        } else {
          const r2 = await paypalRefundCapture(hunt.paypal_capture_id, refundDollars, hunt.id);
          if (r2.ok) {
            await fetch(`${SB}/rest/v1/hunts?id=eq.${hunt.id}`, {
              method: 'PATCH',
              headers: { ...H, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ escrow_status: 'refunded', stripe_refund_id: r2.refundId })
            });
            console.log(`[cron] refund SUCCESS for hunt ${hunt.id}: refund_id=${r2.refundId} amount=$${refundDollars.toFixed(2)}`);
            results.push(`refunded:${hunt.id}`);
          } else {
            console.error(`[cron] refund FAILED for hunt ${hunt.id}: ${r2.error}`);
            results.push(`refund_failed:${hunt.id}`);
          }
        }
      } else if ((hunt.payment_type === 'escrow' || hunt.payment_type === 'finderseek') && hunt.escrow_status === 'funded' && !hunt.paypal_capture_id) {
        // Legacy Stripe-funded quest — log so admin can refund manually
        console.warn(`[cron] hunt ${hunt.id} legacy Stripe quest — manual refund required (pi=${hunt.stripe_payment_intent || 'none'})`);
        results.push(`legacy_stripe:${hunt.id}`);
      } else {
        console.log(`[cron] hunt ${hunt.id} skipped refund: payment_type=${hunt.payment_type} escrow_status=${hunt.escrow_status} capture=${hunt.paypal_capture_id || 'null'}`);
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
    // Only handles PayPal-captured quests; legacy Stripe quests need manual handling.
    const missedRefunds = await fetch(
      `${SB}/rest/v1/hunts?status=eq.ended&winner_id=is.null&escrow_status=eq.funded&paypal_capture_id=not.is.null&select=id,paypal_capture_id,payment_type,prize_value`,
      { headers: H }
    );
    const missedList = missedRefunds.ok ? await missedRefunds.json() : [];
    for (const hunt of missedList) {
      try {
        const refundCents = hunt.prize_value || 0;
        const refundDollars = refundCents / 100;
        if (refundCents <= 0 || refundCents > 11000) {
          results.push(`late_refund_skipped:${hunt.id}`);
          continue;
        }
        const r2 = await paypalRefundCapture(hunt.paypal_capture_id, refundDollars, hunt.id);
        if (r2.ok) {
          await fetch(`${SB}/rest/v1/hunts?id=eq.${hunt.id}`, {
            method: 'PATCH',
            headers: { ...H, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ escrow_status: 'refunded', stripe_refund_id: r2.refundId })
          });
          results.push(`late_refund:${hunt.id}`);
        } else {
          results.push(`late_refund_failed:${hunt.id}`);
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
