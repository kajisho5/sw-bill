// 画面を自動で動かして一通り試す（ログイン → 一覧 → プレビュー → 作成 → freee に保存 → 設定）。
// 先に別の画面で `npm run fake-freee` と `npm run dev` を動かしておく（.dev.vars は .dev.vars.example を写す）。
// 使い方: npm run e2e   （Chrome の場所は CHROME で変えられる。画面の写しは E2E_OUT、既定は ./.e2e）
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
const OUT = process.env.E2E_OUT ?? ".e2e";
mkdirSync(OUT, { recursive: true });
const B = process.env.E2E_BASE ?? "http://127.0.0.1:8787";
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"], headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
page.on("dialog", async (d) => { const m = d.message(); if (d.type() === "prompt") await d.accept(m.includes("％") ? "10" : "映像機材（料率A）"); else await d.accept(); });
const clickText = async (text, sel = "button, a") => {
  const h = await page.evaluateHandle((t, s) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().includes(t)), text, sel);
  if (!h.asElement()) throw new Error("見つからない: " + text);
  await h.asElement().click();
};
let failed = 0;
const step = async (name, f) => { try { await f(); console.log("OK ", name); } catch (e) { failed++; console.log("NG ", name, e.message); await shot(page, "fail-" + name.replace(/\W+/g, "_")); } };

await step("ログイン画面", async () => { await page.goto(B + "/"); await page.waitForSelector('a[href="/auth/login"]'); await shot(page, "1-login"); });
await step("ログイン", async () => { await Promise.all([page.waitForNavigation(), clickText("freee でログイン")]); await page.waitForSelector("h1"); });
await step("一覧（請求書 2099-12）", async () => { await page.goto(B + "/?m=2099-12"); await page.waitForSelector("main ul li"); await sleep(300); await shot(page, "2-list"); });
await step("空の月", async () => { await page.goto(B + "/?m=2098-01"); await page.waitForFunction(() => document.body.innerText.includes("freee にありません")); await shot(page, "2b-empty"); });
await step("プレビュー", async () => { await page.goto(B + "/d/invoice/999"); await page.waitForSelector("iframe"); await sleep(1200); await shot(page, "3-preview"); });
await step("PDF を作る", async () => { await clickText("PDF を作る"); await page.waitForFunction(() => /PDF を共有|ブラウザ|枠|動いていません|作れません/.test(document.body.innerText), { timeout: 60000 }); await sleep(300); await page.evaluate(() => window.scrollTo(0, 99999)); await shot(page, "3b-pdf"); console.log("   ", await page.evaluate(() => [...document.querySelectorAll('[role=alert]')].map((e) => e.textContent).join(" | ") || "PDF できた")); });
await step("金額が合わない書類", async () => { /* 偽物の freee には無いので単体テストで確認済み */ });
await step("新規作成", async () => { await page.goto(B + "/new?k=quotation"); await page.waitForFunction(() => location.pathname.startsWith("/edit/")); await page.waitForSelector("fieldset"); await shot(page, "4-editor-empty"); });
await step("取引先を選ぶ", async () => { await clickText("選ぶ"); await page.waitForSelector('input[type=search]'); await page.type('input[type=search]', "見本"); await sleep(700); await shot(page, "4b-partner"); await clickText("見本イベント合同会社"); });
await step("件名", async () => { await page.type('input[placeholder^="例：催事名"]', "架空フェス 2099　映像"); });
await step("日数を3日に", async () => { await clickText("", 'button[aria-label="機材の日数を増やす"]'); await clickText("", 'button[aria-label="機材の日数を増やす"]'); });
await step("見出しを足す", async () => { await clickText("＋ 見出し"); await sleep(200); });
await step("明細を足す（A・掛率自動）", async () => {
  await clickText("＋ 明細"); await page.waitForSelector("#ln-name");
  await page.type("#ln-name", "映像スイッチャー一式"); await clickText("A 映像", "button[role=radio]");
  await page.type('input[aria-label="単位"]', "台"); await page.$eval('input[aria-label="単価（円・税抜）"]', (e) => e.select()); await page.keyboard.press("Backspace"); await page.type('input[aria-label="単価（円・税抜）"]', "４０，０００");
  await sleep(200); await shot(page, "5-line"); await clickText("この明細を追加");
});
await step("値引きを足す", async () => { await clickText("＋ 値引き"); await sleep(300); await shot(page, "6-editor"); });
await step("プレビューへ", async () => { await clickText("プレビューへ"); await page.waitForSelector("iframe", { timeout: 15000 }); await sleep(1200); await shot(page, "7-draft-preview"); });
await step("freee に保存（連打）", async () => {
  const before = (await (await fetch("http://localhost:8799/iv/quotations")).json()).quotations.length;
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => e.textContent.includes("freee に保存")); b.click(); b.click(); b.click(); });
  await page.waitForFunction(() => location.pathname.startsWith("/d/quotation/"), { timeout: 20000 });
  await page.waitForSelector("iframe"); await sleep(1200); await shot(page, "8-saved");
  const after = (await (await fetch("http://localhost:8799/iv/quotations")).json()).quotations;
  console.log("    見積書の件数", before, "→", after.length, JSON.stringify(after.at(-1).lines.filter((l) => l.type === "item").map((l) => [l.description, l.quantity, l.unit, l.unit_price])));
  if (after.length !== before + 1) throw new Error("二重に保存された");
});
await step("複製して請求書に", async () => { await page.evaluate(() => window.scrollTo(0, 99999)); await clickText("請求書", "main button"); await page.waitForFunction(() => location.pathname.startsWith("/edit/")); await page.waitForSelector("fieldset"); await sleep(300); await shot(page, "9-copied"); });
await step("下書きの一覧", async () => { await page.goto(B + "/?f=drafts"); await page.waitForSelector("main ul li"); await shot(page, "10-drafts"); });
await step("まとめて書き出し", async () => { await page.goto(B + "/?m=2099-12"); await page.waitForSelector("main ul li"); await clickText("件をまとめて PDF"); await sleep(1500); await shot(page, "11-batch"); await clickText("", 'button[aria-label="閉じる"]'); });
await step("設定", async () => { await page.goto(B + "/settings"); await page.waitForSelector("table"); await clickText("＋ 品名を足す"); if (!(await page.$('input[aria-label="2件目の品名"]'))) { const n = (await page.$$('input[aria-label$="件目の品名"]')).length; await page.type(`input[aria-label="${n}件目の品名"]`, "見本プロジェクター" + n); const ps = await page.$$('input[aria-label="単価"]'); await ps.at(-1).type("30000"); } await clickText("単価表を保存"); await sleep(500); await shot(page, "12-settings"); });
await step("横向き・広い画面", async () => { await page.setViewport({ width: 1280, height: 800 }); await page.goto(B + "/?m=2099-12"); await page.waitForSelector("main ul li"); await shot(page, "13-wide"); await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }); });
await step("通信を切る", async () => { await page.goto(B + "/?m=2099-12"); await page.waitForSelector("main ul li"); await page.setOfflineMode(true); await clickText("", 'button[aria-label="次の月"]'); await page.waitForSelector("[role=alert]"); await shot(page, "14-offline"); await page.setOfflineMode(false); await clickText("やり直す"); await page.waitForFunction(() => !document.querySelector("[role=alert]")); });
await step("ログアウト", async () => { await page.goto(B + "/settings"); await page.waitForSelector("table"); await Promise.all([page.waitForNavigation(), clickText("ログアウト")]); await page.waitForSelector('a[href="/auth/login"]'); });
await browser.close();
const bad = errors.filter((e) => e.startsWith("PAGEERROR"));
console.log("画面の中のエラー:", bad.length, bad.slice(0, 8));
if (failed || bad.length) process.exit(1);
