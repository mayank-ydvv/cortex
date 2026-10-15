# Cortex

A notebook that remembers your conversations, so you don't have to.

Import your Claude or ChatGPT export, plus your own notes, and ask questions
about what you actually said. Every answer cites the conversation it came from
and the date you said it.

```
"what did we decide about auth last week?"
  → the decision from last Thursday, cited — not the one from four months ago
```

Sign up, import your own history, and ask. Each account sees only its own
memories — isolation is enforced by Postgres row-level security, not just the app.

**Live:** https://cortex-bice-three.vercel.app

---

## The problem this is built around

Ask a naive RAG pipeline *"what did we decide about auth last week?"* and it
embeds the whole question and returns the five nearest chunks. But `"last week"`
carries almost no semantic signal — the embedding is dominated by `"decide"` and
`"auth"` — so it confidently hands back an auth discussion from four months ago.

That failure is worse than no answer, because it is invisible. The system looks
like it worked.

Measured on real data in this repo:

| query | top results |
|---|---|
| `how do I install claude code` | #2 is a conversation from **24 Aug** |
| `how do I install claude code **last week**` | the August one is **excluded entirely** |

## How it works

Retrieval has three legs:

1. **SQL filters** — date range and project, as `WHERE` clauses on *both*
   ranked queries, so they narrow before ranking rather than after.
2. **Vector similarity** — pgvector cosine, for conceptual matching.
3. **Keyword search** — Postgres full-text, because exact tokens defeat vector
   search: cosine will happily rank a chunk that "discusses dependencies" above
   the one that literally names the package you searched for.

Legs 2 and 3 produce two ranked lists, fused with **Reciprocal Rank Fusion**
(`score = Σ 1/(k + rank)`, k=60). RRF is rank-based, which sidesteps the fact
that cosine distances and `ts_rank` scores are not on comparable scales.

### Time is a SQL filter, never a vector

`chunks.occurred_at` is a `timestamptz` with a B-tree index. An embedding cannot
represent "after September 7" — it can only represent what the phrase *"last
week"* is about, which is nothing.

Two consequences that are easy to get wrong, and that this repo gets right:

**The time phrase is stripped before embedding.** Parsing `"last week"` into a
range does not help if those tokens are still in the vector.

**HNSW post-filters by default, which silently breaks the whole premise.** An
HNSW scan returns the top `ef_search` rows *by distance*, then discards the ones
failing your `WHERE`. If last week is 0.5% of the corpus you get two results —
not because nothing matched, but because the index never looked there. The
vector leg sets `hnsw.iterative_scan = 'relaxed_order'` and `ef_search = 200`,
and warns when a filtered leg returns short.

## Stack

TypeScript · Next.js on Vercel · Supabase (Postgres 17 + pgvector 0.8, Auth) · Drizzle · Vitest

Embeddings are Gemini `gemini-embedding-001` at 768 dims; answers use
`gemini-flash-lite` — both through Gemini's OpenAI-compatible endpoint, so one
free key covers the whole app. Deploy steps are in [DEPLOY.md](DEPLOY.md).

## Running it

```bash
pnpm install
cp .env.example .env          # Postgres URL, Supabase keys, Gemini key
pnpm migrate
pnpm ingest ~/conversations.json --as you@example.com
pnpm dev                      # localhost:3000
```

Also available from the terminal:

```bash
pnpm ask "what did we decide about auth last week?" --sources
```

## Notes on the design

- **Original timestamps are sacred.** An undated message inherits its
  conversation's start time, never import time. Using import time breaks every
  time-scoped query *invisibly* — the rows are there, the search runs, the
  answers are just quietly wrong. Ingest reports how many timestamps were
  inherited for exactly this reason.
- **Chunks are conversation turns**, not fixed character windows. A turn has one
  author and one timestamp; a character window straddles two and its metadata
  becomes fiction.
- **Ingest is idempotent and resumable.** Identity is `(origin, external_id)`;
  `content_hash` decides skip-vs-replace, so a conversation you continued
  updates in place instead of duplicating. Embeddings fill in after insert, so a
  crashed import resumes rather than restarting.
- **Answers always carry their sources.** A synthesised answer reads just as
  fluently when it is wrong, so the evidence stays one click away.

See `CLAUDE.md` for the full design rationale.
