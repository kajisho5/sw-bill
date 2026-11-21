// freee のデータ ⇄ このツールのデータ の変換。外から来たデータは信用せず、ここで形を整える。
import {
  decodeUnit,
  draftLineAmount,
  draftTotals,
  encodeUnit,
  freeeQuantity,
  splitQuantity,
} from "./calc";
import { PREFECTURES } from "./format";
import {
  DRAFT_VERSION,
  type Category,
  type Doc,
  type DocKind,
  type Draft,
  type DraftLine,
  type Line,
  type RateTable,
  type Summary,
  type TaxBucket,
} from "./types";

type J = Record<string, any>;

export const FREEE_PATH: Record<DocKind, string> = {
  invoice: "/invoices",
  quotation: "/quotations",
  delivery_slip: "/delivery_slips",
};
export const FREEE_KEY: Record<DocKind, { one: string; many: string; number: string; date: string; note: string }> = {
  invoice: { one: "invoice", many: "invoices", number: "invoice_number", date: "billing_date", note: "invoice_note" },
  quotation: {
    one: "quotation",
    many: "quotations",
    number: "quotation_number",
    date: "quotation_date",
    note: "quotation_note",
  },
  delivery_slip: {
    one: "delivery_slip",
    many: "delivery_slips",
    number: "delivery_slip_number",
    date: "delivery_slip_date",
    note: "delivery_slip_note",
  },
};

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const lines = (v: unknown) =>
  str(v)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

const zip = (z: string) => {
  const d = z.normalize("NFKC").replace(/[^0-9]/g, "");
  return d.length === 7 ? `〒${d.slice(0, 3)}-${d.slice(3)}` : z ? `〒${z}` : "";
};

/** 見出し行の先頭に自分で付けた印（■▲など）は、紙面の印と二重になるので外す。 */
const stripMarker = (s: string) => s.replace(/^[\s　]*[■□▲△●○◆◇▼▽][\s　]*/, "");

export function dueOf(kind: DocKind, j: J): string | null {
  if (kind === "invoice") return str(j.payment_date) || null;
  if (kind === "quotation") return str(j.expiration_date) || null;
  return null;
}

export function toSummary(kind: DocKind, j: J): Summary {
  const k = FREEE_KEY[kind];
  return {
    kind,
    id: num(j.id),
    number: str(j[k.number]),
    date: str(j[k.date]),
    dueDate: dueOf(kind, j),
    partnerName: str(j.partner_display_name) || str(j.partner_name),
    subject: str(j.subject),
    total: num(j.total_amount),
    sent: j.sending_status === "sent",
    settled: kind === "quotation" ? null : j.payment_status === "settled",
    canceled: j.cancel_status === "canceled",
    freeeUrl: `https://invoice.secure.freee.co.jp/reports/${k.many}/${num(j.id)}`,
  };
}

function toLines(raw: unknown): Line[] {
  const out: Line[] = [];
  for (const l of Array.isArray(raw) ? (raw as J[]) : []) {
    if (l.type === "text") {
      const d = stripMarker(str(l.description)).trim();
      if (d) out.push({ kind: "text", description: d });
      continue;
    }
    const fq = num(l.quantity);
    const u = decodeUnit(str(l.unit));
    const shown = u.rate != null ? splitQuantity(fq, u.rate) : null;
    const split = u.rate != null && shown != null;
    out.push({
      kind: "item",
      description: str(l.description),
      quantity: split ? shown! : fq,
      unit: split ? u.unit : str(l.unit),
      days: split ? u.days : null,
      rate: split ? u.rate : null,
      unitPrice: num(l.unit_price),
      taxRate: num(l.tax_rate),
      reduced: l.reduced_tax_rate === true,
      amount: num(l.amount_excluding_tax),
      salesDate: str(l.sales_date) || null,
    });
  }
  return out;
}

function toBuckets(j: J): TaxBucket[] {
  const defs: [string, number, boolean][] = [
    ["10", 10, false],
    ["8_reduced", 8, true],
    ["8", 8, false],
    ["0", 0, false],
  ];
  const out: TaxBucket[] = [];
  for (const [suffix, rate, reduced] of defs) {
    const excl = j[`amount_excluding_tax_${suffix}`];
    if (excl == null) continue;
    out.push({
      rate,
      reduced,
      excl: num(excl),
      tax: num(j[`amount_tax_${suffix}`]),
      incl: num(j[`amount_including_tax_${suffix}`]),
    });
  }
  return out;
}

export function toDoc(kind: DocKind, j: J): Doc {
  const k = FREEE_KEY[kind];
  const t: J = j.template ?? {};
  const pref = Number.isInteger(j.partner_address_prefecture_code) ? PREFECTURES[j.partner_address_prefecture_code] ?? "" : "";
  const street = [pref + str(j.partner_address_street_name1), str(j.partner_address_street_name2)].filter(Boolean).join("　");
  const desc = lines(t.company_description ?? j.company_description);
  if (desc[0] && /^[0-9０-９\-－ー]+$/.test(desc[0])) desc[0] = zip(desc[0]);
  return {
    kind,
    id: num(j.id) || null,
    number: str(j[k.number]),
    date: str(j[k.date]),
    dueDate: dueOf(kind, j),
    subject: str(j.subject),
    partner: {
      name: str(j.partner_display_name) || str(j.partner_name),
      title: /空白/.test(str(j.partner_title)) ? "" : str(j.partner_title),
      zipcode: zip(str(j.partner_address_zipcode)),
      address: street ? [street] : [],
      department: str(j.partner_contact_department),
      contactName: str(j.partner_contact_name),
    },
    issuer: {
      name: str(t.company_name) || str(j.company_name),
      registrationNumber: str(t.invoice_registration_number),
      description: desc,
      contactName: str(j.company_contact_name),
    },
    lines: toLines(j.lines),
    buckets: toBuckets(j),
    amountExcl: num(j.amount_excluding_tax),
    amountTax: num(j.amount_tax),
    amountWithholding: num(j.amount_withholding_tax),
    total: num(j.total_amount),
    bankAccount: kind === "invoice" ? lines(j.bank_account_to_transfer ?? t.bank_account_to_transfer) : [],
    note: str(j[k.note]),
    message: str(t.message),
    deliveryDeadline: str(j.delivery_deadline),
    deliveryLocation: str(j.delivery_location),
    draft: false,
  };
}

/** 金額のつじつまを確かめる。合わないものがあれば、その説明を返す（空なら問題なし）。 */
export function validateDoc(d: Doc): string[] {
  const p: string[] = [];
  const sumLines = d.lines.reduce((s, l) => (l.kind === "item" ? s + l.amount : s), 0);
  const sumExcl = d.buckets.reduce((s, b) => s + b.excl, 0);
  const sumTax = d.buckets.reduce((s, b) => s + b.tax, 0);
  const sumIncl = d.buckets.reduce((s, b) => s + b.incl, 0);
  if (d.buckets.length === 0) p.push("税率ごとの金額が freee のデータにありません。");
  if (sumLines !== d.amountExcl) p.push(`明細の合計（${sumLines}）と税抜合計（${d.amountExcl}）が合いません。`);
  if (d.buckets.length && sumExcl !== d.amountExcl) p.push(`税率別の対象額の合計（${sumExcl}）と税抜合計（${d.amountExcl}）が合いません。`);
  if (d.buckets.length && sumTax !== d.amountTax) p.push(`税率別の消費税の合計（${sumTax}）と消費税（${d.amountTax}）が合いません。`);
  if (d.buckets.length && sumExcl + sumTax !== sumIncl) p.push("税抜＋消費税が税込の金額と合いません。");
  if (d.buckets.length && sumIncl - d.amountWithholding !== d.total) p.push(`合計（${d.total}）が、税込（${sumIncl}）から源泉徴収（${d.amountWithholding}）を引いた額と合いません。`);
  return p;
}

export interface IssuerProfile {
  templateId: number | null;
  name: string;
  registrationNumber: string;
  description: string[];
  contactName: string;
  bankAccount: string[];
  message: string;
}

export function toIssuerProfile(kind: DocKind, j: J): IssuerProfile {
  const d = toDoc(kind, j);
  return {
    templateId: num(j.template_id) || null,
    name: d.issuer.name,
    registrationNumber: d.issuer.registrationNumber,
    description: d.issuer.description,
    contactName: d.issuer.contactName,
    bankAccount: d.bankAccount,
    message: d.message,
  };
}

export interface PartnerDetail {
  id: number;
  name: string;
  zipcode: string;
  address: string[];
  contactName: string;
}

export function toPartnerDetail(j: J): PartnerDetail {
  const a: J = j.address_attributes ?? {};
  const pref = Number.isInteger(a.prefecture_code) && a.prefecture_code >= 0 ? PREFECTURES[a.prefecture_code] ?? "" : "";
  const street = [pref + str(a.street_name1), str(a.street_name2)].filter(Boolean).join("　");
  return {
    id: num(j.id),
    name: str(j.long_name) || str(j.name),
    zipcode: zip(str(a.zipcode)),
    address: street ? [street] : [],
    contactName: str(j.contact_name),
  };
}

/** 下書きを、プレビュー用の書類データにする。 */
export function draftToDoc(d: Draft, issuer: IssuerProfile | null, partner: PartnerDetail | null): Doc {
  const t = draftTotals(d);
  return {
    kind: d.kind,
    id: null,
    number: "（下書き）",
    date: d.date,
    dueDate: d.kind === "delivery_slip" ? null : d.dueDate,
    subject: d.subject,
    partner: {
      name: partner?.name || d.partnerName,
      title: d.partnerTitle,
      zipcode: partner?.zipcode ?? "",
      address: partner?.address ?? [],
      department: "",
      contactName: partner?.contactName ?? "",
    },
    issuer: {
      name: issuer?.name || "SEVENTHWELL",
      registrationNumber: d.kind === "quotation" ? "" : issuer?.registrationNumber ?? "",
      description: issuer?.description ?? [],
      contactName: issuer?.contactName ?? "",
    },
    lines: d.lines.map((l): Line =>
      l.kind === "text"
        ? { kind: "text", description: l.description }
        : {
            kind: "item",
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            days: l.rate != null ? l.days : null,
            rate: l.rate,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            reduced: false,
            amount: draftLineAmount(l),
            salesDate: null,
          },
    ),
    buckets: t.byRate.map((b) => ({ rate: b.rate, reduced: false, excl: b.excl, tax: b.tax, incl: b.excl + b.tax })),
    amountExcl: t.excl,
    amountTax: t.tax,
    amountWithholding: 0,
    total: t.total,
    bankAccount: d.kind === "invoice" ? issuer?.bankAccount ?? [] : [],
    note: d.note,
    message: issuer?.message ?? "",
    deliveryDeadline: "",
    deliveryLocation: "",
    draft: true,
  };
}

/** 下書きを、freee に保存するときの中身にする。 */
export function draftToFreeeBody(d: Draft, companyId: number, templateId: number | null): J {
  const k = FREEE_KEY[d.kind];
  const body: J = {
    company_id: companyId,
    [k.date]: d.date,
    partner_id: d.partnerId,
    partner_title: d.partnerTitle || "(空白)",
    subject: d.subject,
    tax_entry_method: "out",
    tax_fraction: "omit",
    line_amount_fraction: "omit",
    withholding_tax_entry_method: "out",
    [k.note]: d.note,
    lines: d.lines.map((l) =>
      l.kind === "text"
        ? { type: "text", description: l.description }
        : {
            type: "item",
            description: l.description,
            unit: encodeUnit(l.unit, l.days, l.rate),
            quantity: freeeQuantity(l.quantity, l.rate),
            unit_price: String(l.unitPrice),
            tax_rate: l.taxRate,
            reduced_tax_rate: false,
            withholding: false,
          },
    ),
  };
  if (templateId) body.template_id = templateId;
  if (d.kind === "invoice") {
    body.payment_type = "transfer";
    if (d.dueDate) body.payment_date = d.dueDate;
  }
  if (d.kind === "quotation" && d.dueDate) body.expiration_date = d.dueDate;
  return body;
}

function guessCategory(table: RateTable, days: number | null, rate: number | null): Category {
  if (rate == null) return "none";
  if (days != null && days >= 1 && days <= 5) {
    for (const c of ["A", "B", "C"] as const) if (table[c][days - 1] === rate) return c;
  }
  return "A";
}

/** 既存の書類を下書きにする（複製して別の種類にする・直す、のため）。 */
export function docToDraft(doc: Doc, to: DocKind, partnerId: number | null, table: RateTable, id: string, today: string): Draft {
  const dl: DraftLine[] = doc.lines.map((l) =>
    l.kind === "text"
      ? { kind: "text", description: l.description }
      : {
          kind: "item",
          description: l.description,
          category: guessCategory(table, l.days, l.rate),
          quantity: l.quantity,
          unit: l.unit,
          days: l.days,
          rate: l.rate,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
          priceChecked: true,
        },
  );
  const firstDays = doc.lines.find((l) => l.kind === "item" && l.days != null) as Extract<Line, { kind: "item" }> | undefined;
  return {
    version: DRAFT_VERSION,
    id,
    kind: to,
    partnerId,
    partnerName: doc.partner.name,
    partnerTitle: doc.partner.title || "御中",
    subject: doc.subject,
    date: to === doc.kind ? doc.date : today,
    dueDate: to === doc.kind ? doc.dueDate : null,
    note: doc.note,
    days: firstDays?.days ?? 1,
    lines: dl,
    updatedAt: new Date().toISOString(),
    source: "app",
    freeeId: null,
    editOf: null,
  };
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** 下書きの入力チェック。画面からもAIからも、保存の前に必ず通す。 */
export function checkDraft(d: Draft): string[] {
  const p: string[] = [];
  if (!["invoice", "quotation", "delivery_slip"].includes(d.kind)) p.push("書類の種類が正しくありません。");
  if (!isDate(d.date)) p.push("日付を入れてください。");
  if (d.dueDate != null && !isDate(d.dueDate)) p.push("期限の日付が正しくありません。");
  if (d.subject.length > 255) p.push("件名は255文字までです。");
  if (d.note.length > 4000) p.push("備考は4000文字までです。");
  if (d.lines.length === 0) p.push("明細を1行以上入れてください。");
  if (d.lines.length > 200) p.push("明細は200行までです。");
  if (!d.lines.some((l) => l.kind === "item")) p.push("金額の行を1行以上入れてください。");
  d.lines.forEach((l, i) => {
    const n = i + 1;
    if (!l.description.trim() && l.kind === "text") p.push(`${n}行目：見出しが空です。`);
    if (l.description.length > 255) p.push(`${n}行目：品名は255文字までです。`);
    if (l.kind !== "item") return;
    if (!l.description.trim()) p.push(`${n}行目：品名を入れてください。`);
    if (!(l.quantity > 0) || l.quantity > 99999) p.push(`${n}行目：数量は1以上で入れてください。`);
    if (!Number.isFinite(l.unitPrice) || Math.abs(l.unitPrice) > 999999999) p.push(`${n}行目：単価が正しくありません。`);
    if (l.rate != null && !(l.rate > 0 && l.rate <= 99)) p.push(`${n}行目：掛率が正しくありません。`);
    if (l.category !== "none" && l.rate == null) p.push(`${n}行目：掛率を入れてください（表にない日数です）。`);
    if (l.days != null && !(Number.isInteger(l.days) && l.days >= 1 && l.days <= 999)) p.push(`${n}行目：日数が正しくありません。`);
    if (![0, 8, 10].includes(l.taxRate)) p.push(`${n}行目：税率が正しくありません。`);
    if (encodeUnit(l.unit, l.days, l.rate).length > 255) p.push(`${n}行目：単位が長すぎます。`);
    const fq = freeeQuantity(l.quantity, l.rate);
    if (Math.abs(fq * 1000 - Math.round(fq * 1000)) > 1e-6 || fq > 99999999.999) p.push(`${n}行目：数量×掛率が freee に入れられない桁数です。`);
  });
  return p;
}

/** freee に保存する前のチェック（下書きのチェック＋取引先）。 */
export function checkDraftForCommit(d: Draft): string[] {
  const p = checkDraft(d);
  if (!d.partnerId) p.push("取引先を選んでください。");
  return p;
}
