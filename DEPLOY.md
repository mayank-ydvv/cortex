# Deploying Cortex to Vercel

Cortex runs on Vercel as an ordinary Next.js app. Embeddings and answers both
come from Gemini over HTTP, so nothing heavy ships in the functions. The
database and sign-in are Supabase.

## 1. Project

Vercel → **Add New → Project** → import **mayank-ydvv/cortex**. Framework
preset is Next.js; the defaults are right (pnpm is detected from the lockfile).

## 2. Environment variables

Project → Settings → **Environment Variables**. Values marked *secret* come
from your own `.env`; never commit them.

| Variable | Value |
|---|---|
| `DATABASE_URL` | *secret* — Supabase **transaction pooler** URL (port **6543**) |
| `ANSWER_API_KEY` | *secret* — your Gemini key (also used for embeddings) |
| `ANSWER_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `ANSWER_MODEL` | `gemini-flash-lite-latest` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://jaakijfmbmljzpixxbsq.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the publishable key |
| `MEMORY_TZ` | `Asia/Calcutta` |

**Port 6543 on Vercel, 5432 locally.** Serverless functions open many short-lived
connections; the transaction pooler is built for that, and the app already
disables prepared statements and keeps all per-user state inside transactions,
which is what transaction mode requires. Run `pnpm migrate` from your machine
against the session pooler (5432), never from Vercel.

**Do not set `CORTEX_LOCAL`.** It enables indexing a folder from the server's
own filesystem, which is meaningless on a hosted function. The option hides
itself without it.

After changing variables, redeploy so they take effect.

## 3. Point Supabase Auth at the site

Supabase → Authentication → **URL Configuration**:

- **Site URL**: the production URL, `https://cortex-bice-three.vercel.app`
- **Redirect URLs**: add `https://cortex-bice-three.vercel.app/**`

Without this, confirmation emails link to localhost.

## Limits worth knowing

- **Uploads**: Vercel caps a request at ~4.5MB. The import panel opens large
  `.json`/`.zip` exports in the browser and sends them in pieces, so a 50MB
  Claude export still works. Other files (PDF, DOCX) must be under 3.5MB each.
- **Gemini free tier** rate-limits embeddings per minute and per day. A large
  first import may pause on 429s; if it stops, the remaining chunks stay
  "awaiting embedding" and the status page resumes them.
- **Function time**: the ask and status pages allow 60s per action.
