// api/paypal-capture.js
// Captures an approved PayPal order and activates the quest.
// Called from the client after PayPal approval.
//
// Env vars: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE,
//           SUPABASE_URL, SUPABASE_SERVICE_KEY, NOTIFY_SECRET


// Generate TTS audio for all clues of a hunt using service key
async function generateTtsForHunt(huntId, sbUrl, sbKey) {
  const notifySecret = process.env.NOTIFY_SECRET || process.env.FINDERSEEK_NOTIFY_SECRET;
  if (!notifySecret) return;

  // Fetch hunt persona + location riddle
  const huntRes = await fetch(`${sbUrl}/rest/v1/hunts?id=eq.${huntId}&select=clue_persona,location_riddle`, {
    headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` }
  });
  const hunts = await huntRes.json();
  const hunt = hunts?.[0];
  if (!hunt) { console.warn('[tts] Hunt not found:', huntId); return; }
  const persona = hunt.clue_persona || 'pirate';

  // Fetch clues
  const cluesRes = await fetch(`${sbUrl}/rest/v1/clues?hunt_id=eq.${huntId}&select=id,clue_number,clue_text&order=clue_number.asc`, {
    headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` }
  });
  const clues = await cluesRes.json();
  if (!Array.isArray(clues) || clues.length === 0) { console.warn('[tts] No clues for hunt:', huntId); return; }

  console.log(`[tts] Generating ${clues.length} clue audio + location riddle for hunt ${huntId} persona ${persona}`);

  const ttsBase = 'https://www.finderseek.com';
  const headers = { 'Content-Type': 'application/json', 'x-finderseek-secret': notifySecret };

  // Generate clue audio sequentially
  for (const clue of clues) {
    try {
      const r = await fetch(`${ttsBase}/api/tts`, {
        method: 'POST', headers,
        body: JSON.stringify({ text: clue.clue_text, persona, clueId: clue.id, type: 'clue',
          dbId: clue.id, dbTable: 'clues', dbColumn: 'audio_url' })
      });
      const d = await r.json();
      if (d.success) console.log(`[tts] ✓ Clue ${clue.clue_number}`);
      else console.warn(`[tts] ✗ Clue ${clue.clue_number}:`, d.error);
    } catch(e) { console.warn(`[tts] ✗ Clue ${clue.clue_number}:`, e.message); }
  }

  // Generate location riddle audio
  if (hunt.location_riddle) {
    try {
      const r = await fetch(`${ttsBase}/api/tts`, {
        method: 'POST', headers,
        body: JSON.stringify({ text: hunt.location_riddle, persona, clueId: huntId + '_loc', type: 'location',
          dbId: huntId, dbTable: 'hunts', dbColumn: 'location_riddle_audio_url' })
      });
      const d = await r.json();
      if (d.success) console.log('[tts] ✓ Location riddle');
      else console.warn('[tts] ✗ Location riddle:', d.error);
    } catch(e) { console.warn('[tts] ✗ Location riddle:', e.message); }
  }

  console.log('[tts] ✓ All audio generation complete for hunt:', huntId);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-finderseek-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { orderId, huntId } = req.body || {};
  if (!orderId || !huntId) return res.status(400).json({ error: 'Missing orderId or huntId' });

  try {
    // 1. Get PayPal token
    const mode = process.env.PAYPAL_MODE || 'sandbox';
    const base = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');

    const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('PayPal auth failed');
    const token = tokenData.access_token;

    // 2. Capture the order
    const captureRes = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });
    const capture = await captureRes.json();

    // PayPal returns 4xx with details when capture fails (e.g., card declined).
    // Surface the specific issue code so the client can show a useful message.
    if (!captureRes.ok || capture.status !== 'COMPLETED') {
      console.error('[paypal-capture] Not completed:', capture);
      const issue = capture.details?.[0]?.issue || '';
      const description = capture.details?.[0]?.description || capture.message || 'Payment not completed';
      return res.status(400).json({
        error: issue ? `${issue}: ${description}` : description,
        issue,
        status: capture.status,
      });
    }

    console.log('[paypal-capture] Payment captured:', orderId, 'hunt:', huntId);

    // 3. Extract payment details
    const captureDetail = capture.purchase_units?.[0]?.payments?.captures?.[0];
    const paypalPaymentId = captureDetail?.id || orderId;
    // custom_id format: "huntId|prizeAmount" (max 127 chars)
    const customId = capture.purchase_units?.[0]?.custom_id || '';
    const customParts = customId.split('|');
    const prizeAmount = parseFloat(customParts[1] || 0);

    // 4. Mark quest funded — go live now ONLY if its start time has arrived.
    // Future-scheduled quests get status 'scheduled'; cron-activate-hunts.js
    // flips them to active (and sends the live notification) at starts_at.
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_KEY;

    let newStatus = 'active';
    try {
      const startRes = await fetch(`${sbUrl}/rest/v1/hunts?id=eq.${huntId}&select=starts_at`, {
        headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` }
      });
      const startData = await startRes.json();
      const startsAt = startData?.[0]?.starts_at;
      if (startsAt && new Date(startsAt).getTime() > Date.now()) {
        newStatus = 'scheduled';
      }
    } catch (e) {
      console.error('[paypal-capture] starts_at check failed, defaulting to active:', e.message);
    }

    await fetch(`${sbUrl}/rest/v1/hunts?id=eq.${huntId}`, {
      method: 'PATCH',
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        status: newStatus,
        escrow_status: 'funded',
        escrow_amount: Math.round(prizeAmount * 100),
        paypal_order_id: orderId,
        paypal_capture_id: paypalPaymentId,
      })
    });

    console.log('[paypal-capture] Quest funded; status:', newStatus, 'hunt:', huntId);

    // 5. Generate quest ID
    try {
      const huntRes = await fetch(`${sbUrl}/rest/v1/hunts?id=eq.${huntId}&select=state_code,quest_id`, {
        headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` }
      });
      const huntData = await huntRes.json();
      const hunt = huntData?.[0];
      if (hunt && !hunt.quest_id) {
        const stateCode = (hunt.state_code || 'US').toUpperCase().slice(0, 2);
        const idRes = await fetch(`${sbUrl}/rest/v1/rpc/generate_quest_id`, {
          method: 'POST',
          headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_state: stateCode })
        });
        const questId = await idRes.json();
        if (questId) {
          await fetch(`${sbUrl}/rest/v1/hunts?id=eq.${huntId}`, {
            method: 'PATCH',
            headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ quest_id: questId })
          });
          console.log('[paypal-capture] Quest ID assigned:', questId);
        }
      }
    } catch(e) { console.error('[paypal-capture] Quest ID error:', e.message); }

    // 6. Send notification emails (quest master + city seekers)
    try {
      const notifySecret = process.env.NOTIFY_SECRET || process.env.FINDERSEEK_NOTIFY_SECRET;
      if (notifySecret && newStatus === 'active') {
        await fetch('https://www.finderseek.com/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-finderseek-secret': notifySecret },
          body: JSON.stringify({ event: 'hunt_approved', huntId })
        });
        console.log('[paypal-capture] Notify sent for hunt:', huntId);
      }
    } catch(e) { console.error('[paypal-capture] Notify error:', e.message); }

    // 7. Generate TTS audio server-side without blocking the response.
    // Vercel kills plain background promises when the response is sent, so use
    // waitUntil (keeps the function alive until the task finishes). Falls back
    // to fire-and-forget if @vercel/functions isn't installed.
    const ttsTask = generateTtsForHunt(huntId, sbUrl, sbKey).catch(function(e) {
      console.warn('[paypal-capture] TTS generation failed (non-fatal):', e.message);
    });
    try {
      const { waitUntil } = await import('@vercel/functions');
      waitUntil(ttsTask);
      console.log('[paypal-capture] TTS task registered with waitUntil');
    } catch(e) {
      console.warn('[paypal-capture] @vercel/functions unavailable, TTS may not complete:', e.message);
    }

    return res.status(200).json({
      success: true,
      captureId: paypalPaymentId,
      questId: huntId,
    });

  } catch(e) {
    console.error('[paypal-capture] Error:', e);
    return res.status(500).json({ error: e.message });
  }
}
