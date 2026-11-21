import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DOC_KINDS, type DocKind } from "../shared/types";
import "./app.css";
import { Btn, ErrorPanel, Loading, Ring, Wordmark } from "./components/ui";
import { api, ApiError } from "./lib/api";
import { go, useLocation } from "./lib/router";
import { Editor, NewDraft } from "./screens/Editor";
import { List } from "./screens/List";
import { Preview } from "./screens/Preview";
import { Settings } from "./screens/Settings";

const LOGIN_ERRORS: Record<string, string> = {
  company: "SEVENTHWELL の事業所に入れるアカウントでログインしてください。",
  state: "ログインの途中で時間が空きました。もう一度お試しください。",
  denied: "freee での許可が取り消されました。もう一度お試しください。",
  token: "freee からログインの確認を受け取れませんでした。もう一度お試しください。",
  network: "freee とつながりませんでした。通信の状態を確かめて、もう一度お試しください。",
  setup: "まだ設定が終わっていません（freee のアプリ登録と秘密の値）。",
};

function Login({ reason }: { reason: string | null }) {
  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col items-center px-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16">
        <Ring size={132} />
        <Wordmark text="SEVENTHWELL" height={17} />
        <Wordmark text="BILL" height={30} spacing={0.3} />
        <p className="text-center text-[13px] text-sub">freee の請求書・見積書・納品書を、SEVENTHWELL の見た目で。</p>
      </div>
      <div className="pb-safe w-full">
        {reason && (
          <p className="mb-3 rounded-2xl border border-[#5a2a2a] bg-[#1a0f0f] p-3 text-sm leading-6 text-[#ffd6d6]" role="alert">
            {LOGIN_ERRORS[reason] ?? "ログインできませんでした。もう一度お試しください。"}
          </p>
        )}
        <a href="/auth/login" className="flex min-h-14 w-full items-center justify-center rounded-[14px] bg-fg text-[16px] font-bold text-bg">
          freee でログイン
        </a>
        <p className="mt-4 text-center text-xs leading-5 text-mute">
          SEVENTHWELL の事業所だけが使えます
          <br />
          パスワードはこのツールに保存されません
        </p>
      </div>
    </div>
  );
}

function App() {
  const { path, query } = useLocation();
  const [state, setState] = useState<{ status: "loading" | "in" | "out" | "error"; today?: string; message?: string }>({ status: "loading" });

  const check = () => {
    setState({ status: "loading" });
    api<{ today: string }>("/api/me")
      .then((j) => setState({ status: "in", today: j.today }))
      .catch((e: ApiError) => setState(e.status === 401 ? { status: "out" } : { status: "error", message: e.message }));
  };
  useEffect(() => {
    check();
    const out = () => setState({ status: "out" });
    window.addEventListener("sw-login", out);
    return () => window.removeEventListener("sw-login", out);
  }, []);

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") return <ErrorPanel message={state.message ?? "読み込めませんでした。"} onRetry={check} />;
  if (state.status === "out") return <Login reason={query.get("login_error")} />;
  const today = state.today!;

  const doc = path.match(/^\/d\/([a-z_]+)\/(\d+)$/);
  if (doc && DOC_KINDS.includes(doc[1] as DocKind)) return <Preview key={path} kind={doc[1] as DocKind} id={Number(doc[2])} />;
  const edit = path.match(/^\/edit\/([A-Za-z0-9_-]+)$/);
  if (edit) return <Editor key={edit[1]} id={edit[1]} />;
  if (path === "/new") return <NewDraft kind={DOC_KINDS.includes(query.get("k") as DocKind) ? (query.get("k") as DocKind) : "quotation"} today={today} />;
  if (path === "/settings") return <Settings />;
  if (path === "/") return <List today={today} />;
  return (
    <div className="px-6 py-20 text-center">
      <p className="text-sm text-sub">そのページはありません。</p>
      <Btn className="mt-4" onClick={() => go("/", true)}>
        一覧へ戻る
      </Btn>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
