'use client';

import { useRef, useState, useTransition } from 'react';
import { embedBatch, importFiles, indexFolder, type FolderResult, type ImportResult } from '../actions';
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
  const [folder, setFolder] = useState<FolderResult | null>(null);
  const folderRef = useRef<HTMLFormElement>(null);

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

  function onFolder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFolder(null);
    const data = new FormData(e.currentTarget);
    startUpload(async () => {
      try {
        const r = await indexFolder(data);
        setFolder(r);
        setPending(r.pendingEmbeddings);
        if (r.pendingEmbeddings > 0) await runEmbedding(r.pendingEmbeddings);
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : String(e2));
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
            accept=".md,.markdown,.txt,.docx,.pdf,.json,.zip,application/json,application/zip,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
          Notes (<code>.md</code>, <code>.txt</code>), Word documents (<code>.docx</code>) and PDFs import directly. Drop in your Claude{' '}
          <code>manifest.json</code> and the conversations archive is downloaded and opened for
          you; if those links need your browser session, download the{' '}
          <code>.zip</code> yourself and drop that in instead — it gets unzipped here either way.
        </p>
      </form>

      <form ref={folderRef} onSubmit={onFolder} className="folder-form">
        <div className="stat-label" style={{ margin: 'var(--sp-4) 0 var(--sp-2)' }}>
          or index a folder on this Mac
        </div>
        <div className="import-row">
          <input
            type="text"
            name="path"
            placeholder="~/Documents/notes"
            aria-label="Folder to index"
            className="folder-input"
            disabled={isUploading || embedding}
          />
          <input
            type="text"
            name="project"
            placeholder="project (optional)"
            aria-label="Project tag for folder"
            className="project-input"
            disabled={isUploading || embedding}
          />
          <button className="btn btn-ghost" type="submit" disabled={isUploading || embedding}>
            index folder
          </button>
        </div>
        <p className="import-hint">
          Reads <code>.md</code>, <code>.txt</code>, <code>.docx</code> and <code>.pdf</code> recursively, skipping dotfiles and{' '}
          <code>node_modules</code>. Confined to your home directory. Re-indexing is safe —
          unchanged files are skipped.
        </p>
      </form>

      {folder && (
        <div className={`notice ${folder.ok ? '' : 'notice-warn'}`} style={{ marginTop: 'var(--sp-3)' }}>
          {!folder.ok && <span className="notice-icon"><AlertIcon /></span>}
          <div className="notice-body" style={{ width: '100%' }}>
            <div className="notice-title">{folder.ok ? 'folder indexed' : 'could not index'}</div>
            <p>{folder.message}</p>
            {folder.hint && <p style={{ marginTop: 4, color: 'var(--muted-deep)' }}>{folder.hint}</p>}
            {folder.summary && (
              <dl className="kv" style={{ marginTop: 'var(--sp-3)' }}>
                <dt>inserted</dt><dd>{folder.summary.sourcesInserted}</dd>
                <dt>updated</dt><dd>{folder.summary.sourcesUpdated}</dd>
                <dt>skipped</dt><dd>{folder.summary.sourcesSkipped} (unchanged)</dd>
                <dt>chunks</dt><dd>{folder.summary.chunksCreated}</dd>
              </dl>
            )}
            {folder.skippedTypes.length > 0 && (
              <p style={{ marginTop: 'var(--sp-2)', color: 'var(--muted-deep)', fontSize: 12 }}>
                not read (no parser yet):{' '}
                {folder.skippedTypes.map((t) => `${t.ext} ×${t.count}`).join(', ')}
              </p>
            )}
          </div>
        </div>
      )}

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
            {f.hint && (
              <p style={{ marginTop: 4, color: 'var(--muted-deep)' }}>{f.hint}</p>
            )}
            {f.savedTo && (
              <p style={{ marginTop: 4, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)' }}>
                saved to {f.savedTo} — the download link is single use, so the file is kept
              </p>
            )}
            {f.archive && f.archive.length > 0 && (
              <>
                <div className="stat-label" style={{ margin: 'var(--sp-3) 0 var(--sp-1)' }}>
                  inside the archive
                </div>
                <table className="data">
                  <tbody>
                    {f.archive.slice(0, 12).map((a) => (
                      <tr key={a.name}>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{a.name}</td>
                        <td className="num" style={{ color: 'var(--muted-deep)', fontSize: 11 }}>
                          {a.bytes >= 1048576
                            ? `${(a.bytes / 1048576).toFixed(1)} MB`
                            : `${Math.max(1, Math.round(a.bytes / 1024))} KB`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {f.report?.manifest && (
              <div style={{ marginTop: 'var(--sp-3)' }}>
                {(() => {
                  const conv = f.report!.manifest!.files.find((x) => x.category === 'conversations');
                  return conv?.url ? (
                    <div className="manifest-cta">
                      <a className="btn" href={conv.url} download={conv.filename}
                         rel="noopener noreferrer">
                        download {conv.filename}
                      </a>
                      <p>
                        Opens with your browser session, which is what the server is missing.
                        Then drop the <code>.zip</code> straight back here — no unzipping needed.
                        {f.report!.manifest!.singleUseUrls && (
                          <strong> This link works only once, so keep the file.</strong>
                        )}
                      </p>
                    </div>
                  ) : (
                    <ol className="manifest-steps">
                      <li>
                        Open the manifest and download the <code>export_url</code> for the
                        conversations archive
                        {f.report!.manifest!.singleUseUrls && (
                          <strong> — it works only once, so keep the file</strong>
                        )}
                        .
                      </li>
                      <li>Drop the <code>.zip</code> back here; it is unzipped automatically.</li>
                    </ol>
                  );
                })()}
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
                        <td className="num" style={{ fontSize: 11 }}>
                          {mf.url && mf.category === 'conversations' ? (
                            <a href={mf.url} download={mf.filename} rel="noopener noreferrer"
                               style={{ color: 'var(--accent)' }}>
                              download
                            </a>
                          ) : (
                            <span style={{ color: 'var(--muted-deep)' }}>not needed</span>
                          )}
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
