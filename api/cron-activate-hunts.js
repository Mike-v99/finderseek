// api/cron-activate-hunts.js
// Vercel Cron Job — runs every 15 minutes
// Activates scheduled hunts whose starts_at time has passed
// Also ends hunts whose ends_at time has passed
//
// Add to vercel.json:
// {
//   "crons": [{"path": "/api/cron-activate-hunts", "schedule": "*/15 * * * *"}]
// }

export default async function handler(req, res) {
  // Only allow Vercel cron calls
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SB  = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const H   = { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };
  const now = new Date().toISOString();

  try {
    // 1. Activate scheduled hunts whose starts_at has passed
    const activateRes = await fetch(`${SB}/rest/v1/hunts?status=eq.scheduled&starts_at=lte.${now}`, {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({ status: 'active' })
    });

    // 2. End active hunts whose ends_at has passed
    const endRes = await fetch(`${SB}/rest/v1/hunts?status=eq.active&ends_at=lte.${now}&winner_id=is.null`, {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({ status: 'ended' })
    });

    console.log('[cron] activate:', activateRes.status, '| end:', endRes.status);
    return res.status(200).json({ ok: true, time: now });
  } catch(e) {
    console.error('[cron]', e);
    return res.status(500).json({ error: e.message });
  }
}
