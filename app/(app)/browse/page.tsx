import { checkDb, getCorpusStats, listSources, type SourceRow } from '../../../src/db/stats';
import { SetupNotice } from '../../_components/setup-notice';
import { requireUser } from '../../../src/auth/server';

export const dynamic = 'force-dynamic';

const TZ = process.env.MEMORY_TZ || undefined;
const monthKey = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'long', timeZone: TZ }).format(d);
const dayFmt = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: TZ }).format(d);

interface Props {
  searchParams: Promise<{ project?: string; origin?: string }>;
}

export default async function BrowsePage({ searchParams }: Props) {
  const { project, origin } = await searchParams;

  const db = await checkDb();
  if (!db.configured || !db.reachable) return <SetupNotice error={db.error} />;

  const user = await requireUser();
  const [sources, stats] = await Promise.all([
    listSources(user.id, { project, origin }),
    getCorpusStats(user.id),
  ]);

  // Grouped by month so the corpus reads as a timeline rather than a flat list.
  const months = new Map<string, SourceRow[]>();
  for (const s of sources) {
    const key = monthKey(s.startedAt);
    months.set(key, [...(months.get(key) ?? []), s]);
  }

  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { project, origin, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `/browse?${s}` : '/browse';
  };

  return (
    <>
      <div className="filters">
        <a className="chip" href="/browse" aria-current={!project && !origin}>all</a>
        {stats.byOrigin.map((o) => (
          <a key={o.origin} className="chip" href={qs({ origin: origin === o.origin ? undefined : o.origin })}
             aria-current={origin === o.origin}>
            {o.origin} ({o.sources})
          </a>
        ))}
        {stats.projects.map((p) => (
          <a key={p} className="chip" href={qs({ project: project === p ? undefined : p })}
             aria-current={project === p}>
            #{p}
          </a>
        ))}
      </div>

      {sources.length === 0 ? (
        <div className="empty">
          nothing imported yet &mdash; run <code>pnpm ingest &lt;path&gt;</code>
        </div>
      ) : (
        [...months].map(([month, rows]) => (
          <section key={month}>
            <h2 className="month-head">
              <span>{month}</span>
              <span>{rows.length} source{rows.length === 1 ? '' : 's'}</span>
            </h2>
            {rows.map((s) => (
              <article key={s.id} className="result">
                <div className="result-head">
                  <time className="rank-num" dateTime={s.startedAt.toISOString()}
                        style={{ minWidth: 52, fontSize: 11 }}>
                    {dayFmt(s.startedAt)}
                  </time>
                  <span className="badge badge-origin">{s.origin}</span>
                  <span className="result-title">{s.title ?? 'untitled'}</span>
                  <span className="result-date">
                    {s.chunkCount} chunk{s.chunkCount === 1 ? '' : 's'}
                  </span>
                </div>
                {s.firstLine && (
                  <p className="result-body" style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                    {s.firstLine}
                    {s.firstLine.length >= 160 ? '…' : ''}
                  </p>
                )}
                <div className="meta-row">
                  <span className="badge">source #{s.id}</span>
                  {s.project && <span className="badge">{s.project}</span>}
                </div>
              </article>
            ))}
          </section>
        ))
      )}
    </>
  );
}
