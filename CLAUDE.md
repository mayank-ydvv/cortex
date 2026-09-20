# Personal Memory Engine

A personal "second brain" over my AI chat history (Claude, ChatGPT) and my own notes.
It ingests exported conversations into Postgres, chunks them by conversation turn,
embeds them locally, and answers questions about my past decisions with cited results.
Ingestion is a CLI command; search is a local web UI. Runs on localhost only — a Vercel
deploy is planned but not yet done, so there is deliberately no auth.

## Retrieval strategy: three legs

The requirement that shapes the whole system is answering **"What did we decide about
auth last week?"** correctly.

A naive RAG pipeline embeds that whole query and returns the 5 nearest chunks. But
`"last week"` carries almost no semantic signal — the embedding is dominated by
`"decide"` and `"auth"` — so it confidently returns an auth discussion from four months
ago. Acting on a stale decision is worse than getting nothing, because the failure is
invisible.

So retrieval has three legs:

1. **SQL filters** — date range and project, as `WHERE` clauses on *both* ranked
   queries, so they narrow the candidate set before ranking rather than after.
2. **Vector similarity** — pgvector cosine, for conceptual matching.
3. **Keyword search** — Postgres full-text (`tsvector`), because exact tokens defeat
   vector search: cosine similarity will happily rank a chunk that "discusses
   dependencies" above the chunk that literally names the package you searched for.

Legs 2 and 3 produce two ranked lists, fused with **Reciprocal Rank Fusion**
(score = Σ 1/(k + rank), k = 60). RRF is rank-based, which sidesteps the fact that
cosine distances and `ts_rank` scores are not on comparable scales.

### Why time is a SQL filter, never a vector

Time is **structured metadata**. It lives in `chunks.occurred_at timestamptz` with a
B-tree index and is applied as a `WHERE` clause. It is never embedded, because an
embedding cannot represent "after September 7" — it can only represent what the phrase
"last week" is *about*, which is nothing.

Three consequences that are easy to get wrong:

- **The time expression is stripped from the query text before embedding.** Parsing
  `"last week"` into a range does not help if those tokens are still in the vector.
  `src/search/time.ts` returns both the range and the cleaned text.
- **HNSW post-filters by default, which silently breaks the whole premise.** An HNSW
  scan returns the top `ef_search` rows *by distance*, then drops the ones failing your
  `WHERE`. If last week is 0.5% of the corpus you get two results, not because nothing
  matched but because the index never looked there. The vector leg therefore sets
  `hnsw.iterative_scan = 'relaxed_order'` and `hnsw.ef_search = 200` (pgvector 0.8.0+;
  the default is `off`), and warns when a filtered vector leg returns short.
- **Date ranges are deliberately generous.** "last week" resolves to the start of the
  previous calendar week through *now*, not a strict Mon–Sun window. A strict window
  would silently exclude a decision made this Thursday. Over-including is recoverable
  because you can see the dates; under-including is invisible.

## Embeddings

Local, no API key, no cost. `Xenova/bge-small-en-v1.5` via `@huggingface/transformers`
(onnxruntime), **384 dimensions**. Measured ~2.75ms per input on an M4.

Two constraints this imposes:

- **512-token input limit.** Chunks target ~400 tokens, not the 1500 an API model would
  allow. Anything longer is silently truncated by the model, so the chunker must not
  exceed it. Smaller chunks also match more precisely, so this is not purely a cost.
- **BGE models want an asymmetric prefix.** Queries are prefixed with
  `"Represent this sentence for searching relevant passages: "`; documents are not.
  Skipping this measurably degrades retrieval.

Embedding sits behind a provider interface in `src/ingest/embed.ts`. This matters: a
Vercel deploy cannot run `onnxruntime-node`, which ships native binaries. Swapping
providers must stay a one-file change.

> **Changing the embedding model invalidates every stored vector.** Dimensions, and the
> vector space itself, are model-specific. A model change means a schema migration and
> a full re-embed of the corpus — not a config tweak.

## Directory layout

```
CLAUDE.md
drizzle/0000_init.sql        hand-authored DDL (extension + generated tsvector)
src/
  db/schema.ts               Drizzle tables, mirrors the SQL
  db/client.ts               postgres-js connection
  ingest/
    index.ts                 orchestrator: hash -> diff -> chunk -> embed -> report
    parsers/                 claude.ts, chatgpt.ts, manual.ts, detect.ts, types.ts
    chunk.ts                 turn-based splitting, carries role + timestamp
    embed.ts                 provider interface + local bge-small, batched
  search/
    index.ts                 search(query, options)
    time.ts                  parseTimeRange()    <- unit tested
    rrf.ts                   fuse()              <- unit tested
    vector.ts / keyword.ts   the two ranked legs
  cli/                       migrate, ingest, seed, golden
app/                         Next.js UI: search, explain, browse, import status
tests/
  time.test.ts, rrf.test.ts, golden.json
```

## Commands

```bash
pnpm install
pnpm migrate                                       # apply drizzle/*.sql
pnpm ingest <path> [--project p] [--dry-run]       # import an export file (CLI only)
pnpm dev                                           # web UI on localhost:3000
pnpm test                                          # vitest unit tests
pnpm test:golden                                   # precision@5 / recall@5 by category
pnpm seed:fixtures                                 # synthetic chunks for dev
```

Ingestion stays a CLI command on purpose: it is a long-running batch job, and running it
behind an HTTP route would require the job queue and progress streaming that belong to a
later phase.

The UI's explain panel shows the parsed date range, the cleaned query, both raw ranked
lists, and the fused result — use it whenever results look wrong. `from`/`to` overrides
bypass the parser, which isolates parser bugs from retrieval bugs.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Supabase session pooler (**5432**) or direct. The transaction pooler on 6543 breaks prepared statements and will fail migrations. |
| `MEMORY_TZ` | no | IANA zone for resolving date expressions. Defaults to system timezone. |

No API keys. Embeddings are local.

## Standing rules

**1. Any change to retrieval must be re-validated against the golden set.**
Run `pnpm test:golden` and check the per-category breakdown, not just the aggregate. An
overall score hides the case where every time-scoped query has started failing.

**2. Original message timestamps are sacred. Never substitute import time.**
`chunks.occurred_at` is the message's own timestamp. If a message has none, inherit the
conversation's `started_at` — never `now()`. Using import time silently breaks every
time-scoped query, and it breaks it *invisibly*: the rows are there, the search runs,
the answers are just quietly wrong. Ingest reports how many timestamps were inherited
for exactly this reason.
