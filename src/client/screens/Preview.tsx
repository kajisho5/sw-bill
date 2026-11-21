// 書類のプレビュー。PDF と同じ紙面を見て、PDF を作って共有・保存する。
import { useEffect, useRef, useState } from "react";
import { KIND_LABEL, type Doc, type DocKind } from "../../shared/types";
import { BackIcon, Btn, ErrorPanel, IconBtn, Loading, useToast } from "../components/ui";
import { api, download, fetchPdf, share } from "../lib/api";
import { back, go } from "../lib/router";

interface Info {
  doc: Doc;
  pages: number;
  problems: string[];
  fileName: string;
}

/** 紙面を枠の中に出す。幅に合わせて高さを決める（A4 の比率 × ページ数）。 */
export function Paper({ src, pages, title }: { src: string; pages: number; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const pageH = (w * 297) / 210;
  const h = pageH * pages + w * 0.02 * (pages - 1);
  return (
    <div ref={ref} className="overflow-hidden border border-[#2a2a2a] bg-[#2a2a2a]">
      {w > 0 && <iframe title={title} src={src} className="block w-full border-0" style={{ height: h }} />}
    </div>
  );
}

export function Preview({ kind, id }: { kind: DocKind; id: number }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [copying, setCopying] = useState<DocKind | "edit" | null>(null);
  const [reload, setReload] = useState(0);
  const [toast, showToast] = useToast();

  useEffect(() => {
    let alive = true;
    setInfo(null);
    setError(null);
    setPdf(null);
    api<Info>(`/api/docs/${kind}/${id}`)
      .then((j) => alive && setInfo(j))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [kind, id, reload]);

  const makePdf = async () => {
    setBusy(true);
    setPdfError(null);
    try {
      setPdf(await fetchPdf(`/api/docs/${kind}/${id}/pdf`));
    } catch (e) {
      setPdfError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (to: DocKind | "edit") => {
    setCopying(to);
    try {
      const q = to === "edit" ? "?edit=1" : `?to=${to}`;
      const j = await api<{ draft: { id: string } }>(`/api/drafts/from/${kind}/${id}${q}`, "POST");
      go(`/edit/${j.draft.id}`);
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setCopying(null);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      <header className="pt-safe flex items-center gap-3 px-4 pb-3">
        <IconBtn label="戻る" onClick={() => back()}>
          <BackIcon />
        </IconBtn>
        <h1 className="flex-1 truncate pr-11 text-center font-mono text-[15px] font-bold">{info?.doc.number ?? KIND_LABEL[kind]}</h1>
      </header>
      {error ? (
        <ErrorPanel message={error} onRetry={() => setReload((n) => n + 1)} />
      ) : !info ? (
        <Loading />
      ) : (
        <main className="flex-1 px-4 pb-10">
          <Paper src={`/api/docs/${kind}/${id}/html`} pages={info.pages} title={`${KIND_LABEL[kind]} ${info.doc.number} のプレビュー`} />
          <p className="py-3 text-center text-xs text-sub">{info.pages} ページ</p>
          {info.problems.length > 0 && (
            <div className="mb-3 rounded-2xl border border-[#5a2a2a] bg-[#1a0f0f] p-4 text-sm leading-6 text-[#ffd6d6]" role="alert">
              <p className="font-bold">金額が合わないので、PDF は作れません。freee で確かめてください。</p>
              <ul className="mt-1 list-disc pl-5">
                {info.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="break-all rounded-xl border border-line bg-card px-3 py-3 font-mono text-xs text-[#d8d8d8]">{info.fileName}</p>
          {pdfError && <p className="mt-3 text-sm leading-6 text-[#ffb3b3]" role="alert">{pdfError}</p>}
          <div className="mt-3 space-y-2">
            {!pdf ? (
              <Btn className="w-full" busy={busy} disabled={info.problems.length > 0} onClick={makePdf}>
                {busy ? "PDF を作っています…" : "PDF を作る"}
              </Btn>
            ) : (
              <Btn className="w-full" onClick={() => share(pdf, info.fileName)}>
                PDF を共有
              </Btn>
            )}
            <div className="flex gap-2">
              <Btn tone="line" className="flex-1" disabled={!pdf} onClick={() => pdf && (download(pdf, info.fileName), showToast("保存しました"))}>
                ファイルに保存
              </Btn>
              <a
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-[14px] border border-[#4a4a4a] px-4 text-[15px] font-medium"
                href={`https://invoice.secure.freee.co.jp/reports/${kind === "invoice" ? "invoices" : kind === "quotation" ? "quotations" : "delivery_slips"}/${id}`}
                target="_blank"
                rel="noreferrer"
              >
                freee で開く
              </a>
            </div>
          </div>

          <h2 className="mt-8 text-[13px] font-medium text-sub">この書類から作る</h2>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(["quotation", "delivery_slip", "invoice"] as DocKind[]).map((k) => (
              <Btn key={k} tone="line" busy={copying === k} disabled={copying != null} onClick={() => copy(k)} className="px-2 text-[13px]">
                {KIND_LABEL[k]}
              </Btn>
            ))}
          </div>
          <Btn tone="ghost" className="mt-2 w-full" busy={copying === "edit"} disabled={copying != null} onClick={() => copy("edit")}>
            この書類を直す
          </Btn>
        </main>
      )}
      {toast}
    </div>
  );
}
