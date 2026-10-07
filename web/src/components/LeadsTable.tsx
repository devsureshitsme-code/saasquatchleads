'use client';

import { Fragment, useMemo } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Layers, Sparkles, Star } from 'lucide-react';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type SortingState } from '@tanstack/react-table';
import type { Lead, Outreach } from '@/lib/types';
import { Checkbox, ScoreMark, StatusDot } from './ui';
import { LeadDetail } from './LeadDetail';
import { count, cx, money, yearsSince } from '@/lib/format';

const col = createColumnHelper<Lead>();

// Narrow screens keep score + business; the rest is one tap away in the expanded row.
const HIDE_BELOW: Record<string, string> = {
  ownerName: 'hidden md:table-cell',
  contact: 'hidden sm:table-cell',
  revenue: 'hidden xl:table-cell',
  yearFounded: 'hidden xl:table-cell',
};

export function LeadsTable({
  leads,
  sort,
  order,
  onSort,
  selected,
  onToggle,
  onTogglePage,
  expanded,
  onExpand,
  loading,
  aiAvailable,
  aiRunning,
  onOutreach,
}: {
  leads: Lead[];
  sort: string;
  order: 'asc' | 'desc';
  onSort: (sort: string, order: 'asc' | 'desc') => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onTogglePage: (ids: string[], on: boolean) => void;
  expanded: string | null;
  onExpand: (id: string | null) => void;
  loading: boolean;
  aiAvailable: boolean;
  aiRunning: boolean;
  onOutreach: (id: string, o: Outreach) => void;
}) {
  const pageIds = leads.map((l) => l.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));

  const columns = useMemo(
    () => [
      col.display({
        id: 'select',
        header: () => <Checkbox label="Select all on this page" checked={allOnPage} indeterminate={someOnPage} onChange={(v) => onTogglePage(pageIds, v)} />,
        cell: ({ row }) => <Checkbox label={`Select ${row.original.companyName}`} checked={selected.has(row.original.id)} onChange={() => onToggle(row.original.id)} />,
      }),
      col.accessor('score', {
        header: 'Score',
        cell: ({ row }) => <ScoreMark score={row.original.score} tier={row.original.tier} />,
      }),
      col.accessor('companyName', {
        header: 'Business',
        cell: ({ row: { original: l } }) => (
          <div className="min-w-[150px] sm:min-w-[220px]">
            <p className="font-bold text-ink">{l.companyName}</p>
            <p className="text-[13px] text-muted">
              {[l.industry, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(' in ')}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {l.rating != null && (
                <span className="inline-flex items-center gap-0.5 text-[12px] text-ink-soft" title={`${l.reviewCount ?? 0} reviews`}>
                  <Star className="size-3 fill-current text-amber" aria-hidden />
                  {l.rating} <span className="text-muted">({l.reviewCount ?? 0})</span>
                </span>
              )}
              {l.mergedCount > 1 && (
                <span className="inline-flex items-center gap-1 rounded bg-raised px-1.5 py-0.5 text-[12px] font-semibold text-ink-soft ring-1 ring-line-strong ring-inset">
                  <Layers className="size-3" aria-hidden />
                  {l.sources?.length > 1 ? `Found in ${l.sources.length} sources` : `${l.mergedCount} rows merged`}
                </span>
              )}
              {l.signals?.length > 0 && (
                <span className="rounded bg-highlight-soft px-1.5 py-0.5 text-[12px] font-semibold text-highlight ring-1 ring-highlight/30 ring-inset" title={l.signals.join(', ')}>
                  {l.signals[0]}
                  {l.signals.length > 1 ? ` +${l.signals.length - 1}` : ''}
                </span>
              )}
            </div>
          </div>
        ),
      }),
      col.accessor('ownerName', {
        header: 'Owner',
        enableSorting: false,
        cell: ({ row: { original: l } }) =>
          l.ownerName ? (
            <div className="min-w-[140px]">
              <p className="font-semibold">{l.ownerName}</p>
              <p className="inline-flex items-center gap-1 text-[13px] text-muted">
                {l.ownerTitle}
                {l.enrichment?.provenance?.ownerName === 'ai' && <Sparkles className="size-3 text-amber" aria-label="found by AI" />}
              </p>
            </div>
          ) : (
            <span className="text-[13px] text-muted">Unknown</span>
          ),
      }),
      col.display({
        id: 'contact',
        header: 'Email / phone',
        cell: ({ row: { original: l } }) => (
          <div className="flex min-w-[110px] flex-col gap-0.5">
            <StatusDot status={l.emailStatus} title={l.emailReason || undefined} />
            <StatusDot kind="phone" status={l.phoneStatus} title={l.phoneReason || undefined} />
          </div>
        ),
      }),
      col.accessor('revenue', {
        header: 'Revenue',
        cell: ({ row: { original: l } }) => (
          <div className="whitespace-nowrap">
            <p className="font-semibold">{l.revenueEstimated && l.revenue ? '~' : ''}{money(l.revenue)}</p>
            <p className="text-[13px] text-muted">{l.employees ? `${count(l.employees)} staff` : '—'}</p>
          </div>
        ),
      }),
      col.accessor('yearFounded', {
        header: 'Age',
        cell: ({ row: { original: l } }) => (
          <div className="num whitespace-nowrap">
            <p className="font-semibold">{l.yearFounded ? `${yearsSince(l.yearFounded)} yrs` : '—'}</p>
            <p className="text-[13px] text-muted">{l.yearFounded ? `since ${l.yearFounded}` : ''}</p>
          </div>
        ),
      }),
      col.display({
        id: 'expand',
        header: () => <span className="sr-only">Details</span>,
        cell: ({ row }) =>
          expanded === row.original.id ? <ChevronDown className="size-4 text-ink" aria-hidden /> : <ChevronRight className="size-4 text-muted" aria-hidden />,
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, expanded, allOnPage, someOnPage, leads],
  );

  const sorting: SortingState = [{ id: sort, desc: order === 'desc' }];
  const table = useReactTable({
    data: leads,
    columns,
    getRowId: (l) => l.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    state: { sorting },
  });

  const sortable = new Set(['score', 'companyName', 'revenue', 'yearFounded']);

  return (
    <div className={cx('card relative overflow-x-auto transition-opacity', loading && 'opacity-60')}>
      <table className="w-full border-collapse text-left text-[14px]">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-line bg-raised/40">
              {hg.headers.map((h) => {
                const isSorted = sort === h.column.id;
                const canSort = sortable.has(h.column.id);
                return (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={isSorted ? (order === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cx('px-3 py-2.5 text-[12px] font-bold tracking-wide whitespace-nowrap text-muted uppercase first:pl-4', h.column.id === 'select' && 'w-10', HIDE_BELOW[h.column.id])}
                  >
                    {canSort ? (
                      <button
                        className="inline-flex items-center gap-1 tracking-wide uppercase hover:text-ink"
                        onClick={() => onSort(h.column.id, isSorted && order === 'desc' ? 'asc' : 'desc')}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {isSorted ? order === 'desc' ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" /> : null}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const open = expanded === row.original.id;
            return (
              <Fragment key={row.id}>
                <tr
                  onClick={() => onExpand(open ? null : row.original.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onExpand(open ? null : row.original.id);
                    }
                  }}
                  tabIndex={0}
                  aria-expanded={open}
                  className={cx(
                    'cursor-pointer border-b border-line align-top transition-colors hover:bg-raised/50',
                    selected.has(row.original.id) && 'row-selected',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={cx('px-3 py-3 first:pl-4', HIDE_BELOW[cell.column.id])}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {open && (
                  <tr className="border-b border-line">
                    <td colSpan={row.getVisibleCells().length} className="p-0">
                      <LeadDetail lead={row.original} aiAvailable={aiAvailable} aiRunning={aiRunning} onOutreach={onOutreach} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
