'use client';

import { useState } from 'react';
import { Check, Copy, Sparkles, Star } from 'lucide-react';
import { api } from '@/lib/api';
import type { Lead, Outreach } from '@/lib/types';
import { Button, Spinner, StatusDot } from './ui';
import { cx, formatPhone } from '@/lib/format';

const MATCH_LABEL: Record<string, string> = {
  domain: 'same website',
  phone: 'same phone',
  email: 'same email',
  name: 'similar name, same city',
};

export const SOURCE_LABEL: Record<string, string> = {
  google_places: 'Google',
  osm: 'OpenStreetMap',
  csv: 'Your CSV',
};

const PROVENANCE: Record<string, string> = { website: 'from their website', ai: 'read by AI', estimate: 'estimated' };

function Prov({ lead, field }: { lead: Lead; field: string }) {
  const p = lead.enrichment?.provenance?.[field];
  return p ? <span className="ml-1.5 text-[12px] font-normal text-muted">{PROVENANCE[p]}</span> : null;
}

/** Expanded row: who they are, why the score, what the checks found, and an outreach draft. */
export function LeadDetail({ lead, aiAvailable, aiRunning = false, onOutreach }: { lead: Lead; aiAvailable: boolean; aiRunning?: boolean; onOutreach: (id: string, o: Outreach) => void }) {
  const e = lead.enrichment || {};
  const hasProfile = lead.aiSummary || lead.signals?.length || e.services?.length || lead.ownerName;
  const hasNarrative = lead.aiSummary || e.acquisitionNotes || lead.signals?.length > 0;

  // Only sites that were actually read are queued for the AI.
  const aiPending = aiRunning && !lead.aiSummary && !e.aiError && (e.pagesCrawled?.length || 0) > 0;

  return (
    <div className="bg-sunk">
      {aiPending && (
        <p className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] text-accent-soft sm:px-6" role="status">
          <Spinner className="size-3.5" />
          AI is still working through the list. This company’s summary and signals will appear here when its site has been read.
        </p>
      )}
      {hasProfile && (
        <section className="border-b border-line px-4 py-5 sm:px-6">
          <div className={cx('grid gap-6', hasNarrative && 'lg:grid-cols-[1.4fr_1fr]')}>
            <div className={cx(!hasNarrative && 'hidden')}>
              {lead.aiSummary && (
                <p className="max-w-[70ch] text-[15px] text-ink">
                  <Sparkles className="mr-1.5 inline size-4 -translate-y-px text-amber" aria-label="AI summary" />
                  {lead.aiSummary}
                </p>
              )}
              {e.acquisitionNotes && <p className="mt-2 max-w-[70ch] text-[14px] text-ink-soft">{e.acquisitionNotes}</p>}
              {lead.signals?.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Ownership and business signals">
                  {lead.signals.map((s) => (
                    <li key={s} className="rounded bg-highlight-soft px-2 py-0.5 text-[13px] font-semibold text-highlight ring-1 ring-highlight/30 ring-inset">
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <dl className={cx('grid grid-cols-2 gap-x-4 gap-y-2 text-[14px]', !hasNarrative && 'sm:grid-cols-4')}>
              <div>
                <dt className="text-[13px] text-muted">Owner</dt>
                <dd className="font-semibold">
                  {lead.ownerName ? `${lead.ownerName}${lead.ownerTitle ? `, ${lead.ownerTitle}` : ''}` : 'Not found'}
                  <Prov lead={lead} field="ownerName" />
                </dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted">In business since</dt>
                <dd className="num font-semibold">
                  {lead.yearFounded || 'Unknown'}
                  <Prov lead={lead} field="yearFounded" />
                </dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted">Team</dt>
                <dd className="num font-semibold">
                  {lead.employees ? `${lead.employees} people` : 'Unknown'}
                  <Prov lead={lead} field="employees" />
                </dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted">Revenue</dt>
                <dd className="font-semibold">
                  {lead.revenue ? `${lead.revenueEstimated ? '~' : ''}$${(lead.revenue / 1e6).toFixed(1)}M` : 'Unknown'}
                  {lead.revenueEstimated && <span className="ml-1.5 text-[12px] font-normal text-muted">estimated from team size</span>}
                </dd>
              </div>
              {e.services && e.services.length > 0 && (
                <div className="col-span-2">
                  <dt className="text-[13px] text-muted">Services</dt>
                  <dd>{e.services.join(', ')}</dd>
                </div>
              )}
            </dl>
          </div>
        </section>
      )}

      <div className="grid gap-8 px-4 py-5 sm:px-6 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr]">
        <section>
          <h3 className="text-[13px] font-bold text-ink">Why it scored {lead.score}</h3>
          <ul className="mt-3 space-y-2.5">
            {lead.scoreReasons.map((r) => (
              <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                <span className={cx('text-[14px]', r.points === 0 ? 'text-muted' : 'text-ink')}>{r.label}</span>
                <span className={cx('num text-[13px] font-bold', r.points === 0 ? 'text-brick' : 'text-ink')}>
                  {['signals', 'reputation'].includes(r.key) ? `+${r.points}` : `${r.points}/${r.max}`}
                </span>
                <span className="col-span-2 h-1 overflow-hidden rounded-full bg-line">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(r.points / r.max) * 100}%`,
                      background: ['signals', 'reputation'].includes(r.key) ? 'var(--highlight)' : r.points === r.max ? 'var(--pine)' : 'var(--amber)',
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-[13px] font-bold text-ink">Contact checks</h3>
          <dl className="mt-3 space-y-3 text-[14px]">
            <div>
              <dt className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  Email
                  <Prov lead={lead} field="email" />
                </span>
                <StatusDot status={lead.emailStatus} />
              </dt>
              <dd className="mt-0.5 break-all text-ink-soft">{lead.email || 'No email on record'}</dd>
              {lead.emailReason && lead.email && <dd className="text-[13px] text-muted">{lead.emailReason}</dd>}
              {lead.emailSuggestion && (
                <dd className="mt-1 text-[13px]">
                  Probably meant <span className="font-semibold">{lead.emailSuggestion}</span>
                </dd>
              )}
              {(e.emailsFound?.length || 0) > 1 && (
                <dd className="mt-1 text-[13px] text-muted">Also on their site: {e.emailsFound!.filter((x) => x !== lead.email).join(', ')}</dd>
              )}
            </div>
            <div>
              <dt className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  Phone
                  <Prov lead={lead} field="phone" />
                </span>
                <StatusDot kind="phone" status={lead.phoneStatus} />
              </dt>
              <dd className="num mt-0.5 text-ink-soft">{formatPhone(lead.phone) || 'No phone on record'}</dd>
              {lead.phoneReason && lead.phone && <dd className="text-[13px] text-muted">{lead.phoneReason}</dd>}
            </div>
            <div>
              <dt className="flex items-center justify-between gap-2">
                <span className="font-semibold">Website</span>
                <StatusDot kind="website" status={lead.websiteStatus} />
              </dt>
              <dd className="mt-0.5 text-ink-soft">
                {lead.website ? (
                  <a href={lead.website} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                    {lead.domain}
                  </a>
                ) : (
                  'No website on record'
                )}
              </dd>
              {lead.websiteDetail && <dd className="text-[13px] text-muted">{lead.websiteDetail}</dd>}
              {e.crawlError && <dd className="text-[13px] text-muted">Couldn’t read the site: {e.crawlError}</dd>}
            </div>
            {Object.keys(lead.socials || {}).length > 0 && (
              <div>
                <dt className="font-semibold">Profiles</dt>
                <dd className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                  {Object.entries(lead.socials).map(([k, url]) => (
                    <a key={k} href={url} target="_blank" rel="noreferrer" className="text-ink-soft underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                      {{ bbb: 'BBB', linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', x: 'X', yelp: 'Yelp' }[k] || k}
                    </a>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section>
          <h3 className="text-[13px] font-bold text-ink">Where this came from</h3>
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[14px]">
            {(lead.sources?.length ? lead.sources : ['csv']).map((s) => (
              <span key={s} className="rounded bg-raised px-2 py-0.5 text-[13px] font-semibold ring-1 ring-line-strong ring-inset">
                {SOURCE_LABEL[s] || s}
              </span>
            ))}
            {lead.rating != null && (
              <span className="ml-1 inline-flex items-center gap-1 text-[13px] text-ink-soft">
                <Star className="size-3.5 fill-current text-amber" aria-hidden />
                {lead.rating} ({lead.reviewCount ?? 0} reviews)
              </span>
            )}
          </p>
          {lead.address && <p className="mt-2 text-[13px] text-muted">{lead.address}</p>}
          {(e.pagesCrawled?.length || 0) > 0 && (
            <p className="mt-2 text-[13px] text-muted">
              Read {e.pagesCrawled!.length} page{e.pagesCrawled!.length === 1 ? '' : 's'} of their site:{' '}
              {e.pagesCrawled!.map((u) => new URL(u).pathname).join(', ')}
            </p>
          )}
          {lead.mergedCount > 1 ? (
            <ul className="mt-3 space-y-2">
              {lead.mergedFrom.map((m, i) => (
                <li key={`${m.row}-${i}`} className="rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
                  <p className="font-semibold text-ink">
                    {m.source && m.source !== 'csv' ? SOURCE_LABEL[m.source] : <>Row <span className="num">{m.row}</span></>}: {m.companyName}
                  </p>
                  <p className="mt-0.5 break-all text-muted">{[m.website, m.phone, m.email].filter(Boolean).join(', ') || 'No contact details'}</p>
                  <p className="mt-1 text-ink-soft">Matched on {m.matchedOn.map((x) => MATCH_LABEL[x]).join(' and ')}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-muted">Found once; no duplicates.</p>
          )}
        </section>
      </div>

      <OutreachPanel lead={lead} aiAvailable={aiAvailable} onOutreach={onOutreach} />
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-accent-soft hover:text-ink"
    >
      {done ? <Check className="size-3.5 text-pine" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {done ? 'Copied' : label}
    </button>
  );
}

const SENDER_KEY = 'saasquatchleads.senderName';

function OutreachPanel({ lead, aiAvailable, onOutreach }: { lead: Lead; aiAvailable: boolean; onOutreach: (id: string, o: Outreach) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sender, setSender] = useState(() => {
    try {
      return localStorage.getItem(SENDER_KEY) || '';
    } catch {
      return '';
    }
  });
  const o = lead.outreach;

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      try {
        localStorage.setItem(SENDER_KEY, sender);
      } catch {
        /* ignore */
      }
      const r = await api.draftOutreach(lead.id, { senderName: sender || undefined });
      onOutreach(lead.id, r.outreach);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!aiAvailable && !o) return null;

  return (
    <section className="border-t border-line px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end gap-3">
        <h3 className="mr-auto text-[13px] font-bold text-ink">First-touch outreach</h3>
        {aiAvailable && (
          <>
            <label className="flex items-center text-[13px] font-semibold whitespace-nowrap">
              Sign as
              <input
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="Your name"
                className="ml-2 h-8 w-36 min-w-0 rounded-lg border border-line-strong px-2 text-[14px] font-normal sm:w-44"
              />
            </label>
            <Button size="sm" onClick={draft} disabled={busy}>
              {busy ? <Spinner /> : <Sparkles className="size-3.5" aria-hidden />}
              {o ? 'Draft again' : 'Draft email and call opener'}
            </Button>
          </>
        )}
      </div>
      {error && <p className="mt-2 text-[14px] text-brick">{error}</p>}
      {o && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <p className="text-[14px] font-bold">{o.subject}</p>
              <CopyButton text={`Subject: ${o.subject}\n\n${o.email}`} label="Copy email" />
            </div>
            <p className="mt-2 text-[14px] whitespace-pre-line text-ink-soft">{o.email}</p>
            {lead.email && lead.emailStatus !== 'invalid' && (
              <a
                href={`mailto:${lead.email}?subject=${encodeURIComponent(o.subject)}&body=${encodeURIComponent(o.email)}`}
                className="mt-3 inline-block text-[13px] font-semibold text-accent-soft underline decoration-accent/40 underline-offset-4 hover:decoration-accent-soft"
              >
                Open in your mail app
              </a>
            )}
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[14px] font-bold">Call opener</p>
              <CopyButton text={o.call_opener} label="Copy" />
            </div>
            <p className="mt-2 text-[14px] text-ink-soft">{o.call_opener}</p>
            <p className="mt-3 text-[12px] text-muted">Drafted by AI from this lead’s facts only. Review before sending.</p>
          </div>
        </div>
      )}
    </section>
  );
}
