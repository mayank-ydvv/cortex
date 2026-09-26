'use client';

import { useRef, useState, useTransition } from 'react';
import { ask, type AskResult } from '../actions';
import { AlertIcon, ClockIcon, SearchIcon } from './icons';

interface Turn {
  id: number;
  question: string;
  result: AskResult | null;
  error: string | null;
}

const EXAMPLES = [
  'what is my height?',
  'what did we decide about vector search last week?',
  'how do I install claude code',
];

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(iso));

/**
 * Chat over your own history.
 *
 * Every answer keeps its sources visible underneath. A synthesised answer reads
 * fluently whether or not it is right, so the evidence has to stay one glance
 * away -- otherwise a wrong answer is indistinguishable from a correct one.
 */
export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  function submit(question: string) {
    const q = question.trim();
    if (q === '' || pending) return;

    const id = nextId.current++;
    setTurns((t) => [...t, { id, question: q, result: null, error: null }]);
    if (inputRef.current) inputRef.current.value = '';

    startTransition(async () => {
      try {
        const result = await ask(q);
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, result } : x)));
      } catch (e) {
        setTurns((t) =>
          t.map((x) =>
            x.id === id ? { ...x, error: e instanceof Error ? e.message : String(e) } : x,
          ),
        );
      }
    });
  }

  return (
    <div className="chat">
      {turns.length === 0 ? (
        <div className="card chat-intro">
          <p>
            Ask anything about your own conversations and notes. Answers come only from what
            you actually said, and every one shows its sources.
          </p>
          <div className="filters">
            {EXAMPLES.map((e) => (
              <button key={e} className="chip" type="button" onClick={() => submit(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="turns">
          {turns.map((t) => (
            <li key={t.id} className="turn">
              <div className="bubble-q">{t.question}</div>
              {t.error ? (
                <Notice kind="danger" title="something went wrong" body={t.error} />
              ) : t.result ? (
                <Answer result={t.result} />
              ) : (
                <div className="thinking">
                  <span className="dot" /> searching your history…
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(inputRef.current?.value ?? '');
        }}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="what is my height?"
          aria-label="Ask a question about your history"
          autoComplete="off"
          disabled={pending}
          autoFocus
        />
        <button className="btn" type="submit" disabled={pending}>
          <SearchIcon /> {pending ? 'asking…' : 'ask'}
        </button>
      </form>
    </div>
  );
}

function Notice({ kind, title, body, hint }: {
  kind: 'warn' | 'danger'; title: string; body: string; hint?: string;
}) {
  return (
    <div className={`notice notice-${kind}`}>
      <span className="notice-icon"><AlertIcon /></span>
      <div className="notice-body">
        <div className="notice-title">{title}</div>
        <p>{body}</p>
        {hint && <p style={{ marginTop: 4, color: 'var(--muted-deep)' }}>{hint}</p>}
      </div>
    </div>
  );
}

function Answer({ result }: { result: AskResult }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bubble-a">
      {result.answer ? (
        <div className="answer-text">{result.answer}</div>
      ) : (
        <Notice
          kind="warn"
          title={result.sources.length > 0 ? 'no written answer' : 'nothing found'}
          body={result.unavailable?.message ?? 'No answer.'}
          hint={result.unavailable?.hint}
        />
      )}

      <div className="answer-meta">
        {result.range && (
          <span className="badge">
            <ClockIcon /> {fmtDate(result.range.from)} – {fmtDate(result.range.to)}
            {result.timeExpression && ` · "${result.timeExpression}"`}
          </span>
        )}
        {result.model && <span className="badge">{result.model}</span>}
        {result.sources.length > 0 && (
          <button className="chip" type="button" onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}>
            {open ? 'hide' : 'show'} {result.sources.length} source
            {result.sources.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {result.warnings.map((w) => (
        <Notice key={w} kind="warn" title="retrieval warning" body={w} />
      ))}

      {open && (
        <ol className="sources">
          {result.sources.map((s) => (
            <li key={s.chunkId} className="source">
              <div className="source-head">
                <span className="source-n">[{s.n}]</span>
                <span className="badge badge-origin">{s.origin}</span>
                <span className="source-title">{s.title ?? 'untitled'}</span>
                <time className="source-date" dateTime={s.occurredAt}>{fmtDate(s.occurredAt)}</time>
              </div>
              <p className="source-body">{s.content}</p>
              <div className="meta-row">
                <span className={`badge ${s.vectorRank !== null ? 'badge-vec' : 'badge-off'}`}>
                  {s.vectorRank !== null ? `vec #${s.vectorRank}` : 'vec —'}
                </span>
                <span className={`badge ${s.keywordRank !== null ? 'badge-kw' : 'badge-off'}`}>
                  {s.keywordRank !== null ? `kw #${s.keywordRank}` : 'kw —'}
                </span>
                <span className="badge">{s.role}</span>
                <span className="badge">source #{s.sourceId}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
