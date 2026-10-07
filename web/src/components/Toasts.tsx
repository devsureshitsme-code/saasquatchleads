'use client';

import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { cx } from '@/lib/format';

export type Toast = { id: number; tone: 'ok' | 'error'; title: string; body?: string };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random();
      setToasts((all) => [...all.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === 'error' ? 9000 : 5000);
    },
    [dismiss],
  );
  return { toasts, push, dismiss };
}

export function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed top-4 right-4 left-4 z-50 flex flex-col items-end gap-2 sm:left-auto" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={cx(
            'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-raised px-4 py-3 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.8)]',
            t.tone === 'error' ? 'border-brick/40' : 'border-pine/40',
          )}
        >
          <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', t.tone === 'error' ? 'bg-brick' : 'bg-pine')} aria-hidden />
          <div className="flex-1 text-[14px]">
            <p className="font-semibold text-ink">{t.title}</p>
            {t.body && <p className="mt-0.5 text-muted">{t.body}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-muted hover:text-ink" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
