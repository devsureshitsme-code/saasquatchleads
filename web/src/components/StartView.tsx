'use client';

import { useRef, useState } from 'react';
import { FileUp, Search, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import type { Capabilities, Criteria, Preset, SearchQuery, Upload } from '@/lib/types';
import { Button, Spinner } from './ui';
import { cx } from '@/lib/format';

const INDUSTRY_SUGGESTIONS = [
  'HVAC', 'Plumbing', 'Electrical', 'Roofing', 'Landscaping', 'Pest control', 'Commercial cleaning', 'Accounting',
  'IT services', 'Insurance agency', 'Auto repair', 'Dental practice', 'Veterinary clinic', 'Manufacturing', 'Healthcare',
  'Financial services', 'Retail', 'Software development',
];

type Tab = 'find' | 'csv';

export function StartView({
  presets,
  caps,
  onStarted,
  onError,
}: {
  presets: Preset[];
  caps: Capabilities | null;
  onStarted: (u: Upload) => void;
  onError: (msg: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('find');

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      <h1 className="gradient-text rise max-w-[20ch] text-[34px] leading-[1.05] font-extrabold tracking-tight sm:text-5xl lg:text-6xl">Find the owners worth calling this week.</h1>
      <p className="rise mt-4 max-w-[60ch] text-base text-muted sm:text-[17px]">
        Search any industry in any city, or bring your own list. SaaSquatchLeads reads each company’s website, merges duplicates, checks every contact, and ranks
        each business by how well it fits your acquisition thesis.
      </p>

      <div role="tablist" aria-label="How to start" className="mt-8 flex w-full rounded-xl border border-line bg-surface p-1 sm:inline-flex sm:w-auto">
        {(
          [
            ['find', 'Find companies'],
            ['csv', 'Upload a CSV'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx('h-10 flex-1 rounded-lg px-4 text-sm font-semibold transition-colors sm:h-9 sm:flex-none', tab === id ? 'bg-linear-to-r from-accent to-accent-2 text-white shadow-[0_8px_24px_-12px_var(--accent)]' : 'text-ink-soft hover:bg-raised hover:text-ink')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'find' ? (
          <FinderForm presets={presets} caps={caps} onStarted={onStarted} onError={onError} />
        ) : (
          <CsvForm presets={presets} caps={caps} onStarted={onStarted} onError={onError} />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Find companies

function FinderForm({ presets, caps, onStarted, onError }: { presets: Preset[]; caps: Capabilities | null; onStarted: (u: Upload) => void; onError: (m: string) => void }) {
  const aiOn = !!caps?.ai.available;
  const sources = caps?.sources || [];
  const [industry, setIndustry] = useState('');
  const [product, setProduct] = useState('');
  const [location, setLocation] = useState('');
  const [limit, setLimit] = useState(60);
  const [picked, setPicked] = useState<string[] | null>(null); // null = all available
  const [crawl, setCrawl] = useState(true);
  const [useAi, setUseAi] = useState(true);
  const [preset, setPreset] = useState('home_services');
  const [criteria, setCriteria] = useState<Partial<Criteria> | null>(null);
  const [describe, setDescribe] = useState('');
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [busy, setBusy] = useState<'search' | 'parse' | null>(null);

  const activeSources = (picked ?? sources.filter((s) => s.available).map((s) => s.id)).filter((id) => sources.find((s) => s.id === id)?.available);

  async function interpret() {
    if (describe.trim().length < 5) return;
    setBusy('parse');
    try {
      const r = await api.parseSearch(describe.trim());
      setIndustry(r.industry);
      setProduct(r.product || '');
      if (r.location) setLocation(r.location);
      setPreset(r.preset);
      const base = presets.find((p) => p.id === r.preset);
      const c: Partial<Criteria> = { preset: r.preset };
      if (r.revenue_min_millions != null) c.revenueMin = r.revenue_min_millions * 1e6;
      if (r.revenue_max_millions != null) c.revenueMax = r.revenue_max_millions * 1e6;
      if (r.employees_min != null) c.employeesMin = r.employees_min;
      if (r.employees_max != null) c.employeesMax = r.employees_max;
      if (r.min_years != null) c.minYears = r.min_years;
      if (r.exclude.length) c.excludedIndustries = [...(base?.excludedIndustries || []), ...r.exclude];
      setCriteria(Object.keys(c).length > 1 ? c : null);
      setInterpretation(r.explanation);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!industry.trim() || !location.trim()) return onError('Enter an industry and a location to search.');
    if (!activeSources.length) return onError('Pick at least one source to search.');
    setBusy('search');
    try {
      const q: SearchQuery = {
        industry: industry.trim(),
        product: product.trim() || undefined,
        location: location.trim(),
        limit,
        sources: activeSources as SearchQuery['sources'],
        crawl,
        ai: aiOn && useAi,
        criteria: criteria && criteria.preset === preset ? criteria : { preset },
      };
      const { upload } = await api.search(q);
      onStarted(upload);
    } catch (err) {
      onError((err as Error).message);
      setBusy(null);
    }
  }

  const input = 'mt-1.5 block h-11 w-full rounded-lg border border-line-strong px-3 text-[15px]';

  return (
    <form onSubmit={submit} className="card rise p-4 sm:p-7">
      {aiOn && (
        <div className="mb-6 rounded-xl border border-accent/25 bg-accent/[0.07] p-4">
          <label htmlFor="describe" className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-amber" aria-hidden />
            Describe what you’re looking for
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="describe"
              value={describe}
              onChange={(e) => setDescribe(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  interpret();
                }
              }}
              placeholder="Family-owned HVAC companies around Austin doing $2–8M, at least 15 years old"
              className="h-11 w-full min-w-0 shrink-0 rounded-lg border border-line-strong px-3 text-[15px] sm:w-auto sm:flex-1 sm:shrink"
            />
            <Button type="button" onClick={interpret} disabled={busy !== null || describe.trim().length < 5}>
              {busy === 'parse' ? <Spinner /> : <Sparkles className="size-4" aria-hidden />}
              Fill in the search
            </Button>
          </div>
          {interpretation && <p className="mt-2 text-[14px] text-ink-soft">{interpretation} Check the fields below, then search.</p>}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1.2fr]">
        <label className="text-sm font-semibold">
          Industry
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} list="industries" placeholder="HVAC" required className={input} />
          <datalist id="industries">
            {INDUSTRY_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="text-sm font-semibold">
          Product or service <span className="font-normal text-muted">(optional)</span>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Commercial" className={input} />
        </label>
        <label className="text-sm font-semibold">
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Austin, TX" required className={input} />
        </label>
      </div>

      <div className="mt-6 grid gap-6 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-3">
        <fieldset>
          <legend className="text-sm font-semibold">Search in</legend>
          <div className="mt-2 space-y-1.5">
            {sources.map((s) => (
              <label key={s.id} className={cx('flex items-start gap-2 text-[14px]', !s.available && 'text-muted')}>
                <input
                  type="checkbox"
                  className="mt-1 size-3.5 accent-accent"
                  disabled={!s.available}
                  checked={s.available && activeSources.includes(s.id)}
                  onChange={() => setPicked(activeSources.includes(s.id) ? activeSources.filter((x) => x !== s.id) : [...activeSources, s.id])}
                />
                <span>
                  {s.label}
                  <span className="block text-[13px] text-muted">
                    {s.id === 'google_places'
                      ? s.available
                        ? 'Phones, websites, ratings and review counts'
                        : 'Add GOOGLE_PLACES_API_KEY on the server to enable'
                      : 'Free open map data; thinner on phones and websites'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <label className="mt-3 block text-[13px] font-semibold">
            Up to
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="ml-2 h-8 rounded-md border border-line-strong bg-surface px-2 text-[14px]">
              {[20, 40, 60].map((n) => (
                <option key={n} value={n}>
                  {n} per source
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold">Enrich each company</legend>
          <EnrichToggles crawl={crawl} setCrawl={setCrawl} useAi={useAi} setUseAi={setUseAi} aiOn={aiOn} aiLabel={caps?.ai.label} />
        </fieldset>

        <div className="flex flex-col justify-between gap-4 sm:col-span-2 lg:col-span-1">
          <label className="text-sm font-semibold">
            Rank against
            <select value={preset} onChange={(e) => setPreset(e.target.value)} className="mt-1.5 block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm">
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {criteria && criteria.preset === preset && <span className="mt-1 block text-[13px] font-normal text-muted">With the criteria from your description</span>}
          </label>
          <Button type="submit" variant="primary" disabled={busy !== null} className="h-11">
            {busy === 'search' ? <Spinner /> : <Search className="size-4" aria-hidden />}
            Find companies
          </Button>
        </div>
      </div>
    </form>
  );
}

function EnrichToggles({
  crawl,
  setCrawl,
  useAi,
  setUseAi,
  aiOn,
  aiLabel,
}: {
  crawl: boolean;
  setCrawl: (v: boolean) => void;
  useAi: boolean;
  setUseAi: (v: boolean) => void;
  aiOn: boolean;
  aiLabel?: string | null;
}) {
  return (
    <div className="mt-2 space-y-2.5">
      <label className="flex items-start gap-2 text-[14px]">
        <input type="checkbox" className="mt-1 size-3.5 accent-accent" checked={crawl} onChange={(e) => setCrawl(e.target.checked)} />
        <span>
          Read each company’s website
          <span className="block text-[13px] text-muted">Finds owner names, emails, founding year and team size. Respects robots.txt.</span>
        </span>
      </label>
      <label className={cx('flex items-start gap-2 text-[14px]', !aiOn && 'text-muted')}>
        <input type="checkbox" className="mt-1 size-3.5 accent-accent" disabled={!aiOn || !crawl} checked={aiOn && crawl && useAi} onChange={(e) => setUseAi(e.target.checked)} />
        <span>
          Summarize with AI
          <span className="block text-[13px] text-muted">
            {aiOn ? `${aiLabel || 'AI'} reads the site for ownership and succession signals` : 'Add AI_PROVIDER and AI_API_KEY on the server to enable (Groq and Gemini are free)'}
          </span>
        </span>
      </label>
    </div>
  );
}

// ------------------------------------------------------------------ CSV

function CsvForm({ presets, caps, onStarted, onError }: { presets: Preset[]; caps: Capabilities | null; onStarted: (u: Upload) => void; onError: (m: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState('home_services');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<'file' | 'sample' | null>(null);
  const [crawl, setCrawl] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const aiOn = !!caps?.ai.available;

  async function start(kind: 'file' | 'sample', file?: File) {
    setBusy(kind);
    const enrich = { crawl, ai: aiOn && crawl && useAi };
    try {
      const { upload } = kind === 'file' && file ? await api.uploadFile(file, preset, enrich) : await api.uploadSample(preset, enrich);
      onStarted(upload);
    } catch (e) {
      onError((e as Error).message);
      setBusy(null);
    }
  }

  function onFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) return onError('That file isn’t a CSV. Export your leads as .csv and try again.');
    start('file', file);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(e.dataTransfer.files);
      }}
      className={cx('rise rounded-2xl border-2 border-dashed bg-surface p-4 transition-colors sm:p-7', dragging ? 'border-accent bg-accent/10' : 'border-line-strong')}
    >
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="text-sm font-semibold">Your lead export</p>
          <p className="mt-1 text-[14px] text-muted">
            A SaaSquatch, Apollo or hand-made CSV. Headers like “Company Name”, “Website”, “Phone”, “Owner” and “Revenue” are detected automatically.
          </p>
          <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={!!busy} className="mt-4">
            {busy === 'file' ? <Spinner /> : <FileUp className="size-4" aria-hidden />}
            Upload CSV
          </Button>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFiles(e.target.files)} />
        </div>
        <fieldset>
          <legend className="text-sm font-semibold">Enrich each company</legend>
          <EnrichToggles crawl={crawl} setCrawl={setCrawl} useAi={useAi} setUseAi={setUseAi} aiOn={aiOn} aiLabel={caps?.ai.label} />
        </fieldset>
        <label className="text-sm font-semibold">
          Rank against
          <select value={preset} onChange={(e) => setPreset(e.target.value)} className="mt-1.5 block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm">
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-5">
        <Button variant="secondary" size="sm" onClick={() => start('sample')} disabled={!!busy}>
          {busy === 'sample' && <Spinner />}
          Try the sample list
        </Button>
        <span className="text-sm text-muted">205 fictional businesses, with duplicates and bad contacts left in.</span>
        <a href={api.sampleUrl()} className="text-sm font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
          Download it
        </a>
      </div>
    </div>
  );
}
