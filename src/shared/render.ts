// 書類の紙面（A4縦）。1ページを1枚のSVGとして描く。単位は 0.1mm（2100×2970）。
// プレビューも PDF もこの同じ出力を使うので、見た目がずれない。
import { dotDate, emWidth, esc, qty, wrap, yen } from "./format";
import { GT, GT_CAP } from "./glyphs";
import type { Doc, DocKind, Line } from "./types";

const L = 170;
const R = 1930;
const G = "#6b6b6b";
const HL = "#cfcfcf";
const JP = "'Noto Sans JP','Noto Sans CJK JP','Hiragino Sans','Yu Gothic',sans-serif";
const MONO = "'Space Mono','SFMono-Regular',Menlo,monospace";

const ROW_MAX_Y = 2650;
const PAGE_MAX_Y = 2740;

type Anchor = "start" | "middle" | "end";

function T(
  x: number,
  y: number,
  s: string,
  size: number,
  weight = 400,
  fill = "#000",
  anchor: Anchor = "start",
  font = JP,
  ls = 0,
): string {
  if (!s) return "";
  const a = anchor !== "start" ? ` text-anchor="${anchor}"` : "";
  const l = ls ? ` letter-spacing="${ls}"` : "";
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}"${a}${l}>${esc(s)}</text>`;
}

const rect = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** Goodtimes の文字を輪郭で置く。h は大文字の高さ。戻り値は [svg, 幅]。 */
export function gt(text: string, x: number, y: number, h: number, fill = "#000", ls = 0.14, anchor: Anchor = "start"): [string, number] {
  const s = h / GT_CAP;
  let adv = 0;
  const parts: string[] = [];
  const chars = [...text];
  chars.forEach((ch, i) => {
    if (ch === " ") {
      adv += 400;
      return;
    }
    const g = GT[ch];
    if (!g) return;
    parts.push(`<path transform="translate(${adv},0)" d="${g.d}"/>`);
    adv += g.adv + (i < chars.length - 1 ? ls * 1000 : 0);
  });
  const w = adv * s;
  const ox = x - (anchor === "end" ? w : anchor === "middle" ? w / 2 : 0);
  return [`<g transform="translate(${ox.toFixed(2)},${y}) scale(${s.toFixed(5)})" fill="${fill}">${parts.join("")}</g>`, w];
}

/** 7つの点の輪。7つ目（右上）だけ中が空いた輪。 */
export function ring(cx: number, cy: number, r: number, dot: number, fill = "#000"): string {
  const sw = dot * 0.42;
  let out = "";
  for (let i = 0; i < 7; i++) {
    const a = ((-90 + (i * 360) / 7) * Math.PI) / 180;
    const x = (cx + r * Math.cos(a)).toFixed(2);
    const y = (cy + r * Math.sin(a)).toFixed(2);
    out +=
      i === 1
        ? `<circle cx="${x}" cy="${y}" r="${(dot - sw / 2).toFixed(2)}" fill="none" stroke="${fill}" stroke-width="${sw.toFixed(2)}"/>`
        : `<circle cx="${x}" cy="${y}" r="${dot}" fill="${fill}"/>`;
  }
  return out;
}

interface KindText {
  en: string;
  enH: number;
  ja: string;
  band: string;
  bandSub: string;
  to: [string, string, number];
  numberLabel: string;
  dateLabel: string;
  dueLabel: string;
}

const KIND: Record<DocKind, KindText> = {
  invoice: {
    en: "INVOICE", enH: 84, ja: "請求書", band: "ご請求金額", bandSub: "消費税込み ／ 銀行振込",
    to: ["請求先", "BILL TO", 84], numberLabel: "請求書番号", dateLabel: "請求日", dueLabel: "お支払期限",
  },
  quotation: {
    en: "QUOTATION", enH: 70, ja: "見積書", band: "お見積金額", bandSub: "消費税込み",
    to: ["宛先", "TO", 62], numberLabel: "見積書番号", dateLabel: "見積日", dueLabel: "有効期限",
  },
  delivery_slip: {
    en: "DELIVERY", enH: 84, ja: "納品書", band: "納品金額", bandSub: "消費税込み",
    to: ["宛先", "TO", 62], numberLabel: "納品書番号", dateLabel: "納品日", dueLabel: "",
  },
};

interface Cols {
  rate: boolean;
  qty: number;
  unit: number;
  days: number;
  rateX: number;
  price: number;
  tax: number;
  amt: number;
  descEm: number;
}

const colsFor = (rate: boolean): Cols =>
  rate
    ? { rate, qty: 1130, unit: 1186, days: 1310, rateX: 1440, price: 1660, tax: 0, amt: R - 12, descEm: 30 }
    : { rate, qty: 1300, unit: 1372, days: 0, rateX: 0, price: 1600, tax: 1708, amt: R - 12, descEm: 36 };

interface Row {
  line: Line;
  text: string[];
  h: number;
}

function makeRows(doc: Doc, c: Cols): Row[] {
  return doc.lines.map((line) => {
    const mark = line.kind === "item" && line.reduced ? " ※" : "";
    const text = wrap(line.description + mark, line.kind === "text" ? 60 : c.descEm, 3);
    const base = line.kind === "text" ? 64 : 62;
    return { line, text, h: base + 34 * (text.length - 1) };
  });
}

function tableHead(c: Cols, y: number): string {
  let o = T(L + 12, y, "内容", 22, 500, G) + T(c.qty, y, "数量", 22, 500, G, "end") + T(c.unit, y, "単位", 22, 500, G, "middle");
  if (c.rate) {
    o += T(c.days, y, "日数", 22, 500, G, "end") + T(c.rateX, y, "掛率", 22, 500, G, "end") + T(c.price, y, "単価（1日）", 22, 500, G, "end");
  } else {
    o += T(c.price, y, "単価", 22, 500, G, "end") + T(c.tax, y, "税率", 22, 500, G, "end");
  }
  o += T(c.amt, y, "金額（税抜）", 22, 500, G, "end") + rect(L, y + 18, R - L, 3, "#000");
  return o;
}

function drawRows(rows: Row[], c: Cols, y0: number): [string, number] {
  let o = "";
  let y = y0;
  for (const r of rows) {
    const l = r.line;
    if (l.kind === "text") {
      o += rect(L, y, R - L, r.h, "#f1f1f1") + rect(L + 14, y + 25, 14, 14, "#000");
      r.text.forEach((t, i) => (o += T(L + 44, y + 42 + 34 * i, t, 27, 700)));
    } else {
      r.text.forEach((t, i) => (o += T(L + 44, y + 41 + 34 * i, t, 27, 400)));
      o += T(c.qty, y + 42, qty(l.quantity), 27, 400, "#000", "end", MONO);
      const uw = emWidth(l.unit);
      if (c.rate || uw <= 4) o += T(c.unit, y + 41, l.unit, uw > 2.4 ? 18 : 24, 400, "#222", "middle");
      if (c.rate && l.rate != null) {
        if (l.days != null) o += T(c.days, y + 42, `${l.days}日`, 26, 400, "#000", "end");
        o += T(c.rateX, y + 42, String(l.rate), 27, 700, "#000", "end", MONO);
      }
      o += T(c.price, y + 42, yen(l.unitPrice), 27, 400, "#000", "end", MONO);
      if (!c.rate) o += T(c.tax, y + 42, `${l.taxRate}%`, 24, 400, "#444", "end", MONO);
      o += T(c.amt, y + 42, yen(l.amount), 27, 400, "#000", "end", MONO);
      o += rect(L, y + r.h - 1, R - L, 1.5, HL);
    }
    y += r.h;
  }
  if (rows.length) o += rect(L, y - 1, R - L, 3, "#000");
  return [o, y];
}

function brandTop(): string {
  return ring(L + 36, 206, 30, 7.6) + gt("SEVENTHWELL", L + 92, 222, 32, "#000", 0.2)[0] + T(R, 216, "VIDEO. SOUND. CODE.", 20, 400, G, "end", MONO, 2);
}

function footer(doc: Doc, n: number, total: number): string {
  return (
    rect(L, 2772, R - L, 1.5, "#000") +
    ring(L + 16, 2812, 13, 3.4) +
    gt("SEVENTHWELL", L + 44, 2819, 15, "#000", 0.22)[0] +
    T(R, 2819, `${doc.number}　　${n} / ${total}`, 19, 400, G, "end", doc.draft ? JP : MONO, 1)
  );
}

function partnerNameSize(name: string, title: string): number {
  const titleW = title ? 32 * emWidth(title) + 24 : 0;
  return Math.max(26, Math.min(46, Math.floor((900 - titleW) / Math.max(1, emWidth(name)))));
}

function firstPageHead(doc: Doc): string {
  const k = KIND[doc.kind];
  let o = brandTop();
  const [p, w] = gt(k.en, L, 430, k.enH, "#000", 0.1);
  o += p + T(L + w + 36, 428, k.ja, 46, 700);

  const meta: [string, string, boolean][] = [
    [k.numberLabel, doc.number, false],
    [k.dateLabel, dotDate(doc.date), false],
  ];
  if (k.dueLabel && doc.dueDate) meta.push([k.dueLabel, dotDate(doc.dueDate), true]);
  meta.forEach(([label, value, bold], i) => {
    const y = 350 + (i + 3 - meta.length) * 44;
    o += T(1330, y, label, 22, 400, G) + T(R, y, value, 28, bold ? 700 : 400, "#000", "end", /[^\x20-\x7e]/.test(value) ? JP : MONO);
  });
  o += rect(L, 476, R - L, 6, "#000");

  // 宛先
  o += T(L, 560, k.to[0], 22, 500, G) + T(L + k.to[2], 560, k.to[1], 18, 400, G, "start", MONO, 2);
  const size = partnerNameSize(doc.partner.name, doc.partner.title);
  o += T(L, 642, doc.partner.name, size, 700);
  o += T(L + size * emWidth(doc.partner.name) + 24, 642, doc.partner.title, 32, 400);
  o += rect(L, 668, 900, 2, "#000");
  let y = 718;
  for (const a of [doc.partner.zipcode, ...doc.partner.address.flatMap((s) => wrap(s, 34, 2))].filter(Boolean).slice(0, 3)) {
    o += T(L, y, a, 26, 400, "#222");
    y += 38;
  }
  const who = [doc.partner.department, doc.partner.contactName].filter(Boolean).join("　");
  if (who) o += T(L, y + 12, /様$/.test(who) || !doc.partner.contactName ? who : `${who} 様`, 26, 400, "#222");

  // 発行元
  const fx = 1230;
  o += T(fx, 560, "発行元", 22, 500, G) + T(fx + 84, 560, "FROM", 18, 400, G, "start", MONO, 2);
  o += T(fx, 630, doc.issuer.name, 34, 700, "#000", "start", JP, 1);
  let iy = 680;
  const issuerLines = [...doc.issuer.description.flatMap((s) => wrap(s, 28, 2)).slice(0, 3)];
  if (doc.issuer.contactName) issuerLines.push(`担当　${doc.issuer.contactName}`);
  for (const a of issuerLines) {
    o += T(fx, iy, a, 24, 400, "#222");
    iy += 36;
  }
  if (doc.issuer.registrationNumber) {
    const by = Math.max(772, iy - 14);
    o += `<rect x="${fx}" y="${by}" width="${R - fx}" height="54" fill="none" stroke="#000" stroke-width="2"/>`;
    o += T(fx + 20, by + 36, "登録番号", 22, 500) + T(R - 20, by + 37, doc.issuer.registrationNumber, 28, 700, "#000", "end", MONO, 1);
  }

  // 件名・あいさつ文
  if (doc.subject) o += T(L, 902, "件名", 22, 500, G) + T(L + 84, 904, wrap(doc.subject, doc.message ? 30 : 50, 1)[0], 32, 500);
  if (doc.message) o += T(R, 902, wrap(doc.message, 24, 1)[0], 24, 400, "#222", "end");

  // 金額の帯
  o += rect(L, 944, R - L, 160, "#050505");
  o += T(L + 44, 1018, k.band, 34, 700, "#fff") + T(L + 44, 1062, k.bandSub, 22, 400, "#bdbdbd");
  o += T(R - 44, 1058, `¥${yen(doc.total)}`, 96, 700, "#fff", "end", MONO, -2);
  return o;
}

function contHead(doc: Doc): string {
  const k = KIND[doc.kind];
  const name = `${doc.partner.name}${doc.partner.title ? " " + doc.partner.title : ""}`;
  return (
    brandTop() +
    T(L, 330, k.ja, 30, 700) +
    T(L + 104, 330, "（続き）", 24, 400, G) +
    T(L + 250, 330, wrap(name, 36, 1)[0], 26, 500, "#222") +
    T(R, 331, doc.number, 26, 400, "#000", "end", doc.draft ? JP : MONO) +
    rect(L, 356, R - L, 6, "#000")
  );
}

interface Tail {
  h: number;
  draw: (y: number) => string;
}

function bucketLabel(b: Doc["buckets"][number]): string {
  return `${b.rate}% 対象${b.reduced ? "（軽減）" : ""}`;
}

function makeTail(doc: Doc, c: Cols): Tail {
  const notes: string[] = [];
  if (c.rate) notes.push("掛率はレンタル日数に応じた料率です（金額 ＝ 数量 × 掛率 × 1日の単価）。");
  if (doc.lines.some((l) => l.kind === "item" && l.reduced)) notes.push("※ は軽減税率（8%）の対象です。");
  const fnH = notes.length * 36 + (notes.length ? 4 : 0);
  const nb = Math.max(1, doc.buckets.length);
  const totalRows: [string, string][] = [["小計（税抜）", yen(doc.amountExcl)], ["消費税", yen(doc.amountTax)]];
  if (doc.amountWithholding) totalRows.push(["源泉徴収税", `-${yen(doc.amountWithholding)}`]);
  const boxBottom = 70 + 64 * nb;
  const totalsBottom = 64 * totalRows.length + 60;
  const pyOff = 70 + fnH + Math.max(boxBottom, totalsBottom) + 84;

  const leftLines =
    doc.kind === "invoice"
      ? doc.bankAccount.flatMap((s) => wrap(s, 32, 2)).slice(0, 5)
      : doc.kind === "quotation"
        ? [doc.deliveryDeadline && `納期　　　${doc.deliveryDeadline}`, doc.deliveryLocation && `納品場所　${doc.deliveryLocation}`]
            .filter((s): s is string => !!s)
            .flatMap((s) => wrap(s, 32, 2))
        : [];
  const leftH = leftLines.length ? 94 + 52 * leftLines.length : 0;
  const nx = leftLines.length ? 1110 : L;
  const noteLines = doc.note ? wrap(doc.note, (R - nx) / 24 - 0.5, 8) : [];
  const noteH = noteLines.length ? 104 + 38 * (noteLines.length - 1) + 12 : 0;
  const h = pyOff + Math.max(leftH, noteH);

  const draw = (y: number) => {
    let o = "";
    notes.forEach((n, i) => (o += T(L, y + 40 + 36 * i, n, 21, 400, G)));
    const by = y + 70 + fnH;
    // 税率別内訳
    o += T(L, by, "税率別内訳", 22, 500, G) + rect(L, by + 16, 900, 2, "#000");
    const hx = [L + 12, L + 520, L + 888];
    o += T(hx[0], by + 54, "税率", 21, 400, G) + T(hx[1], by + 54, "対象額（税抜）", 21, 400, G, "end") + T(hx[2], by + 54, "消費税", 21, 400, G, "end");
    o += rect(L, by + 70, 900, 1.5, HL);
    doc.buckets.forEach((b, i) => {
      const yy = by + 70 + 64 * i;
      o += T(hx[0], yy + 42, bucketLabel(b), 26, 500) + T(hx[1], yy + 43, yen(b.excl), 27, 400, "#000", "end", MONO) + T(hx[2], yy + 43, yen(b.tax), 27, 400, "#000", "end", MONO);
      o += rect(L, yy + 64, 900, 1.5, HL);
    });
    // 合計
    const tx = 1330;
    let ty = by;
    totalRows.forEach(([label, value], i) => {
      o += T(tx, ty + 8, label, 25, 400, "#222") + T(R - 12, ty + 9, value, 28, 400, "#000", "end", MONO);
      if (i < totalRows.length - 1) o += rect(tx, ty + 30, R - tx, 1.5, HL);
      ty += 64;
    });
    o += rect(tx, ty - 34, R - tx, 3, "#000");
    o += T(tx, ty + 24, "合計", 32, 700) + T(R - 12, ty + 28, `¥${yen(doc.total)}`, 44, 700, "#000", "end", MONO, -1);
    o += rect(tx, ty + 50, R - tx, 3, "#000") + rect(tx, ty + 58, R - tx, 1.5, "#000");
    // 振込先／納期、備考
    const py = y + pyOff;
    if (leftLines.length) {
      const [ja, en] = doc.kind === "invoice" ? ["お振込先", "PAY TO"] : ["納期・納品場所", "DELIVERY"];
      o += `<rect x="${L}" y="${py}" width="900" height="${leftH}" fill="none" stroke="#000" stroke-width="2"/>`;
      o += rect(L, py, 900, 52, "#050505") + T(L + 24, py + 36, ja, 23, 700, "#fff") + T(L + 876, py + 35, en, 18, 400, "#bdbdbd", "end", MONO, 2);
      leftLines.forEach((s, i) => (o += T(L + 24, py + 108 + 52 * i, s, 26, i === 0 ? 500 : 400, i === 0 ? "#000" : "#222")));
    }
    if (noteLines.length) {
      o += T(nx, py + 30, "備考", 22, 500, G) + T(nx + 62, py + 30, "NOTE", 18, 400, G, "start", MONO, 2) + rect(nx, py + 50, R - nx, 2, "#000");
      noteLines.forEach((s, i) => (o += T(nx, py + 104 + 38 * i, s, 24, 400, "#222")));
    }
    return o;
  };
  return { h, draw };
}

/** ページごとの SVG（中身だけ。svg タグは付けない）を返す。 */
export function renderPages(doc: Doc): string[] {
  const c = colsFor(doc.lines.some((l) => l.kind === "item" && l.rate != null));
  const rows = makeRows(doc, c);
  const tail = makeTail(doc, c);

  // 行をページに分ける。見出し行だけがページの最後に残らないようにする。
  const chunks: Row[][] = [[]];
  let y = 1197;
  for (const r of rows) {
    let cur = chunks[chunks.length - 1];
    if (y + r.h > ROW_MAX_Y && cur.length) {
      const carry: Row[] = [];
      while (cur.length > 1 && cur[cur.length - 1].line.kind === "text") carry.unshift(cur.pop()!);
      cur = [...carry];
      chunks.push(cur);
      y = 451 + carry.reduce((s, x) => s + x.h, 0);
    }
    cur.push(r);
    y += r.h;
  }
  const tailFits = y + tail.h <= PAGE_MAX_Y;
  const total = chunks.length + (tailFits ? 0 : 1);

  const pages: string[] = [];
  chunks.forEach((chunk, i) => {
    let o = rect(0, 0, 2100, 2970, "#fff");
    const headY = i === 0 ? 1176 : 430;
    o += i === 0 ? firstPageHead(doc) : contHead(doc);
    o += tableHead(c, headY);
    const [body, endY] = drawRows(chunk, c, headY + 21);
    o += body;
    const last = i === chunks.length - 1;
    if (last && tailFits) o += tail.draw(endY);
    else o += T(R, endY + 52, "次のページへ続く  →", 22, 500, G, "end");
    o += footer(doc, i + 1, total);
    pages.push(o);
  });
  if (!tailFits) {
    pages.push(rect(0, 0, 2100, 2970, "#fff") + contHead(doc) + tail.draw(380) + footer(doc, total, total));
  }
  return pages;
}

export const pageSvg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2100 2970" role="img">${inner}</svg>`;

/** 印刷・PDF・プレビュー用の HTML 全体。fontBase は Space Mono の置き場所（例：https://…/fonts）。 */
export function renderHtml(doc: Doc, fontBase: string): string {
  const pages = renderPages(doc);
  const face = (w: number) =>
    `@font-face{font-family:'Space Mono';font-weight:${w};font-style:normal;font-display:block;src:url('${esc(fontBase)}/space-mono-latin-${w}-normal.woff2') format('woff2')}`;
  return (
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(KIND[doc.kind].ja)} ${esc(doc.number)}</title><style>${face(400)}${face(700)}` +
    `@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}` +
    `.page{width:210mm;height:297mm;overflow:hidden;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}` +
    `svg{display:block;width:100%;height:100%}` +
    `@media screen{html,body{background:#2a2a2a}.page{width:100vw;height:calc(100vw * 297 / 210);margin:0 0 2vw;background:#fff}.page:last-child{margin-bottom:0}}` +
    `</style></head><body>${pages.map((p) => `<div class="page">${pageSvg(p)}</div>`).join("")}</body></html>`
  );
}

export const pageCount = (doc: Doc) => renderPages(doc).length;
