// api/generate-clues.js
// Generates treasure hunt clues using Claude based on hiding spot description and persona
//
// Env vars needed:
//   ANTHROPIC_API_KEY — from console.anthropic.com

const PERSONA_STYLES = {
  pirate: 'Write like a salty pirate captain — use "ye", "arrr", nautical metaphors, treasure maps, doubloons. Dramatic and seafaring.',
  poetic: 'Write in dreamlike, lyrical verse — soft imagery, gentle metaphors of nature, light, and shadow. Evocative and tender.',
  insults: 'Roast the seeker mercilessly while giving clues — playful taunts, mock their effort, but always slip the real hint inside the burn.',
  sarcastic: 'Dry, witty, deadpan — eye-roll energy. Treat each clue like the seeker should already have figured this out.',
  hillbilly: 'Country folksy charm — "y\'all", down-home talk, references to porches, biscuits, hound dogs, granny\'s shed.',
  kid: 'Like a 5-year-old wrote it — silly, excited, lots of "and then" and "BUT THE BEST PART IS". Innocent and giggly.',
  grandma: 'Sweet warm grandmother voice — "dearie", baking metaphors, gentle encouragement, references to bygone days.',
  surfer: 'Totally gnarly surfer bro — "dude", "stoked", "bro", "killer waves", chill beach vibes.',
  investigator: 'True-crime documentary narrator — clinical, suspenseful, present-tense observations like a detective\'s field notes.',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { description, clueCount, lat, lng, persona, prompt: customPrompt, singleClue } = req.body;

  if (!description || !clueCount) {
    return res.status(400).json({ error: 'Missing description or clueCount' });
  }

  const styleHint = PERSONA_STYLES[persona] || PERSONA_STYLES.pirate;

  // ─── Single clue regeneration mode ───────────────
  // Used by the review page's "regenerate this clue" button.
  // singleClue = { position: 1-based clue number, totalCount: how many clues total }
  // Returns one clue at the requested position with the same difficulty curve as the full set.
  if (singleClue) {
    const pos = parseInt(singleClue.position, 10) || 1;
    const total = parseInt(singleClue.totalCount, 10) || clueCount;
    const earlyMid = Math.ceil(total / 2);
    const specificity = pos <= 2 ? 'very vague, atmospheric' :
                        pos <= earlyMid ? 'moderately vague' :
                        pos >= total - 2 ? 'very specific, what they see up close' :
                        'moderately specific';

    const singlePrompt = `You are writing a single treasure hunt clue for FinderSeek.

The Pirate hid real cash. Hiding spot description:
"${description}"

${lat && lng ? `Location: ${lat}, ${lng}` : ''}

VOICE & STYLE: ${styleHint}

This is clue #${pos} out of ${total} in the full hunt. Specificity should be: ${specificity}.

Write ONE single clue, 1-3 sentences, in second person, staying in character.

Return ONLY a JSON object like this (no markdown, no explanation):
{"number": ${pos}, "text": "clue text here"}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 400,
          messages: [{ role: 'user', content: singlePrompt }]
        })
      });
      const data = await response.json();
      if (!response.ok) {
        console.error('Anthropic error (single):', data);
        return res.status(500).json({ error: data.error?.message || 'Claude API error' });
      }
      const raw = data.content?.[0]?.text || '';
      const clean = raw.replace(/```json|```/g, '').trim();
      const clue = JSON.parse(clean);
      return res.status(200).json({ clue });
    } catch (e) {
      console.error('Single clue regen error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─── Full clue generation (original path) ────────

  const prompt = customPrompt || `You are writing treasure hunt clues for FinderSeek, a real-money treasure hunt app.

The Pirate has hidden real cash and described the hiding spot as:
"${description}"

${lat && lng ? `Location coordinates: ${lat}, ${lng}` : ''}

VOICE & STYLE: ${styleHint}

Write exactly ${clueCount} clues. They must be:
- Vague at first, then progressively more specific — each clue narrows in slightly more than the last
- Written in second person ("you", "your")
- Between 1-3 sentences each
- The final 3 clues should be the most specific, referencing what someone might see up close
- Stay in character (the voice/style above) throughout

Return ONLY a JSON array like this (no markdown, no explanation):
[
  {"number": 1, "text": "clue text here"},
  {"number": 2, "text": "clue text here"}
]`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic error:', data);
      return res.status(500).json({ error: data.error?.message || 'Claude API error' });
    }

    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const clues = JSON.parse(clean);

    return res.status(200).json({ clues });

  } catch (e) {
    console.error('Server error:', e);
    return res.status(500).json({ error: e.message });
  }
}
