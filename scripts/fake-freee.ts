// 手元の試験用の「偽物の freee」。本物には一切つながない。データはすべて架空（test/fixtures.ts）。
// 使い方: node scripts/fake-freee.ts   （ポート 8799）
import { createServer } from "node:http";
import * as fx from "../test/fixtures.ts";

const PORT = 8799;
const store: Record<string, any[]> = {
  invoices: [fx.invoice, fx.longInvoice, fx.mixedTax, { ...fx.invoice, id: 994, invoice_number: "INV-0000000994", partner_display_name: "サンプル音響株式会社", partner_name: "サンプル音響株式会社", subject: "見本ホール 定例配信", sending_status: "sent", payment_status: "settled" }, { ...fx.invoice, id: 993, invoice_number: "INV-0000000993", cancel_status: "canceled", subject: "取り消した見本" }],
  quotations: [fx.quotationWithRates],
  delivery_slips: [fx.deliverySlip],
};
const one: Record<string, string> = { invoices: "invoice", quotations: "quotation", delivery_slips: "delivery_slip" };
const dateKey: Record<string, string> = { invoices: "billing_date", quotations: "quotation_date", delivery_slips: "delivery_slip_date" };
const numKey: Record<string, [string, string]> = { invoices: ["invoice_number", "INV-"], quotations: ["quotation_number", "Q-"], delivery_slips: ["delivery_slip_number", "DEL-"] };
const partners = [
  { id: 77, name: "見本イベント合同会社", address_attributes: { zipcode: "0000000", prefecture_code: 12, street_name1: "架空区見本町 7-8-9", street_name2: "サンプル館 3F" }, contact_name: "見本 三郎" },
  { id: 78, name: "株式会社ダミー映像企画", address_attributes: { zipcode: "0000000", prefecture_code: 12, street_name1: "架空区見本町 1-2-3" } },
  { id: 79, name: "サンプル音響株式会社", address_attributes: {} },
];
let nextId = 5000;

const send = (res: any, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  let raw = "";
  for await (const c of req) raw += c;
  const p = url.pathname;
  if (p === "/public_api/authorize") {
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", "fake-code");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (p === "/public_api/token") return send(res, 200, { access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 21600 });
  if (p === "/api/1/companies") return send(res, 200, { companies: [{ id: 1 }] });
  if (p === "/api/1/partners") {
    const k = url.searchParams.get("keyword") ?? "";
    return send(res, 200, { partners: partners.filter((x) => x.name.includes(k)) });
  }
  const pm = p.match(/^\/api\/1\/partners\/(\d+)$/);
  if (pm) {
    const hit = partners.find((x) => x.id === Number(pm[1]));
    return hit ? send(res, 200, { partner: hit }) : send(res, 404, {});
  }
  const m = p.match(/^\/iv\/(invoices|quotations|delivery_slips)(?:\/(\d+))?$/);
  if (m) {
    const [, kind, id] = m;
    if (id && req.method === "GET") {
      const hit = store[kind].find((d) => d.id === Number(id));
      return hit ? send(res, 200, { [one[kind]]: hit }) : send(res, 404, {});
    }
    if (!id && req.method === "GET") {
      const from = url.searchParams.get(`start_${dateKey[kind]}`) ?? "0000";
      const to = url.searchParams.get(`end_${dateKey[kind]}`) ?? "9999";
      return send(res, 200, { [kind]: store[kind].filter((d) => d[dateKey[kind]] >= from && d[dateKey[kind]] <= to) });
    }
    if (req.method === "POST" || req.method === "PUT") {
      const b = JSON.parse(raw || "{}");
      if (!b.partner_id) return send(res, 400, { errors: [{ messages: ["取引先を指定してください"] }] });
      const partner = partners.find((x) => x.id === b.partner_id);
      const lines = (b.lines ?? []).map((l: any) => ({ ...l, amount_excluding_tax: l.type === "item" ? Math.trunc(l.quantity * Number(l.unit_price)) : null }));
      const ex = lines.reduce((s: number, l: any) => s + (l.amount_excluding_tax ?? 0), 0);
      const tax = Math.floor(ex * 0.1);
      const doc = {
        ...b, id: id ? Number(id) : nextId++, lines, [numKey[kind][0]]: `${numKey[kind][1]}000000${String(nextId).padStart(4, "0")}`,
        partner_name: partner?.name, partner_display_name: partner?.name, sending_status: "unsent", payment_status: "unsettled", cancel_status: "uncanceled",
        amount_excluding_tax: ex, amount_tax: tax, amount_including_tax: ex + tax, total_amount: ex + tax,
        amount_excluding_tax_10: ex, amount_tax_10: tax, amount_including_tax_10: ex + tax,
        template: { company_name: "SEVENTHWELL", company_description: "0000000\n東京都架空市見本町 0-0-0-000", invoice_registration_number: kind === "quotations" ? undefined : "T0000000000000", message: kind === "quotations" ? "下記の通りお見積もり申し上げます。" : "" },
        bank_account_to_transfer: kind === "invoices" ? "サンプル銀行（0000）　見本支店（000）\n普通預金 0000000\nサンプル コウザメイギ" : undefined,
      };
      store[kind] = id ? store[kind].map((d) => (d.id === Number(id) ? doc : d)) : [...store[kind], doc];
      return send(res, 200, { [one[kind]]: doc });
    }
  }
  send(res, 404, { message: "fake freee: not found" });
}).listen(PORT, () => console.log(`偽物の freee を起動しました: http://localhost:${PORT}`));
