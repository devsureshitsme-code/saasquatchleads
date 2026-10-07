export const money = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
};

export const count = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'));

export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

export const yearsSince = (year: number | null) => (year ? new Date().getFullYear() - year : null);

export const formatPhone = (e164: string | null) => {
  if (!e164) return '';
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
};

export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');
