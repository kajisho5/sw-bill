// テスト用のデータ。取引先・金額・住所・口座・登録番号はすべて架空。
const base = {
  company_id: 1,
  template_id: 9,
  subject: "SAMPLE EXPO 2099　運営業務",
  sending_status: "unsent",
  payment_status: "unsettled",
  cancel_status: "uncanceled",
  amount_withholding_tax: null,
  partner_id: 77,
  partner_name: "株式会社ダミー映像企画",
  partner_display_name: "株式会社ダミー映像企画",
  partner_title: "御中",
  partner_address_zipcode: "0000000",
  partner_address_prefecture_code: 12,
  partner_address_street_name1: "架空区見本町 1-2-3",
  partner_address_street_name2: "サンプルビル 9F",
  partner_contact_department: "イベント事業部",
  partner_contact_name: "見本 太郎",
  company_contact_name: "見本 花子",
  tax_entry_method: "out",
};
const tmpl = {
  company_name: "SEVENTHWELL",
  company_description: "0000000\n東京都架空市見本町 0-0-0-000",
  invoice_registration_number: "T0000000000000",
  message: "",
};
const text = (description: string) => ({ type: "text", description, unit: "", quantity: null, unit_price: null, tax_rate: null, reduced_tax_rate: false, amount_excluding_tax: null });
const item = (description: string, quantity: number, unit_price: number, unit = "", tax_rate = 10, reduced = false) => ({
  type: "item", description, unit, quantity, unit_price: unit_price.toFixed(1), tax_rate, reduced_tax_rate: reduced, withholding: false,
  amount_excluding_tax: Math.floor(quantity * unit_price),
});
const totals = (lines: any[], extra: Record<string, unknown> = {}) => {
  const ex10 = lines.filter((l) => l.type === "item" && l.tax_rate === 10).reduce((s, l) => s + l.amount_excluding_tax, 0);
  const ex8 = lines.filter((l) => l.type === "item" && l.tax_rate === 8).reduce((s, l) => s + l.amount_excluding_tax, 0);
  const t10 = Math.floor(ex10 * 0.1);
  const t8 = Math.floor(ex8 * 0.08);
  return {
    lines,
    amount_excluding_tax: ex10 + ex8, amount_tax: t10 + t8, amount_including_tax: ex10 + ex8 + t10 + t8, total_amount: ex10 + ex8 + t10 + t8,
    amount_excluding_tax_10: ex10, amount_tax_10: t10, amount_including_tax_10: ex10 + t10,
    amount_excluding_tax_8_reduced: ex8 ? ex8 : null, amount_tax_8_reduced: ex8 ? t8 : null, amount_including_tax_8_reduced: ex8 ? ex8 + t8 : null,
    amount_excluding_tax_8: null, amount_tax_8: null, amount_including_tax_8: null,
    amount_excluding_tax_0: null, amount_tax_0: null, amount_including_tax_0: null,
    ...extra,
  };
};

export const invoice = {
  ...base, id: 999, invoice_number: "INV-0000000999", billing_date: "2099-12-31", payment_date: "2100-01-31", payment_type: "transfer",
  invoice_note: "備考サンプル：freee の備考欄の内容がそのままここに入ります。", template: tmpl,
  bank_account_to_transfer: "サンプル銀行（0000）　見本支店（000）\n普通預金 0000000\nサンプル コウザメイギ\n",
  ...totals([
    text("12/1-4　SAMPLE EXPO 2099"), item("設営費（2名）", 4, 28000), item("本番対応費（2名）", 6, 33000), item("撤去費", 2, 15000),
    text(""), text("■機材費"), item("映像スイッチャー一式", 3, 20000, "日"), item("24型モニター", 4, 3500, "台"),
    text("交通諸経費"), item("見本駅 → 架空駅 → サンプル展示場", 8, 640), item("駐車場代", 1, 2400),
  ]),
};

export const quotationWithRates = {
  ...base, id: 998, quotation_number: "Q-0000000999", quotation_date: "2099-11-20", expiration_date: "2099-12-20",
  partner_name: "見本イベント合同会社", partner_display_name: "見本イベント合同会社", subject: "架空フェス 2099　映像・音響",
  quotation_note: "", delivery_deadline: "2099.12.14", delivery_location: "サンプル展示場 ダミーホール",
  template: { ...tmpl, invoice_registration_number: undefined, message: "下記の通りお見積もり申し上げます。" },
  ...totals([
    text("12/12-14　架空フェス 2099"), item("設営費（2名）", 2, 28000), item("本番対応費（2名）", 6, 33000),
    text("映像機材（料率A）"), item("映像スイッチャー一式", 1.5, 40000, "台・3日・掛率1.5"), item("24型モニター", 3, 10000, "台・3日・掛率1.5"),
    text("音響機材（料率B）"), item("デジタルミキサー", 2.1, 20000, "台・3日・掛率2.1"), item("ワイヤレスマイク", 8.4, 5000, "本・3日・掛率2.1"),
    item("お値引き（機材費 10%）", 1, -17400),
    text("交通諸経費"), item("見本駅 → 架空駅（往復・概算）", 6, 640),
  ]),
};

export const deliverySlip = {
  ...base, id: 997, delivery_slip_number: "DEL-0000000999", delivery_slip_date: "2099-12-14", delivery_slip_note: "依頼No.SAMPLE-0000",
  template: tmpl,
  ...totals([text("12/12-14　架空フェス 2099"), text("▲人件費"), item("設営費", 1, 28000), text("■機材費"), item("映像スイッチャー一式", 1.25, 60000), item("貴社値引き（30%）", 1, -22500)]),
};

const many: any[] = [];
for (let i = 0; i < 9; i++) {
  many.push(text(`12/${i + 1}　サンプル催事 第${i + 1}回`));
  for (const [n, q, p] of [["設営費（2名）", 2, 28000], ["本番対応費（2名）", 4, 33000], ["撤去費", 2, 15000], ["映像スイッチャー一式", 2, 20000], ["見本駅 → 架空駅（往復）", 4, 640]] as const) many.push(item(n, q + (i % 2), p));
}
export const longInvoice = { ...invoice, id: 996, invoice_number: "INV-0000000996", subject: "2099年12月分　運営業務", ...totals(many) };

export const mixedTax = {
  ...invoice, id: 995, invoice_number: "INV-0000000995", subject: "",
  invoice_note: "",
  partner_name: "サンプル・インターナショナル・エンターテインメント・プロダクション株式会社", partner_display_name: "サンプル・インターナショナル・エンターテインメント・プロダクション株式会社",
  ...totals(
    [text("12/20　見本ホール"), item("本番対応費", 1, 33000), item("ケータリング（お弁当）架空亭 特製幕の内 見本御膳 12名さま分 お茶つき", 12, 1200, "食", 8, true)],
    { amount_withholding_tax: 3369 },
  ),
};
mixedTax.total_amount -= 3369;
