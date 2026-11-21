// 下書きの組み立て。画面から来たものもAIから来たものも、ここで形を確かめてから保存する。
import { discountLine, lookupRate } from "../shared/calc";
import { checkDraft } from "../shared/convert";
import { todayJst } from "../shared/format";
import { DRAFT_VERSION, type Category, type DocKind, type Draft, type DraftLine, type PriceItem, type RateTable } from "../shared/types";
import { AppError } from "./freee";
import { randomId } from "./session";

type J = Record<string, any>;

const KINDS: DocKind[] = ["invoice", "quotation", "delivery_slip"];
const CATS: Category[] = ["none", "A", "B", "C"];

const text = (v: unknown, max: number) => (typeof v === "string" ? v.normalize("NFC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max) : "");
const number = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.normalize("NFKC").replaceAll(",", "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const date = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** 画面から届いた下書きを、決まった形に直す（知らない項目は捨てる）。 */
export function sanitizeDraft(input: unknown, base: Draft | null): Draft {
  const j = (input && typeof input === "object" ? input : {}) as J;
  const kind: DocKind = KINDS.includes(j.kind) ? j.kind : base?.kind ?? "quotation";
  const rawLines = Array.isArray(j.lines) ? (j.lines as J[]).slice(0, 300) : [];
  const lines: DraftLine[] = rawLines.map((l): DraftLine => {
    if (l?.kind === "text") return { kind: "text", description: text(l.description, 300) };
    const category: Category = CATS.includes(l?.category) ? l.category : "none";
    const rate = number(l?.rate);
    const days = number(l?.days);
    return {
      kind: "item",
      description: text(l?.description, 300),
      category,
      quantity: number(l?.quantity) ?? 0,
      unit: text(l?.unit, 20),
      days: rate != null && days != null ? Math.round(days) : null,
      rate: rate != null && rate > 0 ? Math.round(rate * 1000) / 1000 : null,
      unitPrice: Math.round(number(l?.unitPrice) ?? 0),
      taxRate: [0, 8, 10].includes(l?.taxRate) ? l.taxRate : 10,
      priceChecked: l?.priceChecked !== false,
    };
  });
  const d: Draft = {
    version: DRAFT_VERSION,
    id: base?.id ?? randomId(9),
    kind,
    partnerId: number(j.partnerId) ? Math.round(number(j.partnerId)!) : null,
    partnerName: text(j.partnerName, 255),
    partnerTitle: ["御中", "様", ""].includes(j.partnerTitle) ? j.partnerTitle : "御中",
    subject: text(j.subject, 300),
    date: date(j.date) ?? base?.date ?? todayJst(),
    dueDate: kind === "delivery_slip" ? null : date(j.dueDate),
    note: text(j.note, 4100),
    days: Math.min(999, Math.max(1, Math.round(number(j.days) ?? base?.days ?? 1))),
    lines,
    updatedAt: new Date().toISOString(),
    source: base?.source ?? "app",
    freeeId: base?.freeeId ?? null,
    editOf: base?.editOf ?? null,
  };
  return d;
}

export interface BuiltDraft {
  draft: Draft;
  warnings: string[];
}

/**
 * AI から届いた依頼を下書きにする。掛率と金額はここで計算し、AI には決めさせない。
 * 単価は単価表を優先する。単価表にない品名は、AI が単価を示したときだけ「未確認」の印を付けて入れる。
 */
export function buildDraftFromAi(input: unknown, rates: RateTable, items: PriceItem[], base: Draft | null): BuiltDraft {
  const j = (input && typeof input === "object" ? input : {}) as J;
  const warnings: string[] = [];
  if (!KINDS.includes(j.kind) && !base) throw new AppError(400, "bad_input", "kind は invoice / quotation / delivery_slip のどれかにしてください。");
  const kind: DocKind = KINDS.includes(j.kind) ? j.kind : base!.kind;
  const defaultDays = Math.min(999, Math.max(1, Math.round(number(j.days) ?? base?.days ?? 1)));
  const price = new Map(items.map((i) => [i.name.normalize("NFKC").trim(), i]));
  const lines: DraftLine[] = [];
  const raw = Array.isArray(j.lines) ? (j.lines as J[]).slice(0, 200) : [];
  if (!raw.length) throw new AppError(400, "bad_input", "lines（明細）を1行以上入れてください。");
  raw.forEach((l, i) => {
    const n = i + 1;
    if (l?.type === "heading") {
      lines.push({ kind: "text", description: text(l.text, 255) });
      return;
    }
    if (l?.type === "discount_percent") {
      const pct = number(l.percent);
      if (pct == null || pct <= 0 || pct > 100) throw new AppError(400, "bad_input", `${n}行目：percent は 0 より大きく 100 以下にしてください。`);
      lines.push(discountLine(lines, pct));
      return;
    }
    if (l?.type !== "item") throw new AppError(400, "bad_input", `${n}行目：type は heading / item / discount_percent のどれかにしてください。`);
    const name = text(l.name, 255).trim();
    if (!name) throw new AppError(400, "bad_input", `${n}行目：name（品名）を入れてください。`);
    const known = price.get(name.normalize("NFKC"));
    const category: Category = CATS.includes(l.category) ? l.category : known?.category ?? "none";
    const days = category === "none" ? null : Math.round(number(l.days) ?? defaultDays);
    let rate = lookupRate(rates, category, days);
    if (category !== "none" && rate == null) {
      const given = number(l.rate);
      if (given == null || given <= 0 || given > 99) throw new AppError(400, "need_rate", `${n}行目「${name}」：${days}日は掛率の表にありません。利用者に掛率を聞いて rate に入れてください。`);
      rate = Math.round(given * 1000) / 1000;
      warnings.push(`${n}行目「${name}」：掛率 ${rate} は表にない値です（${days}日）。`);
    }
    const given = number(l.unit_price);
    let unitPrice: number;
    let priceChecked = true;
    if (known) {
      unitPrice = known.unitPrice;
      if (given != null && Math.round(given) !== known.unitPrice) warnings.push(`${n}行目「${name}」：単価表の ${known.unitPrice} 円を使いました（指定は ${Math.round(given)} 円）。`);
    } else if (given != null) {
      unitPrice = Math.round(given);
      priceChecked = false;
      warnings.push(`${n}行目「${name}」：単価表にない品名です。単価 ${unitPrice} 円は未確認として入れました。`);
    } else {
      throw new AppError(400, "need_price", `${n}行目「${name}」：単価表にない品名です。利用者に単価を聞いて unit_price に入れてください。`);
    }
    lines.push({
      kind: "item",
      description: name,
      category,
      quantity: number(l.quantity) ?? 1,
      unit: text(l.unit, 20) || known?.unit || "",
      days,
      rate,
      unitPrice,
      taxRate: 10,
      priceChecked,
    });
  });
  const draft: Draft = {
    version: DRAFT_VERSION,
    id: base?.id ?? randomId(9),
    kind,
    partnerId: number(j.partner_id) ? Math.round(number(j.partner_id)!) : base?.partnerId ?? null,
    partnerName: text(j.partner_name, 255) || base?.partnerName || "",
    partnerTitle: base?.partnerTitle ?? "御中",
    subject: text(j.subject, 255) || base?.subject || "",
    date: date(j.date) ?? base?.date ?? todayJst(),
    dueDate: kind === "delivery_slip" ? null : date(j.due_date) ?? base?.dueDate ?? null,
    note: typeof j.note === "string" ? text(j.note, 4000) : base?.note ?? "",
    days: defaultDays,
    lines,
    updatedAt: new Date().toISOString(),
    source: "ai",
    freeeId: null,
    editOf: null,
  };
  const problems = checkDraft(draft);
  if (problems.length) throw new AppError(400, "bad_input", problems.join(" "));
  if (!draft.partnerId) warnings.push("取引先がまだ選ばれていません。画面で選んでください。");
  return { draft, warnings };
}

export function sanitizeItems(input: unknown): PriceItem[] {
  if (!Array.isArray(input)) throw new AppError(400, "bad_input", "単価表の形が正しくありません。");
  if (input.length > 500) throw new AppError(400, "bad_input", "単価表は500件までです。");
  const seen = new Set<string>();
  return (input as J[]).map((i, n) => {
    const name = text(i?.name, 255).trim();
    const unitPrice = number(i?.unitPrice);
    if (!name) throw new AppError(400, "bad_input", `${n + 1}件目：品名を入れてください。`);
    if (unitPrice == null || Math.abs(unitPrice) > 999999999) throw new AppError(400, "bad_input", `${n + 1}件目「${name}」：単価が正しくありません。`);
    const key = name.normalize("NFKC");
    if (seen.has(key)) throw new AppError(400, "bad_input", `「${name}」が2回あります。`);
    seen.add(key);
    return { name, category: CATS.includes(i?.category) ? i.category : "none", unit: text(i?.unit, 20), unitPrice: Math.round(unitPrice) };
  });
}
