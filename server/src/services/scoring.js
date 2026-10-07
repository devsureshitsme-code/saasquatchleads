/**
 * Acquisition-fit scoring (0-100).
 *
 * Searchers and lower-middle-market buyers want stable, owner-run, "boring" businesses:
 * $1-10M revenue, a real team, a decade or more of history, an identifiable owner, and a
 * way to actually reach that owner. Every point awarded is recorded with a human-readable
 * reason so a rep can see WHY a lead ranks where it does.
 */

const PRESETS = {
  home_services: {
    label: 'Home services (searcher classic)',
    revenueMin: 1_000_000,
    revenueMax: 10_000_000,
    employeesMin: 5,
    employeesMax: 50,
    minYears: 10,
    targetIndustries: ['hvac', 'plumbing', 'landscaping', 'lawn', 'electrical', 'electric', 'pest', 'roofing', 'cleaning', 'janitorial', 'pool', 'garage door', 'restoration'],
    excludedIndustries: ['software', 'startup', 'crypto', 'restaurant'],
  },
  b2b_services: {
    label: 'B2B services',
    revenueMin: 2_000_000,
    revenueMax: 15_000_000,
    employeesMin: 10,
    employeesMax: 100,
    minYears: 8,
    targetIndustries: ['it services', 'managed it', 'accounting', 'bookkeeping', 'cpa', 'staffing', 'insurance', 'consulting', 'marketing', 'logistics', 'commercial cleaning', 'janitorial', 'payroll'],
    excludedIndustries: ['software startup', 'crypto', 'restaurant', 'retail'],
  },
  general: {
    label: 'Any traditional SMB',
    revenueMin: 1_000_000,
    revenueMax: 20_000_000,
    employeesMin: 5,
    employeesMax: 150,
    minYears: 10,
    targetIndustries: [], // empty = any industry not excluded counts as a fit
    excludedIndustries: ['software startup', 'crypto', 'startup'],
  },
};

const WEIGHTS = {
  revenue: 25,
  employees: 15,
  age: 15,
  industry: 15,
  owner: 10,
  email: 10,
  phone: 5,
  website: 5,
};

// Bonus points for signals that matter to acquirers; total score is still capped at 100.
const BONUS = { succession: 5, reputation: 5 };

// Tier cut-offs: A = call this week, B = nurture, C = deprioritize.
const TIER_A = 75;
const TIER_B = 50;

const fmtMoney = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M` : `$${Math.round(n / 1e3)}K`);

/** Full points inside [min,max]; half points within 50% outside the band; else zero. */
function bandScore(value, min, max, weight) {
  if (value === null || value === undefined) return { points: 0, where: 'unknown' };
  if (value >= min && value <= max) return { points: weight, where: 'in' };
  if (value >= min * 0.5 && value <= max * 1.5) return { points: Math.round(weight / 2), where: value < min ? 'below-near' : 'above-near' };
  return { points: 0, where: value < min ? 'below' : 'above' };
}

function resolveCriteria(input = {}) {
  const base = PRESETS[input.preset] || PRESETS.home_services;
  const pick = (k) => (input[k] !== undefined && input[k] !== null && input[k] !== '' ? input[k] : base[k]);
  return {
    preset: PRESETS[input.preset] ? input.preset : 'home_services',
    label: base.label,
    revenueMin: Number(pick('revenueMin')),
    revenueMax: Number(pick('revenueMax')),
    employeesMin: Number(pick('employeesMin')),
    employeesMax: Number(pick('employeesMax')),
    minYears: Number(pick('minYears')),
    targetIndustries: (pick('targetIndustries') || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean),
    excludedIndustries: (pick('excludedIndustries') || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean),
  };
}

const OWNER_TITLES = /owner|founder|president|ceo|principal|partner|proprietor/i;

/**
 * @param lead merged + validated lead
 * @param criteria output of resolveCriteria
 * @returns {{ score:number, tier:'A'|'B'|'C', reasons:Array<{key,label,points,max}> }}
 */
function scoreLead(lead, criteria, now = new Date()) {
  const c = criteria;
  const reasons = [];
  const add = (key, label, points, max) => reasons.push({ key, label, points, max });

  // Revenue
  const rev = bandScore(lead.revenue, c.revenueMin, c.revenueMax, WEIGHTS.revenue);
  const band = `${fmtMoney(c.revenueMin)}–${fmtMoney(c.revenueMax)}`;
  const revLabel = lead.revenueEstimated ? `Est. revenue ~${fmtMoney(lead.revenue)} (from headcount)` : `Revenue ${fmtMoney(lead.revenue)}`;
  if (rev.where === 'unknown') add('revenue', 'Revenue unknown', 0, WEIGHTS.revenue);
  else if (rev.where === 'in') add('revenue', `${revLabel} in target band (${band})`, rev.points, WEIGHTS.revenue);
  else add('revenue', `${revLabel} ${rev.where.startsWith('below') ? 'below' : 'above'} target band (${band})`, rev.points, WEIGHTS.revenue);

  // Employees
  const emp = bandScore(lead.employees, c.employeesMin, c.employeesMax, WEIGHTS.employees);
  if (emp.where === 'unknown') add('employees', 'Headcount unknown', 0, WEIGHTS.employees);
  else if (emp.where === 'in') add('employees', `${lead.employees} employees — real team, still owner-run`, emp.points, WEIGHTS.employees);
  else add('employees', `${lead.employees} employees (target ${c.employeesMin}–${c.employeesMax})`, emp.points, WEIGHTS.employees);

  // Business age
  if (!lead.yearFounded) add('age', 'Founding year unknown', 0, WEIGHTS.age);
  else {
    const years = now.getFullYear() - lead.yearFounded;
    if (years >= c.minYears) add('age', `${years} years in business — proven, durable`, WEIGHTS.age, WEIGHTS.age);
    else if (years >= c.minYears / 2) add('age', `${years} years in business (target ${c.minYears}+)`, Math.round(WEIGHTS.age / 2), WEIGHTS.age);
    else add('age', `Only ${years} years in business`, 0, WEIGHTS.age);
  }

  // Industry fit
  const ind = (lead.industry || '').toLowerCase();
  const excluded = ind && c.excludedIndustries.some((k) => ind.includes(k));
  const targeted = ind && (c.targetIndustries.length === 0 || c.targetIndustries.some((k) => ind.includes(k)));
  if (!ind) add('industry', 'Industry unknown', 0, WEIGHTS.industry);
  else if (excluded) add('industry', `${lead.industry} — outside acquisition thesis`, 0, WEIGHTS.industry);
  else if (targeted) add('industry', `${lead.industry} — matches thesis`, WEIGHTS.industry, WEIGHTS.industry);
  else add('industry', `${lead.industry} — adjacent to thesis`, Math.round(WEIGHTS.industry / 3), WEIGHTS.industry);

  // Owner identified
  if (lead.ownerName && OWNER_TITLES.test(lead.ownerTitle || '')) add('owner', `Owner identified: ${lead.ownerName} (${lead.ownerTitle})`, WEIGHTS.owner, WEIGHTS.owner);
  else if (lead.ownerName) add('owner', `Contact known (${lead.ownerName}${lead.ownerTitle ? `, ${lead.ownerTitle}` : ''}) — may not be owner`, Math.round(WEIGHTS.owner / 2), WEIGHTS.owner);
  else add('owner', 'Owner not identified', 0, WEIGHTS.owner);

  // Reachability
  const emailPts = { valid: WEIGHTS.email, risky: Math.round(WEIGHTS.email * 0.4) }[lead.emailStatus] || 0;
  add('email', { valid: 'Verified email', risky: 'Email reachable but risky', invalid: 'Email invalid', missing: 'No email' }[lead.emailStatus] || 'Email not checked', emailPts, WEIGHTS.email);

  const phonePts = { valid: WEIGHTS.phone, risky: Math.round(WEIGHTS.phone * 0.4) }[lead.phoneStatus] || 0;
  add('phone', { valid: 'Direct phone line', risky: 'Toll-free / shared line', invalid: 'Phone invalid', missing: 'No phone' }[lead.phoneStatus] || 'Phone not checked', phonePts, WEIGHTS.phone);

  const webPts = { alive: WEIGHTS.website, unknown: Math.round(WEIGHTS.website * 0.4) }[lead.websiteStatus] || 0;
  add('website', { alive: 'Website online', dead: 'Website down — business may be closed', unknown: 'Website not checked', missing: 'No website' }[lead.websiteStatus] || 'Website not checked', webPts, WEIGHTS.website);

  // Bonus (on top of the 100-point model, capped at 100): signals searchers actively look for.
  const signals = (lead.signals || []).join(' ').toLowerCase();
  const succession = /family|generation|retire|succession|owner-operated|founder/.test(signals);
  if (succession) add('signals', `Ownership signal: ${(lead.signals || []).find((x) => /family|generation|retire|succession|owner-operated|founder/i.test(x))}`, BONUS.succession, BONUS.succession);
  if (lead.rating >= 4.5 && lead.reviewCount >= 50) {
    add('reputation', `Strong reputation: ${lead.rating}★ from ${lead.reviewCount} reviews`, BONUS.reputation, BONUS.reputation);
  }

  const score = Math.max(0, Math.min(100, reasons.reduce((s, r) => s + r.points, 0)));
  const tier = score >= TIER_A ? 'A' : score >= TIER_B ? 'B' : 'C';
  return { score, tier, reasons };
}

function scoreAll(leads, criteriaInput) {
  const criteria = resolveCriteria(criteriaInput);
  return { criteria, leads: leads.map((l) => ({ ...l, ...renameScore(scoreLead(l, criteria)) })) };
}

const renameScore = ({ score, tier, reasons }) => ({ score, tier, scoreReasons: reasons });

module.exports = { scoreLead, scoreAll, resolveCriteria, PRESETS, WEIGHTS, BONUS, TIER_A, TIER_B };
