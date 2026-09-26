import { search } from '../src/search/index';
import { checkDb } from '../src/db/stats';
import { ExplainPanel } from './_components/explain-panel';
import { ResultList } from './_components/result-list';
import { SetupNotice } from './_components/setup-notice';
import { AlertIcon, SearchIcon } from './_components/icons';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string; explain?: string; project?: string; limit?: string }>;
}

const EXAMPLES = [
  'what did we decide about auth last week?',
  'hnsw.iterative_scan',
  'database migrations in March',
];

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = params.q?.trim() ?? '';
  const showExplain = params.explain === '1';

  const db = await checkDb();
  if (!db.configured || !db.reachable) return <SetupNotice error={db.error} />;

  return (
    <>
      <form className="searchbar" action="/" method="get" role="search">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="what did we decide about auth last week?"
          aria-label="Search your memory"
          autoComplete="off"
          autoFocus
        />
        {showExplain && <input type="hidden" name="explain" value="1" />}
        {params.project && <input type="hidden" name="project" value={params.project} />}
        <button className="btn" type="submit">
          <SearchIcon /> search
        </button>
      </form>

      <div className="hint">
        <span>
          time filters are SQL, not embedded &mdash; try{' '}
          <code>last week</code> <code>in March</code> <code>a few months ago</code>
        </span>
        <a
          className="chip"
          href={`/?${new URLSearchParams({ ...(query && { q: query }), ...(showExplain ? {} : { explain: '1' }) })}`}
          aria-current={showExplain}
        >
          {showExplain ? 'hide explain' : 'show explain'}
        </a>
      </div>

      {query === '' ? (
        <div className="card">
          <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13 }}>
            Search across your imported conversations and notes. Every result is cited with its
            source and the date it was actually said.
          </p>
          <div className="filters">
            {EXAMPLES.map((e) => (
              <a key={e} className="chip" href={`/?q=${encodeURIComponent(e)}&explain=1`}>
                {e}
              </a>
            ))}
          </div>
        </div>
      ) : (
        <Results query={query} showExplain={showExplain} project={params.project} limit={params.limit} />
      )}
    </>
  );
}

async function Results({
  query, showExplain, project, limit,
}: { query: string; showExplain: boolean; project?: string; limit?: string }) {
  const { hits, explain } = await search(query, {
    limit: limit ? Number.parseInt(limit, 10) : 10,
    project: project ?? null,
  });

  return (
    <>
      {showExplain && <ExplainPanel explain={explain} />}

      {explain.warnings.map((w) => (
        <div key={w} className="notice notice-warn">
          <span className="notice-icon">
            <AlertIcon />
          </span>
          <div className="notice-body">
            <div className="notice-title">retrieval warning</div>
            <p>{w}</p>
          </div>
        </div>
      ))}

      {hits.length === 0 ? (
        <div className="empty">
          no results
          {explain.range && ' within the resolved date window'}
          {!showExplain && (
            <>
              {' '}
              &mdash;{' '}
              <a
                style={{ color: 'var(--accent)' }}
                href={`/?q=${encodeURIComponent(query)}&explain=1`}
              >
                show explain
              </a>{' '}
              to see why
            </>
          )}
        </div>
      ) : (
        <ResultList hits={hits} />
      )}
    </>
  );
}
