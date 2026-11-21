// freee との通信。時間切れ・一時的な失敗のやり直し・エラーの言い換えをここでまとめる。
import { FREEE_KEY, FREEE_PATH, toDoc, toIssuerProfile, toPartnerDetail, toSummary, type IssuerProfile, type PartnerDetail } from "../shared/convert";
import { monthRange } from "../shared/format";
import type { Doc, DocKind, Partner, Summary } from "../shared/types";
import type { Vault } from "./vault";

export interface Env {
  ASSETS: Fetcher;
  VAULT: DurableObjectNamespace<Vault>;
  BROWSER: Fetcher;
  COMPANY_ID: string;
  FREEE_CLIENT_ID: string;
  FREEE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  MCP_TOKEN?: string;
}

export const vault = (env: Env) => env.VAULT.get(env.VAULT.idFromName("main"));

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

const IV = "https://api.freee.co.jp/iv";
const AC = "https://api.freee.co.jp";

type J = Record<string, any>;

function freeeMessages(j: unknown): string {
  const out: string[] = [];
  const errs = (j as J)?.errors;
  if (Array.isArray(errs)) for (const e of errs) if (Array.isArray(e?.messages)) out.push(...e.messages.map(String));
  const m = (j as J)?.message;
  if (typeof m === "string") out.push(m);
  return out.join(" ").slice(0, 400);
}

async function call(env: Env, method: "GET" | "POST" | "PUT", url: string, body?: unknown): Promise<J> {
  const token = await vault(env).accessToken(env.FREEE_CLIENT_ID, env.FREEE_CLIENT_SECRET);
  if (!token) throw new AppError(401, "relogin", "freee のログインが切れました。もう一度ログインしてください。");
  const tries = method === "GET" ? 3 : 1;
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      last = e;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      last = new AppError(502, "freee_busy", `freee が混み合っています（${res.status}）。少し待ってからやり直してください。`);
      continue;
    }
    const text = await res.text();
    let j: J = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      throw new AppError(502, "freee_bad", "freee から読めない返事が来ました。");
    }
    if (res.status === 401) throw new AppError(401, "relogin", "freee のログインが切れました。もう一度ログインしてください。");
    if (res.status === 403) throw new AppError(403, "freee_forbidden", `freee の権限が足りません。${freeeMessages(j)}`);
    if (res.status === 404) throw new AppError(404, "not_found", "freee にその書類がありません。");
    if (!res.ok) throw new AppError(422, "freee_rejected", `freee に断られました：${freeeMessages(j) || res.status}`, j);
    return j;
  }
  if (last instanceof AppError) throw last;
  console.log("freee との通信に失敗", String(last));
  throw new AppError(504, "freee_timeout", "freee とつながりませんでした。通信の状態を確かめて、やり直してください。");
}

const cid = (env: Env) => Number(env.COMPANY_ID);
const q = (o: Record<string, string | number>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

const DATE_PARAM: Record<DocKind, string> = { invoice: "billing_date", quotation: "quotation_date", delivery_slip: "delivery_slip_date" };

async function listRaw(env: Env, kind: DocKind, from: string, to: string): Promise<J[]> {
  const k = FREEE_KEY[kind];
  const out: J[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const j = await call(
      env,
      "GET",
      `${IV}${FREEE_PATH[kind]}?${q({ company_id: cid(env), [`start_${DATE_PARAM[kind]}`]: from, [`end_${DATE_PARAM[kind]}`]: to, limit: 100, offset })}`,
    );
    const page = Array.isArray(j[k.many]) ? (j[k.many] as J[]) : [];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

export async function listDocs(env: Env, kind: DocKind, month: string): Promise<Summary[]> {
  const range = monthRange(month);
  if (!range) throw new AppError(400, "bad_month", "月の指定が正しくありません。");
  const k = FREEE_KEY[kind];
  return (await listRaw(env, kind, range[0], range[1]))
    .map((j) => toSummary(kind, j))
    .filter((s) => s.date >= range[0] && s.date <= range[1])
    .sort((a, b) => a.number.localeCompare(b.number) || a.id - b.id)
    .map((s) => ({ ...s, number: s.number || `${k.one} ${s.id}` }));
}

export async function getRaw(env: Env, kind: DocKind, id: number): Promise<J> {
  const j = await call(env, "GET", `${IV}${FREEE_PATH[kind]}/${id}?${q({ company_id: cid(env) })}`);
  const raw = j[FREEE_KEY[kind].one];
  if (!raw || typeof raw !== "object") throw new AppError(502, "freee_bad", "freee から読めない返事が来ました。");
  if (Number(raw.company_id) !== cid(env)) throw new AppError(403, "wrong_company", "別の事業所の書類です。");
  return raw;
}

export const getDoc = async (env: Env, kind: DocKind, id: number): Promise<Doc> => toDoc(kind, await getRaw(env, kind, id));

export async function saveDoc(env: Env, kind: DocKind, body: J, editId: number | null): Promise<J> {
  const url = `${IV}${FREEE_PATH[kind]}${editId ? `/${editId}` : ""}`;
  const j = await call(env, editId ? "PUT" : "POST", url, body);
  const raw = j[FREEE_KEY[kind].one];
  if (!raw?.id) throw new AppError(502, "freee_bad", "freee に保存しましたが、番号を受け取れませんでした。freee で確かめてください。");
  return raw;
}

export async function searchPartners(env: Env, keyword: string): Promise<Partner[]> {
  const params: Record<string, string | number> = { company_id: cid(env), limit: 100 };
  if (keyword) params.keyword = keyword.slice(0, 50);
  const j = await call(env, "GET", `${AC}/api/1/partners?${q(params)}`);
  return (Array.isArray(j.partners) ? (j.partners as J[]) : [])
    .filter((p) => p.available !== false)
    .map((p) => ({ id: Number(p.id), name: String(p.long_name || p.name || "") }))
    .filter((p) => p.id && p.name);
}

export async function getPartner(env: Env, id: number): Promise<PartnerDetail> {
  const j = await call(env, "GET", `${AC}/api/1/partners/${id}?${q({ company_id: cid(env) })}`);
  if (!j.partner) throw new AppError(404, "not_found", "その取引先が freee にありません。");
  return toPartnerDetail(j.partner);
}

/** 発行元の情報（名前・住所・登録番号・振込先・テンプレート）。いちばん新しい同じ種類の書類から取る。 */
export async function issuerProfile(env: Env, kind: DocKind, today: string): Promise<IssuerProfile | null> {
  const v = vault(env);
  const hit = (await v.getCache(`issuer:${kind}`)) as IssuerProfile | null;
  if (hit) return hit;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 400);
  const list = await listRaw(env, kind, d.toISOString().slice(0, 10), today);
  const latest = list.filter((j) => j.cancel_status !== "canceled").sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!latest) return null;
  const p = toIssuerProfile(kind, await getRaw(env, kind, Number(latest.id)));
  await v.setCache(`issuer:${kind}`, p, 6 * 3600);
  return p;
}
