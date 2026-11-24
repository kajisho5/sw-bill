// 画面・サーバー・紙面で共通に使うデータの形。

export type DocKind = "invoice" | "quotation" | "delivery_slip";
export const DOC_KINDS: DocKind[] = ["invoice", "quotation", "delivery_slip"];

/** 掛率の区分。none は掛率を使わない行（人件費・交通費など）。 */
export type Category = "none" | "A" | "B" | "C";
export const RATE_CATEGORIES = ["A", "B", "C"] as const;

/** 日数(1〜5)ごとの掛率。配列の0番目が1日。 */
export type RateTable = Record<"A" | "B" | "C", number[]>;

export type Line =
  | { kind: "text"; description: string }
  | {
      kind: "item";
      description: string;
      /** 紙面に出す数量（掛率を掛ける前）。 */
      quantity: number;
      unit: string;
      days: number | null;
      rate: number | null;
      unitPrice: number;
      taxRate: number;
      reduced: boolean;
      /** 税抜の金額。freee の数字をそのまま使う。 */
      amount: number;
      salesDate: string | null;
    };

export interface TaxBucket {
  rate: number;
  reduced: boolean;
  excl: number;
  tax: number;
  incl: number;
}

export interface Doc {
  kind: DocKind;
  id: number | null;
  number: string;
  date: string;
  /** 請求書は支払期限、見積書は有効期限。納品書は使わない。 */
  dueDate: string | null;
  subject: string;
  partner: {
    name: string;
    title: string;
    zipcode: string;
    address: string[];
    department: string;
    contactName: string;
  };
  issuer: {
    name: string;
    registrationNumber: string;
    description: string[];
    contactName: string;
  };
  lines: Line[];
  buckets: TaxBucket[];
  amountExcl: number;
  amountTax: number;
  amountWithholding: number;
  total: number;
  bankAccount: string[];
  note: string;
  message: string;
  deliveryDeadline: string;
  deliveryLocation: string;
  /** 下書きのプレビューのとき true（番号がまだ無い）。 */
  draft: boolean;
}

export interface Summary {
  kind: DocKind;
  id: number;
  number: string;
  date: string;
  dueDate: string | null;
  partnerName: string;
  subject: string;
  total: number;
  sent: boolean;
  /** 見積書には入金の状態が無いので null。 */
  settled: boolean | null;
  canceled: boolean;
  freeeUrl: string;
}

export type DraftLine =
  | { kind: "text"; description: string }
  | {
      kind: "item";
      description: string;
      category: Category;
      quantity: number;
      unit: string;
      days: number | null;
      rate: number | null;
      unitPrice: number;
      taxRate: number;
      /** 単価が単価表か人の入力で確かめられているか（AIが入れただけなら false）。 */
      priceChecked: boolean;
    };

export const DRAFT_VERSION = 1;

export interface Draft {
  version: typeof DRAFT_VERSION;
  id: string;
  kind: DocKind;
  partnerId: number | null;
  partnerName: string;
  partnerTitle: string;
  subject: string;
  date: string;
  dueDate: string | null;
  note: string;
  /** 機材の日数の初期値。 */
  days: number;
  lines: DraftLine[];
  updatedAt: string;
  source: "app" | "ai";
  /** freee に保存済みならその番号。二重保存を防ぐ。 */
  freeeId: number | null;
  /** 既存の書類を直す下書きなら、その書類。 */
  editOf: { kind: DocKind; id: number } | null;
}

export interface PriceItem {
  name: string;
  category: Category;
  unit: string;
  unitPrice: number;
}

export interface Partner {
  id: number;
  name: string;
}

export const KIND_LABEL: Record<DocKind, string> = {
  invoice: "請求書",
  quotation: "見積書",
  delivery_slip: "納品書",
};

// ───────── 機材リスト（freee には無い、このツールだけの書類） ─────────

export interface EquipItem {
  /** 機材コード（発注書の番号など。無ければ空）。 */
  code: string;
  name: string;
  /** 型番・仕様。 */
  model: string;
  /** 数量。数えられないもの（会場備品など）は null。 */
  qty: number | null;
  unit: string;
  /** 備考（手配先・共用先など）。 */
  note: string;
}

export interface EquipSection {
  title: string;
  items: EquipItem[];
}

export const EQUIP_VERSION = 1;

export interface EquipDoc {
  version: typeof EQUIP_VERSION;
  id: string;
  /** 案件番号（発注書の番号など。無ければ空）。 */
  docNo: string;
  /** 作成日（YYYY-MM-DD）。 */
  created: string;
  clientName: string;
  /** 部署・担当者などの補足行。 */
  clientLines: string[];
  schedule: { label: string; value: string }[];
  subject: string;
  /** フッターに出す短い件名。 */
  subjectShort: string;
  place: string;
  venueName: string;
  venueSub: string;
  /** 黒帯に出す英字（例：VENUE 01 — MAIN HALL）。 */
  venueEn: string;
  sections: EquipSection[];
  updatedAt: string;
  source: "app" | "ai";
}

/** 機材の総数（qty が入っている行だけ数える）。 */
export const equipTotalQty = (d: EquipDoc): number =>
  d.sections.reduce((a, s) => a + s.items.reduce((b, it) => b + (it.qty ?? 0), 0), 0);

export const equipItemCount = (d: EquipDoc): number => d.sections.reduce((a, s) => a + s.items.length, 0);
