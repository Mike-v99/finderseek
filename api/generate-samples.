// api/generate-samples.js
// ONE-TIME endpoint — generates high-quality TTS sample MP3s for each persona
// Hit once after deploy: POST /api/generate-samples with x-finderseek-secret header
// Stores in Supabase Storage: clue-audio/samples/{persona}.mp3
// After running, this endpoint can be left in place — it's idempotent (safe to re-run)

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
  kid:         { voice: 'nova',    speed: 1.10 },
};

// Sample clues — one per persona, written to show off the voice character
const SAMPLES = {
  pirate: "Arrr, ye scallywag! The treasure ye seek lies where iron meets stone and shadows grow long at midday. X marks the spot — if ye dare face what lurks in the dark corners of that forgotten place!",
  poetic: "Where morning light spills golden through the leaves and silence holds its breath, something waits — patient as a stone, quiet as the space between heartbeats. Follow the shadow's longest reach.",
  insults: "Oh congratulations, genius — you've managed to read this far without hurting yourself. Now drag your obviously superior intellect to the place where people actually go to think. You'll recognize it because you've never been there.",
  sarcastic: "Oh sure, because obviously the first place anyone would look is the most obvious spot imaginable. But hey, what do I know — maybe you'll surprise me this time. The clue is exactly where you'd expect it. Shocking, I know.",
  hillbilly: "Well shoot, y'all, it ain't rocket science — Grandpappy always said the best hidin' spots are right under your nose, like a possum in a persimmon tree. Head on over to where the old folks gather and poke around a spell.",
  grandma: "Oh sweetie, now don't rush — take a nice deep breath and think about where the prettiest flowers grow in the morning light. That's where I'd leave something special, dearie. Right where anyone with a gentle heart would think to look.",
  surfer: "Dude, okay, so like — the vibe is totally strong over by where the locals chill, you know? It's giving major hidden gem energy. Just flow with it bro, trust your instincts, and you'll totally find it. Gnarly clue, right?",
  detective: "The evidence points to a location frequented by persons of routine habit. Note the wear patterns, the sightlines, the geometry of approach. A careful observer would identify exactly one position where concealment meets accessibility. Proceed with caution.",
  kid: "OKAY SO! There's this super cool hiding spot and it's the BEST PART because nobody ever looks there! And then when you find it you're gonna be SO EXCITED! It's near the big thing — you know the BIG THING — go look there RIGHT NOW!",
};

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

  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY not set' });

  const results = {};
  const errors = {};

  for (const [persona, { voice, speed }] of Object.entries(PERSONA_VOICE)) {
    try {
      console.log(`[samples] Generating ${persona} (${voice} @ ${speed}x)...`);
      const text = SAMPLES[persona];

      // Use tts-1-hd for higher quality samples
      const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1-hd',  // HD quality for samples
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

      const audioBuffer = await ttsRes.arrayBuffer();
      const audioBytes = new Uint8Array(audioBuffer);

      // Upload to Supabase Storage
      const storagePath = `clue-audio/samples/${persona}.mp3`;
      const uploadRes = await fetch(`${SB_URL}/storage/v1/object/${storagePath}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SB_KEY}`,
          'Content-Type': 'audio/mpeg',
          'x-upsert': 'true',
        },
        body: audioBytes,
      });

      if (!uploadRes.ok) {
        const uploadErr = await uploadRes.text();
        throw new Error(`Storage upload failed: ${uploadRes.status} ${uploadErr}`);
      }

      const audioUrl = `${SB_URL}/storage/v1/object/public/${storagePath}`;
      results[persona] = audioUrl;
      console.log(`[samples] ✓ ${persona}: ${audioUrl}`);

    } catch (e) {
      console.error(`[samples] ✗ ${persona}:`, e.message);
      errors[persona] = e.message;
    }
  }

  return res.status(200).json({
    success: true,
    generated: Object.keys(results).length,
    failed: Object.keys(errors).length,
    results,
    errors,
  });
}
