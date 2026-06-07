// ── KPC translation engine ──
// Translates batches of UI strings on demand using Netlify AI Gateway (Anthropic).
// No API keys required: Netlify injects ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY at runtime.

const LANG_NAMES = {
  ht: 'Haitian Creole (Kreyòl Ayisyen)',
  en: 'English',
  fr: 'French (français)',
};

const MODEL = 'claude-haiku-4-5';

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { texts, target } = body || {};
  if (!Array.isArray(texts) || texts.length === 0) {
    return Response.json({ error: 'texts must be a non-empty array' }, { status: 400 });
  }
  if (!LANG_NAMES[target] || target === 'fr') {
    return Response.json({ error: 'Unsupported target language' }, { status: 400 });
  }

  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey) {
    return Response.json(
      { error: 'AI Gateway not configured (a production deploy is required to activate it).' },
      { status: 503 },
    );
  }

  const system =
    `You are a professional translator for a Haitian citizen political movement website (KPC, Konviksyon Pou Chanjman). ` +
    `Translate each string in the given JSON array from French into ${LANG_NAMES[target]}. ` +
    `Rules: keep the meaning faithful and natural; preserve all emojis, numbers, punctuation, line breaks and leading/trailing spaces; ` +
    `do NOT translate proper nouns or brand names (KPC, Konviksyon Pou Chanjman, Haïti, Port-au-Prince, Cap-Haïtien, Pétion-Ville, Miami, Montréal, person names). ` +
    `Return ONLY a JSON array of translated strings, exactly the same length and order as the input, with no commentary and no markdown fences.`;

  const payload = {
    model: MODEL,
    max_tokens: 8000,
    temperature: 0,
    system,
    messages: [{ role: 'user', content: JSON.stringify(texts) }],
  };

  let aiRes;
  try {
    aiRes = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return Response.json({ error: 'Upstream request failed', detail: String(err) }, { status: 502 });
  }

  if (!aiRes.ok) {
    const detail = await aiRes.text().catch(() => '');
    return Response.json({ error: 'Translation provider error', status: aiRes.status, detail }, { status: 502 });
  }

  const data = await aiRes.json();
  const raw = (data?.content || []).map((b) => b?.text || '').join('').trim();

  const translations = parseArray(raw);
  if (!translations || translations.length !== texts.length) {
    // Fall back to source text for any mismatch so the page never breaks.
    return Response.json({ translations: texts, partial: true }, { status: 200 });
  }

  return Response.json({ translations }, {
    status: 200,
    headers: { 'Cache-Control': 'public, max-age=86400' },
  });
};

function parseArray(raw) {
  if (!raw) return null;
  let text = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : null;
  } catch {
    // Best-effort: extract the outermost array.
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed.map((v) => String(v)) : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export const config = {
  path: '/api/translate',
};
