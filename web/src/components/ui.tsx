'use client';

import { forwardRef } from 'react';
import type { Status, Tier, WebsiteStatus } from '@/lib/types';
import { cx } from '@/lib/format';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-linear-to-r from-accent to-accent-2 text-white shadow-[0_10px_28px_-12px_var(--accent)] hover:brightness-115',
        variant === 'secondary' && 'border border-line-strong bg-raised text-ink hover:border-accent-soft/60 hover:bg-line',
        variant === 'ghost' && 'text-ink-soft hover:bg-raised hover:text-ink',
        variant === 'danger' && 'text-brick hover:bg-brick-wash',
        className,
      )}
      {...props}
    />
  );
});

const TIER_STYLE: Record<Tier, string> = {
  A: 'bg-pine text-paper',
  B: 'bg-amber-wash text-amber ring-1 ring-inset ring-amber/30',
  C: 'bg-raised text-muted ring-1 ring-inset ring-line-strong',
};

export const TIER_MEANING: Record<Tier, string> = {
  A: 'Call first',
  B: 'Worth a look',
  C: 'Low fit',
};

/** The score is the memorable element of each row: heavy numeral + tier chip. */
export function ScoreMark({ score, tier, size = 'md' }: { score: number; tier: Tier; size?: 'md' | 'lg' }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Score ${score}, tier ${tier}: ${TIER_MEANING[tier]}`}>
      <span className={cx('num font-black leading-none tracking-tight text-ink', size === 'lg' ? 'text-5xl' : 'text-[22px]')}>{score}</span>
      <span className={cx('num rounded-md px-1.5 py-0.5 text-[11px] font-bold', TIER_STYLE[tier])}>{tier}</span>
    </div>
  );
}

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  valid: { dot: 'bg-pine', text: 'text-pine', label: 'Verified' },
  alive: { dot: 'bg-pine', text: 'text-pine', label: 'Online' },
  risky: { dot: 'bg-amber', text: 'text-amber', label: 'Risky' },
  unknown: { dot: 'bg-line-strong', text: 'text-muted', label: 'Unchecked' },
  invalid: { dot: 'bg-brick', text: 'text-brick', label: 'Invalid' },
  dead: { dot: 'bg-brick', text: 'text-brick', label: 'Down' },
  missing: { dot: 'border border-line-strong bg-transparent', text: 'text-muted', label: 'None' },
};

/** Phones are format/line-type checked, not dialed, so a good phone reads "Valid" rather than "Verified". */
export function StatusDot({ status, title, kind = 'email' }: { status: Status | WebsiteStatus | null; title?: string; kind?: 'email' | 'phone' | 'website' }) {
  const base = STATUS_STYLE[status || 'missing'];
  const s = kind === 'phone' && status === 'valid' ? { ...base, label: 'Valid' } : kind === 'phone' && status === 'risky' ? { ...base, label: 'Toll-free' } : base;
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[13px] font-medium', s.text)} title={title}>
      <span className={cx('inline-block size-2 shrink-0 rounded-full', s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

export function statusLabel(status: string) {
  return STATUS_STYLE[status]?.label || status;
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="size-4 cursor-pointer accent-accent"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate && !checked;
      }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      role="status"
      aria-label="Loading"
    />
  );
}
