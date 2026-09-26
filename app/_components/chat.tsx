'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  deleteThread,
  fetchMessages,
  fetchThreads,
  renameThread,
  sendMessage,
  type ClientMessage,
  type ClientThread,
} from '../chat-actions';
import { AlertIcon, ClockIcon, PlusIcon, SearchIcon, TrashIcon } from './icons';
import { Markdown } from './markdown';

const EXAMPLES = [
  'what did we decide about vector search last week?',
  'how do I install claude code',
  'what have I been working on recently?',
];

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(iso));

/** Relative day grouping, the way these sidebars normally read. */
function bucket(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return 'Older';
}

interface Meta {
  model: string | null;
  range: { from: string; to: string } | null;
  timeExpression: string | null;
  warnings: string[];
}

export function Chat() {
  const [threads, setThreads] = useState<ClientThread[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [meta, setMeta] = useState<Record<number, Meta>>({});
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, startTransition] = useTransition();

  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshThreads = useCallback(() => {
    fetchThreads().then(setThreads).catch(() => {});
  }, []);

  useEffect(refreshThreads, [refreshThreads]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pendingQuestion]);

  function openThread(id: number) {
    setActiveId(id);
    setError(null);
    setSidebarOpen(false);
    startTransition(async () => {
      try {
        setMessages(await fetchMessages(id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setError(null);
    setSidebarOpen(false);
    inputRef.current?.focus();
  }

  function submit(text: string) {
    const q = text.trim();
    if (q === '' || busy) return;
    if (inputRef.current) inputRef.current.value = '';
    setError(null);
    setPendingQuestion(q);

    startTransition(async () => {
      try {
        const r = await sendMessage(activeId, q);
        setActiveId(r.threadId);
        setMessages((prev) => [...prev, r.userMessage, r.assistantMessage]);
        setMeta((m) => ({
          ...m,
          [r.assistantMessage.id]: {
            model: r.model,
            range: r.range,
            timeExpression: r.timeExpression,
            warnings: r.warnings,
          },
        }));
        refreshThreads();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPendingQuestion(null);
      }
    });
  }

  function remove(id: number) {
    startTransition(async () => {
      await deleteThread(id);
      if (id === activeId) newChat();
      refreshThreads();
    });
  }

  function rename(id: number, current: string) {
    const next = window.prompt('Rename chat', current);
    if (next === null) return;
    startTransition(async () => {
      await renameThread(id, next);
      refreshThreads();
    });
  }

  // Group threads for the sidebar, preserving the recency order they arrive in.
  const groups: [string, ClientThread[]][] = [];
  for (const t of threads) {
    const b = bucket(t.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === b) last[1].push(t);
    else groups.push([b, [t]]);
  }

  return (
    <div className={`chat-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <aside className="sidebar">
        <button className="btn new-chat" type="button" onClick={newChat}>
          <PlusIcon /> new chat
        </button>

        <nav className="thread-list" aria-label="Saved chats">
          {threads.length === 0 ? (
            <p className="thread-empty">No saved chats yet.</p>
          ) : (
            groups.map(([label, items]) => (
              <div key={label}>
                <div className="thread-group">{label}</div>
                {items.map((t) => (
                  <div
                    key={t.id}
                    className={`thread ${t.id === activeId ? 'active' : ''}`}
                  >
                    <button className="thread-open" type="button" onClick={() => openThread(t.id)}
                            title={t.title}>
                      {t.title}
                    </button>
                    <span className="thread-actions">
                      <button type="button" onClick={() => rename(t.id, t.title)}
                              aria-label={`Rename ${t.title}`} title="rename">✎</button>
                      <button type="button" onClick={() => remove(t.id)}
                              aria-label={`Delete ${t.title}`} title="delete"><TrashIcon /></button>
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </nav>
      </aside>

      <div className="chat-main">
        <button className="chip sidebar-toggle" type="button"
                onClick={() => setSidebarOpen((v) => !v)} aria-expanded={sidebarOpen}>
          {sidebarOpen ? 'close' : `chats (${threads.length})`}
        </button>

        {messages.length === 0 && !pendingQuestion ? (
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
            {messages.map((m) =>
              m.role === 'user' ? (
                <li key={m.id} className="turn">
                  <div className="bubble-q">{m.content}</div>
                </li>
              ) : (
                <li key={m.id} className="turn">
                  <AnswerBubble message={m} meta={meta[m.id]} />
                </li>
              ),
            )}
            {pendingQuestion && (
              <li className="turn">
                <div className="bubble-q">{pendingQuestion}</div>
                <div className="thinking">
                  <span className="dot" /> searching your history…
                </div>
              </li>
            )}
            <div ref={bottomRef} />
          </ol>
        )}

        {error && (
          <div className="notice notice-danger">
            <span className="notice-icon"><AlertIcon /></span>
            <div className="notice-body">
              <div className="notice-title">something went wrong</div>
              <p>{error}</p>
            </div>
          </div>
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
            placeholder={activeId ? 'ask a follow-up…' : 'what did we decide about…?'}
            aria-label="Ask a question about your history"
            autoComplete="off"
            disabled={busy}
            autoFocus
          />
          <button className="btn" type="submit" disabled={busy}>
            <SearchIcon /> {busy ? '…' : 'ask'}
          </button>
        </form>
      </div>
    </div>
  );
}

function AnswerBubble({ message, meta }: { message: ClientMessage; meta?: Meta }) {
  const [open, setOpen] = useState(false);
  const sources = message.sources ?? [];

  return (
    <div className="bubble-a">
      {message.content ? (
        <div className="answer-text"><Markdown text={message.content} /></div>
      ) : (
        <div className="notice notice-warn">
          <span className="notice-icon"><AlertIcon /></span>
          <div className="notice-body">
            <div className="notice-title">
              {sources.length > 0 ? 'no written answer' : 'nothing found'}
            </div>
            <p>{message.note ?? 'No answer.'}</p>
          </div>
        </div>
      )}

      <div className="answer-meta">
        {meta?.range && (
          <span className="badge">
            <ClockIcon /> {fmtDate(meta.range.from)} – {fmtDate(meta.range.to)}
            {meta.timeExpression && ` · "${meta.timeExpression}"`}
          </span>
        )}
        {meta?.model && <span className="badge">{meta.model}</span>}
        {sources.length > 0 && (
          <button className="chip" type="button" onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}>
            {open ? 'hide' : 'show'} {sources.length} source{sources.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {meta?.warnings.map((w) => (
        <div key={w} className="notice notice-warn">
          <span className="notice-icon"><AlertIcon /></span>
          <div className="notice-body">
            <div className="notice-title">retrieval warning</div>
            <p>{w}</p>
          </div>
        </div>
      ))}

      {open && (
        <ol className="sources">
          {sources.map((s) => (
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
                <span className="badge">source #{s.sourceId}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
