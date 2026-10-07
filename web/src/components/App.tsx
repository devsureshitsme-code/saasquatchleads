'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Capabilities, Preset, Summary, Upload } from '@/lib/types';
import { StartView } from './StartView';
import { ProcessingView } from './ProcessingView';
import { Workspace } from './Workspace';
import { ToastStack, useToasts } from './Toasts';
import { Spinner } from './ui';

export function App() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const uploadId = params.get('u');

  const [presets, setPresets] = useState<Preset[]>([]);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<Upload[]>([]);
  const [apiDown, setApiDown] = useState<string | null>(null);
  const { toasts, push: notify, dismiss } = useToasts();

  const setUploadId = useCallback(
    (id: string | null) => router.replace(id ? `${pathname}?u=${id}` : pathname, { scroll: false }),
    [router, pathname],
  );

  // Boot: presets, recent uploads, capabilities
  useEffect(() => {
    api
      .presets()
      .then((r) => setPresets(r.presets))
      .catch((e) => setApiDown(e.message));
    api.uploads().then((r) => setRecent(r.uploads)).catch(() => {});
    api.capabilities().then(setCaps).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (!uploadId) return;
    try {
      const r = await api.upload(uploadId);
      setUpload(r.upload);
      setSummary(r.summary);
    } catch (e) {
      notify({ tone: 'error', title: 'Couldn’t open that upload', body: (e as Error).message });
      setUploadId(null);
    }
  }, [uploadId, notify, setUploadId]);

  useEffect(() => {
    setUpload(null);
    setSummary(null);
    refresh();
  }, [uploadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while processing
  useEffect(() => {
    if (!upload || upload.status !== 'processing') return;
    const t = setInterval(refresh, 800);
    return () => clearInterval(t);
  }, [upload, refresh]);

  useEffect(() => {
    if (upload?.status === 'ready') api.uploads().then((r) => setRecent(r.uploads)).catch(() => {});
  }, [upload?.status]);

  const view = !uploadId ? 'upload' : !upload ? 'loading' : upload.status === 'ready' && summary ? 'workspace' : 'processing';

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <button onClick={() => setUploadId(null)} className="flex items-center gap-2" aria-label="SaaSquatchLeads home">
            <Logo />
            <span className="text-[17px] font-extrabold tracking-tight">SaaSquatchLeads</span>
          </button>

          {recent.length > 0 && (
            <label className="flex min-w-0 flex-1 items-center gap-2 text-[14px] sm:flex-none">
              <span className="sr-only">Open a previous upload</span>
              <select
                value={uploadId || ''}
                onChange={(e) => setUploadId(e.target.value || null)}
                className="h-9 w-full rounded-lg border border-line-strong px-2 text-[14px] sm:h-8 sm:w-auto sm:max-w-[260px]"
              >
                <option value="">New search or upload</option>
                {recent.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fileName} ({new Date(u.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})
                  </option>
                ))}
              </select>
            </label>
          )}

        </div>
      </header>

      {apiDown && (
        <div className="border-b border-brick/30 bg-brick-wash px-4 py-3 text-center text-[14px] text-brick sm:px-6">
          {apiDown} Start it with <code className="font-semibold">npm run dev:server</code>.
        </div>
      )}

      <main>
        {view === 'upload' && (
          <StartView
            presets={presets}
            caps={caps}
            onStarted={(u) => {
              setUpload(u);
              setUploadId(u.id);
            }}
            onError={(msg) => notify({ tone: 'error', title: 'Couldn’t start', body: msg })}
          />
        )}
        {view === 'loading' && (
          <div className="flex justify-center py-24 text-muted">
            <Spinner />
          </div>
        )}
        {view === 'processing' && upload && <ProcessingView upload={upload} onReset={() => setUploadId(null)} />}
        {view === 'workspace' && upload && summary && (
          <Workspace
            key={upload.id}
            upload={upload}
            summary={summary}
            presets={presets}
            aiAvailable={!!caps?.ai.available}
            onRefresh={refresh}
            notify={notify}
          />
        )}
      </main>

      <ToastStack toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

/** A sieve: three shrinking bars, the same story as the ribbon. */
function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <rect x="1" y="3" width="20" height="4" rx="2" fill="var(--accent-soft)" />
      <rect x="4" y="9" width="14" height="4" rx="2" fill="var(--pine)" />
      <rect x="7" y="15" width="8" height="4" rx="2" fill="var(--highlight)" />
    </svg>
  );
}
