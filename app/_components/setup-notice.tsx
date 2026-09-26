import { DatabaseIcon } from './icons';

/**
 * Shown when DATABASE_URL is absent or the database is unreachable.
 * The app is useless without it, so this explains the fix rather than erroring.
 */
export function SetupNotice({ error }: { error?: string | null }) {
  return (
    <div className="setup card">
      <h1>
        <DatabaseIcon /> {error ? 'Database unreachable' : 'Database not configured'}
      </h1>

      {error ? (
        <>
          <p>
            <code>DATABASE_URL</code> is set, but connecting failed:
          </p>
          <pre>{error}</pre>
          <p>
            The most common cause is using the transaction pooler on port <strong>6543</strong>,
            which does not support prepared statements. Use the session pooler on{' '}
            <strong>5432</strong>.
          </p>
        </>
      ) : (
        <p>
          Add your Supabase connection string to <code>.env</code> to start searching.
        </p>
      )}

      <ol>
        <li>Open your project&rsquo;s <strong>Settings &rarr; Database</strong> in Supabase.</li>
        <li>
          Under <strong>Connection string</strong>, choose the <strong>URI</strong> tab and the{' '}
          <strong>session pooler</strong> (port 5432, not 6543).
        </li>
        <li>
          Put it in <code>.env</code>:
          <pre>DATABASE_URL=postgresql://postgres.[ref]:[password]@...pooler.supabase.com:5432/postgres</pre>
        </li>
        <li>
          Apply the schema and load fixtures:
          <pre>pnpm migrate{'\n'}pnpm seed:fixtures</pre>
        </li>
      </ol>
    </div>
  );
}
