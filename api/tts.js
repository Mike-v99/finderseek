// api/tts.js
// Modes:
//   1. POST { text, persona, clueId, type, dbId, dbTable, dbColumn } → generate + store + PATCH db
//   2. POST { mode: 'samples' } → generate all persona sample MP3s
//   3. GET → diagnostic check
//
// Uses SERVICE KEY for DB writes — bypasses RLS

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY; // service role — bypasses RLS

const PERSONA_VOICE = {
  pirate:      { voice: 'fable',   speed: 0.95 },
  poetic:      { voice: 'nova',    speed: 0.90 },
  insults:     { voice: 'onyx',    speed: 1.10 },
  sarcastic:   { voice: 'shimmer', speed: 1.05 },
  hillbilly:   { voice: 'alloy',   speed: 0.95 },
  grandma:     { voice: 'shimmer', speed: 0.85 },
  surfer:      { voice: 'echo',    speed: 0.95 },
  detective:   { voice: 'onyx',    speed: 0.90 },
  investigator:{ voice: 'onyx',    speed: 0.90 },
  kid:         { voice: 'nova',    speed: 1.10 },
  location:    { voice: 'alloy',   speed: 0.92 },
};
const DEFAULT_VOICE = { voice: 'alloy', speed: 1.0 };

const SAMPLES = {
  pirate:    "Arrr, ye scallywag! Head to Memorial Park on Westheimer — the east entrance near the great stone fountain holds yer first secret. X marks the spot... if ye dare.",
  poetic:    "Where morning light kisses ancient stone, and water speaks in silver tones — seek the place where elm trees lean, and find what rests unseen between.",
  insults:   "Listen up, genius. The treasure is at Memorial Park. You know, that big green thing with trees? Or are you too busy being wrong to notice? East entrance. Go.",
  sarcastic: "Oh sure, it'll be SO hard to find. Just head to Memorial Park — you know, the most obvious place ever. East entrance. Try not to trip on your way.",
  hillbilly: "Well shoot, y'all better git yerself down to Memorial Park, near them big ol' fountains by the east gate. Reckon the treasure's hidin' right there, I tell ya what.",
  grandma:   "Oh sweetheart, you'll want to head over to Memorial Park, dear. You know the one — by Westheimer. The east entrance near the lovely fountain. Bundle up, it might be chilly!",
  surfer:    "Duuude, shred your way over to Memorial Park, bro! Hang a left at the gnarly fountain near the east entrance, ya know? The treasure's like, totally waiting for you out there!",
  detective:   "Evidence points to a single location: Memorial Park, east entrance. Subject was seen near the fountain at approximately 9 AM. Proceed with caution. The treasure won't find itself.",
  investigator:"Evidence points to a single location: Memorial Park, east entrance. Subject was seen near the fountain at approximately 9 AM. Proceed with caution. The treasure won't find itself.",
  kid:       "Ooooh go to the BIG park!! The one with the fountain that goes SPLASH!! It's sooooo fun there!! The treasure is hiding near the gate!! GO GO GO!!",
};

async function generateAndStore(text, voice, speed, storagePath, model) {
  console.log(`[tts] OpenAI TTS: voice=${voice} speed=${speed} len=${text.length} path=${storagePath}`);
  const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: model || 'tts-1', input: text, voice, speed, response_format: 'mp3' }),
  });
  if (!ttsRes.ok) {
    const errText = await ttsRes.text();
    throw new Error(`OpenAI TTS ${ttsRes.status}: ${errText.slice(0, 200)}`);
  }
  const audioBytes = Buffer.from(await ttsRes.arrayBuffer());
  console.log(`[tts] Audio generated: ${audioBytes.length} bytes`);

  const uploadRes = await fetch(`${SB_URL}/storage/v1/object/${storagePath}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'audio/mpeg',
      'x-upsert': 'true',
      'Cache-Control': '3600',
    },
    body: audioBytes,
  });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Storage ${uploadRes.status}: ${errText.slice(0, 200)}`);
  }
  const publicUrl = `${SB_URL}/storage/v1/object/public/${storagePath}`;
  console.log(`[tts] Stored at: ${publicUrl}`);
  return publicUrl;
}

async function patchDb(table, idColumn, idValue, column, value) {
  // Uses service key — bypasses RLS
  const url = `${SB_URL}/rest/v1/${table}?${idColumn}=eq.${idValue}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SB_KEY}`,
      'apikey': SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ [column]: value }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`[tts] DB PATCH failed ${res.status}:`, err);
    return false;
  }
  console.log(`[tts] DB PATCH ✓ ${table}.${column} for ${idValue}`);
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-finderseek-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: diagnostic ──
  if (req.method === 'GET') {
    const secret = req.headers['x-finderseek-secret'];
    const validSecret = secret === process.env.FINDERSEEK_NOTIFY_SECRET || secret === process.env.NOTIFY_SECRET;
    const diag = {
      ok: true,
      env: {
        OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
        SUPABASE_URL: !!SB_URL,
        SUPABASE_SERVICE_KEY: !!SB_KEY,
        FINDERSEEK_NOTIFY_SECRET: !!process.env.FINDERSEEK_NOTIFY_SECRET,
        NOTIFY_SECRET: !!process.env.NOTIFY_SECRET,
      },
      auth: validSecret,
    };
    if (validSecret && SB_URL && SB_KEY) {
      try {
        const bucketRes = await fetch(`${SB_URL}/storage/v1/bucket/clue-audio`, {
          headers: { 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY },
        });
        diag.bucket_clue_audio = bucketRes.ok ? 'accessible' : `error ${bucketRes.status}`;
        if (!bucketRes.ok) diag.bucket_error = (await bucketRes.text()).slice(0, 200);
      } catch(e) {
        diag.bucket_clue_audio = `fetch error: ${e.message}`;
      }
    }
    return res.status(200).json(diag);
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.FINDERSEEK_NOTIFY_SECRET && secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
  if (!SB_URL || !SB_KEY) return res.status(503).json({ error: 'Supabase env vars not configured' });

  const { mode, text, persona, clueId, type, dbId, dbTable, dbColumn } = req.body;

  // ── Samples mode ──
  if (mode === 'samples') {
    const results = {}, errors = {};
    for (const [p, { voice, speed }] of Object.entries(PERSONA_VOICE)) {
      if (p === 'location') continue;
      try {
        const url = await generateAndStore(SAMPLES[p], voice, speed, `clue-audio/samples/${p}.mp3`, 'tts-1-hd');
        results[p] = url;
      } catch(e) { errors[p] = e.message; }
    }
    return res.status(200).json({ success: true, generated: Object.keys(results).length, results, errors });
  }

  // ── Single clue audio ──
  if (!text || !clueId) {
    return res.status(400).json({ error: 'Missing text or clueId' });
  }
  try {
    const personaKey = type === 'location' ? 'location' : (persona || 'alloy').toLowerCase();
    const { voice, speed } = PERSONA_VOICE[personaKey] || DEFAULT_VOICE;
    const safeId = String(clueId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${safeId}_${type || 'clue'}.mp3`;
    const audioUrl = await generateAndStore(text, voice, speed, `clue-audio/${fileName}`, 'tts-1');

    // ── Write audio_url directly to DB using service key (bypasses RLS) ──
    if (dbId && dbTable && dbColumn) {
      const idCol = dbTable === 'hunts' ? 'id' : 'id';
      await patchDb(dbTable, idCol, dbId, dbColumn, audioUrl);
    }

    return res.status(200).json({ success: true, audioUrl, voice, speed, fileName });
  } catch(err) {
    console.error('[tts] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
