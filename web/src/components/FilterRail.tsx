'use client';

import type { Filters, Source, Status, Summary, Tier } from '@/lib/types';
import { TIER_MEANING } from './ui';
import { cx } from '@/lib/format';

function toggle<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title} className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-[12px] font-bold tracking-wide text-muted uppercase">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Option({ checked, onChange, label, count }: { checked: boolean; onChange: () => void; label: React.ReactNode; count?: number }) {
  return (
    <label className={cx('flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-[14px] hover:bg-raised lg:py-1', checked && 'bg-accent/10 font-semibold')}>
      <input type="checkbox" className="size-3.5 accent-accent" checked={checked} onChange={onChange} />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="num text-[13px] text-muted">{count}</span>}
    </label>
  );
}

export function FilterRail({
  filters,
  summary,
  onChange,
  onClear,
}: {
  filters: Filters;
  summary: Summary;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}) {
  const active =
    filters.tiers.length + filters.emailStatuses.length + filters.phoneStatuses.length + filters.industries.length +
    filters.sources.length + (filters.reachableOnly ? 1 : 0) + (filters.mergedOnly ? 1 : 0) + (filters.hasSignals ? 1 : 0) + (filters.ownerKnown ? 1 : 0) + (filters.minScore ? 1 : 0);

  const tierCounts: Record<Tier, number> = { A: summary.tierA, B: summary.tierB, C: summary.tierC };
  const emailCounts: Record<Status, number> = { valid: summary.emailValid, risky: summary.emailRisky, invalid: summary.emailInvalid, missing: summary.emailMissing };
  const phoneCounts: Record<Status, number> = { valid: summary.phoneValid, risky: summary.phoneRisky, invalid: summary.phoneInvalid, missing: summary.phoneMissing };
  const statusNames: Record<Status, string> = { valid: 'Verified', risky: 'Risky', invalid: 'Invalid', missing: 'None' };

  return (
    <aside aria-label="Filters" className="text-ink">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-bold">Filter</h2>
        {active > 0 && (
          <button onClick={onClear} className="text-[13px] font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">
            Clear {active}
          </button>
        )}
      </div>

      <Group title="Fit">
        {(['A', 'B', 'C'] as Tier[]).map((t) => (
          <Option
            key={t}
            checked={filters.tiers.includes(t)}
            onChange={() => onChange({ tiers: toggle(filters.tiers, t) })}
            label={
              <>
                <span className="num font-bold">{t}</span> <span className="text-muted">{TIER_MEANING[t]}</span>
              </>
            }
            count={tierCounts[t]}
          />
        ))}
        <label className="mt-2 block px-1.5 text-[13px] text-muted">
          <span className="flex justify-between">
            Minimum score <span className="num font-semibold text-ink">{filters.minScore || 0}</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minScore}
            onChange={(e) => onChange({ minScore: Number(e.target.value) })}
            className="mt-1 w-full accent-accent"
          />
        </label>
      </Group>

      <Group title="Contact">
        <Option checked={filters.reachableOnly} onChange={() => onChange({ reachableOnly: !filters.reachableOnly })} label="Verified email or valid phone" count={summary.reachable} />
        <p className="px-1.5 pt-2 text-[13px] font-semibold text-muted">Email</p>
        {(['valid', 'risky', 'invalid', 'missing'] as Status[]).map((s) => (
          <Option key={s} checked={filters.emailStatuses.includes(s)} onChange={() => onChange({ emailStatuses: toggle(filters.emailStatuses, s) })} label={statusNames[s]} count={emailCounts[s]} />
        ))}
        <p className="px-1.5 pt-2 text-[13px] font-semibold text-muted">Phone</p>
        {(['valid', 'risky', 'invalid', 'missing'] as Status[]).map((s) => (
          <Option key={s} checked={filters.phoneStatuses.includes(s)} onChange={() => onChange({ phoneStatuses: toggle(filters.phoneStatuses, s) })} label={s === 'risky' ? 'Toll-free' : s === 'valid' ? 'Valid' : statusNames[s]} count={phoneCounts[s]} />
        ))}
      </Group>

      <Group title="Owner & signals">
        <Option checked={filters.ownerKnown} onChange={() => onChange({ ownerKnown: !filters.ownerKnown })} label="Owner identified" count={summary.ownerKnown} />
        <Option checked={filters.hasSignals} onChange={() => onChange({ hasSignals: !filters.hasSignals })} label="Has ownership signal" count={summary.withSignals} />
      </Group>

      {(summary.srcGoogle > 0 || summary.srcOsm > 0) && (
        <Group title="Found in">
          {(
            [
              ['google_places', 'Google', summary.srcGoogle],
              ['osm', 'OpenStreetMap', summary.srcOsm],
              ['csv', 'Your CSV', summary.srcCsv],
            ] as Array<[Source, string, number]>
          )
            .filter(([, , n]) => n > 0)
            .map(([id, label, n]) => (
              <Option key={id} checked={filters.sources.includes(id)} onChange={() => onChange({ sources: toggle(filters.sources, id) })} label={label} count={n} />
            ))}
        </Group>
      )}

      <Group title="Industry">
        <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {summary.industries.map((i) => (
            <Option key={i.industry} checked={filters.industries.includes(i.industry)} onChange={() => onChange({ industries: toggle(filters.industries, i.industry) })} label={i.industry} count={i.count} />
          ))}
        </div>
      </Group>

      <Group title="Records">
        <Option checked={filters.mergedOnly} onChange={() => onChange({ mergedOnly: !filters.mergedOnly })} label="Merged from duplicates" count={summary.mergedRecords} />
      </Group>
    </aside>
  );
}
