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

// Geographic tier definitions by clue count.
// More clues = more gradual zoom. Fewer clues = each clue carries more info.
function buildTierInstructions(clueCount, city, neighborhood, fullAddress) {
  const loc = {
    city: city || 'the city',
    neighborhood: neighborhood || 'the area',
    fullAddress: fullAddress || '',
  };

  const finalClue = `CLUE ${clueCount} — THE PHOTO REVEAL: This is the last clue and a photo of the hiding spot is revealed alongside it. Write the clue text to build suspense for the photo — tease that the answer is right in front of them. Reference one very specific physical feature the seeker will see in person (a bench, tree, fence post, sign, rock, painted surface). The clue text should make them feel they are inches away.`;

  const tiers = {
    5: [
      `CLUE 1 — CITY: Name the city explicitly: "${loc.city}". Give the seeker no doubt which city to head to. Wrap the city name naturally in your voice/style but say it clearly.`,
      `CLUE 2 — NEIGHBORHOOD/DISTRICT: Name a real, recognizable part of ${loc.city} — a neighborhood, district, or well-known area near ${loc.neighborhood}. Locals should immediately say "I know that area."`,
      `CLUE 3 — LANDMARK OR BUSINESS: Name a real, specific, well-known place nearby — a park, school, chain restaurant, grocery store, gas station, church, or other landmark that most locals would recognize near ${loc.fullAddress}. Seekers should think "I know exactly where that is."`,
      `CLUE 4 — STREET/BLOCK: Get close — reference a specific street name, intersection, or block-level feature visible from the road near the hiding spot. Something a driver would notice.`,
      finalClue,
    ],
    4: [
      `CLUE 1 — CITY: Name the city explicitly: "${loc.city}". Give the seeker no doubt which city to head to. Wrap the city name naturally in your voice/style but say it clearly.`,
      `CLUE 2 — NEIGHBORHOOD + LANDMARK: Name a real, recognizable neighborhood or area of ${loc.city} AND a nearby well-known place (park, business, school, or landmark) that locals would immediately recognize near ${loc.neighborhood}. Seekers should think "I know exactly where that is."`,
      `CLUE 3 — STREET/BLOCK: Get specific — reference a real street name, intersection, or block-level feature near the hiding spot. Something visible from the road.`,
      finalClue,
    ],
    3: [
      `CLUE 1 — CITY + AREA: Name the city explicitly: "${loc.city}", AND name a real, recognizable neighborhood or landmark nearby — a park, well-known business, school, or district. Locals should say "I know that place." near ${loc.neighborhood}.`,
      `CLUE 2 — STREET + NEARBY LANDMARK: Name a real street, intersection, or well-known business/landmark that is very close to the hiding spot near ${loc.fullAddress}. Seekers should be able to navigate directly to this block.`,
      finalClue,
    ],
    2: [
      `CLUE 1 — CITY + LANDMARK: Name the city "${loc.city}" clearly AND a well-known nearby landmark, business, park, or intersection that locals immediately recognize near ${loc.fullAddress}. Pack enough info that a local can get within a block.`,
      finalClue,
    ],
  };

  // For any count above 5, fill middle tiers and cap with the photo reveal
  if (clueCount > 5) {
    const result = [
      `CLUE 1 — CITY: Name the city explicitly: "${loc.city}". Give the seeker no doubt which city to head to. Wrap the city name naturally in your voice/style but say it clearly.`,
      `CLUE 2 — NEIGHBORHOOD/DISTRICT: Name a real, recognizable part of ${loc.city} — a neighborhood, district, or well-known area near ${loc.neighborhood}. Locals should immediately say "I know that area."`,
    ];
    for (let i = 3; i <= clueCount - 2; i++) {
      result.push(`CLUE ${i} — NARROWING IN: Get progressively closer than the previous clue. Reference a real, specific local place, street feature, or physical landmark near ${loc.fullAddress}. Name real businesses, parks, streets, or intersections — never generic descriptions. Each clue must be more specific than the last.`);
    }
    result.push(`CLUE ${clueCount - 1} — STREET/BLOCK: You are almost there. Reference a specific street name, intersection, or block-level feature right near the hiding spot. Something a seeker on foot would immediately notice.`);
    result.push(`CLUE ${clueCount} — THE PHOTO REVEAL: This is the last clue and a photo of the hiding spot is revealed alongside it. Write the clue text to build suspense for the photo — tease that the answer is right in front of them. Reference one very specific physical feature the seeker will see in person (a bench, tree, fence post, sign, rock, painted surface). The clue text should make them feel they are inches away.`);
    return result;
  }

  return tiers[Math.min(Math.max(clueCount, 2), 5)];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { description, clueCount, lat, lng, persona, prompt: customPrompt, singleClue, city, neighborhood, searchAddress, finderPosition } = req.body;

  if (!description || !clueCount) {
    return res.status(400).json({ error: 'Missing description or clueCount' });
  }

  const styleHint = PERSONA_STYLES[persona] || PERSONA_STYLES.pirate;
  const tierInstructions = buildTierInstructions(clueCount, city, neighborhood, searchAddress);

  // Inject the finder clue instruction — overrides the normal tier for that position
  if (finderPosition && finderPosition >= 1 && finderPosition <= clueCount) {
    const fi = finderPosition - 1;
    tierInstructions[fi] = `CLUE ${finderPosition} — ⚡ THE FINDER CLUE (secret special clue): This clue, on its own, contains enough specific information for a determined seeker to find the prize RIGHT NOW without waiting for any more clues. It must reference the actual hiding spot location specifically enough to navigate directly there — name the exact street, the exact nearby landmark, and a distinctive physical feature at the spot. Do NOT say "this is the finder clue" or reveal it is special in the text. It should read like a normal clue in the persona voice, but pack in precise, actionable location detail. A seeker who reads this clue carefully should be able to go straight to the prize.`;
  }

  // ─── Single clue regeneration mode ───────────────
  if (singleClue) {
    const pos = parseInt(singleClue.position, 10) || 1;
    const total = parseInt(singleClue.totalCount, 10) || clueCount;
    const allTiers = buildTierInstructions(total, city, neighborhood, searchAddress);
    const tierInstruction = allTiers[pos - 1] || allTiers[allTiers.length - 1];

    const singlePrompt = `You are writing a single clue for FinderSeek, a real-money treasure quest app.

The Pirate hid real cash. Hiding spot description:
"${description}"

Full address context: ${searchAddress || ''}
City: ${city || ''}
Neighborhood/area: ${neighborhood || ''}
${lat && lng ? `Coordinates: ${lat}, ${lng}` : ''}

VOICE & STYLE: ${styleHint}

CRITICAL RULE: Name real, recognizable local places. Seekers should say "I know exactly where that is." Use actual street names, business names, parks, schools, landmarks — never generic descriptions like "a busy road" or "near some shops."

This is clue #${pos} of ${total}. Here is your specific instruction for this clue:
${tierInstruction}

Write ONE clue, 1-3 sentences, in second person, staying in character. Include the geographic information required by the tier instruction above.
Also write a Q&A pair: a simple question directly answerable from the clue text, with a 1-3 word answer.

Return ONLY a JSON object (no markdown, no explanation):
{"number": ${pos}, "text": "clue text here", "question": "question here", "answer": "answer here"}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
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

  // ─── Full clue generation ────────────────────────

  const tierList = tierInstructions.map((t, i) => `${t}`).join('\n\n');

  const prompt = customPrompt || `You are writing quest clues for FinderSeek, a real-money treasure quest app where seekers physically go find hidden cash prizes.

The Quest Master has hidden real cash and described the hiding spot as:
"${description}"

Full address: ${searchAddress || ''}
City: ${city || ''}
Neighborhood/area: ${neighborhood || ''}
${lat && lng ? `Coordinates: ${lat}, ${lng}` : ''}

VOICE & STYLE: ${styleHint}

CRITICAL RULES:
1. Name real, recognizable local places in EVERY clue — actual business names, park names, street names, school names, landmarks. Never say "a nearby store" or "a busy road" — say the real name. Seekers should read a clue and think "I know exactly where that is."
2. Each clue must zoom in geographically — city first, then neighborhood, then a landmark, then the street, then the spot itself.
3. Stay in character (voice/style above) throughout, but NEVER let the persona override the geographic information. The clue must contain the real location detail even if it's delivered in a silly voice.
4. Write in second person ("you", "your").
5. 1-3 sentences per clue.
6. For each clue, also write a Q&A pair: a simple question the seeker must answer correctly to unlock the next clue. The question and answer must be directly answerable from reading the clue text. The answer should be 1-3 words, case-insensitive. Make the question feel like a natural comprehension check — not a trick. Example: clue mentions "the old oak tree" → question: "What type of tree are you looking for?" → answer: "Oak"

Also write a LOCATION RIDDLE — this is shown BEFORE the quest starts. It must guide the seeker to the general area (city/neighborhood level only — not the exact spot) using a riddle in the persona voice. No Q&A needed for the location riddle — it is unlocked by GPS when the seeker physically arrives within 1,000 feet.

Write exactly ${clueCount} clues following these tier instructions precisely:

${tierList}

Return ONLY a JSON object (no markdown, no explanation) in this exact format:
{
  "location_riddle": "riddle text to get seeker to the general area",
  "clues": [
    {"number": 1, "text": "clue text here", "question": "question here", "answer": "answer here"},
    {"number": 2, "text": "clue text here", "question": "question here", "answer": "answer here"}
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
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
    // Extract JSON object
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : clean;
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch(parseErr) {
      console.error('JSON parse error. Raw:', raw.substring(0, 300));
      return res.status(500).json({ error: 'Failed to parse clues. Raw: ' + raw.substring(0, 150) });
    }

    // Support both new format {location_riddle, clues} and legacy array format
    const clues = Array.isArray(parsed) ? parsed : (parsed.clues || []);
    const location_riddle = parsed.location_riddle || null;

    return res.status(200).json({ clues, location_riddle });

  } catch (e) {
    console.error('Server error:', e);
    return res.status(500).json({ error: e.message });
  }
}
