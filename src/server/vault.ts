// 保存箱（Durable Object）。freee の鍵・掛率の表・単価表・下書きを置く。
// freee の更新用の鍵は1回しか使えないので、更新はここで1本の列に並べる。
import { DurableObject } from "cloudflare:workers";
import { DEFAULT_RATES, isValidRateTable } from "../shared/calc";
import type { Draft, PriceItem, RateTable } from "../shared/types";

export interface Tokens {
  access: string;
  refresh: string;
  /** 期限（ミリ秒）。 */
  expiresAt: number;
}

const REFRESH_BEFORE_MS = 30 * 60 * 1000;
const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

export type CommitGate = { state: "done"; freeeId: number } | { state: "busy" } | { state: "go" } | { state: "missing" };

export class Vault extends DurableObject {
  private refreshing: Promise<string | null> | null = null;

  async setTokens(t: Tokens): Promise<void> {
    await this.ctx.storage.put("tokens", t);
  }

  async clearTokens(): Promise<void> {
    await this.ctx.storage.delete("tokens");
  }

  /** 使える鍵を返す。期限が近ければ更新する。ログインし直しが必要なら null。 */
  async accessToken(clientId: string, clientSecret: string, tokenUrl: string): Promise<string | null> {
    const t = await this.ctx.storage.get<Tokens>("tokens");
    if (!t) return null;
    if (t.expiresAt - Date.now() > REFRESH_BEFORE_MS) return t.access;
    this.refreshing ??= this.refresh(t, clientId, clientSecret, tokenUrl).finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async refresh(t: Tokens, clientId: string, clientSecret: string, tokenUrl: string): Promise<string | null> {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: t.refresh,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 400 || res.status === 401) {
      // 更新用の鍵がもう使えない。まだ今の鍵が生きていればそれを使い、切れていればログインし直してもらう。
      console.log("freee の鍵の更新を断られた", res.status);
      if (t.expiresAt > Date.now() + 60_000) return t.access;
      await this.ctx.storage.delete("tokens");
      return null;
    }
    if (!res.ok) throw new Error(`freee の鍵の更新に失敗しました（${res.status}）`);
    const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!j.access_token || !j.refresh_token) throw new Error("freee の鍵の更新の返事が不正です");
    await this.ctx.storage.put("tokens", {
      access: j.access_token,
      refresh: j.refresh_token,
      expiresAt: Date.now() + (j.expires_in ?? 21600) * 1000,
    } satisfies Tokens);
    return j.access_token;
  }

  /** このツールの中だけで使う合言葉（ログインの印の署名用・AI 用の入口の URL 用）。無ければ作る。 */
  async secrets(): Promise<{ session: string; mcp: string }> {
    let s = await this.ctx.storage.get<{ session: string; mcp: string }>("secrets");
    if (!s) {
      s = { session: randomHex(32), mcp: randomHex(24) };
      await this.ctx.storage.put("secrets", s);
    }
    return s;
  }

  /** AI 用の入口の合言葉を作り直す（古い URL は使えなくなる）。 */
  async rotateMcp(): Promise<string> {
    const s = await this.secrets();
    const next = { ...s, mcp: randomHex(24) };
    await this.ctx.storage.put("secrets", next);
    return next.mcp;
  }

  async getRates(): Promise<RateTable> {
    const r = await this.ctx.storage.get("rates");
    return isValidRateTable(r) ? r : DEFAULT_RATES;
  }

  async setRates(r: RateTable): Promise<void> {
    await this.ctx.storage.put("rates", r);
  }

  async getItems(): Promise<PriceItem[]> {
    return (await this.ctx.storage.get<PriceItem[]>("items")) ?? [];
  }

  async setItems(items: PriceItem[]): Promise<void> {
    await this.ctx.storage.put("items", items);
  }

  /** まだ freee に保存していない下書き。保存済みのものは二重保存を防ぐため7日だけ残し、そのあと片づける。 */
  async listDrafts(): Promise<Draft[]> {
    const m = await this.ctx.storage.list<Draft>({ prefix: "draft:" });
    const old = Date.now() - 7 * 86400_000;
    const stale = [...m.values()].filter((d) => d.freeeId && Date.parse(d.updatedAt) < old).map((d) => `draft:${d.id}`);
    if (stale.length) await this.ctx.storage.delete(stale.slice(0, 100));
    return [...m.values()].filter((d) => !d.freeeId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getDraft(id: string): Promise<Draft | null> {
    return (await this.ctx.storage.get<Draft>(`draft:${id}`)) ?? null;
  }

  async putDraft(d: Draft): Promise<void> {
    const count = (await this.ctx.storage.list({ prefix: "draft:", limit: 501 })).size;
    if (count > 500 && !(await this.ctx.storage.get(`draft:${d.id}`))) throw new Error("下書きが多すぎます（500件まで）。不要な下書きを消してください。");
    await this.ctx.storage.put(`draft:${d.id}`, d);
  }

  async deleteDraft(id: string): Promise<void> {
    await this.ctx.storage.delete([`draft:${id}`, `commit:${id}`]);
  }

  /** freee への保存を始めてよいか。同じ下書きの二重保存を防ぐ。 */
  async beginCommit(id: string): Promise<CommitGate> {
    const d = await this.getDraft(id);
    if (!d) return { state: "missing" };
    if (d.freeeId) return { state: "done", freeeId: d.freeeId };
    const at = await this.ctx.storage.get<number>(`commit:${id}`);
    if (at && Date.now() - at < 60_000) return { state: "busy" };
    await this.ctx.storage.put(`commit:${id}`, Date.now());
    return { state: "go" };
  }

  async endCommit(id: string, freeeId: number | null): Promise<void> {
    await this.ctx.storage.delete(`commit:${id}`);
    if (freeeId == null) return;
    const d = await this.getDraft(id);
    if (d) await this.ctx.storage.put(`draft:${id}`, { ...d, freeeId, updatedAt: new Date().toISOString() });
  }

  async getCache<T>(key: string): Promise<T | null> {
    const c = await this.ctx.storage.get<{ v: T; exp: number }>(`cache:${key}`);
    return c && c.exp > Date.now() ? c.v : null;
  }

  async setCache<T>(key: string, v: T, ttlSec: number): Promise<void> {
    await this.ctx.storage.put(`cache:${key}`, { v, exp: Date.now() + ttlSec * 1000 });
  }
}
