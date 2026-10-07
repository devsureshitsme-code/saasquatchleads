/**
 * AI features (any provider: Groq, Gemini, OpenRouter, OpenAI, Claude; see aiClient.js).
 *
 *  1. enrichCompany  - reads the text the crawler pulled from a company's own website and
 *                      returns structured facts: owner, founding year, team size, services,
 *                      ownership/succession signals, and a 2-sentence acquisition summary.
 *  2. parseSearch    - turns "family-owned HVAC companies around Austin doing $2-8M" into
 *                      a search (industry, location) plus scoring criteria.
 *  3. writeOutreach  - drafts a short, specific cold email + call opener for one lead,
 *                      grounded only in facts we actually have.
 *
 * Every call requests JSON matching a schema and is normalized to it. Without an AI key these
 * features are reported as unavailable and the pipeline falls back to rule-based extraction.
 */
const { remember } = require('../lib/cache');
const client = require('./aiClient');

const { AiError, available } = client;
const MODEL = () => client.info().model;
const callAi = (args) => client.callModel(args);

// --------------------------------------------------------------- 1. website enrichment

const nullable = (type, description) => ({ type: [type, 'null'], description });

const ENRICH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['owner_name', 'owner_title', 'year_founded', 'employee_estimate', 'industry', 'services', 'family_owned', 'ownership_signals', 'summary', 'acquisition_notes'],
  properties: {
    owner_name: nullable('string', 'Full name of the owner/founder/president if the text states it. Null if not stated.'),
    owner_title: nullable('string', 'Their title as written, e.g. "Owner", "President".'),
    year_founded: nullable('integer', 'Year the business was founded, only if stated or directly derivable ("35 years in business" in the current year).'),
    employee_estimate: nullable('integer', 'Headcount only if the text states or clearly implies it (e.g. "team of 25", photos of 12 staff listed). Null otherwise.'),
    industry: nullable('string', 'Short industry label, e.g. "HVAC", "Commercial cleaning", "Managed IT services".'),
    services: { type: 'array', items: { type: 'string' }, description: 'Up to 6 main services offered.' },
    family_owned: nullable('boolean', 'True if the site says family-owned/operated or multi-generation.'),
    ownership_signals: {
      type: 'array',
      items: { type: 'string' },
      description: 'Short factual signals relevant to a business acquirer, e.g. "Second-generation owner", "Owner mentions retirement", "Single location", "Commercial contracts". Only what the text supports.',
    },
    summary: { type: 'string', description: 'Two plain sentences: what the company does, for whom, where.' },
    acquisition_notes: { type: 'string', description: 'One sentence on what makes this an interesting (or weak) acquisition target, grounded in the text. No speculation beyond the text.' },
  },
};

const ENRICH_SYSTEM = `You extract facts about small businesses for acquisition researchers (search funds).
Use ONLY the website text provided. Never guess names, years or headcounts: if the text doesn't state it, return null.
Be concise and factual.`;

async function enrichCompany(lead, crawlResult) {
  const key = `ai:enrich:${client.info().provider}:${MODEL()}:${lead.domain}`;
  const { value } = await remember(key, 7 * 86400, async () => {
    const { data } = await callAi({
      system: ENRICH_SYSTEM,
      schema: ENRICH_SCHEMA,
      maxTokens: 900,
      prompt: `Company: ${lead.companyName}
Location: ${[lead.city, lead.state].filter(Boolean).join(', ') || 'unknown'}
Listed industry: ${lead.industry || 'unknown'}
Current year: ${new Date().getFullYear()}

Website text (homepage and about/contact pages):
"""
${crawlResult.text}
"""`,
    });
    return data;
  });
  return value;
}

// --------------------------------------------------------------- 2. natural-language search

const SEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['industry', 'product', 'location', 'preset', 'revenue_min_millions', 'revenue_max_millions', 'employees_min', 'employees_max', 'min_years', 'exclude', 'explanation'],
  properties: {
    industry: { type: 'string', description: 'Industry to search, as a short phrase a business directory understands, e.g. "HVAC contractor".' },
    product: nullable('string', 'Optional product/service keyword to narrow the search.'),
    location: { type: 'string', description: 'City and state/region, e.g. "Austin, TX". Empty string if none given.' },
    preset: { type: 'string', enum: ['home_services', 'b2b_services', 'general'], description: 'Closest scoring preset.' },
    revenue_min_millions: nullable('number', 'Minimum revenue in $M if stated.'),
    revenue_max_millions: nullable('number', 'Maximum revenue in $M if stated.'),
    employees_min: nullable('integer', 'Minimum employees if stated.'),
    employees_max: nullable('integer', 'Maximum employees if stated.'),
    min_years: nullable('integer', 'Minimum years in business if stated.'),
    exclude: { type: 'array', items: { type: 'string' }, description: 'Industries or keywords to exclude, if stated.' },
    explanation: { type: 'string', description: 'One short sentence describing how you interpreted the request.' },
  },
};

async function parseSearch(text) {
  const { data } = await callAi({
    system: 'You convert a buyer\'s plain-English description of target companies into a structured search. Only fill criteria the user actually stated.',
    schema: SEARCH_SCHEMA,
    maxTokens: 500,
    prompt: text,
  });
  return data;
}

// --------------------------------------------------------------- 3. outreach writer

const OUTREACH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'email', 'call_opener'],
  properties: {
    subject: { type: 'string', description: 'Short, specific subject line. No clickbait.' },
    email: { type: 'string', description: 'Plain-text email body, 80-130 words, signed with the sender name.' },
    call_opener: { type: 'string', description: 'Two sentences a caller can say in the first 15 seconds.' },
  },
};

async function writeOutreach(lead, { senderName, senderCompany, goal, tone }) {
  const facts = {
    company: lead.companyName,
    owner: lead.ownerName,
    owner_title: lead.ownerTitle,
    city: lead.city,
    state: lead.state,
    industry: lead.industry,
    year_founded: lead.yearFounded,
    employees: lead.employees,
    google_rating: lead.rating,
    google_reviews: lead.reviewCount,
    website_summary: lead.aiSummary,
    signals: lead.signals,
    why_it_scored: (lead.scoreReasons || []).filter((r) => r.points > 0).map((r) => r.label),
  };
  const { data } = await callAi({
    system: `You write respectful, low-pressure first-touch outreach from a business buyer to a small-business owner.
Rules: use only the facts given; never invent numbers, names or compliments; don't mention scores, tiers or data tools;
no hype words ("exciting", "unique opportunity"); one clear ask (a short call); plain text.`,
    schema: OUTREACH_SCHEMA,
    maxTokens: 700,
    prompt: `Sender: ${senderName || 'the sender'}${senderCompany ? ` of ${senderCompany}` : ''}
Goal: ${goal || 'Start a conversation about the owner\'s long-term plans and whether they would ever consider selling or bringing on a successor.'}
Tone: ${tone || 'warm and direct'}

Facts about the business (JSON):
${JSON.stringify(facts, null, 2)}`,
  });
  return data;
}

// --------------------------------------------------------------- revenue estimate (no AI)

// Rough revenue per employee by industry (US small-business benchmarks, rounded).
const REVENUE_PER_EMPLOYEE = [
  [['roof'], 250_000],
  [['dental', 'dentist'], 220_000],
  [['hvac', 'heating', 'air'], 200_000],
  [['electric'], 190_000],
  [['plumb'], 180_000],
  [['it ', 'it services', 'managed it', 'technology', 'software'], 180_000],
  [['medical', 'health', 'clinic'], 170_000],
  [['auto', 'car repair'], 160_000],
  [['account', 'bookkeep', 'cpa', 'tax'], 150_000],
  [['pest'], 140_000],
  [['landscap', 'lawn'], 110_000],
  [['restaurant', 'food'], 70_000],
  [['clean', 'janitorial'], 60_000],
];

function estimateRevenue(industry, employees) {
  if (!employees) return null;
  const ind = ` ${String(industry || '').toLowerCase()} `;
  const hit = REVENUE_PER_EMPLOYEE.find(([keys]) => keys.some((k) => ind.includes(k)));
  const rpe = hit ? hit[1] : 150_000;
  return Math.round((employees * rpe) / 10_000) * 10_000;
}

module.exports = { available, model: MODEL, info: client.info, enrichCompany, parseSearch, writeOutreach, estimateRevenue, callAi, AiError, ENRICH_SCHEMA };
