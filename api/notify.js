// api/notify.js
// FinderSeek — Email notification handler via Resend
//
// Environment variables required (set in Vercel dashboard):
//   RESEND_API_KEY     — from resend.com
//   SUPABASE_URL       — https://qeiuycuasjkopxfkmggp.supabase.co
//   SUPABASE_SERVICE_KEY — service role key (NOT anon key) from Supabase → Settings → API
//
// Called by:
//   admin.html    → event: 'hunt_approved'
//   hunt.html     → event: 'prize_claimed'
//   hunt.html     → event: 'chat_message'

const RESEND_URL = 'https://api.resend.com/emails';
const FROM = 'FinderSeek <notifications@mylocalpaws.com>';
const SITE_URL   = 'https://finderseek.com';

// ── Colours / styles used in all emails ──────────────────────────
const CSS = `
  body { background:#06050a; margin:0; padding:0; font-family:'Helvetica Neue',Arial,sans-serif; }
  .wrap { max-width:560px; margin:0 auto; background:#0e0c14; border:1px solid rgba(201,137,12,.2); border-radius:16px; overflow:hidden; }
  .header { background:linear-gradient(135deg,#1a1628,#0e0c14); padding:32px 36px 24px; border-bottom:1px solid rgba(255,255,255,.06); }
  .logo { font-size:22px; font-weight:800; color:#f5ead8; letter-spacing:1px; }
  .logo em { font-style:italic; color:#c9890c; }
  .body { padding:28px 36px 32px; }
  h1 { font-size:26px; font-weight:800; color:#f5ead8; margin:0 0 10px; letter-spacing:.5px; }
  p { font-size:15px; color:#c8b48a; line-height:1.7; margin:0 0 16px; }
  .highlight { background:rgba(201,137,12,.1); border:1px solid rgba(201,137,12,.25); border-radius:12px; padding:16px 20px; margin:20px 0; }
  .highlight-label { font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7a5a; margin-bottom:4px; font-family:monospace; }
  .highlight-val { font-size:18px; font-weight:800; color:#e8a820; }
  .btn { display:inline-block; background:linear-gradient(135deg,#b45309,#e8a820); color:#0a0800 !important; text-decoration:none; border-radius:10px; padding:13px 28px; font-size:15px; font-weight:800; margin:8px 0 20px; }
  .footer { padding:20px 36px; border-top:1px solid rgba(255,255,255,.05); font-size:11px; color:#8a7a5a; line-height:1.8; font-family:monospace; }
  .divider { border:none; border-top:1px solid rgba(255,255,255,.05); margin:20px 0; }
`;

function html(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${CSS}</style></head>
  <body><div style="padding:24px 16px;">
  <div class="wrap">
    <div class="header"><div class="logo">Finder<em>Seek</em></div></div>
    <div class="body">${body}</div>
    <div class="footer">
      You're receiving this because you have notifications enabled.<br/>
      <a href="${SITE_URL}/profile.html" style="color:#c9890c;">Manage notification preferences</a>
      &nbsp;·&nbsp; FinderSeek · finderseek.com
    </div>
  </div>
  </div></body></html>`;
}

// ── Email templates ───────────────────────────────────────────────

function tplHuntApproved({ username, city, prize, huntUrl }) {
  return {
    subject: `🏴‍☠️ Your hunt is LIVE in ${city}!`,
    html: html('Hunt Approved', `
      <h1>Your Hunt is Live! 🏴‍☠️</h1>
      <p>Hey ${username}, great news — your treasure hunt has been approved by our team and is now live for seekers in <strong style="color:#f5ead8;">${city}</strong>.</p>
      <div class="highlight">
        <div class="highlight-label">Prize</div>
        <div class="highlight-val">${prize}</div>
      </div>
      <p>Seekers are already hunting. You'll get another email as soon as someone claims your prize!</p>
      <a href="${huntUrl}" class="btn">View Your Hunt →</a>
      <hr class="divider"/>
      <p style="font-size:13px;">When someone wins, chat with them through the hunt page to arrange prize delivery.</p>
    `)
  };
}

function tplPrizeClaimed({ username, city, prize, winnerName, huntUrl }) {
  return {
    subject: `🏆 Someone found your treasure in ${city}!`,
    html: html('Prize Claimed', `
      <h1>Your Treasure Was Found! 🏆</h1>
      <p>Hey ${username}, <strong style="color:#4ade80;">${winnerName}</strong> just claimed your prize in <strong style="color:#f5ead8;">${city}</strong>.</p>
      <div class="highlight">
        <div class="highlight-label">Prize to deliver</div>
        <div class="highlight-val">${prize}</div>
      </div>
      <p>Head to the hunt page to chat with the winner and arrange delivery.</p>
      <a href="${huntUrl}" class="btn">Open Winner Chat →</a>
    `)
  };
}

function tplYouWon({ username, city, prize, huntUrl }) {
  return {
    subject: `🏆 You won the FinderSeek hunt in ${city}!`,
    html: html('You Won!', `
      <h1>You Found the Treasure! 🏆</h1>
      <p>Congratulations ${username}! You successfully claimed the prize in <strong style="color:#f5ead8;">${city}</strong>.</p>
      <div class="highlight">
        <div class="highlight-label">Your prize</div>
        <div class="highlight-val">${prize}</div>
      </div>
      <p>The Pirate has been notified. Chat with them on the hunt page to arrange how you receive your prize.</p>
      <a href="${huntUrl}" class="btn">Open Pirate Chat →</a>
    `)
  };
}

function tplChatMessage({ username, senderName, senderRole, preview, huntUrl, city }) {
  const roleLabel = senderRole === 'pirate' ? '🏴‍☠️ Pirate' : '🏆 Winner';
  return {
    subject: `💬 New message from your ${senderRole === 'pirate' ? 'Pirate' : 'Winner'} — ${city}`,
    html: html('New Message', `
      <h1>New Message 💬</h1>
      <p>Hey ${username}, <strong style="color:#f5ead8;">${senderName}</strong> (${roleLabel}) sent you a message about the <strong style="color:#f5ead8;">${city}</strong> hunt.</p>
      <div class="highlight">
        <div class="highlight-label">Message preview</div>
        <div class="highlight-val" style="font-size:15px;font-weight:600;">"${preview}"</div>
      </div>
      <a href="${huntUrl}" class="btn">Reply in Chat →</a>
    `)
  };
}

function tplNewHuntInCity({ username, city, prize, huntUrl }) {
  return {
    subject: `🗺️ New treasure hidden in ${city}!`,
    html: html('New Hunt', `
      <h1>New Hunt in ${city}! 🗺️</h1>
      <p>Hey ${username}, a new treasure hunt just went live in your city.</p>
      <div class="highlight">
        <div class="highlight-label">Prize up for grabs</div>
        <div class="highlight-val">${prize}</div>
      </div>
      <p>Clues drop throughout the hunt — the faster you solve them, the better your chances. Good luck!</p>
      <a href="${huntUrl}" class="btn">Start Hunting →</a>
    `)
  };
}

// ── Send via Resend ───────────────────────────────────────────────
async function sendEmail(to, subject, htmlBody) {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM, to, subject, html: htmlBody })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Resend error');
  return data;
}

// ── Supabase helper (uses service role key for full access) ───────
async function sbFetch(path, opts = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  return res.json();
}

// ── Main handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Simple shared secret to prevent abuse
  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { event, huntId, senderId } = req.body;
  if (!event || !huntId) return res.status(400).json({ error: 'Missing event or huntId' });

  try {
    // Fetch hunt + pirate profile + winner profile
    const hunts = await sbFetch(`hunts?id=eq.${huntId}&select=id,city,prize_desc,pirate_id,winner_id,status`);
    const hunt  = hunts?.[0];
    if (!hunt) return res.status(404).json({ error: 'Hunt not found' });

    const huntUrl = `${SITE_URL}/hunt.html?id=${huntId}`;
    const results = [];

    // ── hunt_approved ─────────────────────────────────────────────
    // Email pirate: their hunt is live
    // Email city seekers: new hunt in your city
    if (event === 'hunt_approved') {
      // 1. Email the Pirate
      if (hunt.pirate_id) {
        const [pirate] = await sbFetch(`profiles?id=eq.${hunt.pirate_id}&select=username,email,notify_hunt_live`);
        if (pirate?.notify_hunt_live && pirate?.email) {
          const tpl = tplHuntApproved({ username: pirate.username, city: hunt.city, prize: hunt.prize_desc, huntUrl });
          await sendEmail(pirate.email, tpl.subject, tpl.html);
          results.push(`pirate_notified:${pirate.email}`);
        }
      }

      // 2. Email all seekers in this city with notify_new_hunts on
      const seekers = await sbFetch(
        `profiles?city=ilike.${encodeURIComponent('%'+hunt.city+'%')}&notify_new_hunts=eq.true&email=not.is.null&select=username,email,id`
      );
      for (const s of (seekers || [])) {
        if (s.id === hunt.pirate_id) continue; // don't email the pirate twice
        if (!s.email) continue;
        const tpl = tplNewHuntInCity({ username: s.username, city: hunt.city, prize: hunt.prize_desc, huntUrl });
        await sendEmail(s.email, tpl.subject, tpl.html);
        results.push(`seeker_notified:${s.email}`);
      }
    }

    // ── prize_claimed ─────────────────────────────────────────────
    // Email pirate: someone found it
    // Email winner: you won confirmation
    if (event === 'prize_claimed') {
      const [pirate] = hunt.pirate_id
        ? await sbFetch(`profiles?id=eq.${hunt.pirate_id}&select=username,email,notify_hunt_won`)
        : [null];
      const [winner] = hunt.winner_id
        ? await sbFetch(`profiles?id=eq.${hunt.winner_id}&select=username,email,notify_hunt_won`)
        : [null];

      if (pirate?.notify_hunt_won && pirate?.email && winner) {
        const tpl = tplPrizeClaimed({ username: pirate.username, city: hunt.city, prize: hunt.prize_desc, winnerName: winner.username, huntUrl });
        await sendEmail(pirate.email, tpl.subject, tpl.html);
        results.push(`pirate_notified:${pirate.email}`);
      }
      if (winner?.notify_hunt_won && winner?.email) {
        const tpl = tplYouWon({ username: winner.username, city: hunt.city, prize: hunt.prize_desc, huntUrl });
        await sendEmail(winner.email, tpl.subject, tpl.html);
        results.push(`winner_notified:${winner.email}`);
      }
    }

    // ── chat_message ──────────────────────────────────────────────
    // Email the OTHER party (not the sender)
    if (event === 'chat_message' && senderId) {
      const [pirate] = hunt.pirate_id
        ? await sbFetch(`profiles?id=eq.${hunt.pirate_id}&select=id,username,email,notify_chat`)
        : [null];
      const [winner] = hunt.winner_id
        ? await sbFetch(`profiles?id=eq.${hunt.winner_id}&select=id,username,email,notify_chat`)
        : [null];

      // Figure out sender and recipient
      const senderIsPirate = senderId === hunt.pirate_id;
      const sender    = senderIsPirate ? pirate : winner;
      const recipient = senderIsPirate ? winner : pirate;
      const senderRole = senderIsPirate ? 'pirate' : 'winner';

      const { preview } = req.body; // short message preview passed by client

      if (recipient?.notify_chat && recipient?.email && sender) {
        const tpl = tplChatMessage({
          username: recipient.username,
          senderName: sender.username,
          senderRole,
          preview: (preview || '').slice(0, 80),
          huntUrl,
          city: hunt.city
        });
        await sendEmail(recipient.email, tpl.subject, tpl.html);
        results.push(`chat_notified:${recipient.email}`);
      }
    }

    return res.status(200).json({ ok: true, sent: results });

  } catch(e) {
    console.error('[notify]', e);
    return res.status(500).json({ error: e.message });
  }
}
