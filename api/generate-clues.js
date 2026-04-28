// api/generate-clues.js
const PERSONA_STYLES = {
  pirate: 'Salty pirate captain — "ye", "arrr", nautical metaphors, treasure maps, doubloons.',
  poetic: 'Dreamlike lyrical verse — soft imagery, nature metaphors, evocative and tender.',
  insults: 'Roast the seeker mercilessly but always slip the real hint inside the burn.',
  sarcastic: 'Dry, witty, deadpan — eye-roll energy. Treat it like they should already know.',
  hillbilly: 'Country folksy — "y\'all", down-home talk, porches, biscuits, hound dogs.',
  kid: 'Like a 5-year-old — silly, excited, lots of "and then" and "BUT THE BEST PART IS".',
  grandma: 'Sweet grandmother — "dearie", baking metaphors, gentle encouragement.',
  surfer: 'Gnarly surfer bro — "dude", "stoked", "bro", chill beach vibes.',
  investigator: 'True-crime narrator — clinical, suspenseful, detective field notes.',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    description, clueCount, lat, lng, persona, placeName,
    city, neighborhood, searchAddress,
    hsData, // NEW — full clue hints + Q&A from Quest Master
    singleClue, customPrompt, finderPosition
  } = req.body;

  if (!clueCount) return res.status(400).json({ error: 'Missing clueCount' });

  const styleHint = PERSONA_STYLES[persona] || PERSONA_STYLES.pirate;

  // ── Resolve city — extract from address if not explicitly passed ─
  function extractCityFromAddress(addr) {
    if (!addr) return '';
    addr = addr.replace(/, USA$/, '').replace(/\s\d{5}(-\d{4})?/g, '').trim();
    const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
    if (parts.length === 1) return parts[0];
    return '';
  }
  const resolvedCity = city || extractCityFromAddress(searchAddress) || extractCityFromAddress(description) || '';

  // ── Resolve place name ───────────────────────────────────────
  let resolvedPlaceName = placeName || null;
  if (!resolvedPlaceName && (description || searchAddress || (hsData && hsData.location))) {
    const textToSearch = (hsData && hsData.location) || description || '';
    try {
      const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 50,
          messages: [{ role: 'user', content: `Extract the specific named location (store, park, building, landmark) from this text. Return ONLY the name, nothing else. If none, return "none".\n\nText: "${textToSearch}"` }]
        })
      });
      const ed = await extractRes.json();
      const extracted = ed.content?.[0]?.text?.trim();
      if (extracted && extracted.toLowerCase() !== 'none' && extracted.length < 50) resolvedPlaceName = extracted;
    } catch(e) {}
  }

  console.log('[generate-clues] placeName:', placeName, '| resolvedPlaceName:', resolvedPlaceName, '| hasHsData:', !!hsData);

  // ── Build location riddle prompt ─────────────────────────────
  const locationText = (hsData && hsData.location) || description || searchAddress || '';
  const cityContext = resolvedCity ? ` in ${resolvedCity}` : '';
  // Build a specific location string combining place name + street address for disambiguation
  // e.g. "Kroger at 2115 N Loop 336 W, Conroe, TX" rather than just "Kroger"
  let specificLocation = resolvedPlaceName || locationText;
  if (searchAddress && resolvedPlaceName && !searchAddress.toLowerCase().includes(resolvedPlaceName.toLowerCase())) {
    // Address doesn't already contain the place name — combine them
    specificLocation = resolvedPlaceName + ', ' + searchAddress.replace(/, USA$/, '');
  } else if (searchAddress && !resolvedPlaceName) {
    specificLocation = searchAddress.replace(/, USA$/, '');
  }
  const locationRiddlePrompt = `Write a location riddle in ${persona || 'pirate'} style. EXACTLY two sentences — no more.
The EXACT location is: "${specificLocation}${!specificLocation.includes(resolvedCity || '') ? cityContext : ''}"
Place name: "${resolvedPlaceName || locationText}"
Street/address: "${searchAddress ? searchAddress.replace(/, USA$/, '') : ''}"
City: "${resolvedCity}"

RULES — all required:
1. EXACTLY two sentences. Not one. Not three. Two.
2. The place name "${resolvedPlaceName || locationText}" MUST appear word-for-word.
3. The city "${resolvedCity || 'the city'}" MUST be named explicitly.
4. A street name or road from the address MUST be included.
5. Written in ${persona || 'pirate'} persona voice.

Return ONLY the two-sentence riddle, no explanation.`;

  // ── Build per-clue prompts using hsData ──────────────────────
  const clues = (hsData && hsData.clues) || [];
  const totalClues = parseInt(clueCount, 10);

  // ─── Single clue regen ───────────────────────────────────────
  if (singleClue) {
    const pos = parseInt(singleClue.position, 10) || 1;
    const clueHint = clues[pos - 1] || {};
    const isFinal = pos === totalClues;
    const sPrompt = buildCluePrompt(clueHint, pos, totalClues, isFinal, styleHint, resolvedPlaceName, searchAddress, resolvedCity);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: sPrompt }] })
      });
      const d = await r.json();
      const raw = d.content?.[0]?.text || '';
      const clue = JSON.parse(raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/)?.[0] || raw);
      return res.status(200).json({ clue });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ─── Full generation ─────────────────────────────────────────
  try {
    // 1. Generate location riddle
    const lrRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: locationRiddlePrompt }] })
    });
    const lrData = await lrRes.json();
    let location_riddle = lrData.content?.[0]?.text?.trim() || '';

    // Enforce two sentences max — truncate if Claude went long
    const sentences = location_riddle.match(/[^.!?]+[.!?]+/g) || [];
    if (sentences.length > 2) {
      location_riddle = sentences.slice(0, 2).join(' ').trim();
    }

    // Validate place name in riddle
    if (resolvedPlaceName) {
      const nameCore = resolvedPlaceName.replace(/[''\u2018\u2019s]+$/i, '').toLowerCase();
      if (!location_riddle.toLowerCase().includes(nameCore)) {
        location_riddle = `Head to ${resolvedPlaceName}! ` + location_riddle;
      }
    }

    // 2. Generate each clue in parallel
    const cluePromises = Array.from({ length: totalClues }, (_, i) => {
      const clueHint = clues[i] || {};
      const isFinal = i === totalClues - 1;
      const prompt = buildCluePrompt(clueHint, i + 1, totalClues, isFinal, styleHint, resolvedPlaceName, searchAddress, city);
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 300, messages: [{ role: 'user', content: prompt }] })
      }).then(r => r.json()).then(d => {
        const raw = d.content?.[0]?.text || '';
        try {
          const jsonStr = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/)?.[0] || raw;
          const parsed = JSON.parse(jsonStr);
          return { number: i + 1, ...parsed };
        } catch(e) {
          // Fallback — return raw text as clue
          return { number: i + 1, text: raw.trim(), question: clueHint.question || '', answer: clueHint.answer || '' };
        }
      }).catch(e => ({
        number: i + 1,
        text: clueHint.hint || 'Clue ' + (i + 1),
        question: clueHint.question || '',
        answer: clueHint.answer || ''
      }));
    });

    const generatedClues = await Promise.all(cluePromises);
    return res.status(200).json({ clues: generatedClues, location_riddle });

  } catch(e) {
    console.error('Server error:', e);
    return res.status(500).json({ error: e.message });
  }
}

function buildCluePrompt(clueHint, position, total, isFinal, styleHint, placeName, address, city) {
  const action = clueHint.action || '';
  const hint = clueHint.hint || '';
  const question = clueHint.question || '';
  const answer = clueHint.answer || '';

  if (isFinal) {
    return `You are writing the FINAL clue for FinderSeek, a real-money treasure hunt app.
Style: ${styleHint}
Hiding spot description: "${hint}"
Write ONE sentence: a dramatic rhyming riddle in the persona voice that builds maximum suspense — the seeker is inches away.
Do NOT write a question — the final clue has no Q&A.
Return ONLY a JSON object: {"number": ${position}, "text": "riddle sentence here", "question": "", "answer": ""}`;
  }

  return `You are writing clue #${position} of ${total} for FinderSeek, a real-money treasure hunt app.
Style: ${styleHint}
Action: "${action}" — the seeker must physically do this
Hint/keyword from Quest Master: "${hint}"
Question to ask seeker: "${question}"
Correct answer: "${answer}"

Write EXACTLY 2 sentences:
Sentence 1: A rhyming riddle in the persona voice that naturally includes the action "${action}" and describes "${hint}" — but DO NOT reveal the answer "${answer}" anywhere in the riddle. The riddle should make the seeker go look for something and discover the answer themselves. Tease and hint, never tell.
Sentence 2: The question "${question}" rewritten in the same persona voice. Keep it as a question.

CRITICAL: The answer "${answer}" must NOT appear in sentence 1. The seeker discovers it by going there.

Return ONLY a JSON object (no markdown):
{"number": ${position}, "text": "sentence 1 here sentence 2 here", "question": "${question}", "answer": "${answer}"}`;
}
