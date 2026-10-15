import { checkDb, getCorpusStats } from '../../../src/db/stats';
import { SetupNotice } from '../../_components/setup-notice';
import { ImportPanel } from '../../_components/import-panel';
import { isLocalInstall } from '../../actions';
import { AlertIcon } from '../../_components/icons';
import { requireUser } from '../../../src/auth/server';

export const dynamic = 'force-dynamic';
// Server actions on this page call Gemini; give them room on serverless.
export const maxDuration = 60;

const TZ = process.env.MEMORY_TZ || undefined;
const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: TZ }).format(d) : '—';

export default async function StatusPage() {
  const db = await checkDb();
  if (!db.configured || !db.reachable) return <SetupNotice error={db.error} />;

  const user = await requireUser();
  const s = await getCorpusStats(user.id);
  const span =
    s.earliest && s.latest
      ? Math.round((s.latest.getTime() - s.earliest.getTime()) / 86400000)
      : 0;

  return (
    <>
      <ImportPanel initialPending={s.awaitingEmbedding} showFolder={await isLocalInstall()} />

      {s.awaitingEmbedding > 0 && (
        <div className="notice notice-danger">
          <span className="notice-icon"><AlertIcon /></span>
          <div className="notice-body">
            <div className="notice-title">
              {s.awaitingEmbedding} chunk{s.awaitingEmbedding === 1 ? '' : 's'} awaiting embedding
            </div>
            <p>
              These are invisible to vector search until embedded &mdash; searches will silently
              miss them. Re-run <code>pnpm ingest</code> to sweep them up.
            </p>
          </div>
        </div>
      )}

      {s.inherited > 0 && (
        <div className="notice notice-warn">
          <span className="notice-icon"><AlertIcon /></span>
          <div className="notice-body">
            <div className="notice-title">
              {s.inherited} chunk{s.inherited === 1 ? '' : 's'} inherited their
              conversation&rsquo;s start time
            </div>
            <p>
              The export carried no per-message timestamp for these. They are still real
              timestamps, never import time, but time-scoped queries are coarser for them.
            </p>
          </div>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">sources</div>
          <div className="stat-value">{s.sources.toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="stat-label">chunks</div>
          <div className="stat-value">{s.chunks.toLocaleString()}</div>
          <div className="stat-sub">
            {s.sources > 0 ? (s.chunks / s.sources).toFixed(1) : '0'} per source
          </div>
        </div>
        <div className={`stat ${s.awaitingEmbedding > 0 ? 'stat-flag' : ''}`}>
          <div className="stat-label">awaiting embedding</div>
          <div className="stat-value">{s.awaitingEmbedding.toLocaleString()}</div>
          <div className="stat-sub">
            {s.awaitingEmbedding === 0 ? 'fully indexed' : 'invisible to vector search'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">corpus span</div>
          <div className="stat-value">{span.toLocaleString()}</div>
          <div className="stat-sub">days</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--sp-4)' }}>
        <table className="data">
          <caption style={{ captionSide: 'top', textAlign: 'left', paddingBottom: 8 }}
                   className="stat-label">
            by origin
          </caption>
          <thead>
            <tr><th>origin</th><th style={{ textAlign: 'right' }}>sources</th><th style={{ textAlign: 'right' }}>chunks</th></tr>
          </thead>
          <tbody>
            {s.byOrigin.length === 0 ? (
              <tr><td colSpan={3} style={{ color: 'var(--muted-deep)' }}>nothing imported yet</td></tr>
            ) : (
              s.byOrigin.map((o) => (
                <tr key={o.origin}>
                  <td><span className="badge badge-origin">{o.origin}</span></td>
                  <td className="num">{o.sources.toLocaleString()}</td>
                  <td className="num">{o.chunks.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <dl className="kv">
          <dt>earliest</dt><dd>{fmt(s.earliest)}</dd>
          <dt>latest</dt><dd>{fmt(s.latest)}</dd>
          <dt>projects</dt>
          <dd>{s.projects.length > 0 ? s.projects.join(', ') : '—'}</dd>
          <dt>embedding</dt><dd>gemini-embedding-001 · 768 dims</dd>
          <dt>timezone</dt><dd>{process.env.MEMORY_TZ ?? 'system default'}</dd>
        </dl>
      </div>
    </>
  );
}
