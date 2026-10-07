'use client';

import { Check } from 'lucide-react';
import type { Upload } from '@/lib/types';
import { Button, Spinner } from './ui';
import { cx } from '@/lib/format';

type Stage = { id: Upload['stage']; label: string; unit?: string };

function stagesFor(u: Upload): Stage[] {
  const q = u.query || {};
  const crawl = u.source === 'search' ? q.crawl !== false : !!q.crawl;
  return [
    u.source === 'search' ? { id: 'discovering', label: 'Searching for businesses' } : { id: 'parsing', label: 'Reading columns' },
    { id: 'deduping', label: 'Merging duplicates' },
    ...(crawl ? [{ id: 'crawling' as const, label: 'Reading company websites', unit: 'websites read' }] : []),
    { id: 'validating', label: 'Checking emails, phones and websites', unit: 'businesses checked' },
    { id: 'scoring', label: 'Scoring acquisition fit' },
    { id: 'saving', label: 'Saving' },
  ];
}

export function ProcessingView({ upload, onReset }: { upload: Upload; onReset: () => void }) {
  const STAGES = stagesFor(upload);
  const current = STAGES.findIndex((s) => s.id === upload.stage);
  const failed = upload.status === 'failed';
  const pct = upload.progressTotal ? Math.round((upload.progressDone / upload.progressTotal) * 100) : 0;

  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="card rise p-5 sm:p-8">
      <p className="text-sm font-semibold text-muted">{upload.fileName}</p>
      <h1 className="gradient-text mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{failed ? (upload.source === 'search' ? 'This search didn’t return results' : 'This file couldn’t be processed') : upload.source === 'search' ? 'Finding and sifting companies' : 'Sifting your list'}</h1>

      {failed ? (
        <div className="mt-6 rounded-lg border border-brick/30 bg-brick-wash p-4 text-[15px] text-brick">
          <p className="font-semibold">{upload.error}</p>
          <p className="mt-1 text-ink-soft">
            {upload.source === 'search'
              ? 'Try a broader industry (“HVAC” rather than “ductless mini-split installers”) or a nearby larger city.'
              : 'Check that the first row holds column headers and that one of them names the company.'}
          </p>
          <Button className="mt-4" onClick={onReset}>
            Start over
          </Button>
        </div>
      ) : (
        <ol className="mt-8 space-y-4" aria-live="polite">
          {STAGES.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s.id} className="flex items-start gap-3">
                <span
                  className={cx(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                    done && 'bg-pine text-paper',
                    active && 'text-accent-soft',
                    !done && !active && 'border border-line-strong',
                  )}
                >
                  {done ? <Check className="size-3" strokeWidth={3} aria-hidden /> : active ? <Spinner className="size-4" /> : null}
                </span>
                <div className="flex-1">
                  <p className={cx('font-semibold', !done && !active && 'text-muted')}>
                    {s.label}
                    {s.id === 'deduping' && done && upload.duplicateCount > 0 && (
                      <span className="num ml-2 font-normal text-muted">
                        {upload.rowCount} {upload.source === 'search' ? 'listings' : 'rows'} became {upload.uniqueCount} businesses
                      </span>
                    )}
                  </p>
                  {s.unit && active && upload.progressTotal > 0 && (
                    <div className="mt-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-linear-to-r from-accent to-accent-2 transition-[width] duration-300" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="num mt-1.5 text-[13px] text-muted">
                        {upload.progressDone} of {upload.progressTotal} {s.unit}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      </div>
    </div>
  );
}
