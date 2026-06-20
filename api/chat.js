// api/chat.js — Vercel Serverless Function
// Powered by Groq (free, 14,400 req/day, no credit card)

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

  const systemPrompt = lang === 'ar'
    ? "أنت بَدِي (buddy)، روبوت دردشة ذكي، ودود ومباشر. يجب أن تشعر المستخدم وكأنه يتحدث مع إنسان ذكي ومرح وصريح جداً في إجاباته."
    : lang === 'fr'
      ? "Tu es buddy, un assistant IA intelligent, amical et direct. Le ton doit être direct, chaleureux, perspicace et naturel."
      : "You are buddy, a friendly, smart, and direct AI chatbot. Your tone is conversational, helpful, direct, and witty, feeling like talking to a human.";

  // Format messages for Groq (OpenAI-compatible format)
  const groqMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text
    }))
  ];

  const payload = {
    model: 'llama-3.3-70b-versatile', // best free model on Groq
    messages: groqMessages,
    max_tokens: 1024,
    temperature: 0.7
  };

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      return res.status(groqRes.status).json({ error: data.error?.message || 'Groq API error' });
    }

    // Return in a format the frontend can use
    const text = data.choices?.[0]?.message?.content || '';
    return res.status(200).json({ text });

  } catch (err) {
    console.error('Groq fetch error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
