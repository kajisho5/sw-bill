// 機材リストのプレビューと作成・編集。freee には保存しない、このツールだけの書類。
import { useCallback, useEffect, useRef, useState } from "react";
import { equipItemCount, equipTotalQty, type EquipDoc, type EquipItem } from "../../shared/types";
import { BackIcon, Btn, Empty, ErrorPanel, IconBtn, Loading, Sheet, isComposing, toNumber, useToast } from "../components/ui";
import { api, download, fetchPdf, share } from "../lib/api";
import { back, go } from "../lib/router";
import { Paper } from "./Preview";

interface EquipInfo {
  equip: EquipDoc;
  pages: number;
  fileName: string;
}

const blankItem = (): EquipItem => ({ code: "", name: "", model: "", qty: null, unit: "台", note: "" });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-h-12 items-center gap-3 border-b border-[#1e1e1e] px-4 last:border-b-0">
      <span className="w-24 shrink-0 text-sm text-sub">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

const textInput = "w-full bg-transparent py-2 text-right text-[15px] outline-none";
const onEnterBlur = (e: React.KeyboardEvent<HTMLInputElement>) => !isComposing(e) && e.key === "Enter" && (e.target as HTMLInputElement).blur();

// ───────── プレビュー ─────────

export function EquipPreview({ id }: { id: string }) {
  const [info, setInfo] = useState<EquipInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [toast, showToast] = useToast();

  useEffect(() => {
    let alive = true;
    setInfo(null);
    setError(null);
    setPdf(null);
    api<EquipInfo>(`/api/equips/${id}`)
      .then((j) => alive && setInfo(j))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id, reload]);

  const makePdf = async () => {
    setBusy(true);
    setPdfError(null);
    try {
      setPdf(await fetchPdf(`/api/equips/${id}/pdf`));
    } catch (e) {
      setPdfError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      const j = await api<{ equip: EquipDoc }>(`/api/equips/${id}/copy`, "POST");
      go(`/equip/${j.equip.id}`);
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const remove = async () => {
    if (!window.confirm("この機材リストを消します。元に戻せません。よろしいですか？")) return;
    try {
      await api(`/api/equips/${id}`, "DELETE");
      go("/?k=equip", true);
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const title = info ? [info.equip.venueName, info.equip.venueSub].filter(Boolean).join(" ") || info.equip.subject || "機材リスト" : "機材リスト";

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      <header className="pt-safe flex items-center gap-3 px-4 pb-3">
        <IconBtn label="戻る" onClick={() => back("/?k=equip")}>
          <BackIcon />
        </IconBtn>
        <h1 className="flex-1 truncate pr-11 text-center font-mono text-[15px] font-bold">{title}</h1>
      </header>
      {error ? (
        <ErrorPanel message={error} onRetry={() => setReload((n) => n + 1)} />
      ) : !info ? (
        <Loading />
      ) : (
        <main className="flex-1 px-4 pb-10">
          <Paper src={`/api/equips/${id}/html`} pages={info.pages} title={`機材リスト ${title} のプレビュー`} />
          <p className="py-3 text-center text-xs text-sub">
            {info.pages} ページ　機材 {equipItemCount(info.equip)} 件{equipTotalQty(info.equip) > 0 ? `・合計 ${equipTotalQty(info.equip)} 点` : ""}
          </p>
          <p className="break-all rounded-xl border border-line bg-card px-3 py-3 font-mono text-xs text-[#d8d8d8]">{info.fileName}</p>
          {pdfError && (
            <p className="mt-3 text-sm leading-6 text-[#ffb3b3]" role="alert">
              {pdfError}
            </p>
          )}
          <div className="mt-3 space-y-2">
            {!pdf ? (
              <Btn className="w-full" busy={busy} onClick={makePdf}>
                {busy ? "PDF を作っています…" : "PDF を作る"}
              </Btn>
            ) : (
              <Btn className="w-full" onClick={() => share(pdf, info.fileName)}>
                PDF を共有
              </Btn>
            )}
            <Btn tone="line" className="w-full" disabled={!pdf} onClick={() => pdf && (download(pdf, info.fileName), showToast("保存しました"))}>
              ファイルに保存
            </Btn>
            <Btn tone="line" className="w-full" onClick={() => go(`/equip/${id}/edit`)}>
              編集する
            </Btn>
            <div className="flex gap-2">
              <Btn tone="ghost" className="flex-1" onClick={copy}>
                複製する
              </Btn>
              <Btn tone="ghost" className="flex-1" onClick={remove}>
                削除する
              </Btn>
            </div>
          </div>
        </main>
      )}
      {toast}
    </div>
  );
}

// ───────── 新規作成（空の機材リストを作って編集へ） ─────────

export function NewEquip() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ equip: EquipDoc }>("/api/equips", "POST", {})
      .then((j) => alive && go(`/equip/${j.equip.id}/edit`, true))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);
  if (error) return <ErrorPanel message={error} onRetry={() => location.reload()} />;
  return <Loading label="機材リストを用意しています" />;
}

// ───────── 編集 ─────────

export function EquipEditor({ id }: { id: string }) {
  const [doc, setDoc] = useState<EquipDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [sheet, setSheet] = useState<{ sec: number; index: number | null; item: EquipItem } | null>(null);
  const [toast, showToast] = useToast();
  const dirty = useRef(false);
  const latest = useRef<EquipDoc | null>(null);
  latest.current = doc;

  useEffect(() => {
    let alive = true;
    api<EquipInfo>(`/api/equips/${id}`)
      .then((j) => alive && setDoc(j.equip))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  const flush = useCallback(async () => {
    while (dirty.current && latest.current) {
      dirty.current = false;
      setSaveState("saving");
      try {
        await api(`/api/equips/${id}`, "PUT", latest.current);
        if (!dirty.current) setSaveState("saved");
      } catch {
        dirty.current = true;
        setSaveState("error");
        throw new Error("save");
      }
    }
  }, [id]);

  useEffect(() => {
    if (!doc || !dirty.current) return;
    const t = setTimeout(() => void flush().catch(() => {}), 700);
    return () => clearTimeout(t);
  }, [doc, flush]);

  const update = (patch: Partial<EquipDoc>) => {
    dirty.current = true;
    setDoc((d) => (d ? { ...d, ...patch } : d));
  };

  const setSectionTitle = (sec: number, title: string) =>
    update({ sections: doc!.sections.map((s, i) => (i === sec ? { ...s, title } : s)) });

  const setItem = (sec: number, index: number, item: EquipItem) =>
    update({ sections: doc!.sections.map((s, i) => (i === sec ? { ...s, items: s.items.map((it, j) => (j === index ? item : it)) } : s)) });

  const removeItem = (sec: number, index: number) =>
    update({ sections: doc!.sections.map((s, i) => (i === sec ? { ...s, items: s.items.filter((_, j) => j !== index) } : s)) });

  const moveItem = (sec: number, index: number, by: number) => {
    const items = [...doc!.sections[sec].items];
    const to = index + by;
    if (to < 0 || to >= items.length) return;
    [items[index], items[to]] = [items[to], items[index]];
    update({ sections: doc!.sections.map((s, i) => (i === sec ? { ...s, items } : s)) });
  };

  const moveSection = (sec: number, by: number) => {
    const sections = [...doc!.sections];
    const to = sec + by;
    if (to < 0 || to >= sections.length) return;
    [sections[sec], sections[to]] = [sections[to], sections[sec]];
    update({ sections });
  };

  const remove = async () => {
    if (!window.confirm("この機材リストを消します。元に戻せません。よろしいですか？")) return;
    try {
      await api(`/api/equips/${id}`, "DELETE");
      go("/?k=equip", true);
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  if (error) return <ErrorPanel message={error} onRetry={() => location.reload()} />;
  if (!doc) return <Loading />;

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      <header className="pt-safe flex items-center gap-3 px-4 pb-3">
        <IconBtn label="戻る" onClick={() => void flush().catch(() => {}).then(() => back("/?k=equip"))}>
          <BackIcon />
        </IconBtn>
        <h1 className="flex-1 pl-5 text-center text-[17px] font-bold">機材リストを作成</h1>
        <span className="w-16 whitespace-nowrap text-right text-[11px] text-mute" role="status">
          {saveState === "saving" ? "保存中…" : saveState === "error" ? "未保存" : "保存済み"}
        </span>
      </header>

      <main className="flex-1 space-y-4 px-4 pb-40">
        {saveState === "error" && (
          <p className="rounded-2xl border border-[#5a2a2a] bg-[#1a0f0f] p-3 text-sm leading-6 text-[#ffd6d6]" role="alert">
            保存できていません。通信の状態を確かめてください（入力は画面に残っています）。
          </p>
        )}

        <div className="rounded-2xl border border-line bg-card">
          <Row label="発注元">
            <input aria-label="発注元" className={textInput} value={doc.clientName} maxLength={200} placeholder="例：見本イベント合同会社" onChange={(e) => update({ clientName: e.target.value })} onKeyDown={onEnterBlur} />
          </Row>
          <Row label="部署・担当">
            <textarea
              className="w-full resize-none bg-transparent py-2 text-right text-[15px] outline-none"
              rows={2}
              value={doc.clientLines.join("\n")}
              placeholder={"1行に1つ（部署・担当者など）"}
              onChange={(e) => update({ clientLines: e.target.value.split("\n") })}
            />
          </Row>
          <Row label="件名">
            <input aria-label="件名" className={textInput} value={doc.subject} maxLength={300} placeholder="例：見本ホール 架空の催し" onChange={(e) => update({ subject: e.target.value })} onKeyDown={onEnterBlur} />
          </Row>
          <Row label="件名（短縮）">
            <input className={textInput} value={doc.subjectShort} maxLength={120} placeholder="フッターに出ます" onChange={(e) => update({ subjectShort: e.target.value })} onKeyDown={onEnterBlur} />
          </Row>
          <Row label="場所">
            <input className={textInput} value={doc.place} maxLength={200} onChange={(e) => update({ place: e.target.value })} onKeyDown={onEnterBlur} />
          </Row>
          <Row label="案件番号">
            <input className={`${textInput} font-mono`} value={doc.docNo} maxLength={60} onChange={(e) => update({ docNo: e.target.value })} onKeyDown={onEnterBlur} />
          </Row>
          <Row label="作成日">
            <input type="date" className="w-full bg-transparent py-2 text-right font-mono text-[15px] outline-none" value={doc.created} onChange={(e) => e.target.value && update({ created: e.target.value })} />
          </Row>
        </div>

        <div className="rounded-2xl border border-line bg-card">
          <Row label="会場名">
            <input aria-label="会場名" className={textInput} value={doc.venueName} maxLength={60} placeholder="例：第1会場" onChange={(e) => update({ venueName: e.target.value })} onKeyDown={onEnterBlur} />
          </Row>
          <Row label="会場の補足">
            <input className={textInput} value={doc.venueSub} maxLength={120} placeholder="例：メインホール" onChange={(e) => update({ venueSub: e.target.value })} onKeyDown={onEnterBlur} />
          </Row>
          <Row label="英字表記">
            <input className={`${textInput} font-mono`} value={doc.venueEn} maxLength={120} placeholder="例：VENUE 01 — MAIN HALL" onChange={(e) => update({ venueEn: e.target.value })} onKeyDown={onEnterBlur} />
          </Row>
        </div>

        <section aria-label="日程">
          <h2 className="mb-2 text-[13px] font-medium text-sub">日程（紙面には4行まで）</h2>
          <div className="rounded-2xl border border-line bg-card px-4 py-2">
            {doc.schedule.length === 0 && <p className="py-2 text-sm text-sub">まだ日程がありません。</p>}
            {doc.schedule.map((r, i) => (
              <div key={i} className="flex items-center gap-2 border-b border-[#1e1e1e] py-1 last:border-b-0">
                <input
                  aria-label={`日程${i + 1}の見出し`}
                  className="w-20 shrink-0 bg-transparent py-2 text-[15px] font-bold outline-none"
                  value={r.label}
                  maxLength={40}
                  placeholder="設営日"
                  onChange={(e) => update({ schedule: doc.schedule.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                />
                <input
                  aria-label={`日程${i + 1}の日時`}
                  className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none"
                  value={r.value}
                  maxLength={120}
                  placeholder="2099年12月1日（火）09:00〜"
                  onChange={(e) => update({ schedule: doc.schedule.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                />
                <button
                  type="button"
                  aria-label={`日程${i + 1}を消す`}
                  className="grid size-9 shrink-0 place-items-center text-mute"
                  onClick={() => update({ schedule: doc.schedule.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <Btn tone="line" className="mt-2 w-full text-[13px]" disabled={doc.schedule.length >= 6} onClick={() => update({ schedule: [...doc.schedule, { label: "", value: "" }] })}>
            ＋ 日程を足す
          </Btn>
        </section>

        <section aria-label="機材">
          <h2 className="mb-2 text-[13px] font-medium text-sub">
            機材（{equipItemCount(doc)} 件{equipTotalQty(doc) > 0 ? `・合計 ${equipTotalQty(doc)} 点` : ""}）
          </h2>
          {doc.sections.length === 0 && <Empty>グループがありません。下のボタンから足してください。</Empty>}
          {doc.sections.map((sec, si) => (
            <div key={si} className="mb-4">
              <div className="mb-1 flex items-center gap-1">
                <span className="size-2 shrink-0 bg-fg" />
                <input
                  aria-label={`グループ${si + 1}の見出し`}
                  className="min-w-0 flex-1 bg-transparent px-1 py-1 text-[15px] font-bold outline-none"
                  value={sec.title}
                  maxLength={120}
                  placeholder="例：メイン機材"
                  onChange={(e) => setSectionTitle(si, e.target.value)}
                  onKeyDown={onEnterBlur}
                />
                <button type="button" aria-label={`グループ${si + 1}を上へ`} className="grid h-8 w-8 place-items-center text-mute disabled:opacity-20" disabled={si === 0} onClick={() => moveSection(si, -1)}>
                  ▲
                </button>
                <button type="button" aria-label={`グループ${si + 1}を下へ`} className="grid h-8 w-8 place-items-center text-mute disabled:opacity-20" disabled={si === doc.sections.length - 1} onClick={() => moveSection(si, 1)}>
                  ▼
                </button>
                <button
                  type="button"
                  aria-label={`グループ${si + 1}を消す`}
                  className="grid h-8 w-8 place-items-center text-mute"
                  onClick={() => window.confirm("このグループと中の機材を消します。よろしいですか？") && update({ sections: doc.sections.filter((_, j) => j !== si) })}
                >
                  ✕
                </button>
              </div>
              <ul className="rounded-2xl border border-line bg-card px-2">
                {sec.items.length === 0 && <li className="px-2 py-4 text-center text-sm text-sub">まだ機材がありません。</li>}
                {sec.items.map((it, ii) => (
                  <li key={ii} className="flex items-stretch gap-1 border-b border-[#1c1c1c] last:border-b-0">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left" onClick={() => setSheet({ sec: si, index: ii, item: { ...it } })}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{it.name || "（機材名なし）"}</span>
                        <span className="block truncate font-mono text-[12px] text-sub">
                          {[it.code, it.model].filter(Boolean).join("　")}
                        </span>
                      </span>
                      <span className="font-mono text-[15px] font-bold">
                        {it.qty == null ? "—" : it.qty}
                        {it.unit}
                      </span>
                    </button>
                    <span className="flex flex-col justify-center">
                      <button type="button" aria-label={`${ii + 1}件目を上へ`} className="grid h-6 w-8 place-items-center text-mute disabled:opacity-20" disabled={ii === 0} onClick={() => moveItem(si, ii, -1)}>
                        ▲
                      </button>
                      <button type="button" aria-label={`${ii + 1}件目を下へ`} className="grid h-6 w-8 place-items-center text-mute disabled:opacity-20" disabled={ii === sec.items.length - 1} onClick={() => moveItem(si, ii, 1)}>
                        ▼
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <Btn tone="line" className="mt-2 w-full text-[13px]" onClick={() => setSheet({ sec: si, index: null, item: blankItem() })}>
                ＋ 機材を足す
              </Btn>
            </div>
          ))}
          <Btn tone="line" className="w-full" onClick={() => update({ sections: [...doc.sections, { title: "", items: [] }] })}>
            ＋ グループを足す
          </Btn>
          <Btn tone="ghost" className="mt-6 w-full" onClick={remove}>
            この機材リストを消す
          </Btn>
        </section>
      </main>

      <div className="pb-safe fixed inset-x-0 bottom-0 border-t border-line bg-[#0b0b0b]/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto max-w-xl">
          <Btn
            className="w-full"
            onClick={() =>
              void flush()
                .catch(() => {})
                .then(() => go(`/equip/${id}`))
            }
          >
            プレビューを見る
          </Btn>
        </div>
      </div>

      {sheet && (
        <Sheet
          title={sheet.index == null ? "機材を足す" : "機材を直す"}
          onClose={() => setSheet(null)}
          footer={
            <div className="flex gap-2">
              {sheet.index != null && (
                <Btn
                  tone="ghost"
                  onClick={() => {
                    removeItem(sheet.sec, sheet.index!);
                    setSheet(null);
                  }}
                >
                  消す
                </Btn>
              )}
              <Btn
                className="flex-1"
                onClick={() => {
                  if (sheet.index == null) {
                    update({ sections: doc.sections.map((s, i) => (i === sheet.sec ? { ...s, items: [...s.items, sheet.item] } : s)) });
                  } else {
                    setItem(sheet.sec, sheet.index, sheet.item);
                  }
                  setSheet(null);
                }}
              >
                {sheet.index == null ? "足す" : "この内容にする"}
              </Btn>
            </div>
          }
        >
          <div className="rounded-2xl border border-line bg-card">
            <Row label="機材名">
              <input aria-label="機材名" className={textInput} value={sheet.item.name} maxLength={300} onChange={(e) => setSheet({ ...sheet, item: { ...sheet.item, name: e.target.value } })} onKeyDown={onEnterBlur} />
            </Row>
            <Row label="型番・仕様">
              <input aria-label="型番・仕様" className={textInput} value={sheet.item.model} maxLength={300} onChange={(e) => setSheet({ ...sheet, item: { ...sheet.item, model: e.target.value } })} onKeyDown={onEnterBlur} />
            </Row>
            <Row label="コード">
              <input className={`${textInput} font-mono`} value={sheet.item.code} maxLength={60} onChange={(e) => setSheet({ ...sheet, item: { ...sheet.item, code: e.target.value } })} onKeyDown={onEnterBlur} />
            </Row>
            <Row label="数量">
              <input
                className={`${textInput} font-mono`}
                inputMode="decimal"
                aria-label="数量" value={sheet.item.qty == null ? "" : String(sheet.item.qty)}
                placeholder="数えられないものは空欄"
                onChange={(e) => setSheet({ ...sheet, item: { ...sheet.item, qty: toNumber(e.target.value) } })}
                onKeyDown={onEnterBlur}
              />
            </Row>
            <Row label="単位">
              <input className={textInput} value={sheet.item.unit} maxLength={20} onChange={(e) => setSheet({ ...sheet, item: { ...sheet.item, unit: e.target.value } })} onKeyDown={onEnterBlur} />
            </Row>
            <Row label="備考">
              <input className={textInput} value={sheet.item.note} maxLength={300} placeholder="手配先など" onChange={(e) => setSheet({ ...sheet, item: { ...sheet.item, note: e.target.value } })} onKeyDown={onEnterBlur} />
            </Row>
          </div>
        </Sheet>
      )}
      {toast}
    </div>
  );
}
