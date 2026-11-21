// リポを取ってきた AI や人が、サイトを使わずに手元で動かすためのコマンド。
// freee への読み書きはこのコマンドではしない（呼ぶ側が自分の freee 接続で行う）。
//   npm run bill -- pdf  <invoice|quotation|delivery_slip> <freee の書類の JSON> [出力フォルダ]
//   npm run bill -- body <依頼の JSON> [--rates 掛率表.json] [--items 単価表.json] [--company 事業所ID] [--preview 出力フォルダ]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDraftFromAi, sanitizeItems } from "../src/server/drafts";
import { AppError } from "../src/server/freee";
import { DEFAULT_RATES, draftTotals, isValidRateTable } from "../src/shared/calc";
import { checkDraftForCommit, draftToDoc, draftToFreeeBody, FREEE_KEY, FREEE_PATH, toDoc, validateDoc } from "../src/shared/convert";
import { fileName } from "../src/shared/format";
import { renderHtml } from "../src/shared/render";
import type { Doc, DocKind } from "../src/shared/types";

declare const __APP_VERSION__: string;
const KINDS: DocKind[] = ["invoice", "quotation", "delivery_slip"];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const HELP = `SW BILL コマンド（バージョン ${__APP_VERSION__}）

  npm run bill -- pdf <種類> <freee の書類の JSON> [出力フォルダ]
      freee から取った書類（GET /invoices/{id} などの返り値そのまま）を、SEVENTHWELL の紙面の PDF にする。
      種類は invoice / quotation / delivery_slip。金額が freee の数字と合わないときは作らずに終わる。

  npm run bill -- body <依頼の JSON> [--rates 掛率表.json] [--items 単価表.json] [--company 事業所ID] [--preview 出力フォルダ]
      台数・日数・区分から掛率と金額を計算し、freee に POST する中身（JSON）を標準出力に出す。
      依頼の書き方は AGENTS.md を参照。--preview を付けると下書きの紙面も作る。

  JSON のファイル名を - にすると標準入力から読む。失敗すると 0 以外で終わり、理由は標準エラーに出る。`;

class Fail extends Error {}

function readJson(path: string, what: string): any {
  let raw: string;
  try {
    raw = path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
  } catch {
    throw new Fail(`${what}を読めません：${path}`);
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new Fail(`${what}が JSON として読めません：${path}`);
  }
}

function findChrome(): string | null {
  const list = [process.env.CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];
  return list.find((p): p is string => !!p && existsSync(p)) ?? null;
}

/** HTML を書き出し、Chrome があれば PDF にもする。書き出したファイルの場所を返す。 */
async function writePaper(doc: Doc, outDir: string): Promise<{ html: string; pdf: string | null; note: string }> {
  mkdirSync(outDir, { recursive: true });
  const base = fileName(doc.kind, doc.date, doc.partner.name, doc.number || "下書き").replace(/\.pdf$/, "");
  const htmlPath = join(outDir, `${base}.html`);
  const fontBase = pathToFileURL(join(ROOT, "public/fonts")).href;
  writeFileSync(htmlPath, renderHtml(doc, fontBase));
  const chrome = findChrome();
  if (!chrome) return { html: htmlPath, pdf: null, note: "Chrome が見つからないので HTML だけ作りました（CHROME=Chrome の場所 を付けると PDF にします）。" };
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-gpu"], headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 30000 });
    await page.evaluate("document.fonts.ready");
    const pdfPath = join(outDir, `${base}.pdf`);
    writeFileSync(pdfPath, await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
    return { html: htmlPath, pdf: pdfPath, note: "" };
  } finally {
    await browser.close().catch(() => {});
  }
}

function kindOf(s: string | undefined): DocKind {
  if (!KINDS.includes(s as DocKind)) throw new Fail("種類は invoice / quotation / delivery_slip のどれかにしてください。");
  return s as DocKind;
}

async function cmdPdf(args: string[]) {
  const kind = kindOf(args[0]);
  if (!args[1]) throw new Fail("freee の書類の JSON を指定してください。");
  const j = readJson(args[1], "書類の JSON");
  const raw = j?.[FREEE_KEY[kind].one] ?? j;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.lines)) throw new Fail("freee の書類の形ではありません（lines がありません）。GET " + FREEE_PATH[kind] + "/{id} の返り値をそのまま渡してください。");
  const doc = toDoc(kind, raw);
  const problems = validateDoc(doc);
  if (problems.length) throw new Fail("freee の数字と合わないので作りません：\n- " + problems.join("\n- "));
  const out = await writePaper(doc, resolve(args[2] ?? "out"));
  console.log(JSON.stringify({ ok: true, pdf: out.pdf, html: out.html, total: doc.total, note: out.note }, null, 2));
}

async function cmdBody(args: string[]) {
  const opt: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) opt[a.slice(2)] = args[++i] ?? "";
    else rest.push(a);
  }
  if (!rest[0]) throw new Fail("依頼の JSON を指定してください。");
  const input = readJson(rest[0], "依頼の JSON");
  const rates = opt.rates ? readJson(opt.rates, "掛率表") : DEFAULT_RATES;
  if (!isValidRateTable(rates)) throw new Fail("掛率表の形が正しくありません。");
  const items = opt.items ? sanitizeItems(readJson(opt.items, "単価表")) : [];
  const company = Number(opt.company ?? input?.company_id);
  if (!Number.isInteger(company) || company <= 0) throw new Fail("事業所ID を --company か、依頼の company_id で指定してください。");
  const { draft, warnings } = buildDraftFromAi(input, rates, items, null);
  if (typeof input.partner_name === "string" && !draft.partnerName) draft.partnerName = input.partner_name.slice(0, 255);
  const problems = checkDraftForCommit(draft);
  if (problems.length) throw new Fail("このままでは freee に入れられません：\n- " + problems.join("\n- "));
  const totals = draftTotals(draft);
  let preview: Awaited<ReturnType<typeof writePaper>> | null = null;
  if (opt.preview) preview = await writePaper(draftToDoc(draft, null, null), resolve(opt.preview));
  console.log(
    JSON.stringify(
      {
        ok: true,
        post_path: FREEE_PATH[draft.kind],
        freee_body: draftToFreeeBody(draft, company, null),
        totals: { 税抜: totals.excl, 消費税: totals.tax, 合計: totals.total },
        warnings,
        preview: preview ? { pdf: preview.pdf, html: preview.html, note: preview.note } : null,
        next: "freee_body を利用者に見せて確認を取ってから post_path に POST する。保存後、返ってきた書類の JSON を pdf コマンドに渡すと正式な PDF になる。合計が freee の返り値と違ったら利用者に知らせる。",
      },
      null,
      2,
    ),
  );
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") return console.log(HELP);
  if (cmd === "--version") return console.log(__APP_VERSION__);
  if (cmd === "pdf") return cmdPdf(args);
  if (cmd === "body") return cmdBody(args);
  throw new Fail(`知らないコマンドです：${cmd}\n\n${HELP}`);
}

main().catch((e) => {
  if (e instanceof Fail || e instanceof AppError) console.error(e.message);
  else console.error("思わぬ失敗：", e);
  process.exit(1);
});
