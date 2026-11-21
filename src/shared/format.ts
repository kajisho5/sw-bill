import type { DocKind } from "./types";

export const yen = (n: number) => n.toLocaleString("ja-JP");

/** 2099-12-31 → 2099.12.31 */
export const dotDate = (d: string | null | undefined) => (d ? d.replaceAll("-", ".") : "");

/** 数量の表示。小数は末尾の0を落とす。 */
export const qty = (n: number) => (Number.isInteger(n) ? yen(n) : String(Math.round(n * 1000) / 1000));

export const esc = (s: unknown) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** 文字の幅の見積もり（全角=1、半角=0.56、空白=0.3）。折り返しと縮小の判断に使う。 */
export function emWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 0x20) w += 0.3;
    else if (c === 0x3000) w += 1;
    else if (c < 0x2000 || (c >= 0xff61 && c <= 0xff9f)) w += 0.56;
    else w += 1;
  }
  return w;
}

/** 幅(em)に収まるように行を分ける。 */
export function wrap(s: string, maxEm: number, maxLines = 3): string[] {
  const out: string[] = [];
  for (const para of String(s ?? "").split(/\r?\n/)) {
    let cur = "";
    let w = 0;
    for (const ch of para) {
      const cw = emWidth(ch);
      if (w + cw > maxEm && cur) {
        out.push(cur);
        cur = "";
        w = 0;
      }
      cur += ch;
      w += cw;
    }
    out.push(cur);
  }
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].slice(0, -1) + "…";
    return kept;
  }
  return out;
}

const KIND_FILE: Record<DocKind, string> = { invoice: "請求書", quotation: "見積書", delivery_slip: "納品書" };

/** 例：請求書_2099-12_ダミー映像企画_0999.pdf */
export function fileName(kind: DocKind, date: string, partnerName: string, number: string): string {
  const partner = partnerName
    .replace(/(株式会社|合同会社|有限会社|\(株\)|（株）)/g, "")
    .replace(/[\\/:*?"<>|\s　]+/g, "")
    .slice(0, 24);
  const tail = (number.match(/(\d{4})$/)?.[1] ?? number.replace(/[^0-9A-Za-z-]/g, "")) || "下書き";
  return `${KIND_FILE[kind]}_${date.slice(0, 7)}_${partner || "取引先"}_${tail}.pdf`;
}

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県",
  "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県",
  "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

/** 月の最初と最後の日。2099-12 → [2099-12-01, 2099-12-31] */
export function monthRange(month: string): [string, string] | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return [`${m[1]}-${m[2]}-01`, `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`];
}

/** 日本時間の今日。 */
export function todayJst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
