// 画面の小さな部品。
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { GT, GT_CAP } from "../../shared/glyphs";

export function Ring({ size = 24, className = "" }: { size?: number; className?: string }) {
  const dots = [];
  for (let i = 0; i < 7; i++) {
    const a = ((-90 + (i * 360) / 7) * Math.PI) / 180;
    const x = 50 + 36 * Math.cos(a);
    const y = 50 + 36 * Math.sin(a);
    dots.push(i === 1 ? <circle key={i} cx={x} cy={y} r={7.1} fill="none" stroke="currentColor" strokeWidth={3.8} /> : <circle key={i} cx={x} cy={y} r={9} fill="currentColor" />);
  }
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      {dots}
    </svg>
  );
}

/** Goodtimes の文字（輪郭）。 */
export function Wordmark({ text, height, spacing = 0.24 }: { text: string; height: number; spacing?: number }) {
  let adv = 0;
  const paths = [...text].map((ch, i, all) => {
    if (ch === " ") {
      adv += 400;
      return null;
    }
    const g = GT[ch];
    if (!g) return null;
    const el = <path key={i} transform={`translate(${adv},0)`} d={g.d} />;
    adv += g.adv + (i < all.length - 1 ? spacing * 1000 : 0);
    return el;
  });
  return (
    <svg viewBox={`0 ${-GT_CAP} ${adv} ${GT_CAP}`} height={height} width={(adv * height) / GT_CAP} fill="currentColor" role="img" aria-label={text}>
      {paths}
    </svg>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "line" | "ghost"; busy?: boolean };

export function Btn({ tone = "primary", busy, className = "", children, disabled, ...rest }: BtnProps) {
  const base = "inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] px-4 text-[15px] font-bold transition active:scale-[0.99] disabled:opacity-40";
  const tones = {
    primary: "bg-fg text-bg",
    line: "border border-[#4a4a4a] text-fg font-medium",
    ghost: "text-[#d8d8d8] font-medium",
  };
  return (
    <button type="button" {...rest} disabled={disabled || busy} aria-busy={busy || undefined} className={`${base} ${tones[tone]} ${className}`}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function IconBtn({ label, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} {...rest} className={`grid size-11 shrink-0 place-items-center rounded-full border border-line bg-card text-fg ${rest.className ?? ""}`}>
      {children}
    </button>
  );
}

export const Spinner = () => <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />;

export function Loading({ label = "読み込んでいます" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sub" role="status">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mx-4 my-6 rounded-2xl border border-[#5a2a2a] bg-[#1a0f0f] p-4" role="alert">
      <p className="text-sm leading-6 text-[#ffd6d6]">{message}</p>
      {onRetry && (
        <Btn tone="line" className="mt-3 w-full" onClick={onRetry}>
          やり直す
        </Btn>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-6 py-16 text-center text-sm leading-6 text-sub">{children}</p>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full border border-line bg-card p-[3px]">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={`min-h-9 flex-1 rounded-full px-2 text-[13px] ${v === value ? "bg-fg font-bold text-bg" : "font-medium text-[#d8d8d8]"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, max = 999, suffix = "", label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string; label: string }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className="flex h-10 items-center rounded-full border border-[#3a3a3a]" role="group" aria-label={label}>
      <button type="button" aria-label={`${label}を減らす`} className="grid h-10 w-11 place-items-center text-lg" onClick={() => set(value - 1)} disabled={value <= min}>
        −
      </button>
      <span className="min-w-12 text-center font-mono text-[15px] font-bold" aria-live="polite">
        {value}
        {suffix}
      </span>
      <button type="button" aria-label={`${label}を増やす`} className="grid h-10 w-11 place-items-center text-lg" onClick={() => set(value + 1)} disabled={value >= max}>
        ＋
      </button>
    </div>
  );
}

/** 下から出るシート。 */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={title}>
      <header className="pt-safe flex items-center gap-3 px-4 pb-3">
        <IconBtn label="閉じる" onClick={onClose}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </IconBtn>
        <h2 className="flex-1 pr-11 text-center text-[17px] font-bold">{title}</h2>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-6">{children}</div>
      {footer && <div className="pb-safe border-t border-line bg-[#0b0b0b] px-4 pt-3">{footer}</div>}
    </div>
  );
}

export function useToast(): [ReactNode, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-6" role="status">
      <div className="rounded-full bg-fg px-4 py-2 text-[13px] font-medium text-bg shadow-lg">{msg}</div>
    </div>
  ) : null;
  return [node, setMsg];
}

export const BackIcon = () => (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

/** 日本語の変換を確定する Enter では動かさないための判定。 */
export const isComposing = (e: { nativeEvent: KeyboardEvent; keyCode?: number }) => e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;

/** 数字の欄：全角も受け付けて半角の数にする。 */
export function toNumber(s: string): number | null {
  const t = s.normalize("NFKC").replace(/[,，\s¥円]/g, "");
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
