// 小さな画面切り替え。URL に今の場所を入れるので、戻る・再読み込みで同じ場所に戻れる。
import { useEffect, useState } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export function go(url: string, replace = false) {
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  notify();
  window.scrollTo(0, 0);
}

export function back(fallback = "/") {
  if (history.length > 1) history.back();
  else go(fallback, true);
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    window.addEventListener("popstate", f);
    return () => {
      listeners.delete(f);
      window.removeEventListener("popstate", f);
    };
  }, []);
  return { path: location.pathname, query: new URLSearchParams(location.search) };
}

export function setQuery(patch: Record<string, string | null>) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) v == null ? q.delete(k) : q.set(k, v);
  const s = q.toString();
  go(location.pathname + (s ? `?${s}` : ""), true);
}
