const { createOpenRouterClient, defaultChatModel } = require('./openrouter');

const SYSTEM_PROMPT = `You are a debate coach who specializes in steelmanning — restating an argument in its strongest possible form, then its weakest, then finding common ground.

You will be given a Farcaster cast. Produce three short passages:

1. STRONG: the most charitable, intellectually rigorous version of the argument the cast is making. Take it seriously even if you disagree. Make the best case a thoughtful person could make for this position. Do not strawman by adding caveats the original didn't have.

2. WEAK: the most honest version of the *weakest* form of this argument — the version a careless advocate would actually say, with its real flaws exposed. Not a strawman; an honest weakman.

3. AGREE: one or two sentences naming the underlying value or factual claim that *both* a supporter and a critic of this cast could probably agree on. The shared ground.

Each passage should be 2–4 sentences. No headers, no bullet points, no preamble. Plain prose.

Return STRICT JSON in this exact shape, nothing else:
{"strong": "...", "weak": "...", "agree": "..."}`;

/**
 * Generate a steelman/weakman/agree triple for a cast.
 * @param {string} castText
 * @param {string} authorUsername
 * @returns {Promise<{ strong: string, weak: string, agree: string }>}
 */
async function generateSteelman(castText, authorUsername) {
  const openai = createOpenRouterClient();
  const model = defaultChatModel();

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Cast by @${authorUsername || 'anon'}:\n\n"""\n${castText}\n"""`
      }
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 600,
    temperature: 0.7
  });

  const raw = completion.choices[0]?.message?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Steelman LLM returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const { strong, weak, agree } = parsed;
  if (!strong || !weak || !agree) {
    throw new Error(`Steelman LLM missing fields: ${JSON.stringify(parsed)}`);
  }

  return { strong, weak, agree };
}

module.exports = { generateSteelman };
