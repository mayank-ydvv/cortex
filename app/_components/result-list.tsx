import type { SearchHit } from '../../src/search/index';

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeZone: process.env.MEMORY_TZ || undefined,
  }).format(d);

/**
 * Results always carry their citation: origin, conversation title, the real
 * date the thing was said, and the source id. An uncited answer is a failure.
 *
 * Each hit also shows its rank in each leg, so it is always visible WHY
 * something surfaced -- and whether it came from one leg or both.
 */
export function ResultList({ hits }: { hits: SearchHit[] }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {hits.map((h, i) => (
        <li key={h.chunkId} className="result">
          <div className="result-head">
            <span className="rank-num">{String(i + 1).padStart(2, '0')}</span>
            <span className="badge badge-origin">{h.origin}</span>
            <span className="result-title">{h.sourceTitle ?? 'untitled'}</span>
            <time className="result-date" dateTime={h.occurredAt.toISOString()}>
              {fmt(h.occurredAt)}
            </time>
          </div>

          <p className="result-body">{h.content}</p>

          <div className="meta-row">
            <span className={`badge ${h.vectorRank !== null ? 'badge-vec' : 'badge-off'}`}>
              {h.vectorRank !== null ? `vec #${h.vectorRank}` : 'vec —'}
            </span>
            <span className={`badge ${h.keywordRank !== null ? 'badge-kw' : 'badge-off'}`}>
              {h.keywordRank !== null ? `kw #${h.keywordRank}` : 'kw —'}
            </span>
            <span className="badge">rrf {h.fusedScore.toFixed(5)}</span>
            <span className="badge">{h.role}</span>
            <span className="badge">source #{h.sourceId}</span>
            {h.project && <span className="badge">{h.project}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
