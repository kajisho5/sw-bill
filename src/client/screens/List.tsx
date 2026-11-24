// 一覧（月ごと）。請求書・見積書・納品書を切り替え、選んでまとめて PDF にできる。
import { useCallback, useEffect, useMemo, useState } from "react";
import { yen } from "../../shared/format";
import { KIND_LABEL, type DocKind, type Summary } from "../../shared/types";
import { Btn, Empty, ErrorPanel, IconBtn, Loading, Ring, Segmented, Wordmark } from "../components/ui";
import { api } from "../lib/api";
import { go, setQuery, useLocation } from "../lib/router";
import { Batch } from "./Batch";

type Filter = "all" | "unsent" | "unsettled" | "drafts";

interface DraftRow {
  id: string;
  kind: DocKind;
  partnerName: string;
  subject: string;
  date: string;
  total: number;
  updatedAt: string;
  source: "app" | "ai";
  freeeId: number | null;
}

type ListKind = DocKind | "equip";

interface EquipRow {
  id: string;
  subject: string;
  subjectShort: string;
  clientName: string;
  venueName: string;
  venueSub: string;
  place: string;
  created: string;
  totalQty: number;
  itemCount: number;
  updatedAt: string;
  source: "app" | "ai";
}

const KINDS: [ListKind, string][] = [
  ["invoice", "請求書"],
  ["quotation", "見積書"],
  ["delivery_slip", "納品書"],
  ["equip", "機材リスト"],
];

function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function Pill({ on, children }: { on: boolean; children: string }) {
  return <span className={`rounded-full px-2 py-[3px] text-[11px] ${on ? "bg-fg font-bold text-bg" : "border border-[#5a5a5a] text-[#cfcfcf]"}`}>{children}</span>;
}

export function List({ today }: { today: string }) {
  const { query } = useLocation();
  const kind = (KINDS.find(([k]) => k === query.get("k"))?.[0] ?? "invoice") as ListKind;
  const month = /^\d{4}-\d{2}$/.test(query.get("m") ?? "") ? query.get("m")! : today.slice(0, 7);
  const filter = (["all", "unsent", "unsettled", "drafts"].includes(query.get("f") ?? "") ? query.get("f") : "all") as Filter;

  const [docs, setDocs] = useState<Summary[] | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [equips, setEquips] = useState<EquipRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [batch, setBatch] = useState<Summary[] | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    setPicked(new Set());
    if (kind === "equip") {
      setEquips(null);
      api<{ equips: EquipRow[] }>("/api/equips")
        .then((j) => alive && setEquips(j.equips))
        .catch((e) => alive && setError(e.message));
    } else if (filter === "drafts") {
      setDrafts(null);
      api<{ drafts: DraftRow[] }>("/api/drafts")
        .then((j) => alive && setDrafts(j.drafts))
        .catch((e) => alive && setError(e.message));
    } else {
      setDocs(null);
      api<{ docs: Summary[] }>(`/api/docs/${kind}?month=${month}`)
        .then((j) => alive && setDocs(j.docs))
        .catch((e) => alive && setError(e.message));
    }
    return () => {
      alive = false;
    };
  }, [kind, month, filter, reload]);

  const shown = useMemo(() => {
    if (!docs) return [];
    const live = docs.filter((d) => !d.canceled);
    if (filter === "unsent") return live.filter((d) => !d.sent);
    if (filter === "unsettled") return live.filter((d) => d.settled === false);
    return docs;
  }, [docs, filter]);
  const exportable = useMemo(() => shown.filter((d) => !d.canceled), [shown]);
  const total = exportable.reduce((s, d) => s + d.total, 0);

  const toggle = useCallback((id: number) => {
    setPicked((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const filters: [Filter, string][] = [["all", "すべて"], ["unsent", "未送付"], ...(kind === "quotation" ? [] : ([["unsettled", "未入金"]] as [Filter, string][])), ["drafts", "下書き"]];

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      <header className="pt-safe flex items-center gap-3 px-4 pb-2">
        <Ring size={26} />
        <Wordmark text="BILL" height={14} spacing={0.3} />
        <div className="flex-1" />
        <IconBtn label="読み込み直す" onClick={() => setReload((n) => n + 1)}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />
          </svg>
        </IconBtn>
        <IconBtn label="設定（掛率の表・単価表）" onClick={() => go("/settings")}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="8" cy="17" r="2" />
          </svg>
        </IconBtn>
      </header>

      <div className="px-4 pt-2">
        <Segmented label="書類の種類" value={kind} options={KINDS} onChange={(k) => setQuery({ k, f: k === "equip" || (filter === "unsettled" && k === "quotation") ? null : query.get("f") })} />
      </div>

      {kind !== "equip" && filter !== "drafts" && (
        <div className="flex items-center gap-2 px-4 pt-5">
          <h1 className="flex-1 font-mono text-[34px] font-bold tracking-tight">{month.replace("-", ".")}</h1>
          <IconBtn label="前の月" onClick={() => setQuery({ m: shiftMonth(month, -1) })}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </IconBtn>
          <IconBtn label="次の月" onClick={() => setQuery({ m: shiftMonth(month, 1) })}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </IconBtn>
        </div>
      )}
      {kind !== "equip" && filter !== "drafts" && docs && (
        <p className="px-4 pt-1 text-sm text-sub">
          {exportable.length}件　合計 <span className="font-mono font-bold text-fg">¥{yen(total)}</span>
        </p>
      )}
      {kind === "equip" && equips && (
        <p className="px-4 pt-5 text-sm text-sub">{equips.length}件の機材リスト</p>
      )}

      {kind !== "equip" && (<div className="flex gap-2 overflow-x-auto px-4 py-4" role="tablist" aria-label="絞り込み">
        {filters.map(([f, label]) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={f === filter}
            onClick={() => setQuery({ f: f === "all" ? null : f })}
            className={`min-h-9 shrink-0 rounded-full px-4 text-sm ${f === filter ? "bg-fg font-bold text-bg" : "border border-[#3a3a3a] text-[#d8d8d8]"}`}
          >
            {label}
          </button>
        ))}
      </div>)}

      <main className="flex-1 px-4 pb-44">
        {error ? (
          <ErrorPanel message={error} onRetry={() => setReload((n) => n + 1)} />
        ) : kind === "equip" ? (
          !equips ? (
            <Loading />
          ) : equips.length === 0 ? (
            <Empty>機材リストはありません。右下の「＋ 作る」から作れます。</Empty>
          ) : (
            <ul className="space-y-2">
              {equips.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => go(`/equip/${e.id}`)} className="w-full rounded-2xl border border-line bg-card p-4 text-left">
                    <div className="flex items-baseline gap-3">
                      <span className="flex-1 truncate text-[16px] font-bold">{[e.venueName, e.venueSub].filter(Boolean).join(" ") || e.subject || "（無題）"}</span>
                      <span className="font-mono text-[16px] font-bold">{e.totalQty > 0 ? `${e.totalQty}点` : `${e.itemCount}件`}</span>
                    </div>
                    <p className="mt-1 truncate text-[13px] text-sub">{e.subject || "（件名なし）"}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Pill on={false}>機材リスト</Pill>
                      {e.source === "ai" && <Pill on={false}>AIが作成</Pill>}
                      <span className="flex-1 text-right font-mono text-[12px] text-mute">{e.created.replaceAll("-", ".")}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : filter === "drafts" ? (
          !drafts ? (
            <Loading />
          ) : drafts.length === 0 ? (
            <Empty>下書きはありません。右下の「＋ 作る」から作れます。</Empty>
          ) : (
            <ul className="space-y-2">
              {drafts.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => go(`/edit/${d.id}`)} className="w-full rounded-2xl border border-line bg-card p-4 text-left">
                    <div className="flex items-baseline gap-3">
                      <span className="flex-1 truncate text-[16px] font-bold">{d.partnerName || "（取引先がまだ）"}</span>
                      <span className="font-mono text-[16px] font-bold">¥{yen(d.total)}</span>
                    </div>
                    <p className="mt-1 truncate text-[13px] text-sub">{d.subject || "（件名なし）"}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Pill on={false}>{KIND_LABEL[d.kind]}</Pill>
                      {d.source === "ai" && <Pill on={false}>AIが作成</Pill>}
                      {d.freeeId && <Pill on>freee 保存済み</Pill>}
                      <span className="flex-1 text-right font-mono text-[12px] text-mute">{d.date.replaceAll("-", ".")}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : !docs ? (
          <Loading />
        ) : shown.length === 0 ? (
          <Empty>{docs.length === 0 ? `この月の${KIND_LABEL[kind as DocKind]}は freee にありません。` : "この条件に当てはまる書類はありません。"}</Empty>
        ) : (
          <ul className="space-y-2">
            {shown.map((d) => {
              const sel = picked.has(d.id);
              return (
                <li key={d.id} className={`flex items-stretch rounded-2xl border bg-card ${sel ? "border-fg" : "border-line"} ${d.canceled ? "opacity-50" : ""}`}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={sel}
                    aria-label={`${d.partnerName} ${d.number} を選ぶ`}
                    disabled={d.canceled}
                    onClick={() => toggle(d.id)}
                    className="grid w-12 shrink-0 place-items-center"
                  >
                    <span className={`grid size-[22px] place-items-center rounded-full ${sel ? "bg-fg text-bg" : "border-[1.5px] border-[#5a5a5a]"}`}>
                      {sel && (
                        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12.5l4.5 4.5L19 7" />
                        </svg>
                      )}
                    </span>
                  </button>
                  <button type="button" onClick={() => go(`/d/${d.kind}/${d.id}`)} className="min-w-0 flex-1 py-3 pr-4 text-left">
                    <div className="flex items-baseline gap-3">
                      <span className="min-w-0 flex-1 truncate text-[16px] font-bold">{d.partnerName}</span>
                      <span className="font-mono text-[16px] font-bold">¥{yen(d.total)}</span>
                    </div>
                    <p className="mt-1 truncate text-[13px] text-sub">{d.subject || "（件名なし）"}</p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-mute">{d.number}</span>
                      {d.canceled ? (
                        <Pill on={false}>取り消し済み</Pill>
                      ) : (
                        <>
                          <Pill on={d.sent}>{d.sent ? "送付済" : "未送付"}</Pill>
                          {d.settled != null && <Pill on={d.settled}>{d.settled ? "入金済" : "未入金"}</Pill>}
                        </>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <div className="pb-safe fixed inset-x-0 bottom-0 border-t border-line bg-[#0b0b0b]/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl gap-2">
          {kind === "equip" ? (
            <Btn className="flex-1" onClick={() => go("/equip/new")} aria-label="新しい機材リストを作る">
              ＋ 作る
            </Btn>
          ) : filter !== "drafts" && picked.size > 0 ? (
            <Btn className="flex-1" onClick={() => setBatch(exportable.filter((d) => picked.has(d.id)))}>
              選んだ {picked.size} 件を PDF にする
            </Btn>
          ) : (
            <Btn tone="line" className="flex-1" disabled={filter === "drafts" || exportable.length === 0} onClick={() => setBatch(exportable)}>
              {filter === "drafts" ? "下書きは開いて保存します" : `表示中の ${exportable.length} 件をまとめて PDF`}
            </Btn>
          )}
          {kind !== "equip" && (
            <Btn onClick={() => go(`/new?k=${kind}`)} aria-label="新しい書類を作る">
              ＋ 作る
            </Btn>
          )}
        </div>
      </div>

      {batch && <Batch docs={batch} label={`${month.replace("-", ".")} ${KIND_LABEL[kind as DocKind]}`} onClose={() => setBatch(null)} />}
    </div>
  );
}
