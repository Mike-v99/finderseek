// api/tts.js
// Two modes:
//   1. POST with { text, persona, clueId, type } → generate + store clue audio
//   2. POST with { mode: 'samples' } → generate all 9 persona sample MP3s (run once)
//
// Env vars: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
//           FINDERSEEK_NOTIFY_SECRET or NOTIFY_SECRET

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const PERSONA_VOICE = {
  pirate:      { voice: 'fable',   speed: 0.95 },
  poetic:      { voice: 'nova',    speed: 0.90 },
  insults:     { voice: 'onyx',    speed: 1.10 },
  sarcastic:   { voice: 'shimmer', speed: 1.05 },
  hillbilly:   { voice: 'alloy',   speed: 0.95 },
  grandma:     { voice: 'shimmer', speed: 0.85 },
  surfer:      { voice: 'echo',    speed: 0.95 },
  detective:   { voice: 'onyx',    speed: 0.90 },
  investigator:{ voice: 'onyx',    speed: 0.90 }, // alias for detective
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
  const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || 'tts-1', input: text, voice, speed, response_format: 'mp3' }),
  });
  if (!ttsRes.ok) { const e = await ttsRes.text(); throw new Error(`OpenAI TTS: ${ttsRes.status} ${e}`); }
  const audioBytes = new Uint8Array(await ttsRes.arrayBuffer());
  const uploadRes = await fetch(`${SB_URL}/storage/v1/object/${storagePath}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'audio/mpeg', 'x-upsert': 'true' },
    body: audioBytes,
  });
  if (!uploadRes.ok) { const e = await uploadRes.text(); throw new Error(`Storage: ${uploadRes.status} ${e}`); }
  return `${SB_URL}/storage/v1/object/public/${storagePath}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-finderseek-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-finderseek-secret'];
  if (secret !== process.env.FINDERSEEK_NOTIFY_SECRET && secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });

  const { mode, text, persona, clueId, type } = req.body;

  // ── Mode: generate all persona samples (run once) ──
  if (mode === 'samples') {
    const results = {}, errors = {};
    for (const [p, { voice, speed }] of Object.entries(PERSONA_VOICE)) {
      if (p === 'location') continue; // skip location — not a persona
      try {
        console.log(`[tts/samples] ${p} (${voice} @ ${speed}x)`);
        const url = await generateAndStore(SAMPLES[p], voice, speed, `clue-audio/samples/${p}.mp3`, 'tts-1-hd');
        results[p] = url;
        console.log(`[tts/samples] ✓ ${p}`);
      } catch(e) { errors[p] = e.message; console.error(`[tts/samples] ✗ ${p}:`, e.message); }
    }
    return res.status(200).json({ success: true, generated: Object.keys(results).length, results, errors });
  }

  // ── Mode: generate single clue audio ──
  if (!text || !clueId) return res.status(400).json({ error: 'Missing text or clueId' });
  try {
    const personaKey = type === 'location' ? 'location' : (persona || 'alloy').toLowerCase();
    const { voice, speed } = PERSONA_VOICE[personaKey] || DEFAULT_VOICE;
    console.log(`[tts] clueId=${clueId} persona=${personaKey} voice=${voice} speed=${speed}`);
    const fileName = `${clueId}_${type || 'clue'}.mp3`;
    const audioUrl = await generateAndStore(text, voice, speed, `clue-audio/${fileName}`, 'tts-1');
    return res.status(200).json({ success: true, audioUrl, voice, speed });
  } catch(err) {
    console.error('[tts] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
