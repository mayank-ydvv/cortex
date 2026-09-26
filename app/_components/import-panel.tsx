'use client';

import { useRef, useState, useTransition } from 'react';
import { embedBatch, importFiles, type ImportResult } from '../actions';
import { AlertIcon } from './icons';

/**
 * Upload and import.
 *
 * Two phases on purpose. The upload inserts chunks with no embedding and returns
 * straight away; embedding then runs as a client-driven loop of bounded batches.
 * That gives real progress on a long import without a job queue, and it reuses
 * the nullable-embedding column that already makes ingest resumable — if you
 * close the tab midway, the remaining chunks are picked up next time.
 */
export function ImportPanel({ initialPending }: { initialPending: number }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isUploading, startUpload] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, setPending] = useState(initialPending);
  const [embedding, setEmbedding] = useState(false);
  const [embedTotal, setEmbedTotal] = useState(0);
  const [embedDone, setEmbedDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function runEmbedding(total: number) {
    setEmbedding(true);
    setEmbedTotal(total);
    setEmbedDone(0);
    try {
      for (;;) {
        const { embedded, remaining } = await embedBatch(64);
        setEmbedDone((d) => d + embedded);
        setPending(remaining);
        if (remaining === 0 || embedded === 0) break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEmbedding(false);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const data = new FormData(e.currentTarget);
    startUpload(async () => {
      try {
        const r = await importFiles(data);
        setResult(r);
        setPending(r.pendingEmbeddings);
        formRef.current?.reset();
        if (r.pendingEmbeddings > 0) await runEmbedding(r.pendingEmbeddings);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const pct = embedTotal > 0 ? Math.min(100, Math.round((embedDone / embedTotal) * 100)) : 0;

  return (
    <section className="card" style={{ marginBottom: 'var(--sp-4)' }}>
      <div className="stat-label" style={{ marginBottom: 'var(--sp-3)' }}>import</div>

      <form ref={formRef} onSubmit={onSubmit}>
        <div className="import-row">
          <input
            type="file"
            name="files"
            multiple
            accept=".md,.markdown,.txt,.json,application/json,text/markdown,text/plain"
            aria-label="Files to import"
            disabled={isUploading || embedding}
          />
          <input
            type="text"
            name="project"
            placeholder="project (optional)"
            aria-label="Project tag"
            className="project-input"
            disabled={isUploading || embedding}
          />
          <button className="btn" type="submit" disabled={isUploading || embedding}>
            {isUploading ? 'importing…' : 'import'}
          </button>
        </div>
        <p className="import-hint">
          Markdown and text notes import directly. A Claude or ChatGPT{' '}
          <code>.json</code> export is not parsed yet — upload it and this will print its real
          structure, which is what the parser has to be written against.
        </p>
      </form>

      {(embedding || pending > 0) && (
        <div className="window" style={{ marginTop: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{embedding ? 'embedding locally…' : `${pending} chunk(s) awaiting embedding`}</span>
            {embedding && <span style={{ color: 'var(--accent)' }}>{pct}%</span>}
          </div>
          {embedding && (
            <>
              <div className="window-bar">
                <div className="window-fill" style={{ width: `${pct}%`, inset: '0 auto 0 0' }} />
              </div>
              <div style={{ color: 'var(--muted-deep)' }}>
                {embedDone} / {embedTotal} · runs on your machine, nothing is sent anywhere
              </div>
            </>
          )}
          {!embedding && pending > 0 && (
            <button
              className="btn btn-ghost"
              style={{ marginTop: 'var(--sp-2)' }}
              onClick={() => runEmbedding(pending)}
              type="button"
            >
              embed now
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="notice notice-danger" style={{ marginTop: 'var(--sp-3)' }}>
          <span className="notice-icon"><AlertIcon /></span>
          <div className="notice-body">
            <div className="notice-title">import failed</div>
            <p>{error}</p>
          </div>
        </div>
      )}

      {result && <ImportReport result={result} />}
    </section>
  );
}

function ImportReport({ result }: { result: ImportResult }) {
  const s = result.summary;
  return (
    <div style={{ marginTop: 'var(--sp-4)' }}>
      {s && (s.sourcesInserted > 0 || s.sourcesUpdated > 0 || s.sourcesSkipped > 0) && (
        <dl className="kv" style={{ marginBottom: 'var(--sp-3)' }}>
          <dt>inserted</dt><dd>{s.sourcesInserted}</dd>
          <dt>updated</dt><dd>{s.sourcesUpdated}</dd>
          <dt>skipped</dt><dd>{s.sourcesSkipped} (unchanged)</dd>
          <dt>chunks</dt><dd>{s.chunksCreated}</dd>
          {s.timestampsInherited > 0 && (
            <>
              <dt>inherited</dt>
              <dd style={{ color: 'var(--warn)' }}>
                {s.timestampsInherited} timestamp(s) from conversation start
              </dd>
            </>
          )}
        </dl>
      )}

      {result.files.map((f) => (
        <div key={f.name} className={`notice ${f.status === 'error' ? 'notice-danger' : f.status === 'unsupported' || f.status === 'manifest' ? 'notice-warn' : ''}`}>
          <div className="notice-body" style={{ width: '100%' }}>
            <div className="notice-title">
              <span className={`badge ${f.status === 'imported' ? 'badge-origin' : 'badge-off'}`}>
                {f.status}
              </span>{' '}
              {f.name}
            </div>
            <p>{f.message}</p>

            {f.report?.manifest && (
              <div style={{ marginTop: 'var(--sp-3)' }}>
                <div className="stat-label" style={{ marginBottom: 'var(--sp-2)' }}>
                  what to do
                </div>
                <ol className="manifest-steps">
                  <li>
                    Open the manifest and download each <code>export_url</code> in it
                    {f.report.manifest.singleUseUrls && (
                      <strong> — each link works only once, so save the file when it downloads</strong>
                    )}
                    .
                  </li>
                  <li>
                    You only need{' '}
                    <code>{f.report.manifest.conversationsFile ?? 'the conversations archive'}</code>
                    {' '}— the others are metadata, design chats and frames.
                  </li>
                  <li>Unzip it (double-click on macOS) to get the conversations JSON.</li>
                  <li>Upload that file here.</li>
                </ol>
                <div className="stat-label" style={{ margin: 'var(--sp-3) 0 var(--sp-1)' }}>
                  files listed in this manifest
                </div>
                <table className="data">
                  <tbody>
                    {f.report.manifest.files.map((mf) => (
                      <tr key={mf.filename}>
                        <td>
                          <span className={`badge ${mf.category === 'conversations' ? 'badge-origin' : 'badge-off'}`}>
                            {mf.category}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{mf.filename}</td>
                        <td className="num" style={{ color: 'var(--muted-deep)', fontSize: 11 }}>
                          {mf.category === 'conversations' ? 'this one' : 'not needed'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {f.report && !f.report.manifest && (
              <>
                <dl className="kv" style={{ marginTop: 'var(--sp-2)' }}>
                  <dt>shape</dt><dd>{f.report.shape}</dd>
                  <dt>top-level keys</dt><dd>{f.report.topLevelKeys.join(', ') || '(none)'}</dd>
                  {f.report.itemCount !== null && (
                    <><dt>items</dt><dd>{f.report.itemCount}</dd></>
                  )}
                </dl>
                {f.report.sample && (
                  <>
                    <div className="stat-label" style={{ margin: 'var(--sp-3) 0 var(--sp-1)' }}>
                      first item — copy this into chat so the parser can be written
                    </div>
                    <pre className="sample">{f.report.sample}</pre>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
