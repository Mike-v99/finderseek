export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { description, clueCount, lat, lng } = req.body;

  if (!description || !clueCount) {
    return res.status(400).json({ error: 'Missing description or clueCount' });
  }

  const prompt = `You are writing treasure hunt clues for FinderSeek, a real-money treasure hunt app.

The Pirate has hidden real cash and described the hiding spot as:
"${description}"

${lat && lng ? `Location coordinates: ${lat}, ${lng}` : ''}

Write exactly ${clueCount} clues. They must be:
- Vague and poetic — like riddles, not directions
- Build progressively — each clue narrows in slightly more than the last
- Written in second person ("you", "your")
- Between 1-3 sentences each
- Evocative, mysterious, fun
- The final 3 clues should be the most specific, referencing what someone might see up close

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
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
