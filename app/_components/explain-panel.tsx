import type { SearchExplain } from '../../src/search/index';
import { ClockIcon } from './icons';

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short',
    timeZone: process.env.MEMORY_TZ || undefined,
  }).format(d);

const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

/**
 * The visual form of --explain.
 *
 * This is the surface that tells a date-parsing bug from a retrieval bug, so it
 * shows the resolved window, what actually got embedded, and both ranked lists
 * side by side with the fused result.
 */
export function ExplainPanel({ explain }: { explain: SearchExplain }) {
  const { range, vector, keyword, fused } = explain;
  const rows = Math.min(10, Math.max(vector.length, keyword.length, fused.length));

  return (
    <section className="explain card" aria-label="Retrieval explanation">
      <h2>explain</h2>

      <dl className="kv">
        <dt>query</dt>
        <dd>{explain.query}</dd>

        <dt>embedded</dt>
        <dd>
          {explain.cleanedText}
          {explain.cleanedText !== explain.query && (
            <span style={{ color: 'var(--accent)' }}> &larr; time phrase stripped</span>
          )}
        </dd>

        <dt>date filter</dt>
        <dd>
          {range ? (
            <>
              {explain.rangeSource === 'override'
                ? 'manual override'
                : `parsed "${explain.timeExpression}"`}
            </>
          ) : (
            <span style={{ color: 'var(--muted-deep)' }}>none &mdash; no time expression found</span>
          )}
        </dd>

        <dt>depth / k</dt>
        <dd>
          {explain.candidateDepth} per leg &middot; k={explain.k}
        </dd>

        {explain.project && (
          <>
            <dt>project</dt>
            <dd>{explain.project}</dd>
          </>
        )}
      </dl>

      {range && (
        <div className="window">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>
              <ClockIcon /> {fmt(range.from)}
            </span>
            <span style={{ color: 'var(--accent)' }}>{fmt(range.to)}</span>
          </div>
          <div className="window-bar">
            <div className="window-fill" style={{ width: '100%' }} />
          </div>
          <div style={{ color: 'var(--muted-deep)' }}>
            {days(range.from, range.to)} day window &middot; anything outside it cannot be returned,
            however similar
          </div>
        </div>
      )}

      <div className="legs">
        <Leg title="vector leg" className="leg-vec"
             items={vector.slice(0, rows).map((h) => [`c${h.chunkId}`, `d=${h.score.toFixed(3)}`])} />
        <Leg title="keyword leg" className="leg-kw"
             items={keyword.slice(0, rows).map((h) => [`c${h.chunkId}`, `r=${h.score.toFixed(3)}`])} />
        <Leg title="fused (rrf)" className="leg-fused"
             items={fused.slice(0, rows).map((h) => [`c${h.chunkId}`, h.score.toFixed(5)])} />
      </div>
    </section>
  );
}

function Leg({
  title, className, items,
}: { title: string; className: string; items: [string, string][] }) {
  return (
    <div className={`leg ${className}`}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="leg-empty">no results</p>
      ) : (
        <ol>
          {items.map(([id, score], i) => (
            <li key={id}>
              <span>
                {i + 1}. {id}
              </span>
              <span>{score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
