'use client';

import { useEffect, useState } from 'react';
import type { Criteria, Preset } from '@/lib/types';
import { Button, Spinner } from './ui';

const toM = (n: number) => String(+(n / 1e6).toFixed(2));

/** Edit the acquisition thesis and re-rank instantly (scoring needs no network calls). */
export function ThesisPanel({
  criteria,
  presets,
  onApply,
  onClose,
}: {
  criteria: Criteria;
  presets: Preset[];
  onApply: (c: Partial<Criteria>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState(() => fromCriteria(criteria));
  const [busy, setBusy] = useState(false);

  useEffect(() => setForm(fromCriteria(criteria)), [criteria]);

  function loadPreset(id: string) {
    const p = presets.find((x) => x.id === id);
    if (p) setForm(fromCriteria({ ...p, preset: p.id }));
  }

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onApply({
        preset: form.preset,
        revenueMin: Number(form.revenueMin) * 1e6,
        revenueMax: Number(form.revenueMax) * 1e6,
        employeesMin: Number(form.employeesMin),
        employeesMax: Number(form.employeesMax),
        minYears: Number(form.minYears),
        targetIndustries: splitList(form.targetIndustries),
        excludedIndustries: splitList(form.excludedIndustries),
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const field = 'mt-1 block h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-sm num';
  const compact = 'block h-9 min-w-0 rounded-md border border-line-strong bg-surface px-2.5 text-sm num';
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={apply} className="border-b border-line bg-surface/70">
      <div className="mx-auto grid max-w-[1400px] gap-5 px-4 py-5 sm:px-6 xl:grid-cols-[200px_minmax(0,1.3fr)_minmax(0,1fr)_auto]">
        <label className="text-[13px] font-semibold">
          Start from
          <select value={form.preset} onChange={(e) => loadPreset(e.target.value)} className={field}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Range label="Revenue, $M" min={form.revenueMin} max={form.revenueMax} onMin={set('revenueMin')} onMax={set('revenueMax')} step="0.1" field={compact} />
          <Range label="Employees" min={form.employeesMin} max={form.employeesMax} onMin={set('employeesMin')} onMax={set('employeesMax')} field={compact} />
          <label className="text-[13px] font-semibold">
            Years in business
            <span className="mt-1 flex items-center gap-1.5">
              <input type="number" min="0" value={form.minYears} onChange={set('minYears')} className={`${compact} w-20`} aria-label="Minimum years in business" />
              <span className="font-normal whitespace-nowrap text-muted">or more</span>
            </span>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[13px] font-semibold">
            Target industries
            <input value={form.targetIndustries} onChange={set('targetIndustries')} placeholder="Any industry" className={field.replace('num', '')} />
          </label>
          <label className="text-[13px] font-semibold">
            Exclude
            <input value={form.excludedIndustries} onChange={set('excludedIndustries')} className={field.replace('num', '')} />
          </label>
          <p className="text-[12px] text-muted sm:col-span-2">Comma-separated keywords, matched against each lead’s industry.</p>
        </div>

        <div className="flex items-end justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy && <Spinner />}
            Re-rank leads
          </Button>
        </div>
      </div>
    </form>
  );
}

function Range({
  label,
  min,
  max,
  onMin,
  onMax,
  step,
  field,
}: {
  label: string;
  min: string;
  max: string;
  onMin: React.ChangeEventHandler<HTMLInputElement>;
  onMax: React.ChangeEventHandler<HTMLInputElement>;
  step?: string;
  field: string;
}) {
  return (
    <div role="group" aria-label={label} className="text-[13px] font-semibold">
      {label}
      <span className="mt-1 flex items-center gap-1.5">
        <input type="number" min="0" step={step} value={min} onChange={onMin} className={`${field} w-full flex-1`} aria-label={`${label} minimum`} />
        <span className="font-normal text-muted">to</span>
        <input type="number" min="0" step={step} value={max} onChange={onMax} className={`${field} w-full flex-1`} aria-label={`${label} maximum`} />
      </span>
    </div>
  );
}

function fromCriteria(c: Criteria) {
  return {
    preset: c.preset,
    revenueMin: toM(c.revenueMin),
    revenueMax: toM(c.revenueMax),
    employeesMin: String(c.employeesMin),
    employeesMax: String(c.employeesMax),
    minYears: String(c.minYears),
    targetIndustries: (c.targetIndustries || []).join(', '),
    excludedIndustries: (c.excludedIndustries || []).join(', '),
  };
}

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
