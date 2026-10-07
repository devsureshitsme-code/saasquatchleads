'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Search, SlidersHorizontal, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Criteria, Filters, Lead, Outreach, Preset, Summary, Upload } from '@/lib/types';
import { SieveRibbon, type RibbonStep } from './SieveRibbon';
import { ThesisPanel } from './ThesisPanel';
import { FilterRail } from './FilterRail';
import { LeadsTable } from './LeadsTable';
import { Button, Spinner } from './ui';
import { cx } from '@/lib/format';

export const EMPTY_FILTERS: Filters = {
  tiers: [],
  emailStatuses: [],
  phoneStatuses: [],
  industries: [],
  reachableOnly: false,
  mergedOnly: false,
  sources: [],
  hasSignals: false,
  ownerKnown: false,
  minScore: 0,
  q: '',
  sort: 'score',
  order: 'desc',
  page: 1,
  pageSize: 50,
};

export function Workspace({
  upload,
  summary,
  presets,
  aiAvailable,
  onRefresh,
  notify,
}: {
  upload: Upload;
  summary: Summary;
  presets: Preset[];
  aiAvailable: boolean;
  onRefresh: () => Promise<void>;
  notify: (t: { tone: 'ok' | 'error'; title: string; body?: string }) => void;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [data, setData] = useState<{ leads: Lead[]; total: number }>({ leads: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [thesisOpen, setThesisOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await api.leads(upload.id, filters);
      if (id === reqId.current) setData({ leads: res.leads, total: res.total });
    } catch (e) {
      notify({ tone: 'error', title: 'Couldn’t load leads', body: (e as Error).message });
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [upload.id, filters, notify]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounced search box
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search, page: 1 })), 250);
    return () => clearTimeout(t);
  }, [search]);

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p, page: 'page' in p ? p.page! : 1 }));

  function pickStep(step: RibbonStep) {
    const base = { ...EMPTY_FILTERS, sort: filters.sort, order: filters.order };
    if (step === 'merged') setFilters({ ...base, mergedOnly: true });
    else if (step === 'emailVerified') setFilters({ ...base, emailStatuses: ['valid'] });
    else if (step === 'ownerKnown') setFilters({ ...base, ownerKnown: true });
    else if (step === 'tierA') setFilters({ ...base, tiers: ['A'] });
    else setFilters(base);
    setSearch('');
  }

  async function rescore(c: Partial<Criteria>) {
    try {
      await api.rescore(upload.id, c);
      await onRefresh();
      await load();
      notify({ tone: 'ok', title: 'Leads re-ranked', body: 'Scores now reflect the updated thesis.' });
    } catch (e) {
      notify({ tone: 'error', title: 'Couldn’t re-rank', body: (e as Error).message });
      throw e;
    }
  }

  function selectAllMatching() {
    // Select every lead matching current filters (across pages) via the export-sized fetch.
    api.leads(upload.id, { ...filters, page: 1, pageSize: 500 }).then((r) => setSelected(new Set(r.leads.map((l) => l.id))));
  }

  const pages = Math.max(1, Math.ceil(data.total / filters.pageSize));
  const exportHref = api.exportUrl(upload.id, filters, selected.size ? [...selected] : undefined);

  return (
    <>
      <SieveRibbon upload={upload} summary={summary} onPick={pickStep} />

      <div className="border-b border-line">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <p className="text-[14px]">
            Ranked for <span className="font-semibold">{upload.criteria?.label || 'your thesis'}</span>
          </p>
          <Button size="sm" variant={thesisOpen ? 'primary' : 'secondary'} onClick={() => setThesisOpen((v) => !v)} aria-expanded={thesisOpen}>
            <SlidersHorizontal className="size-3.5" aria-hidden />
            Edit thesis
          </Button>
          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <label className="relative flex-1 sm:w-72 sm:flex-none">
              <span className="sr-only">Search leads</span>
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, owner, city"
                className="h-9 w-full rounded-lg border border-line-strong pr-2 pl-8 text-[14px] sm:h-8"
              />
            </label>
            <Button size="sm" className="h-9 sm:h-8 lg:hidden" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}>
              Filter
            </Button>
          </div>
        </div>
      </div>

      {thesisOpen && upload.criteria && <ThesisPanel criteria={upload.criteria} presets={presets} onApply={rescore} onClose={() => setThesisOpen(false)} />}

      <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 pb-28 sm:px-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        <div className={cx(filtersOpen ? 'block' : 'hidden', 'lg:block')}>
          <div className="card p-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
            <FilterRail
              filters={filters}
              summary={summary}
              onChange={patch}
              onClear={() => {
                setFilters({ ...EMPTY_FILTERS, sort: filters.sort, order: filters.order });
                setSearch('');
              }}
            />
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
            <p>
              <span className="num font-bold">{data.total.toLocaleString('en-US')}</span> <span className="text-muted">of {summary.total} businesses</span>
            </p>
            {loading && <Spinner className="text-muted" />}
            {data.total > 0 && selected.size < data.total && (
              <button onClick={selectAllMatching} className="font-semibold text-ink-soft underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                Select all {data.total} shown
              </button>
            )}
            <a href={exportHref} className="inline-flex items-center gap-1.5 font-semibold text-accent-soft hover:text-ink sm:ml-auto">
              <Download className="size-4" aria-hidden />
              Export {selected.size ? `${selected.size} selected` : 'this view'} as CSV
            </a>
          </div>

          {data.total === 0 && !loading ? (
            <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
              <p className="font-semibold">No businesses match these filters.</p>
              <button onClick={() => pickStep('all')} className="mt-2 text-[14px] font-semibold text-accent-soft underline underline-offset-4">
                Clear filters
              </button>
            </div>
          ) : (
            <LeadsTable
              leads={data.leads}
              sort={filters.sort}
              order={filters.order}
              onSort={(sort, order) => patch({ sort, order })}
              selected={selected}
              onToggle={(id) =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                })
              }
              onTogglePage={(ids, on) =>
                setSelected((s) => {
                  const n = new Set(s);
                  ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
                  return n;
                })
              }
              expanded={expanded}
              onExpand={setExpanded}
              loading={loading}
              aiAvailable={aiAvailable}
              onOutreach={(id: string, o: Outreach) => setData((d) => ({ ...d, leads: d.leads.map((l) => (l.id === id ? { ...l, outreach: o } : l)) }))}
            />
          )}

          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-between text-[14px]" aria-label="Pagination">
              <Button size="sm" disabled={filters.page <= 1} onClick={() => patch({ page: filters.page - 1 })}>
                Previous
              </Button>
              <span className="num text-muted">
                Page {filters.page} of {pages}
              </span>
              <Button size="sm" disabled={filters.page >= pages} onClick={() => patch({ page: filters.page + 1 })}>
                Next
              </Button>
            </nav>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-surface/85 pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_40px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <p className="text-[15px]">
              <span className="num rounded-md bg-highlight px-1.5 py-0.5 font-bold text-paper">{selected.size}</span> selected
            </p>
            <button onClick={() => setSelected(new Set())} className="inline-flex items-center gap-1 text-[14px] text-muted hover:text-ink">
              <X className="size-3.5" aria-hidden /> Clear
            </button>
            <a
              href={exportHref}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-linear-to-r from-accent to-accent-2 px-4 text-[13px] font-semibold whitespace-nowrap text-white shadow-[0_10px_28px_-12px_var(--accent)] hover:brightness-115 sm:ml-auto sm:h-8 sm:w-auto"
            >
              <Download className="size-3.5" aria-hidden />
              Export {selected.size} as CSV
            </a>
          </div>
        </div>
      )}
    </>
  );
}
