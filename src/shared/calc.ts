// 掛率・金額の計算と、freee の「単位」欄への書き込み方。AI には任せず、ここで決まった計算をする。
import type { Category, Draft, DraftLine, RateTable } from "./types";

/** 株式会社ハーツ 2023 Rental GUIDE と同じ値（1〜5日）。設定画面で直せる。 */
export const DEFAULT_RATES: RateTable = {
  A: [1.0, 1.3, 1.5, 1.7, 1.9],
  B: [1.0, 1.6, 2.1, 2.6, 3.0],
  C: [1.0, 2.0, 3.0, 4.0, 4.5],
};

export const MAX_TABLE_DAYS = 5;

/** 表にある日数なら掛率を返す。区分なし・表にない日数は null（手で入れてもらう）。 */
export function lookupRate(table: RateTable, category: Category, days: number | null): number | null {
  if (category === "none" || days == null) return null;
  if (!Number.isInteger(days) || days < 1 || days > MAX_TABLE_DAYS) return null;
  const v = table[category]?.[days - 1];
  return typeof v === "number" && v > 0 ? v : null;
}

export function isValidRateTable(t: unknown): t is RateTable {
  if (!t || typeof t !== "object") return false;
  return (["A", "B", "C"] as const).every((k) => {
    const row = (t as Record<string, unknown>)[k];
    return (
      Array.isArray(row) &&
      row.length === MAX_TABLE_DAYS &&
      row.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 99)
    );
  });
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** freee の「数量」に入れる値（数量 × 掛率。小数3桁まで）。 */
export function freeeQuantity(quantity: number, rate: number | null): number {
  return round3(quantity * (rate ?? 1));
}

/** 税抜の金額（数量 × 掛率 × 単価、1円未満は切り捨て）。freee の「金額端数：切り捨て」と同じ。 */
export function lineAmount(quantity: number, rate: number | null, unitPrice: number): number {
  const v = Math.round(freeeQuantity(quantity, rate) * unitPrice * 1000) / 1000;
  return v < 0 ? Math.ceil(v) : Math.floor(v);
}

/** freee の「単位」欄に入れる文字。例：「台・3日・掛率1.5」。掛率が無ければ単位だけ。 */
export function encodeUnit(unit: string, days: number | null, rate: number | null): string {
  if (rate == null) return unit;
  const d = days != null ? `${days}日・` : "";
  return `${unit ? unit + "・" : ""}${d}掛率${rate}`;
}

/** 「単位」欄の文字から、単位・日数・掛率を取り出す。約束の形でなければ掛率なしとして扱う。 */
export function decodeUnit(raw: string): { unit: string; days: number | null; rate: number | null } {
  const none = { unit: raw ?? "", days: null, rate: null };
  const parts = (raw ?? "").normalize("NFKC").trim().split("・");
  const rm = parts.pop()?.match(/^掛率(\d{1,2}(?:\.\d{1,3})?)$/);
  if (!rm) return none;
  const rate = Number(rm[1]);
  if (!(rate > 0)) return none;
  let days: number | null = null;
  const dm = parts[parts.length - 1]?.match(/^(\d{1,3})日$/);
  if (dm) {
    days = Number(dm[1]);
    parts.pop();
  }
  return { unit: parts.join("・"), days, rate };
}

/** freee の数量を掛率で割って、紙面に出す数量に戻す。きれいに割り切れなければ null（分けて表示しない）。 */
export function splitQuantity(freeeQty: number, rate: number): number | null {
  const q = freeeQty / rate;
  const r = Math.round(q * 100) / 100;
  if (Math.abs(q - r) > 1e-6) return null;
  return Math.abs(freeeQuantity(r, rate) - freeeQty) < 0.0005 ? r : null;
}

export function draftLineAmount(l: DraftLine): number {
  return l.kind === "item" ? lineAmount(l.quantity, l.rate, l.unitPrice) : 0;
}

export interface Totals {
  excl: number;
  tax: number;
  total: number;
  byRate: { rate: number; excl: number; tax: number }[];
}

/** 下書きの合計。消費税は税率ごとに1回だけ切り捨て（freee の「消費税端数：切り捨て」と同じ）。 */
export function draftTotals(d: Pick<Draft, "lines">): Totals {
  const map = new Map<number, number>();
  for (const l of d.lines) {
    if (l.kind !== "item") continue;
    map.set(l.taxRate, (map.get(l.taxRate) ?? 0) + draftLineAmount(l));
  }
  const byRate = [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, excl]) => ({ rate, excl, tax: Math.floor((excl * rate) / 100) }));
  const excl = byRate.reduce((s, b) => s + b.excl, 0);
  const tax = byRate.reduce((s, b) => s + b.tax, 0);
  return { excl, tax, total: excl + tax, byRate };
}

/** 機材（掛率のある行）の税抜合計。値引きの計算に使う。 */
export function equipmentSubtotal(lines: DraftLine[]): number {
  return lines.reduce((s, l) => (l.kind === "item" && l.rate != null ? s + draftLineAmount(l) : s), 0);
}

/** 「機材費の◯%」の値引き行を作る。 */
export function discountLine(lines: DraftLine[], percent: number): DraftLine {
  const amount = Math.floor((equipmentSubtotal(lines) * percent) / 100);
  return {
    kind: "item",
    description: `お値引き（機材費 ${percent}%）`,
    category: "none",
    quantity: 1,
    unit: "",
    days: null,
    rate: null,
    unitPrice: -amount,
    taxRate: 10,
    priceChecked: true,
  };
}
