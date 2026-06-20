// api/chat.js — Vercel Serverless Function
// Groq (Llama 3.3 70B) + Tavily web search for real-time info

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

// Detect if the question needs real-time web search
function needsSearch(text) {
  const triggers = [
    // English
    'weather', 'price', 'stock', 'news', 'latest', 'current', 'today', 'now',
    'score', 'match', 'game', 'result', 'standing', 'live', 'transfer',
    'who is', 'what is the', 'when is', 'where is',
    // French
    'météo', 'actualité', 'maintenant', 'aujourd', 'résultat', 'match', 'prix',
    // Arabic
    'طقس', 'سعر', 'أخبار', 'الآن', 'اليوم', 'نتيجة', 'مباراة', 'منتخب'
  ];
  const lower = text.toLowerCase();
  return triggers.some(t => lower.includes(t));
}

// Search the web using Tavily
async function searchWeb(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: 'basic',
      max_results: 5,
      include_answer: true
    })
  });
  const data = await res.json();
  return data;
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

  const systemPrompt = lang === 'ar'
    ? "أنت بَدِي (buddy)، روبوت دردشة ذكي، ودود ومباشر. يجب أن تشعر المستخدم وكأنه يتحدث مع إنسان ذكي ومرح وصريح جداً في إجاباته. إذا أُعطيت نتائج بحث، استخدمها للإجابة بدقة."
    : lang === 'fr'
      ? "Tu es buddy, un assistant IA intelligent, amical et direct. Si des résultats de recherche sont fournis, utilise-les pour répondre avec précision."
      : "You are buddy, a friendly, smart, and direct AI chatbot. If search results are provided, use them to answer accurately with up-to-date information. Never say you don't have access to real-time info — you do via search results.";

  // Run web search if needed
  let searchContext = '';
  let sources = [];

  if (needsSearch(lastUserMessage)) {
    try {
      const searchData = await searchWeb(lastUserMessage);
      if (searchData.results?.length > 0) {
        searchContext = '\n\n[WEB SEARCH RESULTS]\n' +
          searchData.results.map((r, i) =>
            `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`
          ).join('\n\n');

        sources = searchData.results.map(r => ({
          title: r.title,
          url: r.url
        }));
      }
    } catch (e) {
      console.error('Tavily search error:', e);
    }
  }

  const groqMessages = [
    { role: 'system', content: systemPrompt + searchContext },
    ...messages.map(msg => ({
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
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        max_tokens: 1024,
        temperature: 0.7
      })
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      return res.status(groqRes.status).json({ error: data.error?.message || 'Groq API error' });
    }

    const text = data.choices?.[0]?.message?.content || '';
    return res.status(200).json({ text, sources });

  } catch (err) {
    console.error('Groq fetch error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
