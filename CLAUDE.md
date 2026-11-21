# SW BILL

freee の請求書・見積書・納品書を SEVENTHWELL のデザインの PDF にするツール。作成（掛率の自動計算）と、AI 用の入口（下書きまで）も持つ。非公開リポ。公開先は https://bill.seventh-well.com 。

## コマンド（どれも動作確認済み）

- `npm ci` … 準備
- `npm run check` … 型の検査 ＋ テスト ＋ ビルド。**完成と言う前に必ず通す**
- `npm test` … テストだけ
- `npm run fake-freee` と `npm run dev` … 手元で動かす（偽物の freee につなぐ。`.dev.vars.example` を `.dev.vars` に写す）
- `npm run e2e` … 画面を自動で一通り試す（上の2つを動かした状態で）
- `SAMPLE_OUT=/tmp/x SAMPLE_FONTS=file://$PWD/public/fonts npx vitest run` … 紙面の見本 HTML を書き出す（Chrome で PDF にして目で確かめる）

## フォルダ

- `src/shared/` … 画面とサーバーの両方で使う。`calc.ts`（掛率・金額・単位欄の書き方）、`convert.ts`（freee との変換・照合・入力チェック）、`render.ts`（紙面）
- `src/server/` … `index.ts`（入口）、`freee.ts`（通信）、`vault.ts`（保存箱）、`pdf.ts`、`drafts.ts`、`mcp.ts`
- `src/client/` … 画面（React）
- `src/shared/glyphs.ts` … `scripts/make-glyphs.py` が作る。**手で直さない**（Goodtimes のフォント本体はリポに入れない）

## 決まり

- 金額・消費税は freee の数字をそのまま出す。紙面で計算し直さない（`validateDoc` で照合し、合わなければ PDF を作らない）
- 掛率・金額の計算は `src/shared/calc.ts` だけで行う。AI に計算させない
- freee への書き込みは `/api/drafts/:id/commit` だけ。AI 用の入口（`mcp.ts`）に freee へ書き込む道具を足さない
- 外から来た文字（freee・画面・AI）は `render.ts` の `esc` を通して出す。入力は `drafts.ts` で形を直してから保存する
- 秘密の値はコード・リポ・ログに入れない。Cloudflare の Secret は `FREEE_CLIENT_ID` と `FREEE_CLIENT_SECRET` だけ
- テスト・見本のデータに実在の名前（取引先・会場・人・住所・口座・登録番号）を使わない。架空のものにする
- 画面・文書は日本語。「版」ではなく「バージョン」と書く
- 依存ライブラリのバージョンを勝手に上げない
- git の作者メールは info@seventh-well.com

## 紙面を変えたとき

`render.ts` は 0.1mm 単位の SVG（2100×2970）。変えたら見本を PDF にして、1ページ・複数ページ・掛率あり・軽減税率と源泉徴収あり、の4つを目で確かめる。

## 公開

main に反映すると `.github/workflows/deploy.yml` が `npm run check` を通してから公開する（鍵と DNS は kajisho5/tower の `projects/sw-bill.toml`）。バージョンは `package.json` の `version`（設定画面の下に出る）。

## freee の仕様を調べるとき

- freee 公式のスキル `freee-api-skill`（https://github.com/freee/freee-mcp の `skills/freee-api-skill/`）に、項目の一覧と使い方がある。記憶で書かずここを見る。
- このツールが使うのは `recipes/invoice-operations.md`、`references/invoice-invoices.md`、`invoice-quotations.md`、`invoice-delivery-slips.md`、`accounting-partners.md`。
- 2026-11-21 に freee-mcp v0.38.3 の内容と照合済み（作成時の必須項目、一覧の日付の絞り込み、取引先の `keyword` 検索、freee の画面の URL）。食い違いなし。
- そのスキルにある「メモタグ freee-mcp を付ける」は freee-mcp 経由の作成の決まりで、このツールには当てはめない。
