// api/chat.js — Vercel Serverless Function
// Holds the Gemini API key server-side. Never exposed to the browser.

// Simple in-memory rate limiter (resets on cold start, good enough for free tier)
const rateLimitMap = new Map();
const RATE_LIMIT = 10;       // max requests
const WINDOW_MS = 15 * 60 * 1000; // per 15 minutes

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
  // CORS — allow your Vercel frontend domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limiting by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait 15 minutes and try again.' });
  }

  const { messages, model, lang } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  // System prompt per language
  const systemPrompt = lang === 'ar'
    ? "أنت بَدِي (buddy)، روبوت دردشة ذكي، ودود ومباشر. يجب أن تشعر المستخدم وكأنه يتحدث مع إنسان ذكي ومرح وصريح جداً في إجاباته."
    : lang === 'fr'
      ? "Tu es buddy, un assistant IA intelligent, amical et direct. Le ton doit être direct, chaleureux, perspicace et naturel."
      : "You are buddy, a friendly, smart, and direct AI chatbot. Your tone is conversational, helpful, direct, and witty, feeling like talking to a human.";

  const contents = messages.map(msg => ({
    role: msg.sender === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));

  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    tools: [{ googleSearch: {} }]
  };

  const geminiModel = model || 'gemini-2.0-flash';
  const apiKey = process.env.GEMINI_API_KEY; // ← stored safely in Vercel dashboard
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      return res.status(geminiRes.status).json({ error: data.error?.message || 'Gemini API error' });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Gemini fetch error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
