// HTML を PDF にする（Cloudflare のサーバー側ブラウザ）。
// 無料枠では新しいブラウザを20秒に1回しか起こせないので、動いているものがあれば使い回す。
import puppeteer, { type Browser } from "@cloudflare/puppeteer";
import { AppError, type Env } from "./freee";

async function openBrowser(env: Env): Promise<Browser> {
  try {
    const sessions = await puppeteer.sessions(env.BROWSER as any);
    for (const s of sessions) {
      if (s.connectionId) continue;
      try {
        return await puppeteer.connect(env.BROWSER as any, s.sessionId);
      } catch {
        // ほかの依頼に先に取られた。次を試す。
      }
    }
  } catch (e) {
    console.log("動いているブラウザの確認に失敗", String(e));
  }
  return puppeteer.launch(env.BROWSER as any, { keep_alive: 60_000 });
}

export async function htmlToPdf(env: Env, html: string): Promise<ArrayBuffer> {
  let browser: Browser;
  try {
    browser = await openBrowser(env);
  } catch (e) {
    const msg = String(e);
    console.log("ブラウザを起こせなかった", msg);
    if (/429|limit/i.test(msg)) throw new AppError(429, "pdf_busy", "PDF を作る枠がいっぱいです。20秒ほど待ってからやり直してください。");
    throw new AppError(503, "pdf_down", "PDF を作る機能が動いていません。少し待ってからやり直してください。");
  }
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "load", timeout: 20000 });
      await page.evaluate("document.fonts.ready");
      const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
      return new Uint8Array(pdf).slice().buffer;
    } finally {
      await page.close().catch(() => {});
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.log("PDF の作成に失敗", String(e));
    throw new AppError(500, "pdf_failed", "PDF を作れませんでした。やり直してください。");
  } finally {
    // 閉じずに離すだけにして、次の依頼で使い回せるようにする。
    await Promise.resolve(browser.disconnect()).catch(() => {});
  }
}
