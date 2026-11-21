// ログイン済みの印（署名つきクッキー）。中身は期限だけで、秘密は入れない。
const enc = new TextEncoder();

const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** 時間差で中身が漏れない比べ方。 */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const SESSION_DAYS = 30;

export async function makeSession(secret: string, purpose: "s" | "st", ttlSec: number, extra = ""): Promise<string> {
  const payload = `${purpose}.${Math.floor(Date.now() / 1000) + ttlSec}.${extra}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

/** 正しい印なら、付けておいた値（extra）を返す。だめなら null。 */
export async function readSession(secret: string, purpose: "s" | "st", value: string | undefined): Promise<string | null> {
  if (!value || !secret) return null;
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const payload = value.slice(0, i);
  if (!safeEqual(await hmac(secret, payload), value.slice(i + 1))) return null;
  const [p, exp, ...rest] = payload.split(".");
  if (p !== purpose || !(Number(exp) > Date.now() / 1000)) return null;
  return rest.join(".");
}

export const randomId = (bytes = 16) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));
