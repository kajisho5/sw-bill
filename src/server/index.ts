// サーバーの入口。画面の配信・ログイン・freee の読み書き・PDF・AI 用の入口を受け持つ。
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { draftTotals, isValidRateTable } from "../shared/calc";
import { checkDraft, checkDraftForCommit, docToDraft, draftToDoc, draftToFreeeBody, toDoc, validateDoc } from "../shared/convert";
import { fileName, todayJst } from "../shared/format";
import { pageCount, renderHtml } from "../shared/render";
import { DOC_KINDS, type DocKind, type Draft } from "../shared/types";
import { sanitizeDraft, sanitizeItems } from "./drafts";
import { AppError, appSecrets, endpoints, tokenUrl, getDoc, getPartner, getRaw, issuerProfile, listDocs, saveDoc, searchPartners, vault, type Env } from "./freee";
import { handleMcp } from "./mcp";
import { htmlToPdf } from "./pdf";
import { makeSession, randomId, readSession, safeEqual, SESSION_DAYS } from "./session";

export { Vault } from "./vault";


type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const kindOf = (c: Ctx): DocKind => {
  const k = c.req.param("kind") as DocKind;
  if (!DOC_KINDS.includes(k)) throw new AppError(404, "not_found", "その種類の書類はありません。");
  return k;
};
const idOf = (c: Ctx): number => {
  const n = Number(c.req.param("id"));
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, "bad_id", "書類の番号が正しくありません。");
  return n;
};
const configured = (env: Env) => !!(env.FREEE_CLIENT_ID && env.FREEE_CLIENT_SECRET);
const cookieOpts = (maxAge: number, secure = true) => ({ httpOnly: true, secure, sameSite: "Lax" as const, path: "/", maxAge });
const isHttps = (c: Ctx) => new URL(c.req.url).protocol === "https:";
const htmlHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src data:",
  "x-content-type-options": "nosniff",
};

app.onError((e, c) => {
  if (e instanceof AppError) return c.json({ error: e.code, message: e.message }, e.status as 400);
  console.log("想定外の失敗", c.req.method, new URL(c.req.url).pathname, String(e));
  return c.json({ error: "internal", message: "サーバーで問題が起きました。少し待ってからやり直してください。" }, 500);
});

// ───────── ログイン ─────────
app.get("/auth/login", async (c) => {
  if (!configured(c.env)) return c.text("まだ設定が終わっていません（freee のアプリ登録）。README を見てください。", 503);
  const state = randomId(18);
  setCookie(c, "st", await makeSession((await appSecrets(c.env)).session, "st", 600, state), cookieOpts(600, isHttps(c)));
  const u = new URL(`${endpoints(c.env).accounts}/public_api/authorize`);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: c.env.FREEE_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
    state,
    prompt: "select_company",
  }).toString();
  return c.redirect(u.toString());
});

app.get("/auth/callback", async (c) => {
  const fail = (reason: string) => c.redirect(`/?login_error=${encodeURIComponent(reason)}`);
  if (!configured(c.env)) return fail("setup");
  const secret = (await appSecrets(c.env)).session;
  const expected = await readSession(secret, "st", getCookie(c, "st"));
  deleteCookie(c, "st", { path: "/" });
  const state = c.req.query("state") ?? "";
  const code = c.req.query("code") ?? "";
  if (!expected || !state || !safeEqual(expected, state)) return fail("state");
  if (!code) return fail("denied");
  let tok: { access_token?: string; refresh_token?: string; expires_in?: number };
  try {
    const res = await fetch(tokenUrl(c.env), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: c.env.FREEE_CLIENT_ID,
        client_secret: c.env.FREEE_CLIENT_SECRET,
        code,
        redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return fail("token");
    tok = await res.json();
  } catch {
    return fail("network");
  }
  if (!tok.access_token || !tok.refresh_token) return fail("token");
  // SEVENTHWELL の事業所に入れる人だけを通す。
  try {
    const res = await fetch(`${endpoints(c.env).api}/api/1/companies`, {
      headers: { authorization: `Bearer ${tok.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    const j = (await res.json()) as { companies?: { id: number }[] };
    if (!res.ok || !j.companies?.some((x) => String(x.id) === String(c.env.COMPANY_ID))) return fail("company");
  } catch {
    return fail("network");
  }
  await vault(c.env).setTokens({ access: tok.access_token, refresh: tok.refresh_token, expiresAt: Date.now() + (tok.expires_in ?? 21600) * 1000 });
  setCookie(c, "s", await makeSession(secret, "s", SESSION_DAYS * 86400), cookieOpts(SESSION_DAYS * 86400, isHttps(c)));
  return c.redirect("/");
});

app.post("/auth/logout", (c) => {
  deleteCookie(c, "s", { path: "/" });
  return c.json({ ok: true });
});

// ───────── AI 用の入口 ─────────
app.all("/mcp/:token", async (c) => {
  const given = c.req.param("token");
  if (given.length < 32 || !safeEqual((await appSecrets(c.env)).mcp, given)) return c.json({ error: "not_found" }, 404);
  if (c.req.method !== "POST") return c.body(null, 405, { allow: "POST" });
  return handleMcp(c.env, c.req.raw);
});

// ───────── ここから下はログインが要る ─────────
app.use("/api/*", async (c, next) => {
  if (!configured(c.env)) throw new AppError(503, "setup", "まだ設定が終わっていません（freee のアプリ登録）。");
  if ((await readSession((await appSecrets(c.env)).session, "s", getCookie(c, "s"))) == null) throw new AppError(401, "login", "ログインしてください。");
  // 画面以外（別のサイトのフォームなど）からの書き込みを通さない。
  if (c.req.method !== "GET" && c.req.header("x-requested-with") !== "sw-bill") throw new AppError(403, "forbidden", "この操作は画面からだけできます。");
  await next();
  c.header("cache-control", "no-store");
});

app.get("/api/me", (c) => c.json({ ok: true, today: todayJst() }));

app.get("/api/docs/:kind", async (c) => c.json({ docs: await listDocs(c.env, kindOf(c), c.req.query("month") ?? "") }));

app.get("/api/docs/:kind/:id", async (c) => {
  const kind = kindOf(c);
  const doc = await getDoc(c.env, kind, idOf(c));
  return c.json({ doc, pages: pageCount(doc), problems: validateDoc(doc), fileName: fileName(kind, doc.date, doc.partner.name, doc.number) });
});

app.get("/api/docs/:kind/:id/html", async (c) => {
  const doc = await getDoc(c.env, kindOf(c), idOf(c));
  return c.body(renderHtml(doc, `${new URL(c.req.url).origin}/fonts`), 200, htmlHeaders);
});

app.get("/api/docs/:kind/:id/pdf", async (c) => {
  const kind = kindOf(c);
  const doc = await getDoc(c.env, kind, idOf(c));
  const problems = validateDoc(doc);
  if (problems.length) throw new AppError(422, "mismatch", `金額が合わないので PDF を作りませんでした。freee で確かめてください。${problems.join(" ")}`);
  const pdf = await htmlToPdf(c.env, renderHtml(doc, `${new URL(c.req.url).origin}/fonts`));
  const name = fileName(kind, doc.date, doc.partner.name, doc.number);
  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
});

app.get("/api/partners", async (c) => c.json({ partners: await searchPartners(c.env, (c.req.query("q") ?? "").trim()) }));

// 掛率の表・単価表
app.get("/api/settings", async (c) => {
  const v = vault(c.env);
  const [rates, items, sec] = await Promise.all([v.getRates(), v.getItems(), appSecrets(c.env)]);
  return c.json({ rates, items, mcpUrl: `${new URL(c.req.url).origin}/mcp/${sec.mcp}` });
});
app.post("/api/mcp-token/rotate", async (c) => {
  if (c.env.MCP_TOKEN && c.env.MCP_TOKEN.length >= 32) throw new AppError(409, "fixed", "合言葉が設定で固定されているので、ここからは作り直せません。");
  return c.json({ mcpUrl: `${new URL(c.req.url).origin}/mcp/${await vault(c.env).rotateMcp()}` });
});
app.put("/api/rates", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!isValidRateTable(body)) throw new AppError(400, "bad_input", "掛率の表が正しくありません（1〜5日、0 より大きい数）。");
  await vault(c.env).setRates({ A: body.A, B: body.B, C: body.C });
  return c.json({ ok: true });
});
app.put("/api/items", async (c) => {
  await vault(c.env).setItems(sanitizeItems(await c.req.json().catch(() => null)));
  return c.json({ ok: true });
});

// 下書き
const loadDraft = async (c: Ctx): Promise<Draft> => {
  const d = await vault(c.env).getDraft(c.req.param("id") ?? "");
  if (!d) throw new AppError(404, "not_found", "その下書きはありません。");
  return d;
};

app.get("/api/drafts", async (c) =>
  c.json({
    drafts: (await vault(c.env).listDrafts()).map((d) => ({
      id: d.id, kind: d.kind, partnerName: d.partnerName, subject: d.subject, date: d.date, total: draftTotals(d).total,
      updatedAt: d.updatedAt, source: d.source, freeeId: d.freeeId,
    })),
  }),
);

app.post("/api/drafts", async (c) => {
  const d = sanitizeDraft(await c.req.json().catch(() => ({})), null);
  await vault(c.env).putDraft(d);
  return c.json({ draft: d });
});

// 既存の書類を複製して下書きにする（to を変えると別の種類になる）。edit=1 なら元の書類を直す下書き。
app.post("/api/drafts/from/:kind/:id", async (c) => {
  const kind = kindOf(c);
  const id = idOf(c);
  const to = (c.req.query("to") ?? kind) as DocKind;
  if (!DOC_KINDS.includes(to)) throw new AppError(400, "bad_input", "書類の種類が正しくありません。");
  const raw = await getRaw(c.env, kind, id);
  const v = vault(c.env);
  const d = docToDraft(toDoc(kind, raw), to, Number(raw.partner_id) || null, await v.getRates(), randomId(9), todayJst());
  if (c.req.query("edit") === "1" && to === kind) d.editOf = { kind, id };
  await v.putDraft(d);
  return c.json({ draft: d });
});

app.get("/api/drafts/:id", async (c) => {
  const d = await loadDraft(c);
  return c.json({ draft: d, problems: checkDraftForCommit(d) });
});

app.put("/api/drafts/:id", async (c) => {
  const base = await loadDraft(c);
  if (base.freeeId) throw new AppError(409, "already_saved", "freee に保存済みの下書きは直せません。");
  const d = sanitizeDraft(await c.req.json().catch(() => ({})), base);
  await vault(c.env).putDraft(d);
  return c.json({ draft: d, problems: checkDraftForCommit(d) });
});

app.delete("/api/drafts/:id", async (c) => {
  await vault(c.env).deleteDraft(c.req.param("id"));
  return c.json({ ok: true });
});

const draftDoc = async (c: Ctx, d: Draft) => {
  const [issuer, partner] = await Promise.all([
    issuerProfile(c.env, d.kind, todayJst()),
    d.partnerId ? getPartner(c.env, d.partnerId).catch(() => null) : Promise.resolve(null),
  ]);
  return { doc: draftToDoc(d, issuer, partner), issuer };
};

app.get("/api/drafts/:id/html", async (c) => {
  const { doc } = await draftDoc(c, await loadDraft(c));
  return c.body(renderHtml(doc, `${new URL(c.req.url).origin}/fonts`), 200, htmlHeaders);
});

app.get("/api/drafts/:id/preview", async (c) => {
  const d = await loadDraft(c);
  const { doc } = await draftDoc(c, d);
  return c.json({ pages: pageCount(doc), problems: checkDraftForCommit(d), total: doc.total });
});

// freee に保存する。プレビューを見た人が押したときだけ呼ばれる。
app.post("/api/drafts/:id/commit", async (c) => {
  const v = vault(c.env);
  const d = await loadDraft(c);
  const problems = checkDraftForCommit(d);
  if (problems.length) throw new AppError(400, "bad_input", problems.join(" "));
  const gate = await v.beginCommit(d.id);
  if (gate.state === "missing") throw new AppError(404, "not_found", "その下書きはありません。");
  if (gate.state === "done") return c.json({ kind: d.editOf?.kind ?? d.kind, id: gate.freeeId, mismatch: null, already: true });
  if (gate.state === "busy") throw new AppError(409, "busy", "いま保存しています。少し待ってください。");
  let savedId: number | null = null;
  try {
    const issuer = await issuerProfile(c.env, d.kind, todayJst());
    const raw = await saveDoc(c.env, d.kind, draftToFreeeBody(d, Number(c.env.COMPANY_ID), issuer?.templateId ?? null), d.editOf?.id ?? null);
    savedId = Number(raw.id);
    const expect = draftTotals(d).total;
    const got = Number(raw.total_amount);
    return c.json({ kind: d.kind, id: savedId, mismatch: got === expect ? null : { tool: expect, freee: got }, already: false });
  } finally {
    await v.endCommit(d.id, savedId);
  }
});

app.all("/api/*", (c) => c.json({ error: "not_found", message: "その入口はありません。" }, 404));

export default app;
