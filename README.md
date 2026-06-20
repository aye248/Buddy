# buddy — AI Chatbot

Public chatbot powered by Gemini. API key is hidden server-side. Anyone can use it, no key needed.

---

## Deploy to Vercel (10 minutes)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/buddy.git
git push -u origin main
```

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) → Sign up with GitHub
2. Click **Add New Project**
3. Import your `buddy` repo
4. Click **Deploy** (no build settings needed)

### 3. Add your Gemini API Key

1. In Vercel dashboard → your project → **Settings** → **Environment Variables**
2. Add:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** your key from [aistudio.google.com](https://aistudio.google.com)
3. Click **Save**
4. Go to **Deployments** → click the 3 dots on latest → **Redeploy**

### 4. Done ✅

Your public URL: `https://buddy-xyz.vercel.app`

Share it with anyone — they use it for free, your key stays hidden.

---

## Rate Limiting

By default: **10 messages per user every 15 minutes.**

To change it, edit `api/chat.js`:
```js
const RATE_LIMIT = 10;          // max messages
const WINDOW_MS = 15 * 60 * 1000; // per 15 minutes
```

---

## Get a Free Gemini API Key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click **Get API Key**
3. Free tier: 15 requests/min, 1500 requests/day — more than enough
