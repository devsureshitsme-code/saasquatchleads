/**
 * Deduplication: cluster raw leads that describe the same business, then merge
 * each cluster into a single "golden record".
 *
 * Two leads are linked when ANY of these hold:
 *   1. same website domain
 *   2. same valid phone number (E.164), excluding toll-free lines shared by franchises
 *   3. same personal (non-role) email address
 *   4. company names >= 88% similar AND same city, with no conflicting domain/phone
 *
 * Links are transitive (A~B, B~C => A,B,C are one business), resolved with union-find.
 */
const { distance } = require('fastest-levenshtein');
const { isRoleEmail } = require('./emailRules');

const NAME_SIMILARITY_THRESHOLD = 0.88;

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
    return true;
  }
}

function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance(a, b) / maxLen;
}

const phoneKey = (lead) => {
  const p = lead.phoneParsed;
  if (!p || !p.valid || !p.e164) return null;
  if (p.type === 'TOLL_FREE' || p.type === 'SHARED_COST') return null;
  return p.e164;
};

const emailKey = (lead) => (lead.email && lead.email.includes('@') && !isRoleEmail(lead.email) ? lead.email : null);

/** True when two leads carry evidence they are different businesses. */
function conflicts(a, b) {
  if (a.domain && b.domain && a.domain !== b.domain) return true;
  const pa = phoneKey(a);
  const pb = phoneKey(b);
  if (pa && pb && pa !== pb) return true;
  return false;
}

/**
 * @param {Array} leads normalized raw leads from csv.parseLeadsCsv
 * @returns {{ records: Array, stats: object }}
 */
function dedupe(leads) {
  const uf = new UnionFind(leads.length);
  const edgeReasons = leads.map(() => new Set());
  const counts = { domain: 0, phone: 0, email: 0, name: 0 };

  const link = (i, j, reason) => {
    edgeReasons[i].add(reason);
    edgeReasons[j].add(reason);
    if (uf.union(i, j)) counts[reason]++;
  };

  // 1-3: exact keys. Bucket indices per key and link each to the first in its bucket.
  const exactKeys = [
    ['domain', (l) => l.domain],
    ['phone', phoneKey],
    ['email', emailKey],
  ];
  for (const [reason, getKey] of exactKeys) {
    const firstSeen = new Map();
    leads.forEach((lead, i) => {
      const k = getKey(lead);
      if (!k) return;
      if (firstSeen.has(k)) link(firstSeen.get(k), i, reason);
      else firstSeen.set(k, i);
    });
  }

  // 4: fuzzy name match, blocked by city so we only compare plausible pairs.
  const byCity = new Map();
  leads.forEach((lead, i) => {
    if (!lead.normName) return;
    const city = (lead.city || '').toLowerCase();
    if (!byCity.has(city)) byCity.set(city, []);
    byCity.get(city).push(i);
  });
  for (const [city, idxs] of byCity) {
    if (!city) continue; // without a city we don't trust name-only matches
    for (let x = 0; x < idxs.length; x++) {
      for (let y = x + 1; y < idxs.length; y++) {
        const a = leads[idxs[x]];
        const b = leads[idxs[y]];
        if (uf.find(idxs[x]) === uf.find(idxs[y])) continue;
        if (conflicts(a, b)) continue;
        if (nameSimilarity(a.normName, b.normName) >= NAME_SIMILARITY_THRESHOLD) link(idxs[x], idxs[y], 'name');
      }
    }
  }

  // Group into clusters (keep original order of first appearance).
  const clusters = new Map();
  leads.forEach((lead, i) => {
    const root = uf.find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(i);
  });

  const records = [];
  for (const members of clusters.values()) {
    const group = members.map((i) => ({ ...leads[i], matchedOn: [...edgeReasons[i]] }));
    records.push(mergeCluster(group));
  }

  return {
    records,
    stats: {
      inputRows: leads.length,
      uniqueLeads: records.length,
      duplicatesMerged: leads.length - records.length,
      clustersWithDuplicates: records.filter((r) => r.mergedCount > 1).length,
      linksBy: counts,
    },
  };
}

const filled = (v) => v !== null && v !== undefined && v !== '';
const completeness = (l) =>
  ['website', 'phone', 'email', 'ownerName', 'ownerTitle', 'city', 'state', 'industry', 'revenue', 'employees', 'yearFounded', 'linkedin']
    .filter((f) => filled(l[f])).length;

const isShouting = (s) => s && s === s.toUpperCase() && /[A-Z]/.test(s);

/** Merge one cluster of raw leads into a golden record, field by field. */
function mergeCluster(group) {
  const sorted = [...group].sort((a, b) => completeness(b) - completeness(a));
  const best = sorted[0];
  const firstFilled = (field, prefer = () => true) =>
    (sorted.find((l) => filled(l[field]) && prefer(l)) || sorted.find((l) => filled(l[field])) || {})[field] ?? null;

  // Company name: most complete record's name, but avoid ALL-CAPS scraper output when a nicer one exists.
  const companyName = (sorted.find((l) => !isShouting(l.companyName)) || best).companyName;

  // Phone: prefer a valid non-toll-free number, then any valid one.
  const phoneLead =
    sorted.find((l) => l.phoneParsed && l.phoneParsed.valid && l.phoneParsed.type !== 'TOLL_FREE') ||
    sorted.find((l) => l.phoneParsed && l.phoneParsed.valid) ||
    sorted.find((l) => filled(l.phone));

  // Email: prefer a personal address over info@/sales@.
  const email = firstFilled('email', (l) => !isRoleEmail(l.email));

  const merged = {
    companyName,
    normName: best.normName,
    domain: firstFilled('domain'),
    website: firstFilled('website'),
    phone: phoneLead ? phoneLead.phone : null,
    phoneParsed: phoneLead ? phoneLead.phoneParsed : null,
    email,
    ownerName: firstFilled('ownerName'),
    ownerTitle: firstFilled('ownerTitle'),
    city: firstFilled('city'),
    state: firstFilled('state'),
    industry: firstFilled('industry'),
    revenue: firstFilled('revenue'),
    employees: firstFilled('employees'),
    yearFounded: firstFilled('yearFounded'),
    linkedin: firstFilled('linkedin'),
    address: firstFilled('address'),
    rating: firstFilled('rating'),
    reviewCount: firstFilled('reviewCount'),
    revenueEstimated: false,
    source: best.source || 'csv',
    sources: [...new Set(group.map((l) => l.source || 'csv'))],
    sourceIds: group.filter((l) => l.sourceId).map((l) => `${l.source}:${l.sourceId}`),
    mergedCount: group.length,
    mergedFrom:
      group.length > 1
        ? group
            .sort((a, b) => a.row - b.row)
            .map((l) => ({
              row: l.row,
              companyName: l.companyName,
              email: l.email,
              phone: l.phoneRaw,
              website: l.website,
              source: l.source || 'csv',
              matchedOn: l.matchedOn,
            }))
        : [],
  };
  return merged;
}

module.exports = { dedupe, nameSimilarity, mergeCluster, UnionFind, NAME_SIMILARITY_THRESHOLD };
