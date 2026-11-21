import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_RATES, decodeUnit, discountLine, draftTotals, encodeUnit, freeeQuantity, isValidRateTable, lineAmount, lookupRate, splitQuantity } from "../src/shared/calc";
import { checkDraft, checkDraftForCommit, docToDraft, draftToDoc, draftToFreeeBody, toDoc, toSummary, validateDoc } from "../src/shared/convert";
import { emWidth, fileName, monthRange, wrap } from "../src/shared/format";
import { pageCount, renderHtml, renderPages } from "../src/shared/render";
import type { Draft, DraftLine } from "../src/shared/types";
import * as fx from "./fixtures";

const item = (o: Partial<Extract<DraftLine, { kind: "item" }>>): DraftLine => ({
  kind: "item", description: "品名", category: "none", quantity: 1, unit: "", days: null, rate: null, unitPrice: 1000, taxRate: 10, priceChecked: true, ...o,
});
const draft = (lines: DraftLine[], o: Partial<Draft> = {}): Draft => ({
  version: 1, id: "d1", kind: "quotation", partnerId: 77, partnerName: "見本イベント合同会社", partnerTitle: "御中", subject: "架空フェス 2099",
  date: "2099-11-20", dueDate: null, note: "", days: 3, lines, updatedAt: "2099-11-20T00:00:00Z", source: "app", freeeId: null, editOf: null, ...o,
});

describe("掛率と金額", () => {
  it("表から掛率を引く（ハーツと同じ値）", () => {
    expect(lookupRate(DEFAULT_RATES, "A", 3)).toBe(1.5);
    expect(lookupRate(DEFAULT_RATES, "B", 4)).toBe(2.6);
    expect(lookupRate(DEFAULT_RATES, "C", 5)).toBe(4.5);
    expect(lookupRate(DEFAULT_RATES, "A", 6)).toBeNull();
    expect(lookupRate(DEFAULT_RATES, "none", 3)).toBeNull();
    expect(lookupRate(DEFAULT_RATES, "A", 0)).toBeNull();
  });
  it("数量×掛率×単価を小数の誤差なく出す", () => {
    expect(lineAmount(1, 1.5, 40000)).toBe(60000);
    expect(lineAmount(4, 2.1, 5000)).toBe(42000);
    expect(lineAmount(3, 2.6, 5000)).toBe(39000);
    expect(lineAmount(9, 1.8, 500)).toBe(8100);
    expect(lineAmount(1, null, -17400)).toBe(-17400);
    expect(freeeQuantity(4, 2.1)).toBe(8.4);
    expect(freeeQuantity(3, 1.3)).toBe(3.9);
  });
  it("単位欄への書き込みと読み取りが往復する", () => {
    expect(encodeUnit("台", 3, 1.5)).toBe("台・3日・掛率1.5");
    expect(decodeUnit("台・3日・掛率1.5")).toEqual({ unit: "台", days: 3, rate: 1.5 });
    expect(decodeUnit(encodeUnit("", 7, 2.25))).toEqual({ unit: "", days: 7, rate: 2.25 });
    expect(decodeUnit(encodeUnit("本", null, 2))).toEqual({ unit: "本", days: null, rate: 2 });
    expect(decodeUnit("台・３日・掛率１.５")).toEqual({ unit: "台", days: 3, rate: 1.5 });
    expect(decodeUnit("日")).toEqual({ unit: "日", days: null, rate: null });
    expect(decodeUnit("")).toEqual({ unit: "", days: null, rate: null });
    expect(encodeUnit("式", null, null)).toBe("式");
  });
  it("freee の数量を掛率で割り戻す。割り切れなければ分けない", () => {
    expect(splitQuantity(8.4, 2.1)).toBe(4);
    expect(splitQuantity(1.5, 1.5)).toBe(1);
    expect(splitQuantity(5, 1.5)).toBeNull();
  });
  it("値引き行と合計", () => {
    const lines = [item({ category: "A", days: 3, rate: 1.5, unitPrice: 40000 }), item({ quantity: 2, category: "A", days: 3, rate: 1.5, unitPrice: 10000 }),
      item({ category: "B", days: 3, rate: 2.1, unitPrice: 20000 }), item({ quantity: 4, category: "B", days: 3, rate: 2.1, unitPrice: 5000 }), item({ quantity: 2, unitPrice: 28000 })];
    const d = discountLine(lines, 10);
    expect(d.kind === "item" && d.unitPrice).toBe(-17400);
    expect(draftTotals({ lines: [...lines, d] })).toMatchObject({ excl: 212600, tax: 21260, total: 233860 });
  });
  it("掛率の表の形を確かめる", () => {
    expect(isValidRateTable(DEFAULT_RATES)).toBe(true);
    expect(isValidRateTable({ A: [1, 2], B: [], C: [] })).toBe(false);
    expect(isValidRateTable({ ...DEFAULT_RATES, A: [1, 1, 1, 1, -1] })).toBe(false);
    expect(isValidRateTable(null)).toBe(false);
  });
});

describe("freee のデータの読み取り", () => {
  it("請求書を読み取り、金額が合う", () => {
    const d = toDoc("invoice", fx.invoice);
    expect(validateDoc(d)).toEqual([]);
    expect(d.total).toBe(463672);
    expect(d.partner.zipcode).toBe("〒000-0000");
    expect(d.partner.address[0]).toContain("東京都架空区");
    expect(d.lines.filter((l) => l.kind === "text").map((l) => l.description)).toEqual(["12/1-4　SAMPLE EXPO 2099", "機材費", "交通諸経費"]);
    expect(d.bankAccount.length).toBe(3);
  });
  it("単位欄の掛率を分けて表示用の数量に戻す", () => {
    const d = toDoc("quotation", fx.quotationWithRates);
    expect(validateDoc(d)).toEqual([]);
    const mic = d.lines.find((l) => l.kind === "item" && l.description === "ワイヤレスマイク");
    expect(mic).toMatchObject({ quantity: 4, unit: "本", days: 3, rate: 2.1, amount: 42000 });
    expect(d.total).toBe(455884);
    expect(d.issuer.registrationNumber).toBe("");
  });
  it("掛け込まれた昔の数量はそのまま出す。見出しの印は外す", () => {
    const d = toDoc("delivery_slip", fx.deliverySlip);
    expect(validateDoc(d)).toEqual([]);
    expect(d.lines.find((l) => l.kind === "item" && l.description === "映像スイッチャー一式")).toMatchObject({ quantity: 1.25, rate: null });
    expect(d.lines.filter((l) => l.kind === "text").map((l) => l.description)).toEqual(["12/12-14　架空フェス 2099", "人件費", "機材費"]);
    expect(d.bankAccount).toEqual([]);
  });
  it("金額が合わないときは理由を返す", () => {
    const bad = { ...fx.invoice, amount_tax: fx.invoice.amount_tax + 1 };
    expect(validateDoc(toDoc("invoice", bad)).length).toBeGreaterThan(0);
    const bad2 = { ...fx.invoice, lines: fx.invoice.lines.slice(0, 3) };
    expect(validateDoc(toDoc("invoice", bad2))[0]).toContain("明細の合計");
  });
  it("軽減税率と源泉徴収が混ざっても合う", () => {
    const d = toDoc("invoice", fx.mixedTax);
    expect(validateDoc(d)).toEqual([]);
    expect(d.buckets.map((b) => [b.rate, b.reduced])).toEqual([[10, false], [8, true]]);
    expect(d.amountWithholding).toBe(3369);
  });
  it("壊れたデータでも落ちない", () => {
    const d = toDoc("invoice", { lines: "x", partner_address_prefecture_code: 99 } as any);
    expect(d.lines).toEqual([]);
    expect(validateDoc(d).length).toBeGreaterThan(0);
    expect(toSummary("quotation", {}).settled).toBeNull();
  });
});

describe("紙面", () => {
  it("1ページに収まる書類は1ページ", () => {
    expect(pageCount(toDoc("invoice", fx.invoice))).toBe(1);
    expect(pageCount(toDoc("quotation", fx.quotationWithRates))).toBe(1);
  });
  it("明細が多いと2ページ以上になり、見出しだけがページの最後に残らない", () => {
    const d = toDoc("invoice", fx.longInvoice);
    const pages = renderPages(d);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages[0]).toContain("次のページへ続く");
    expect(pages[pages.length - 1]).toContain("お振込先");
    expect(pages[1]).toContain("（続き）");
    expect(pages[0]).toContain(`1 / ${pages.length}`);
  });
  it("掛率があるときだけ掛率の列を出す", () => {
    expect(renderPages(toDoc("quotation", fx.quotationWithRates))[0]).toContain("掛率");
    expect(renderPages(toDoc("invoice", fx.invoice))[0]).not.toContain("掛率");
  });
  it("外から来た文字は無害化する", () => {
    const d = toDoc("invoice", { ...fx.invoice, subject: `<script>alert(1)</script>"'&`, partner_display_name: "<img src=x onerror=1>" });
    const html = renderHtml(d, "https://example.invalid/fonts");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
  it("件名・備考が空でも、長い取引先名でも描ける", () => {
    const html = renderHtml(toDoc("invoice", fx.mixedTax), "/fonts");
    expect(html).toContain("源泉徴収税");
    expect(html).toContain("※ は軽減税率");
    expect(html).not.toContain(">件名<");
  });
  it("見本の HTML を書き出す（SAMPLE_OUT を指定したときだけ）", () => {
    const out = process.env.SAMPLE_OUT;
    if (!out) return;
    mkdirSync(out, { recursive: true });
    const set: [string, string, any][] = [["invoice", "invoice", fx.invoice], ["quotation-rates", "quotation", fx.quotationWithRates], ["delivery", "delivery_slip", fx.deliverySlip], ["long", "invoice", fx.longInvoice], ["mixed", "invoice", fx.mixedTax]];
    for (const [name, kind, j] of set) writeFileSync(`${out}/${name}.html`, renderHtml(toDoc(kind as any, j), process.env.SAMPLE_FONTS ?? "/fonts"));
  });
});

describe("下書き", () => {
  const lines: DraftLine[] = [{ kind: "text", description: "映像機材（料率A）" }, item({ description: "映像スイッチャー一式", category: "A", unit: "台", days: 3, rate: 1.5, unitPrice: 40000 })];
  it("freee に保存する中身：数量に掛率を掛け、単位欄に書く", () => {
    const body = draftToFreeeBody(draft(lines, { dueDate: "2099-12-20" }), 1, 9);
    expect(body.lines[1]).toMatchObject({ type: "item", quantity: 1.5, unit: "台・3日・掛率1.5", unit_price: "40000", tax_rate: 10 });
    expect(body).toMatchObject({ company_id: 1, quotation_date: "2099-11-20", expiration_date: "2099-12-20", partner_id: 77, template_id: 9, tax_fraction: "omit" });
    expect(draftToFreeeBody(draft(lines, { kind: "invoice", dueDate: "2100-01-31" }), 1, null)).toMatchObject({ billing_date: "2099-11-20", payment_date: "2100-01-31", payment_type: "transfer" });
  });
  it("保存した中身を読み戻すと、同じ表示になる", () => {
    const d = draft(lines);
    const body = draftToFreeeBody(d, 1, null);
    const back = toDoc("quotation", { ...body, lines: body.lines.map((l: any) => ({ ...l, amount_excluding_tax: l.type === "item" ? 60000 : null })) });
    expect(back.lines[1]).toMatchObject({ quantity: 1, unit: "台", days: 3, rate: 1.5 });
    expect(draftToDoc(d, null, null).total).toBe(66000);
  });
  it("入力チェック", () => {
    expect(checkDraft(draft(lines))).toEqual([]);
    expect(checkDraft(draft([]))[0]).toContain("明細");
    expect(checkDraft(draft([{ kind: "text", description: "見出しだけ" }])).join()).toContain("金額の行");
    expect(checkDraft(draft([item({ quantity: 0 })])).join()).toContain("数量");
    expect(checkDraft(draft([item({ category: "A", days: 9, rate: null })])).join()).toContain("掛率");
    expect(checkDraft(draft(lines, { date: "2099-13-40" })).join()).toContain("日付");
    expect(checkDraft(draft([item({ description: "あ".repeat(300) })])).join()).toContain("255");
    expect(checkDraftForCommit(draft(lines, { partnerId: null })).join()).toContain("取引先");
  });
  it("既存の書類を別の種類の下書きにする", () => {
    const q = toDoc("quotation", fx.quotationWithRates);
    const d = docToDraft(q, "invoice", 77, DEFAULT_RATES, "x", "2099-12-31");
    expect(d.kind).toBe("invoice");
    expect(d.date).toBe("2099-12-31");
    expect(d.lines.find((l) => l.kind === "item" && l.description === "デジタルミキサー")).toMatchObject({ category: "B", rate: 2.1, days: 3, quantity: 1 });
    expect(draftTotals(d).total).toBe(q.total);
    expect(checkDraftForCommit(d)).toEqual([]);
  });
});

describe("表示の補助", () => {
  it("ファイル名", () => {
    expect(fileName("invoice", "2099-12-31", "株式会社ダミー映像企画", "INV-0000000999")).toBe("請求書_2099-12_ダミー映像企画_0999.pdf");
    expect(fileName("quotation", "2099-11-20", "見本 / イベント:合同会社", "（下書き）")).toBe("見積書_2099-11_見本イベント_下書き.pdf");
  });
  it("月の範囲（うるう年・不正な値）", () => {
    expect(monthRange("2096-02")).toEqual(["2096-02-01", "2096-02-29"]);
    expect(monthRange("2099-12")).toEqual(["2099-12-01", "2099-12-31"]);
    expect(monthRange("2099-13")).toBeNull();
    expect(monthRange("x")).toBeNull();
  });
  it("折り返し", () => {
    expect(emWidth("あa ")).toBeCloseTo(1.86);
    expect(wrap("あ".repeat(25), 10, 2)).toEqual(["あ".repeat(10), "あ".repeat(9) + "…"]);
    expect(wrap("", 10)).toEqual([""]);
  });
});
