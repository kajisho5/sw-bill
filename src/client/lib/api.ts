// サーバーとの通信。失敗は「何が起きたか」が分かる言葉にして投げる。
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const OFFLINE = "通信できませんでした。電波の状態を確かめて、やり直してください。";

async function fail(res: Response): Promise<never> {
  let code = "error";
  let message = `うまくいきませんでした（${res.status}）。やり直してください。`;
  try {
    const j = (await res.json()) as { error?: string; message?: string };
    if (j.error) code = j.error;
    if (j.message) message = j.message;
  } catch {
    // JSON でない返事（混雑時など）はそのままの文言にする
  }
  if (res.status === 401) window.dispatchEvent(new Event("sw-login"));
  throw new ApiError(res.status, code, message);
}

export async function api<T>(path: string, method = "GET", body?: unknown, timeoutMs = 30000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "x-requested-with": "sw-bill", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(0, "offline", OFFLINE);
  }
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

export async function fetchPdf(path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", signal: AbortSignal.timeout(90000) });
  } catch {
    throw new ApiError(0, "offline", OFFLINE);
  }
  if (!res.ok) return fail(res);
  return res.blob();
}

/** ファイルを端末に保存する。 */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** 共有メニューを開く。使えない端末では保存にする。戻り値は「共有したか」。 */
export async function share(blob: Blob, name: string): Promise<boolean> {
  const file = new File([blob], name, { type: blob.type || "application/pdf" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false; // 利用者が閉じただけ
    }
  }
  download(blob, name);
  return false;
}
