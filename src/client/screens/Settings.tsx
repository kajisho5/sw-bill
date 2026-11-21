// 設定：掛率の表と単価表。
import { useEffect, useState } from "react";
import { DEFAULT_RATES, isValidRateTable } from "../../shared/calc";
import type { Category, PriceItem, RateTable } from "../../shared/types";
import { BackIcon, Btn, ErrorPanel, IconBtn, Loading, toNumber, useToast } from "../components/ui";
import { api } from "../lib/api";
import { back } from "../lib/router";

declare const __APP_VERSION__: string;

type RateText = Record<"A" | "B" | "C", string[]>;
interface ItemText {
  name: string;
  category: Category;
  unit: string;
  unitPrice: string;
}
const NAMES: [("A" | "B" | "C"), string][] = [["A", "映像"], ["B", "音響"], ["C", "カメラ"]];
const toText = (r: RateTable): RateText => ({ A: r.A.map(String), B: r.B.map(String), C: r.C.map(String) });

export function Settings() {
  const [rates, setRates] = useState<RateText | null>(null);
  const [items, setItems] = useState<ItemText[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"rates" | "items" | null>(null);
  const [toast, showToast] = useToast();
  const [mcpUrl, setMcpUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);

  useEffect(() => {
    api<{ rates: RateTable; items: PriceItem[]; mcpUrl: string }>("/api/settings")
      .then((j) => {
        setMcpUrl(j.mcpUrl);
        setRates(toText(j.rates));
        setItems(j.items.map((i) => ({ ...i, unitPrice: String(i.unitPrice) })));
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorPanel message={error} onRetry={() => location.reload()} />;
  if (!rates) return <Loading />;

  const saveRates = async () => {
    const table = { A: rates.A.map((s) => toNumber(s) ?? NaN), B: rates.B.map((s) => toNumber(s) ?? NaN), C: rates.C.map((s) => toNumber(s) ?? NaN) };
    if (!isValidRateTable(table)) return showToast("掛率は 0 より大きい数で、全部のマスに入れてください");
    setBusy("rates");
    try {
      await api("/api/rates", "PUT", table);
      setRates(toText(table));
      showToast("掛率の表を保存しました");
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveItems = async () => {
    const out: PriceItem[] = [];
    for (const [n, i] of items.entries()) {
      const price = toNumber(i.unitPrice);
      if (!i.name.trim()) return showToast(`${n + 1}件目：品名を入れてください`);
      if (price == null) return showToast(`「${i.name}」：単価を入れてください`);
      out.push({ name: i.name.trim(), category: i.category, unit: i.unit.trim(), unitPrice: Math.round(price) });
    }
    setBusy("items");
    try {
      await api("/api/items", "PUT", out);
      showToast("単価表を保存しました");
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      showToast("URL をコピーしました");
    } catch {
      setShowUrl(true);
      showToast("コピーできませんでした。表示された URL を長押ししてコピーしてください");
    }
  };
  const rotate = async () => {
    if (!window.confirm("AI 用の入口の URL を作り直します。今つないでいる AI からは使えなくなり、新しい URL でつなぎ直しが必要です。よろしいですか？")) return;
    try {
      setMcpUrl((await api<{ mcpUrl: string }>("/api/mcp-token/rotate", "POST")).mcpUrl);
      showToast("URL を作り直しました");
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const logout = async () => {
    await api("/auth/logout", "POST").catch(() => {});
    location.href = "/";
  };

  return (
    <div className="mx-auto max-w-xl pb-16">
      <header className="pt-safe flex items-center gap-3 px-4 pb-3">
        <IconBtn label="戻る" onClick={() => back()}>
          <BackIcon />
        </IconBtn>
        <h1 className="flex-1 pr-11 text-center text-[17px] font-bold">設定</h1>
      </header>
      <main className="space-y-8 px-4">
        <section aria-labelledby="h-rates">
          <h2 id="h-rates" className="text-[15px] font-bold">
            掛率の表
          </h2>
          <p className="mt-1 text-xs leading-5 text-sub">日数ごとの掛率。ここを直すと、次に入れる明細から変わります（作成済みの書類は変わりません）。</p>
          <div className="mt-3 rounded-2xl border border-line bg-card p-4">
            <table className="w-full border-separate border-spacing-y-2 text-center">
              <thead>
                <tr className="text-xs text-sub">
                  <th scope="col" className="w-14 text-left font-medium">
                    日数
                  </th>
                  {NAMES.map(([k, n]) => (
                    <th key={k} scope="col" className="font-medium">
                      <span className="block font-mono text-[15px] font-bold text-fg">{k}</span>
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4].map((d) => (
                  <tr key={d}>
                    <th scope="row" className="text-left text-[15px] font-medium">
                      {d + 1}日
                    </th>
                    {NAMES.map(([k]) => (
                      <td key={k} className="px-1">
                        <input
                          className="field text-center font-mono font-bold"
                          inputMode="decimal"
                          aria-label={`${k} ${d + 1}日の掛率`}
                          value={rates[k][d]}
                          onChange={(e) => setRates({ ...rates, [k]: rates[k].map((v, i) => (i === d ? e.target.value : v)) })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs leading-5 text-mute">6日以上は表にないので、明細ごとに手で入れます。最初の値は株式会社ハーツの 2023 Rental GUIDE と同じです。</p>
          <div className="mt-3 flex gap-2">
            <Btn className="flex-1" busy={busy === "rates"} onClick={saveRates}>
              掛率の表を保存
            </Btn>
            <Btn tone="line" onClick={() => setRates(toText(DEFAULT_RATES))}>
              最初の値に戻す
            </Btn>
          </div>
        </section>

        <section aria-labelledby="h-items">
          <h2 id="h-items" className="text-[15px] font-bold">
            単価表
          </h2>
          <p className="mt-1 text-xs leading-5 text-sub">よく使う品名と1日の単価（税抜）。明細の品名の候補に出ます。AI に作らせるときも、ここの単価が使われます。</p>
          <ul className="mt-3 space-y-2">
            {items.map((it, n) => {
              const set = (patch: Partial<ItemText>) => setItems(items.map((v, i) => (i === n ? { ...v, ...patch } : v)));
              return (
                <li key={n} className="rounded-2xl border border-line bg-card p-3">
                  <div className="flex gap-2">
                    <input className="field flex-1" aria-label={`${n + 1}件目の品名`} placeholder="品名" maxLength={255} value={it.name} onChange={(e) => set({ name: e.target.value })} />
                    <button type="button" aria-label={`${it.name || `${n + 1}件目`}を消す`} className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#333] text-mute" onClick={() => setItems(items.filter((_, i) => i !== n))}>
                      ×
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-[6.5rem_4.5rem_minmax(0,1fr)] gap-2">
                    <select className="field" aria-label="区分" value={it.category} onChange={(e) => set({ category: e.target.value as Category })}>
                      <option value="none">なし</option>
                      <option value="A">A 映像</option>
                      <option value="B">B 音響</option>
                      <option value="C">C カメラ</option>
                    </select>
                    <input className="field text-center" aria-label="単位" placeholder="単位" maxLength={10} value={it.unit} onChange={(e) => set({ unit: e.target.value })} />
                    <input className="field text-right font-mono" aria-label="単価" inputMode="numeric" placeholder="単価" value={it.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} />
                  </div>
                </li>
              );
            })}
          </ul>
          {items.length === 0 && <p className="mt-3 rounded-2xl border border-dashed border-[#333] p-5 text-center text-sm leading-6 text-sub">まだ登録がありません。</p>}
          <div className="mt-3 flex gap-2">
            <Btn tone="line" className="flex-1" onClick={() => setItems([...items, { name: "", category: "none", unit: "", unitPrice: "" }])}>
              ＋ 品名を足す
            </Btn>
            <Btn className="flex-1" busy={busy === "items"} onClick={saveItems}>
              単価表を保存
            </Btn>
          </div>
        </section>

        <section aria-labelledby="h-ai">
          <h2 id="h-ai" className="text-[15px] font-bold">
            AI から下書きを作る
          </h2>
          <p className="mt-1 text-xs leading-5 text-sub">
            Claude や Muse の「コネクタ（MCP）」に、下の URL を登録すると、チャットから見積書などの下書きを作れます。AI が作れるのは下書きまでで、freee への保存はこの画面で自分で押します。
          </p>
          <p className="mt-2 text-xs leading-5 text-[#ffd98a]">この URL は合言葉を兼ねています。人に見せたり、公開の場所に貼ったりしないでください。</p>
          {showUrl && <p className="mt-3 break-all rounded-xl border border-line bg-card p-3 font-mono text-xs select-all">{mcpUrl}</p>}
          <div className="mt-3 flex gap-2">
            <Btn className="flex-1" onClick={copyUrl}>
              URL をコピー
            </Btn>
            <Btn tone="line" onClick={() => setShowUrl((v) => !v)}>
              {showUrl ? "隠す" : "表示"}
            </Btn>
            <Btn tone="line" onClick={rotate}>
              作り直す
            </Btn>
          </div>
        </section>

        <section className="border-t border-line pt-6">
          <Btn tone="line" className="w-full" onClick={logout}>
            ログアウト
          </Btn>
          <p className="mt-4 text-center font-mono text-xs text-mute">SW BILL バージョン {__APP_VERSION__}</p>
        </section>
      </main>
      {toast}
    </div>
  );
}
