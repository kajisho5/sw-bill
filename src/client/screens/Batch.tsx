// まとめて書き出し。1件ずつ順番に PDF を作り、終わったら ZIP で保存する。
import { zipSync } from "fflate";
import { useEffect, useRef, useState } from "react";
import { fileName, yen } from "../../shared/format";
import type { Summary } from "../../shared/types";
import { Btn, Sheet, Spinner } from "../components/ui";
import { download, fetchPdf } from "../lib/api";

type State = "wait" | "run" | "done" | "fail";

export function Batch({ docs, label, onClose }: { docs: Summary[]; label: string; onClose: () => void }) {
  const [states, setStates] = useState<State[]>(() => docs.map(() => "wait"));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [running, setRunning] = useState(false);
  const files = useRef(new Map<number, { name: string; data: Uint8Array }>());
  const stop = useRef(false);

  const run = async (targets: number[]) => {
    stop.current = false;
    setRunning(true);
    for (const i of targets) {
      if (stop.current) break;
      const d = docs[i];
      setStates((s) => s.map((v, j) => (j === i ? "run" : v)));
      try {
        const blob = await fetchPdf(`/api/docs/${d.kind}/${d.id}/pdf`);
        if (stop.current) break;
        files.current.set(i, { name: fileName(d.kind, d.date, d.partnerName, d.number), data: new Uint8Array(await blob.arrayBuffer()) });
        setStates((s) => s.map((v, j) => (j === i ? "done" : v)));
      } catch (e) {
        setErrors((m) => ({ ...m, [i]: (e as Error).message }));
        setStates((s) => s.map((v, j) => (j === i ? "fail" : v)));
      }
    }
    setRunning(false);
  };

  useEffect(() => {
    void run(docs.map((_, i) => i));
    return () => {
      stop.current = true;
    };
    // 開いたときに1回だけ始める
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = states.filter((s) => s === "done").length;
  const failed = states.map((s, i) => (s === "fail" ? i : -1)).filter((i) => i >= 0);

  const saveZip = () => {
    const entries: Record<string, Uint8Array> = {};
    for (const f of files.current.values()) {
      let name = f.name;
      for (let n = 2; entries[name]; n++) name = f.name.replace(/\.pdf$/, `_${n}.pdf`);
      entries[name] = f.data;
    }
    const zip = zipSync(entries, { level: 0 });
    download(new Blob([zip as BlobPart], { type: "application/zip" }), `${label.replace(/[\s.]+/g, "_")}.zip`);
  };

  const close = () => {
    stop.current = true;
    onClose();
  };

  return (
    <Sheet
      title="まとめて書き出し"
      onClose={close}
      footer={
        <div className="space-y-2">
          {failed.length > 0 && !running && (
            <Btn tone="line" className="w-full" onClick={() => run(failed)}>
              失敗した {failed.length} 件をやり直す
            </Btn>
          )}
          <Btn className="w-full" disabled={running || done === 0} onClick={saveZip}>
            {running ? "作っています…" : `ZIP で保存（${done}件）`}
          </Btn>
        </div>
      }
    >
      <div className="py-4 text-center">
        <p className="font-mono text-[52px] font-bold leading-none tracking-tight" aria-live="polite">
          {done} / {docs.length}
        </p>
        <p className="mt-3 text-[13px] text-sub">{running ? `${label} の PDF を作っています` : failed.length ? `${failed.length} 件が失敗しました` : "できました"}</p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#222]" role="progressbar" aria-valuemin={0} aria-valuemax={docs.length} aria-valuenow={done}>
          <div className="h-full rounded-full bg-fg transition-all" style={{ width: `${(done / Math.max(1, docs.length)) * 100}%` }} />
        </div>
      </div>
      <ul>
        {docs.map((d, i) => (
          <li key={d.id} className="border-b border-[#1c1c1c] py-3">
            <div className="flex items-center gap-3">
              <span className="grid size-5 shrink-0 place-items-center">
                {states[i] === "done" ? (
                  <span className="grid size-5 place-items-center rounded-full bg-fg text-bg">
                    <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7" />
                    </svg>
                  </span>
                ) : states[i] === "run" ? (
                  <Spinner />
                ) : states[i] === "fail" ? (
                  <span className="text-[#ff9a9a]" aria-label="失敗">
                    ！
                  </span>
                ) : (
                  <span className="size-[18px] rounded-full border-2 border-[#3a3a3a]" />
                )}
              </span>
              <span className={`min-w-0 flex-1 truncate text-sm ${states[i] === "wait" ? "text-mute" : ""}`}>{d.partnerName}</span>
              <span className={`font-mono text-sm ${states[i] === "wait" ? "text-mute" : "text-[#d8d8d8]"}`}>¥{yen(d.total)}</span>
            </div>
            {errors[i] && states[i] === "fail" && <p className="mt-1 pl-8 text-xs leading-5 text-[#ffb3b3]">{errors[i]}</p>}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
