// 機材リストの紙面（A4縦・2100×2970）。請求書と同じデザインの組み方で描く。
// freee には無い書類なので、金額の照合はなく、総数は数量の合計をそのまま出す。
import { dotDate, esc, qty as qtyText, wrap } from "./format";
import { gt, pageSvg, ring } from "./render";
import { equipItemCount, equipTotalQty, type EquipDoc } from "./types";

const L = 170;
const R = 1930;
const G = "#6b6b6b";
const HL = "#cfcfcf";
const JP = "'Noto Sans JP','Noto Sans CJK JP','Hiragino Sans','Yu Gothic',sans-serif";
const MONO = "'Space Mono','SFMono-Regular',Menlo,monospace";
const ROW_MAX_Y = 2650;

type Anchor = "start" | "middle" | "end";

function T(x: number, y: number, s: string, size: number, weight = 400, fill = "#000", anchor: Anchor = "start", font = JP, ls = 0): string {
  if (!s) return "";
  const a = anchor !== "start" ? ` text-anchor="${anchor}"` : "";
  const l = ls ? ` letter-spacing="${ls}"` : "";
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}"${a}${l}>${esc(s)}</text>`;
}

const rect = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

function brandTop(): string {
  return ring(L + 36, 206, 30, 7.6) + gt("SEVENTHWELL", L + 92, 222, 32, "#000", 0.2)[0] + T(R, 216, "VIDEO. SOUND. CODE.", 20, 400, G, "end", MONO, 2);
}

function footer(doc: EquipDoc, n: number, total: number): string {
  const id = doc.docNo || doc.subjectShort;
  return (
    rect(L, 2772, R - L, 1.5, "#000") +
    ring(L + 16, 2812, 13, 3.4) +
    gt("SEVENTHWELL", L + 44, 2819, 15, "#000", 0.22)[0] +
    T(1050, 2819, doc.subjectShort, 19, 400, G, "middle") +
    T(R, 2819, `${id}　　${n} / ${total}`, 19, 400, G, "end", /[^\x20-\x7e]/.test(id) ? JP : MONO, 1)
  );
}

// 表の列（左端からの位置）
const COL = { code: 182, name: 300, model: 1020, qtyEnd: 1430, unitCx: 1485, note: 1560, checkCx: 1900 };

function tableHead(y: number): string {
  return (
    T(COL.code, y, "コード", 22, 500, G) +
    T(COL.name, y, "機材名", 22, 500, G) +
    T(COL.model, y, "型番・仕様", 22, 500, G) +
    T(COL.qtyEnd, y, "数量", 22, 500, G, "end") +
    T(COL.unitCx, y, "単位", 22, 500, G, "middle") +
    T(COL.note, y, "備考", 22, 500, G) +
    T(COL.checkCx, y, "確認", 22, 500, G, "middle") +
    rect(L, y + 18, R - L, 3, "#000")
  );
}

interface Row {
  section: boolean;
  title?: string;
  item?: EquipDoc["sections"][number]["items"][number];
  nameLines: string[];
  h: number;
}

const SEC_H = 62;
const ROW_H = 58;

function makeRows(doc: EquipDoc): Row[] {
  const rows: Row[] = [];
  for (const sec of doc.sections) {
    rows.push({ section: true, title: sec.title, nameLines: [], h: SEC_H });
    for (const it of sec.items) {
      const nameLines = wrap(it.name, 26, 2);
      rows.push({ section: false, item: it, nameLines, h: ROW_H + 30 * (nameLines.length - 1) });
    }
  }
  return rows;
}

function drawRow(r: Row, y: number): string {
  if (r.section) {
    return rect(L, y, R - L, SEC_H, "#f1f1f1") + rect(L + 14, y + SEC_H / 2 - 7, 14, 14, "#000") + T(L + 44, y + SEC_H / 2 + 9, r.title ?? "", 25, 700);
  }
  const it = r.item!;
  const cy = y + r.h / 2;
  let o = "";
  o += T(COL.code, cy + 8, it.code, 21, 400, "#444", "start", MONO);
  r.nameLines.forEach((t, i) => {
    o += T(COL.name, cy + 9 + 30 * (i - (r.nameLines.length - 1) / 2), t, 25);
  });
  const model = wrap(it.model, 30, 1)[0] ?? "";
  o += T(COL.model, cy + 8, model, /[^\x00-\x7F]/.test(model) ? 22 : 21, 400, "#222", "start", /[^\x00-\x7F]/.test(model) ? JP : MONO);
  o += T(COL.qtyEnd, cy + 9, it.qty == null ? "" : qtyText(it.qty), 25, 400, "#000", "end", MONO);
  o += T(COL.unitCx, cy + 8, it.unit, 22, 400, "#222", "middle");
  o += T(COL.note, cy + 8, wrap(it.note, 15, 1)[0] ?? "", 21, 400, "#222");
  o += `<rect x="${COL.checkCx - 13}" y="${cy - 13}" width="26" height="26" fill="none" stroke="#444" stroke-width="2"/>`;
  o += rect(L, y + r.h, R - L, 1.5, HL);
  return o;
}

function firstPageHead(doc: EquipDoc): string {
  let o = brandTop();
  // 題字。横幅が収まるよう、大きさを調整する。
  let h = 69;
  let [title, w] = gt("EQUIPMENT LIST", L, 430, h, "#000", 0.1);
  if (w > 1180) {
    h = Math.floor((h * 1180) / w);
    [title, w] = gt("EQUIPMENT LIST", L, 430, h, "#000", 0.1);
  }
  o += title + T(L + w + 36, 428, "機材リスト", 46, 700);

  const meta: [string, string, number][] = [["作成日", dotDate(doc.created), 26]];
  if (doc.docNo) meta.push(["案件番号", doc.docNo, 22]);
  meta.forEach(([label, value, size], i) => {
    o += T(1620, 350 + i * 44, label, 22, 400, G) + T(R, 350 + i * 44, value, size, 400, "#000", "end", MONO);
  });
  o += rect(L, 476, R - L, 6, "#000");

  // 発注元
  o += T(L, 560, "発注元", 22, 500, G) + T(L + 112, 560, "CLIENT", 18, 400, G, "start", MONO, 2);
  o += T(L, 640, wrap(doc.clientName, 22, 1)[0] ?? "", 40, 700);
  o += rect(L, 664, 900, 2, "#000");
  doc.clientLines.slice(0, 3).forEach((ln, i) => (o += T(L, 716 + i * 38, ln, 25, 400, "#222")));

  // 日程
  o += T(1230, 560, "日程", 22, 500, G) + T(1314, 560, "SCHEDULE", 18, 400, G, "start", MONO, 2);
  doc.schedule.slice(0, 4).forEach((r, i) => {
    o += T(1230, 632 + i * 46, r.label, 24, 700) + T(1340, 632 + i * 46, wrap(r.value, 24, 1)[0] ?? "", 24, 400, "#222");
  });

  // 件名・場所
  o += T(L, 886, "件名", 22, 500, G) + T(L + 112, 886, "SUBJECT", 18, 400, G, "start", MONO, 2);
  o += T(430, 888, wrap(doc.subject, 50, 1)[0] ?? "", 30, 500);
  o += T(L, 942, "場所", 22, 500, G) + T(L + 112, 942, "VENUE", 18, 400, G, "start", MONO, 2);
  o += T(430, 944, wrap(doc.place, 40, 1)[0] ?? "", 26);

  // 黒帯（会場名と総数）
  const totalQty = equipTotalQty(doc);
  const count = equipItemCount(doc);
  o += rect(L, 990, R - L, 150, "#050505");
  o += T(L + 44, 1064, [doc.venueName, doc.venueSub].filter(Boolean).join("　"), 36, 700, "#fff");
  o += T(L + 44, 1108, doc.venueEn, 22, 400, "#bdbdbd", "start", MONO, 1);
  if (totalQty > 0) {
    o += T(1826, 1092, String(totalQty), 96, 700, "#fff", "end", MONO, -2) + T(1836, 1092, "点", 44, 700, "#fff");
  } else if (count > 0) {
    o += T(1826, 1092, String(count), 96, 700, "#fff", "end", MONO, -2) + T(1836, 1092, "件", 44, 700, "#fff");
  }
  return o;
}

function contHead(doc: EquipDoc): string {
  return (
    brandTop() +
    T(L, 330, "機材リスト", 30, 700) +
    T(L + 158, 330, "（続き）", 24, 400, G) +
    T(L + 290, 330, wrap([doc.venueName, doc.venueSub].filter(Boolean).join("　"), 30, 1)[0] ?? "", 26, 500, "#222") +
    T(R, 331, doc.docNo, 26, 400, "#000", "end", MONO) +
    rect(L, 356, R - L, 6, "#000")
  );
}

/** ページごとの SVG（中身だけ）を返す。 */
export function renderEquipPages(doc: EquipDoc): string[] {
  const rows = makeRows(doc);
  const chunks: Row[][] = [[]];
  let y = 1234;
  for (const r of rows) {
    let cur = chunks[chunks.length - 1];
    if (y + r.h > ROW_MAX_Y && cur.length) {
      const carry: Row[] = [];
      while (cur.length > 1 && cur[cur.length - 1].section) carry.unshift(cur.pop()!);
      cur = [...carry];
      chunks.push(cur);
      y = 451 + carry.reduce((s, x) => s + x.h, 0);
    }
    cur.push(r);
    y += r.h;
  }
  const total = chunks.length;
  return chunks.map((chunk, i) => {
    let o = rect(0, 0, 2100, 2970, "#fff");
    o += i === 0 ? firstPageHead(doc) : contHead(doc);
    const headY = i === 0 ? 1216 : 430;
    o += tableHead(headY);
    let yy = headY + 18;
    for (const r of chunk) {
      o += drawRow(r, yy);
      yy += r.h;
    }
    if (chunk.length) o += rect(L, yy, R - L, 3, "#000");
    if (i < total - 1) o += T(R, yy + 52, "次のページへ続く  →", 22, 500, G, "end");
    o += footer(doc, i + 1, total);
    return o;
  });
}

export const equipPageCount = (doc: EquipDoc) => renderEquipPages(doc).length;

/** 印刷・PDF・プレビュー用の HTML 全体。 */
export function renderEquipHtml(doc: EquipDoc, fontBase: string): string {
  const pages = renderEquipPages(doc);
  const face = (w: number) =>
    `@font-face{font-family:'Space Mono';font-weight:${w};font-style:normal;font-display:block;src:url('${esc(fontBase)}/space-mono-latin-${w}-normal.woff2') format('woff2')}`;
  return (
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>機材リスト ${esc(doc.subjectShort || doc.docNo)}</title><style>${face(400)}${face(700)}` +
    `@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}` +
    `.page{width:210mm;height:297mm;overflow:hidden;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}` +
    `svg{display:block;width:100%;height:100%}` +
    `@media screen{html,body{background:#2a2a2a}.page{width:100vw;height:calc(100vw * 297 / 210);margin:0 0 2vw;background:#fff}.page:last-child{margin-bottom:0}}` +
    `</style></head><body>${pages.map((p) => `<div class="page">${pageSvg(p)}</div>`).join("")}</body></html>`
  );
}

/** 例：機材リスト_2099-12_第1会場メインホール.pdf */
export function equipFileName(doc: EquipDoc): string {
  const venue = [doc.venueName, doc.venueSub].filter(Boolean).join("").replace(/[\\/:*?"<>|\s　]+/g, "").slice(0, 24);
  const subject = (doc.subjectShort || doc.subject).replace(/[\\/:*?"<>|\s　]+/g, "").slice(0, 24);
  return `機材リスト_${doc.created.slice(0, 7)}_${venue || subject || "無題"}.pdf`;
}
