import { AnimatePresence, motion, type HTMLMotionProps } from 'framer-motion';
import { CheckCircle2, Info, Loader2, X, XCircle, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from '../lib/format';

/* ---------- Button ---------- */

const VARIANTS = {
  primary: 'bg-brand text-white shadow-lg shadow-brand/25 hover:bg-[#1a60d0]',
  dark: 'bg-navy text-white hover:bg-navy-2',
  ghost: 'bg-white text-ink ring-1 ring-line hover:bg-slate-50',
  danger: 'bg-critical text-white hover:bg-[#b83232]',
  warn: 'bg-warning text-navy hover:bg-[#f0a600]',
  good: 'bg-teal text-white hover:bg-[#0b7d72]',
} as const;
const SIZES = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-14 px-6 text-base gap-2.5', xl: 'h-20 px-8 text-xl gap-3' };

type ButtonProps = HTMLMotionProps<'button'> & {
  variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES; icon?: LucideIcon; loading?: boolean; kbd?: string;
};

export function Button({ variant = 'primary', size = 'md', icon: Icon, loading, kbd, className, children, disabled, ...rest }: ButtonProps) {
  const Glyph = loading ? Loader2 : Icon;
  return (
    <motion.button
      whileHover={{ y: disabled ? 0 : -1 }}
      whileTap={{ scale: disabled ? 1 : 0.96 }}
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant], SIZES[size], className,
      )}
      {...rest}
    >
      {Glyph && <Glyph className={cx('shrink-0', loading && 'animate-spin', size === 'xl' ? 'size-7' : 'size-4')} />}
      {children as ReactNode}
      {kbd && <Kbd className="ml-1 opacity-70">{kbd}</Kbd>}
    </motion.button>
  );
}

export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => (
  <kbd className={cx('rounded-md border border-current/30 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none', className)}>{children}</kbd>
);

/* ---------- Chip / Card / Stat ---------- */

export const Chip = ({ icon: Icon, className, children }: { icon?: LucideIcon; className?: string; children: ReactNode }) => (
  <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', className)}>
    {Icon && <Icon className="size-3.5" />}
    {children}
  </span>
);

/** White card by default; a `bg-*` class in className replaces the white background. */
export const Card = ({ className, children, ...rest }: HTMLMotionProps<'div'>) => (
  <motion.div className={cx('rounded-2xl p-5 shadow-sm ring-1 ring-line/80', !/(^|\s)bg-/.test(className ?? '') && 'bg-white', className)} {...rest}>
    {children}
  </motion.div>
);

export function Stat({ label, value, hint, icon: Icon, tone = 'text-ink' }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: string;
}) {
  return (
    <Card layout whileHover={{ y: -2 }} className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-sm text-ink-2">
        {Icon && <Icon className="size-4" />}
        {label}
      </div>
      <motion.div key={String(value)} initial={{ opacity: 0.3, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cx('text-3xl font-bold', tone)}>
        {value}
      </motion.div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export const LiveDot = ({ on, label }: { on: boolean; label?: string }) => (
  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
    <span className="relative flex size-2.5">
      {on && <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60" />}
      <span className={cx('relative inline-flex size-2.5 rounded-full', on ? 'bg-good' : 'bg-critical')} />
    </span>
    {label ?? (on ? 'Live' : 'Reconnecting…')}
  </span>
);

export const Empty = ({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted">
    <Icon className="size-10 animate-float opacity-60" />
    <div className="font-semibold text-ink-2">{title}</div>
    {hint && <div className="max-w-xs text-sm">{hint}</div>}
  </div>
);

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cx('animate-pulse rounded-xl bg-slate-200/70', className)} />
);

/** Suspense fallback while a page's chunk downloads (usually only on the first visit). */
export const PageLoader = () => (
  <div className="grid min-h-[50vh] place-items-center" role="status" aria-label="Loading page">
    <Loader2 className="size-6 animate-spin text-muted" />
  </div>
);

/* ---------- Segmented control with sliding pill ---------- */

export function Segmented<T extends string>({ value, options, onChange, id }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; id: string;
}) {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cx('relative rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors', value === o.value ? 'text-ink' : 'text-muted hover:text-ink-2')}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg bg-white shadow-sm" transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Modal ---------- */

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10, opacity: 0 }}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{title}</h2>
              <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-slate-100" aria-label="Close"><X className="size-5" /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Toasts ---------- */

type Tone = 'good' | 'bad' | 'info';
interface ToastItem { id: number; tone: Tone; text: string }
const TONE: Record<Tone, { icon: LucideIcon; cls: string }> = {
  good: { icon: CheckCircle2, cls: 'text-good' },
  bad: { icon: XCircle, cls: 'text-critical' },
  info: { icon: Info, cls: 'text-brand' },
};

const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, tone, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => {
            const { icon: Icon, cls } = TONE[t.tone];
            return (
              <motion.div key={t.id} layout initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 60 }}
                className="pointer-events-auto flex items-start gap-2 rounded-xl bg-white p-3 text-sm shadow-xl ring-1 ring-line">
                <Icon className={cx('mt-0.5 size-4 shrink-0', cls)} />
                <span>{t.text}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/** Run an async action with toast feedback; returns the result (or undefined on failure). */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, success?: (r: T) => string) => {
    setBusy(key);
    try {
      const r = await fn();
      success && toast(success(r), 'good');
      return r;
    } catch (e) {
      toast((e as Error).message, 'bad');
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [toast]);
  return { run, busy };
}
