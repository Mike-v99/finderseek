// api/tts.js
// Generates TTS audio for a clue using OpenAI TTS API
// Stores MP3 in Supabase Storage and returns the public URL
//
// Env vars needed:
//   OPENAI_API_KEY
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   FINDERSEEK_NOTIFY_SECRET or NOTIFY_SECRET

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Voice + speed map by persona ──────────────────────────
const PERSONA_VOICE = {
  pirate:      { voice: 'fable',   speed: 0.95 },
  poetic:      { voice: 'nova',    speed: 0.90 },
  insults:     { voice: 'onyx',    speed: 1.10 },
  sarcastic:   { voice: 'shimmer', speed: 1.05 },
  hillbilly:   { voice: 'alloy',   speed: 0.95 },
  grandma:     { voice: 'shimmer', speed: 0.85 },
  surfer:      { voice: 'echo',    speed: 0.95 },
  investigator:{ voice: 'onyx',    speed: 0.90 },
  detective:   { voice: 'onyx',    speed: 0.90 },
  kid:         { voice: 'nova',    speed: 1.10 },
  location:    { voice: 'alloy',   speed: 0.92 }, // location riddle — neutral, slightly slow
};

const DEFAULT_VOICE = { voice: 'alloy', speed: 1.0 };

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

  const { text, persona, clueId, type } = req.body;
  // type = 'clue' | 'location' | 'question'
  if (!text || !clueId) return res.status(400).json({ error: 'Missing text or clueId' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
  }

  try {
    // Pick voice based on persona
    const personaKey = type === 'location' ? 'location' : (persona || 'alloy').toLowerCase();
    const { voice, speed } = PERSONA_VOICE[personaKey] || DEFAULT_VOICE;

    console.log(`[tts] clueId=${clueId} persona=${personaKey} voice=${voice} speed=${speed} chars=${text.length}`);

    // ── Call OpenAI TTS ──
    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',          // tts-1 = fast + cheap; tts-1-hd = higher quality
        input: text,
        voice,
        speed,
        response_format: 'mp3',
      }),
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      throw new Error(`OpenAI TTS failed: ${ttsRes.status} ${err}`);
    }

    // Get audio as buffer
    const audioBuffer = await ttsRes.arrayBuffer();
    const audioBytes = new Uint8Array(audioBuffer);

    // ── Upload to Supabase Storage ──
    const fileName = `${clueId}_${type || 'clue'}.mp3`;
    const storagePath = `clue-audio/${fileName}`;

    const uploadRes = await fetch(`${SB_URL}/storage/v1/object/${storagePath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type': 'audio/mpeg',
        'x-upsert': 'true', // overwrite if exists
      },
      body: audioBytes,
    });

    if (!uploadRes.ok) {
      const uploadErr = await uploadRes.text();
      throw new Error(`Supabase Storage upload failed: ${uploadRes.status} ${uploadErr}`);
    }

    // Build public URL
    const audioUrl = `${SB_URL}/storage/v1/object/public/${storagePath}`;
    console.log(`[tts] ✓ Stored: ${audioUrl}`);

    return res.status(200).json({ success: true, audioUrl, voice, speed });

  } catch (err) {
    console.error('[tts] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
