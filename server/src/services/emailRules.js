/** Static email rules shared by dedup and validation. */
const disposableDomains = new Set(require('disposable-email-domains'));

const ROLE_LOCAL_PARTS = new Set([
  'info', 'sales', 'admin', 'contact', 'office', 'support', 'hello', 'help', 'team', 'service', 'services',
  'billing', 'accounts', 'accounting', 'marketing', 'hr', 'jobs', 'careers', 'noreply', 'no-reply', 'webmaster',
  'enquiries', 'inquiries', 'frontdesk', 'reception', 'customerservice', 'mail', 'general',
]);

const FREE_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'comcast.net', 'att.net', 'verizon.net', 'sbcglobal.net',
  'bellsouth.net', 'protonmail.com', 'proton.me', 'zoho.com', 'gmx.com',
]);

// Frequent typos of big providers -> correction
const DOMAIN_TYPOS = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmial.con': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmai.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com', 'aol.con': 'aol.com', 'icloud.con': 'icloud.com',
};

// Pragmatic syntax check (RFC 5322 is far looser, but this matches deliverable real-world addresses).
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const localPart = (email) => String(email || '').split('@')[0].toLowerCase();
const domainOf = (email) => String(email || '').split('@').pop().toLowerCase();

const isRoleEmail = (email) => !!email && ROLE_LOCAL_PARTS.has(localPart(email).replace(/[._-]/g, ''));
/** Checks the domain and its parent domains (mx.tempmail.net -> tempmail.net). */
function isDisposable(domain) {
  const parts = String(domain || '').split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (disposableDomains.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}
const isFreeProvider = (domain) => FREE_PROVIDERS.has(domain);
const isValidSyntax = (email) => EMAIL_RE.test(email) && !email.includes('..') && localPart(email).length <= 64;

module.exports = { isRoleEmail, isDisposable, isFreeProvider, isValidSyntax, DOMAIN_TYPOS, domainOf, localPart };
