// 書類を作る・直す。明細は数量・日数を入れると、掛率と金額が自動で出る。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { discountLine, draftLineAmount, draftTotals, equipmentSubtotal, lookupRate } from "../../shared/calc";
import { yen } from "../../shared/format";
import { KIND_LABEL, type Category, type DocKind, type Draft, type DraftLine, type Partner, type PriceItem, type RateTable } from "../../shared/types";
import { BackIcon, Btn, ErrorPanel, IconBtn, isComposing, Loading, Segmented, Sheet, Stepper, toNumber, useToast } from "../components/ui";
import { api } from "../lib/api";
import { back, go } from "../lib/router";
import { Paper } from "./Preview";

type Item = Extract<DraftLine, { kind: "item" }>;
interface Settings {
  rates: RateTable;
  items: PriceItem[];
}

const KINDS: [DocKind, string][] = [
  ["quotation", "見積書"],
  ["delivery_slip", "納品書"],
  ["invoice", "請求書"],
];
const CATS: [Category, string][] = [
  ["none", "なし"],
  ["A", "A 映像"],
  ["B", "B 音響"],
  ["C", "C カメラ"],
];
const DATE_LABEL: Record<DocKind, [string, string | null]> = { invoice: ["請求日", "お支払期限"], quotation: ["見積日", "有効期限"], delivery_slip: ["納品日", null] };

const blankItem = (days: number): Item => ({ kind: "item", description: "", category: "none", quantity: 1, unit: "", days: null, rate: null, unitPrice: 0, taxRate: 10, priceChecked: true });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-h-12 items-center gap-3 border-b border-[#1e1e1e] px-4 last:border-b-0">
      <span className="w-24 shrink-0 text-sm text-sub">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

function PartnerPicker({ onPick, onClose }: { onPick: (p: Partner) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Partner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setError(null);
    const t = setTimeout(() => {
      api<{ partners: Partner[] }>(`/api/partners?q=${encodeURIComponent(q.trim())}`)
        .then((j) => alive && setList(j.partners))
        .catch((e) => alive && setError(e.message));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <Sheet title="取引先を選ぶ" onClose={onClose}>
      <input className="field" type="search" placeholder="名前で探す" aria-label="取引先の名前で探す" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {error ? (
        <ErrorPanel message={error} />
      ) : !list ? (
        <Loading />
      ) : list.length === 0 ? (
        <p className="py-10 text-center text-sm leading-6 text-sub">見つかりません。新しい取引先は freee で登録してください。</p>
      ) : (
        <ul className="mt-3">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" className="min-h-12 w-full border-b border-[#1c1c1c] py-3 text-left text-[15px]" onClick={() => onPick(p)}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function LineSheet({ initial, isNew, defaultDays, settings, onSave, onDelete, onClose }: { initial: Item; isNew: boolean; defaultDays: number; settings: Settings; onSave: (l: Item) => void; onDelete?: () => void; onClose: () => void }) {
  const [l, setL] = useState<Item>(initial);
  const [price, setPrice] = useState(initial.unitPrice ? String(initial.unitPrice) : "");
  const [qtyText, setQtyText] = useState(String(initial.quantity));
  const [rateText, setRateText] = useState(initial.rate != null ? String(initial.rate) : "");
  const [manualRate, setManualRate] = useState(initial.rate != null && lookupRate(settings.rates, initial.category, initial.days) !== initial.rate);

  const auto = lookupRate(settings.rates, l.category, l.days);
  const rate = l.category === "none" ? null : manualRate || auto == null ? toNumber(rateText) : auto;
  const quantity = toNumber(qtyText) ?? 0;
  const unitPrice = Math.round(toNumber(price) ?? 0);
  const current: Item = { ...l, quantity, unitPrice, rate, days: l.category === "none" ? null : l.days ?? defaultDays };
  const amount = draftLineAmount(current);

  const setCategory = (category: Category) => setL((v) => ({ ...v, category, days: category === "none" ? null : v.days ?? defaultDays }));
  const pickName = (name: string) => {
    const hit = settings.items.find((i) => i.name === name.trim());
    setL((v) => ({ ...v, description: name, ...(hit ? { category: hit.category, unit: hit.unit, days: hit.category === "none" ? null : v.days ?? defaultDays, priceChecked: true } : {}) }));
    if (hit) {
      setPrice(String(hit.unitPrice));
      setManualRate(false);
    }
  };

  const problems: string[] = [];
  if (!l.description.trim()) problems.push("品名を入れてください。");
  if (!(quantity > 0)) problems.push("数量は 0 より大きい数で入れてください。");
  if (toNumber(price) == null) problems.push("単価を入れてください。");
  if (l.category !== "none" && !(rate != null && rate > 0)) problems.push(auto == null ? `${current.days}日は表にありません。掛率を入れてください。` : "掛率を入れてください。");

  return (
    <Sheet
      title={isNew ? "明細を追加" : "明細を直す"}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <Btn className="w-full" disabled={problems.length > 0} onClick={() => onSave({ ...current, priceChecked: true })}>
            {isNew ? "この明細を追加" : "この内容にする"}
          </Btn>
          {onDelete && (
            <Btn tone="ghost" className="w-full" onClick={onDelete}>
              この行を消す
            </Btn>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-[13px] text-sub" htmlFor="ln-name">
            品名
          </label>
          <input id="ln-name" className="field" list="price-items" value={l.description} maxLength={255} onChange={(e) => pickName(e.target.value)} placeholder="例：設営費（2名）" />
          <datalist id="price-items">
            {settings.items.map((i) => (
              <option key={i.name} value={i.name} />
            ))}
          </datalist>
          {!initial.priceChecked && <p className="mt-1 text-xs leading-5 text-[#ffd98a]">この行の単価は AI が入れた未確認の値です。確かめてから保存してください。</p>}
        </div>
        <div>
          <p className="mb-1 text-[13px] text-sub">料率の区分</p>
          <Segmented label="料率の区分" value={l.category} options={CATS} onChange={setCategory} />
        </div>
        <div className="rounded-2xl border border-line bg-card">
          <Row label="数量">
            <div className="flex items-center justify-end gap-2">
              <input className="field w-24 text-right font-mono" inputMode="decimal" aria-label="数量" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
              <input className="field w-20 text-center" aria-label="単位" placeholder="単位" maxLength={10} value={l.unit} onChange={(e) => setL({ ...l, unit: e.target.value })} />
            </div>
          </Row>
          {l.category !== "none" && (
            <>
              <Row label="日数">
                <div className="flex justify-end">
                  <Stepper label="日数" value={current.days ?? defaultDays} suffix="日" onChange={(days) => setL({ ...l, days })} />
                </div>
              </Row>
              <Row label="掛率">
                <div className="flex items-center justify-end gap-2">
                  {auto != null && (
                    <button type="button" className={`rounded-full px-2 py-1 text-[11px] font-bold ${manualRate ? "border border-[#5a5a5a] text-[#cfcfcf]" : "bg-fg text-bg"}`} aria-pressed={!manualRate} onClick={() => setManualRate((v) => !v)}>
                      {manualRate ? "手入力" : "自動"}
                    </button>
                  )}
                  {manualRate || auto == null ? (
                    <input className="field w-24 text-right font-mono" inputMode="decimal" aria-label="掛率" placeholder="例 2.3" value={rateText} onChange={(e) => setRateText(e.target.value)} />
                  ) : (
                    <span className="font-mono text-[17px] font-bold">{auto}</span>
                  )}
                </div>
              </Row>
            </>
          )}
          <Row label={l.category === "none" ? "単価" : "単価（1日）"}>
            <input className="field text-right font-mono" inputMode="numeric" aria-label="単価（円・税抜）" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Row>
        </div>
        <div className="rounded-2xl bg-fg p-4 text-bg">
          <p className="text-xs font-medium text-[#444]">金額（税抜）</p>
          <div className="mt-1 flex items-end gap-3">
            <p className="flex-1 font-mono text-[32px] font-bold leading-none tracking-tight">¥{yen(amount)}</p>
            <p className="font-mono text-xs text-[#444]">
              {quantity}
              {rate != null ? ` × ${rate}` : ""} × {yen(unitPrice)}
            </p>
          </div>
        </div>
        {problems.length > 0 ? (
          <ul className="list-disc pl-5 text-xs leading-5 text-[#ffb3b3]">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs leading-5 text-mute">A・B・C は日数から掛率が自動で入ります（5日まで）。「なし」は人件費・交通費など、掛率を使わない行です。値引きはマイナスの単価で入れられます。</p>
        )}
      </div>
    </Sheet>
  );
}

export function Editor({ id }: { id: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [problems, setProblems] = useState<string[]>([]);
  const [sheet, setSheet] = useState<{ index: number | null; line: Item } | null>(null);
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState<{ pages: number; problems: string[] } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [toast, showToast] = useToast();
  const dirty = useRef(false);
  const latest = useRef<Draft | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const commitLock = useRef(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api<{ draft: Draft; problems: string[] }>(`/api/drafts/${id}`), api<Settings>("/api/settings")])
      .then(([d, s]) => {
        if (!alive) return;
        setDraft(d.draft);
        latest.current = d.draft;
        setProblems(d.problems);
        setSettings(s);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  const save = useCallback(async () => {
    while (dirty.current && latest.current) {
      dirty.current = false;
      setSaveState("saving");
      try {
        const j = await api<{ problems: string[] }>(`/api/drafts/${id}`, "PUT", latest.current);
        setProblems(j.problems);
        if (!dirty.current) setSaveState("saved");
      } catch (e) {
        dirty.current = true;
        setSaveState("error");
        throw e;
      }
    }
  }, [id]);

  const flush = useCallback(async () => {
    if (saving.current) await saving.current.catch(() => {});
    saving.current = save().finally(() => (saving.current = null));
    await saving.current;
  }, [save]);

  // 入力のたびに少し待ってから自動で保存する
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => void flush().catch(() => {}), 700);
    return () => clearTimeout(t);
  }, [draft, flush]);

  const locked = !!draft?.freeeId;
  const update = (patch: Partial<Draft>) => {
    if (locked) return;
    setDraft((d) => {
      if (!d) return d;
      const n = { ...d, ...patch };
      latest.current = n;
      dirty.current = true;
      return n;
    });
    setSaveState("saving");
  };

  const totals = useMemo(() => (draft ? draftTotals(draft) : null), [draft]);

  if (error) return <ErrorPanel message={error} onRetry={() => location.reload()} />;
  if (!draft || !settings || !totals) return <Loading />;

  const setDays = (days: number) => {
    const lines = draft.lines.map((l) => {
      if (l.kind !== "item" || l.category === "none" || l.days !== draft.days) return l;
      const auto = lookupRate(settings.rates, l.category, days);
      return { ...l, days, rate: auto ?? l.rate };
    });
    update({ days, lines });
  };
  const setLine = (index: number | null, line: DraftLine) => update({ lines: index == null ? [...draft.lines, line] : draft.lines.map((l, i) => (i === index ? line : l)) });
  const removeLine = (index: number) => {
    const removed = draft.lines[index];
    update({ lines: draft.lines.filter((_, i) => i !== index) });
    showToast(`「${removed.description.slice(0, 12) || "行"}」を消しました`);
  };
  const move = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= draft.lines.length) return;
    const lines = [...draft.lines];
    [lines[index], lines[to]] = [lines[to], lines[index]];
    update({ lines });
  };
  const addHeading = () => {
    const t = window.prompt("見出し（例：12/12-14 催事名、映像機材、交通諸経費）");
    if (t?.trim()) setLine(null, { kind: "text", description: t.trim().slice(0, 255) });
  };
  const addDiscount = () => {
    if (equipmentSubtotal(draft.lines) <= 0) return showToast("先に機材（掛率のある行）を入れてください");
    const p = toNumber(window.prompt("機材費の何％を値引きしますか？（例：10）") ?? "");
    if (p == null) return;
    if (p <= 0 || p > 100) return showToast("0 より大きく 100 以下で入れてください");
    setLine(null, discountLine(draft.lines, p));
  };

  const openPreview = async () => {
    setPreviewBusy(true);
    try {
      await flush();
      setPreview(await api<{ pages: number; problems: string[] }>(`/api/drafts/${id}/preview`));
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  };

  const commit = async () => {
    if (commitLock.current) return; // 連打しても1回だけ
    commitLock.current = true;
    setCommitting(true);
    try {
      const j = await api<{ kind: DocKind; id: number; mismatch: { tool: number; freee: number } | null }>(`/api/drafts/${id}/commit`, "POST", undefined, 60000);
      if (j.mismatch) window.alert(`freee に保存しましたが、合計が違います（ツール ¥${yen(j.mismatch.tool)}／freee ¥${yen(j.mismatch.freee)}）。freee の数字が正しい扱いになります。次の画面で確かめてください。`);
      go(`/d/${j.kind}/${j.id}`, true);
    } catch (e) {
      showToast((e as Error).message);
      commitLock.current = false;
      setCommitting(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("この下書きを消します。元に戻せません。よろしいですか？")) return;
    try {
      await api(`/api/drafts/${id}`, "DELETE");
      go("/?f=drafts", true);
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const [dateLabel, dueLabel] = DATE_LABEL[draft.kind];
  const unchecked = draft.lines.filter((l) => l.kind === "item" && !l.priceChecked).length;

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      <header className="pt-safe flex items-center gap-3 px-4 pb-3">
        <IconBtn label="戻る" onClick={() => void flush().catch(() => {}).then(() => back("/?f=drafts"))}>
          <BackIcon />
        </IconBtn>
        <h1 className="flex-1 pl-5 text-center text-[17px] font-bold">{draft.editOf ? "書類を直す" : "書類を作成"}</h1>
        <span className="w-16 whitespace-nowrap text-right text-[11px] text-mute" role="status">
          {locked ? "保存済み" : saveState === "saving" ? "保存中…" : saveState === "error" ? "未保存" : "下書き保存"}
        </span>
      </header>

      <main className="flex-1 space-y-4 px-4 pb-40">
        {locked && <p className="rounded-2xl border border-line bg-card p-4 text-sm leading-6 text-sub">この下書きは freee に保存済みです。直すときは、書類の画面の「この書類を直す」から始めてください。</p>}
        {saveState === "error" && <p className="rounded-2xl border border-[#5a2a2a] bg-[#1a0f0f] p-3 text-sm leading-6 text-[#ffd6d6]" role="alert">下書きを保存できていません。通信の状態を確かめてください（入力は画面に残っています）。</p>}
        <fieldset disabled={locked} className="m-0 min-w-0 space-y-4 border-0 p-0">
          <Segmented label="書類の種類" value={draft.kind} options={KINDS} onChange={(kind) => !draft.editOf && update({ kind, dueDate: kind === "delivery_slip" ? null : draft.dueDate })} />

          <div className="rounded-2xl border border-line bg-card">
            <div className="flex min-h-12 items-center gap-3 border-b border-[#1e1e1e] px-4">
              <span className="w-24 shrink-0 text-sm text-sub">取引先</span>
              <button type="button" className="min-h-11 min-w-0 flex-1 truncate text-right text-[15px]" onClick={() => setPicker(true)}>
                {draft.partnerName || <span className="text-mute">選ぶ</span>} <span className="text-mute">›</span>
              </button>
              <select aria-label="敬称" className="rounded-lg border border-[#333] bg-[#0a0a0a] px-1 py-2 text-sm" value={draft.partnerTitle} onChange={(e) => update({ partnerTitle: e.target.value })}>
                <option value="御中">御中</option>
                <option value="様">様</option>
                <option value="">なし</option>
              </select>
            </div>
            <Row label="件名">
              <input className="w-full bg-transparent py-2 text-right text-[15px] outline-none" value={draft.subject} maxLength={255} placeholder="例：催事名 映像・音響" onChange={(e) => update({ subject: e.target.value })} onKeyDown={(e) => !isComposing(e) && e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            </Row>
            <Row label={dateLabel}>
              <input type="date" className="w-full bg-transparent py-2 text-right font-mono text-[15px] outline-none" value={draft.date} onChange={(e) => e.target.value && update({ date: e.target.value })} />
            </Row>
            {dueLabel && (
              <Row label={dueLabel}>
                <input type="date" className="w-full bg-transparent py-2 text-right font-mono text-[15px] outline-none" value={draft.dueDate ?? ""} onChange={(e) => update({ dueDate: e.target.value || null })} />
              </Row>
            )}
            <div className="flex min-h-14 items-center gap-3 px-4">
              <span className="flex-1 text-sm text-sub">機材の日数</span>
              <Stepper label="機材の日数" value={draft.days} suffix="日" onChange={setDays} />
            </div>
          </div>

          <section aria-label="明細">
            <h2 className="mb-2 text-[13px] font-medium text-sub">明細</h2>
            {draft.lines.length === 0 && <p className="rounded-2xl border border-dashed border-[#333] p-6 text-center text-sm leading-6 text-sub">まだ明細がありません。下のボタンから足してください。</p>}
            <ul>
              {draft.lines.map((l, i) => (
                <li key={i} className="flex items-stretch gap-1">
                  {l.kind === "text" ? (
                    <button
                      type="button"
                      className="my-1 flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg bg-[#1a1a1a] px-3 text-left"
                      onClick={() => {
                        const t = window.prompt("見出し", l.description);
                        if (t != null) t.trim() ? setLine(i, { kind: "text", description: t.trim().slice(0, 255) }) : removeLine(i);
                      }}
                    >
                      <span className="size-2 shrink-0 bg-fg" />
                      <span className="truncate text-[13px] font-bold">{l.description}</span>
                    </button>
                  ) : (
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 border-b border-[#1c1c1c] px-2 py-2 text-left" onClick={() => setSheet({ index: i, line: l })}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">
                          {l.description}
                          {!l.priceChecked && <span className="ml-2 rounded bg-[#4a3a10] px-1 text-[10px] text-[#ffd98a]">単価未確認</span>}
                        </span>
                        <span className="block truncate font-mono text-[12px] text-sub">
                          {l.quantity}
                          {l.unit}
                          {l.rate != null ? ` × ${l.days ?? "-"}日（${l.rate}）` : ""} × ¥{yen(l.unitPrice)}
                        </span>
                      </span>
                      <span className="font-mono text-[15px] font-bold">¥{yen(draftLineAmount(l))}</span>
                    </button>
                  )}
                  <span className="flex flex-col justify-center">
                    <button type="button" aria-label={`${i + 1}行目を上へ`} className="grid h-6 w-8 place-items-center text-mute disabled:opacity-20" disabled={i === 0} onClick={() => move(i, -1)}>
                      ▲
                    </button>
                    <button type="button" aria-label={`${i + 1}行目を下へ`} className="grid h-6 w-8 place-items-center text-mute disabled:opacity-20" disabled={i === draft.lines.length - 1} onClick={() => move(i, 1)}>
                      ▼
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Btn tone="line" className="px-1 text-[13px]" onClick={() => setSheet({ index: null, line: blankItem(draft.days) })}>
                ＋ 明細
              </Btn>
              <Btn tone="line" className="px-1 text-[13px]" onClick={addHeading}>
                ＋ 見出し
              </Btn>
              <Btn tone="line" className="px-1 text-[13px]" onClick={addDiscount}>
                ＋ 値引き
              </Btn>
            </div>
          </section>

          <div>
            <label className="mb-1 block text-[13px] text-sub" htmlFor="note">
              備考
            </label>
            <textarea id="note" className="field min-h-20" maxLength={4000} value={draft.note} onChange={(e) => update({ note: e.target.value })} />
          </div>
        </fieldset>
        <Btn tone="ghost" className="w-full text-[#ffb3b3]" onClick={remove}>
          この下書きを消す
        </Btn>
      </main>

      <div className="pb-safe fixed inset-x-0 bottom-0 border-t border-line bg-[#0b0b0b]/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-sub">合計（税込）</p>
            <p className="font-mono text-[22px] font-bold tracking-tight">¥{yen(totals.total)}</p>
          </div>
          <Btn className="w-40" busy={previewBusy} onClick={openPreview}>
            プレビューへ
          </Btn>
        </div>
      </div>

      {picker && (
        <PartnerPicker
          onClose={() => setPicker(false)}
          onPick={(p) => {
            update({ partnerId: p.id, partnerName: p.name });
            setPicker(false);
          }}
        />
      )}
      {sheet && (
        <LineSheet
          initial={sheet.line}
          isNew={sheet.index == null}
          defaultDays={draft.days}
          settings={settings}
          onClose={() => setSheet(null)}
          onSave={(l) => {
            setLine(sheet.index, l);
            setSheet(null);
          }}
          onDelete={
            sheet.index == null
              ? undefined
              : () => {
                  removeLine(sheet.index!);
                  setSheet(null);
                }
          }
        />
      )}
      {preview && (
        <Sheet
          title={`${KIND_LABEL[draft.kind]}のプレビュー`}
          onClose={() => !committing && setPreview(null)}
          footer={
            locked ? (
              <p className="py-2 text-center text-sm text-sub">freee に保存済みです</p>
            ) : (
              <Btn className="w-full" busy={committing} disabled={preview.problems.length > 0} onClick={commit}>
                {committing ? "freee に保存しています…" : draft.editOf ? "この内容で freee の書類を直す" : "この内容で freee に保存"}
              </Btn>
            )
          }
        >
          {preview.problems.length > 0 && (
            <ul className="mb-3 list-disc rounded-2xl border border-[#5a2a2a] bg-[#1a0f0f] p-4 pl-8 text-sm leading-6 text-[#ffd6d6]" role="alert">
              {preview.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {unchecked > 0 && <p className="mb-3 rounded-2xl border border-[#5a4a1a] bg-[#1a160a] p-3 text-sm leading-6 text-[#ffd98a]">単価が未確認の行が {unchecked} 行あります（AI が入れた値）。保存する前に確かめてください。</p>}
          <Paper src={`/api/drafts/${id}/html?t=${encodeURIComponent(draft.updatedAt + draft.lines.length + totals.total)}`} pages={preview.pages} title="下書きのプレビュー" />
          <p className="py-3 text-center text-xs leading-5 text-sub">
            {preview.pages} ページ。番号は freee に保存したときに付きます。
            <br />
            消費税などの最終の数字は freee の計算が正になります。
          </p>
        </Sheet>
      )}
      {toast}
    </div>
  );
}

/** 新しい下書きを作って、編集画面へ進む。 */
export function NewDraft({ kind, today }: { kind: DocKind; today: string }) {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api<{ draft: Draft }>("/api/drafts", "POST", { kind, date: today, days: 1, lines: [] })
      .then((j) => go(`/edit/${j.draft.id}`, true))
      .catch((e) => setError(e.message));
  }, [kind, today]);
  return error ? <ErrorPanel message={error} onRetry={() => location.reload()} /> : <Loading label="下書きを用意しています" />;
}
