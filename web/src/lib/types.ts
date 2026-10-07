export type Status = 'valid' | 'risky' | 'invalid' | 'missing';
export type WebsiteStatus = 'alive' | 'dead' | 'unknown' | 'missing';
export type Tier = 'A' | 'B' | 'C';
export type Source = 'csv' | 'google_places' | 'osm';

export interface Outreach {
  subject: string;
  email: string;
  call_opener: string;
  createdAt: string;
  model: string;
}

export interface Capabilities {
  ai: { available: boolean; provider: string | null; label: string | null; model: string | null };
  sources: Array<{ id: Exclude<Source, 'csv'>; label: string; available: boolean }>;
}

export interface SearchQuery {
  industry: string;
  product?: string;
  location: string;
  limit?: number;
  sources?: Array<Exclude<Source, 'csv'>>;
  crawl?: boolean;
  ai?: boolean;
  criteria?: Partial<Criteria>;
}

export interface ParsedSearch {
  industry: string;
  product: string | null;
  location: string;
  preset: string;
  revenue_min_millions: number | null;
  revenue_max_millions: number | null;
  employees_min: number | null;
  employees_max: number | null;
  min_years: number | null;
  exclude: string[];
  explanation: string;
}

export interface ScoreReason {
  key: string;
  label: string;
  points: number;
  max: number;
}

export interface MergedSource {
  row: number;
  companyName: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  source?: Source;
  matchedOn: Array<'domain' | 'phone' | 'email' | 'name'>;
}

export interface Lead {
  id: string;
  uploadId: string;
  companyName: string;
  domain: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  revenue: number | null;
  employees: number | null;
  yearFounded: number | null;
  ownerName: string | null;
  ownerTitle: string | null;
  linkedin: string | null;
  source: Source | null;
  sources: Source[];
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  revenueEstimated: boolean;
  socials: Partial<Record<'linkedin' | 'facebook' | 'instagram' | 'x' | 'bbb' | 'yelp', string>>;
  signals: string[];
  aiSummary: string | null;
  enrichment: {
    provenance?: Partial<Record<string, 'website' | 'ai' | 'estimate'>>;
    pagesCrawled?: string[];
    emailsFound?: string[];
    phonesFound?: string[];
    services?: string[];
    aiIndustry?: string | null;
    acquisitionNotes?: string | null;
    crawlError?: string | null;
    aiError?: string | null;
  };
  outreach: Outreach | null;
  mergedCount: number;
  mergedFrom: MergedSource[];
  emailStatus: Status;
  emailReason: string | null;
  emailSuggestion: string | null;
  phoneStatus: Status;
  phoneReason: string | null;
  phoneType: string | null;
  websiteStatus: WebsiteStatus;
  websiteDetail: string | null;
  score: number;
  tier: Tier;
  scoreReasons: ScoreReason[];
}

export interface Criteria {
  preset: string;
  label?: string;
  revenueMin: number;
  revenueMax: number;
  employeesMin: number;
  employeesMax: number;
  minYears: number;
  targetIndustries: string[];
  excludedIndustries: string[];
}

export interface Preset extends Criteria {
  id: string;
  label: string;
}

export interface Upload {
  id: string;
  fileName: string;
  rowCount: number;
  uniqueCount: number;
  duplicateCount: number;
  status: 'processing' | 'ready' | 'failed';
  stage: 'parsing' | 'discovering' | 'deduping' | 'crawling' | 'analyzing' | 'validating' | 'scoring' | 'saving' | 'done';
  source: 'csv' | 'search';
  query: Partial<SearchQuery> & { crawl?: boolean; useAi?: boolean };
  progressDone: number;
  progressTotal: number;
  error: string | null;
  criteria: Criteria;
  columnMapping: { mapping?: Record<string, string>; unmapped?: string[] };
  stats: {
    dedup?: { inputRows: number; uniqueLeads: number; duplicatesMerged: number; clustersWithDuplicates: number; linksBy: Record<string, number> };
    validation?: { lookups: number; cacheHits: number; durationMs: number };
    discovery?: Record<string, { count: number; error?: string; cached?: boolean }>;
    enrichment?: { crawled: number; crawlFailed: number; blockedByRobots: number; aiEnriched: number; aiFailed: number; fieldsFilled: Record<string, number> } | null;
    skippedRows?: Array<{ row: number; reason: string }>;
  };
  processingMs: number;
  createdAt: string;
}

export interface Summary {
  total: number;
  avgScore: number;
  tierA: number;
  tierB: number;
  tierC: number;
  emailValid: number;
  emailRisky: number;
  emailInvalid: number;
  emailMissing: number;
  phoneValid: number;
  phoneRisky: number;
  phoneInvalid: number;
  phoneMissing: number;
  websiteAlive: number;
  websiteDead: number;
  reachable: number;
  mergedRecords: number;
  aiEnriched: number;
  ownerKnown: number;
  websitesCrawled: number;
  ownersFound: number;
  emailsFound: number;
  withSignals: number;
  srcGoogle: number;
  srcOsm: number;
  srcCsv: number;
  industries: Array<{ industry: string; count: number }>;
  scoreHistogram: Array<{ from: number; to: number; count: number }>;
}

export interface Filters {
  tiers: Tier[];
  emailStatuses: Status[];
  phoneStatuses: Status[];
  industries: string[];
  reachableOnly: boolean;
  mergedOnly: boolean;
  sources: Source[];
  hasSignals: boolean;
  ownerKnown: boolean;
  minScore: number;
  q: string;
  sort: string;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

