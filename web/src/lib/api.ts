import type { Capabilities, Criteria, Filters, Lead, Outreach, ParsedSearch, Preset, SearchQuery, Summary, Upload } from './types';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(`Can't reach the SaaSquatchLeads API at ${API_URL}. Is the server running?`, 0);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `Request failed (${res.status})`, res.status);
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export function filtersToQuery(f: Partial<Filters>, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  const setList = (k: string, v?: string[]) => v && v.length && p.set(k, v.join(','));
  setList('tiers', f.tiers);
  setList('emailStatuses', f.emailStatuses);
  setList('phoneStatuses', f.phoneStatuses);
  setList('industries', f.industries);
  setList('sources', f.sources);
  if (f.hasSignals) p.set('hasSignals', 'true');
  if (f.ownerKnown) p.set('ownerKnown', 'true');
  if (f.reachableOnly) p.set('reachableOnly', 'true');
  if (f.mergedOnly) p.set('mergedOnly', 'true');
  if (f.minScore) p.set('minScore', String(f.minScore));
  if (f.q) p.set('q', f.q);
  if (f.sort) p.set('sort', f.sort);
  if (f.order) p.set('order', f.order);
  if (f.page) p.set('page', String(f.page));
  if (f.pageSize) p.set('pageSize', String(f.pageSize));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

export const api = {
  health: () => request<{ ok: boolean; db: string; cache: string }>('/api/health'),
  presets: () => request<{ presets: Preset[] }>('/api/presets'),
  uploads: () => request<{ uploads: Upload[] }>('/api/uploads'),
  upload: (id: string) => request<{ upload: Upload; summary: Summary | null }>(`/api/uploads/${id}`),
  deleteUpload: (id: string) => request<void>(`/api/uploads/${id}`, { method: 'DELETE' }),
  uploadFile: (file: File, preset: string, enrich: { crawl: boolean; ai: boolean }) => {
    const form = new FormData();
    form.append('file', file);
    form.append('preset', preset);
    form.append('crawl', String(enrich.crawl));
    form.append('ai', String(enrich.ai));
    return request<{ upload: Upload }>('/api/uploads', { method: 'POST', body: form });
  },
  uploadSample: (preset: string, enrich: { crawl: boolean; ai: boolean }) => request<{ upload: Upload }>('/api/uploads/sample', json({ preset, ...enrich })),
  capabilities: () => request<Capabilities>('/api/capabilities'),
  search: (q: SearchQuery) => request<{ upload: Upload }>('/api/search', json(q)),
  parseSearch: (text: string) => request<ParsedSearch>('/api/ai/parse-search', json({ text })),
  draftOutreach: (leadId: string, body: { senderName?: string; senderCompany?: string; goal?: string; tone?: string }) =>
    request<{ outreach: Outreach }>(`/api/leads/${leadId}/outreach`, json(body)),
  leads: (id: string, f: Partial<Filters>) =>
    request<{ leads: Lead[]; total: number; page: number; pageSize: number }>(`/api/uploads/${id}/leads?${filtersToQuery(f)}`),
  rescore: (id: string, criteria: Partial<Criteria>) => request<{ criteria: Criteria }>(`/api/uploads/${id}/rescore`, json(criteria)),
  exportUrl: (id: string, f: Partial<Filters>, ids?: string[]) =>
    `${API_URL}/api/uploads/${id}/export.csv?${filtersToQuery({ ...f, page: undefined, pageSize: undefined, sort: undefined, order: undefined }, ids && ids.length ? { ids: ids.join(',') } : {})}`,
  sampleUrl: () => `${API_URL}/api/sample.csv`,
};
