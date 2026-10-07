'use client';

import type { Summary, Upload } from '@/lib/types';
import { pct } from '@/lib/format';

/**
 * The signature element: the list physically narrowing as it passes through the sieve.
 * Each bar's width is proportional to the original row count.
 */
export type RibbonStep = 'all' | 'merged' | 'emailVerified' | 'ownerKnown' | 'tierA';

export function SieveRibbon({ upload, summary, onPick }: { upload: Upload; summary: Summary; onPick: (step: RibbonStep) => void }) {
  const base = upload.rowCount || 1;
  const disc = upload.stats?.discovery || {};
  const found = Object.entries(disc)
    .filter(([, v]) => v.count)
    .map(([k, v]) => `${v.count} from ${k === 'google_places' ? 'Google' : 'OpenStreetMap'}`)
    .join(', ');
  const isSearch = upload.source === 'search';
  const steps: Array<{ key: RibbonStep; value: number; label: string; note: string }> = [
    isSearch
      ? { key: 'all', value: upload.rowCount, label: 'listings found', note: found || 'Search results' }
      : { key: 'all', value: upload.rowCount, label: 'rows uploaded', note: `${upload.columnMapping?.mapping ? Object.keys(upload.columnMapping.mapping).length : 0} columns recognized` },
    { key: 'merged', value: summary.total, label: 'unique businesses', note: `${upload.duplicateCount} duplicates merged into ${summary.mergedRecords}` },
    isSearch
      ? { key: 'ownerKnown', value: summary.ownerKnown, label: 'with the owner named', note: `${summary.websitesCrawled} websites read${summary.aiEnriched ? `, ${summary.aiEnriched} by AI` : ''}` }
      : { key: 'emailVerified', value: summary.emailValid, label: 'with a verified email', note: `${summary.emailInvalid} bad and ${summary.emailMissing} missing emails set aside` },
    { key: 'tierA', value: summary.tierA, label: 'to call first', note: 'Scored 75 or higher on your thesis' },
  ];

  return (
    <section aria-label="How the list narrowed" className="border-b border-line">
      <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-3 px-4 py-5 sm:gap-4 sm:px-6 lg:grid-cols-4">
        {steps.map((s, i) => (
          <button
            key={s.key}
            onClick={() => onPick(s.key)}
            className="card group p-3.5 text-left transition-colors hover:border-line-strong sm:p-5"
            title={i === 0 ? 'Show everything' : `Filter to ${s.label}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="num text-[28px] leading-none font-black tracking-tight text-ink sm:text-[34px]">{s.value.toLocaleString('en-US')}</span>
              <span className="text-[13px] font-semibold text-ink-soft group-hover:text-ink sm:text-sm">{s.label}</span>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-raised">
              <div
                className="sieve-bar h-1.5 rounded-full"
                style={{
                  width: `${Math.max(pct(s.value, base), 2)}%`,
                  background: i === 3 ? 'var(--highlight)' : i === 2 ? 'var(--pine)' : 'linear-gradient(90deg, var(--accent), var(--accent-2))',
                  animationDelay: `${i * 120}ms`,
                  boxShadow: i === 3 ? '0 0 14px -2px var(--highlight)' : undefined,
                }}
              />
            </div>
            <p className="mt-2 text-[12px] text-muted sm:text-[13px]">{s.note}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
