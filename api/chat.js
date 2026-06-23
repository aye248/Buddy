// api/chat.js — Vercel Serverless Function
// Groq + Tavily (always search, full history, smart system prompt)

const rateLimitMap = new Map();
const RATE_LIMIT = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

async function searchWeb(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: 'advanced',  // richer results
      max_results: 5,
      include_answer: true
    })
  });
  return await res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait 15 minutes and try again.' });
  }

  const { messages, lang } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  const lastUserMessage = messages.filter(m => m.sender === 'user').pop()?.text || '';

  // Smart system prompt per language
  const systemPrompts = {
    en: `You are buddy, a smart, direct, and friendly AI assistant.
Rules you must always follow:
- Always give a concrete, direct answer. Never dodge or say "I'm not sure".
- Never say you lack real-time info — you have web search results below, use them.
- Be concise. No unnecessary filler like "Great question!" or "Certainly!".
- Use markdown formatting when it helps clarity (bold, lists, code blocks).
- If web search results are provided, base your answer on them and cite them naturally.
- Remember the full conversation history and refer back to it when relevant.
- If the user writes in a language, respond in that same language.`,

    fr: `Tu es buddy, un assistant IA intelligent, direct et amical.
Règles à toujours respecter:
- Donne toujours une réponse concrète et directe. Ne botte jamais en touche.
- Ne dis jamais que tu manques d'infos en temps réel — tu as des résultats de recherche ci-dessous.
- Sois concis. Pas de remplissage inutile comme "Bonne question!".
- Utilise le markdown quand ça aide (gras, listes, blocs de code).
- Si des résultats de recherche sont fournis, base ta réponse dessus.
- Mémorise l'historique complet de la conversation et réfère-toi y si pertinent.`,

    ar: `أنت بَدِي، مساعد ذكاء اصطناعي ذكي ومباشر وودود.
قواعد يجب اتباعها دائماً:
- أعطِ دائماً إجابة مباشرة وملموسة. لا تتهرب أبداً.
- لا تقل أبداً أنك تفتقر إلى معلومات حية — لديك نتائج بحث أدناه، استخدمها.
- كن موجزاً. لا حشو غير ضروري.
- استخدم تنسيق markdown عند الحاجة.
- إذا تم تزويدك بنتائج بحث، استند إليها في إجابتك.
- تذكر كامل تاريخ المحادثة وأشر إليه عند الحاجة.`
  };

  const systemPrompt = systemPrompts[lang] || systemPrompts.en;

  // Always search web for every message
  let searchContext = '';
  let sources = [];

  try {
    const searchData = await searchWeb(lastUserMessage);
    if (searchData.results?.length > 0) {
      searchContext = '\n\n[REAL-TIME WEB SEARCH RESULTS - use these to answer]\n' +
        searchData.results.map((r, i) =>
          `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`
        ).join('\n\n');

      sources = searchData.results.map(r => ({
        title: r.title,
        url: r.url
      }));
    }
  } catch (e) {
    console.error('Tavily error:', e);
    // continue without search if Tavily fails
  }

  // Send last 10 messages for context memory
  const recentMessages = messages.slice(-10);

  const groqMessages = [
    { role: 'system', content: systemPrompt + searchContext },
    ...recentMessages.map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text
    }))
  ];

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: groqMessages,
        max_tokens: 1024,
        temperature: 0.6
      })
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      return res.status(groqRes.status).json({ error: data.error?.message || 'Groq API error' });
    }

    let text = data.choices?.[0]?.message?.content || '';

    // Remove deepseek's <think>...</think> block from response
    

    return res.status(200).json({ text, sources });

  } catch (err) {
    console.error('Groq error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
