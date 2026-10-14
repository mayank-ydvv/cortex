# Deploying Cortex to Railway

Railway runs a container rather than serverless functions, which is why this
app goes there and not to Vercel: the embedding model is 287MB of native
`onnxruntime` binaries and needs a long-lived process with a real filesystem.
Vercel's function limit is 250MB and has neither.

## 1. Create the project

1. Go to **https://railway.com/new**
2. **Deploy from GitHub repo** → authorise Railway → pick **mayank-ydvv/cortex**
3. Railway detects Next.js and starts a first build. It will fail until the
   variables below are set — that is expected.

## 2. Set variables

Project → **Variables** → paste these. Values marked *secret* come from your
local `.env`; never commit them.

| Variable | Value |
|---|---|
| `DATABASE_URL` | *secret* — the Supabase session pooler URL (port 5432) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://jaakijfmbmljzpixxbsq.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the publishable key from `.env` |
| `ANSWER_API_KEY` | *secret* — your Gemini key |
| `ANSWER_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `ANSWER_MODEL` | `gemini-flash-lite-latest` |
| `MEMORY_TZ` | `Asia/Calcutta` |

**Do not set `CORTEX_LOCAL`.** It enables indexing a folder from the
filesystem, which on a server reads the container rather than anyone's machine.
The feature disables itself without it.

## 3. Generate a domain

Settings → **Networking** → **Generate Domain**. That URL is the live app.

## 4. Point Supabase at it

Supabase dashboard → Authentication → URL Configuration → add the Railway URL
to **Site URL** and **Redirect URLs**, or email confirmation links will send
people to localhost.

## Notes

- **First request after a deploy is slow** (~30s). The embedding model
  downloads once on cold start, then stays in memory.
- **Memory**: the model needs roughly 500MB resident. Railway's starter
  container is 512MB–1GB; if the process is killed, raise the limit.
- **Cost**: Railway's free trial covers this; after that it is usage-based.
  The database stays on Supabase's free tier.
