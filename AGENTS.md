# SW BILL

freee の請求書・見積書・納品書を SEVENTHWELL のデザインの PDF にするツール。作成（掛率の自動計算）と、AI 用の入口（下書きまで）も持つ。公開リポ（秘密の値・実在の取引先のデータは入れない）。公開先は https://bill.seventh-well.com 。

## コマンド（どれも動作確認済み）

- `npm ci` … 準備
- `npm run check` … 型の検査 ＋ テスト ＋ ビルド。**完成と言う前に必ず通す**
- `npm test` … テストだけ
- `npm run bill -- --help` … サイトを使わずに手元で PDF づくり・掛率の計算をするコマンド（`scripts/bill.ts`）
- `npm run fake-freee` と `npm run dev` … 手元で動かす（偽物の freee につなぐ。`.dev.vars.example` を `.dev.vars` に写す）
- `npm run e2e` … 画面を自動で一通り試す（上の2つを動かした状態で）
- `SAMPLE_OUT=/tmp/x SAMPLE_FONTS=file://$PWD/public/fonts npx vitest run` … 紙面の見本 HTML を書き出す（Chrome で PDF にして目で確かめる）

## フォルダ

- `src/shared/` … 画面とサーバーの両方で使う。`calc.ts`（掛率・金額・単位欄の書き方）、`convert.ts`（freee との変換・照合・入力チェック）、`render.ts`（紙面）、`equip.ts`（機材リストの紙面）
- `src/server/` … `index.ts`（入口）、`freee.ts`（通信）、`vault.ts`（保存箱）、`pdf.ts`、`drafts.ts`、`mcp.ts`
- `src/client/` … 画面（React）
- `src/shared/glyphs.ts` … `scripts/make-glyphs.py` が作る。**手で直さない**（Goodtimes のフォント本体はリポに入れない）

## AI がこのリポを使って書類を作るとき（Muse など。サイトは使わない）

freee の読み書きは、呼ぶ側の AI が自分の freee 接続（freee 公式の接続など）で行う。このリポのコマンドは計算と紙面づくりだけをする。`npm ci` のあと：

**PDF にする**（freee にある書類 → SEVENTHWELL の紙面）

1. freee から書類を1件取る（`GET /invoices/{id}`・`/quotations/{id}`・`/delivery_slips/{id}`、`company_id` 必須）。返り値をそのままファイルに保存する
2. `npm run bill -- pdf invoice 書類.json out`（種類は `invoice` / `quotation` / `delivery_slip`）
3. 出力の `pdf` の場所を利用者に渡す。金額が freee の数字と合わないときは作らずに失敗する。そのときは理由をそのまま利用者に伝え、数字を直して作り直さない

**新しく作る**（掛率の計算 → freee に保存 → PDF）

1. 取引先を freee で探して `partner_id` を決める（`GET /api/1/partners?keyword=`）。候補が複数なら利用者に聞く
2. 依頼を JSON に書く（下の見本）。**掛率・金額は自分で計算しない**。台数・日数・区分・1日の単価だけを書く
3. `npm run bill -- body 依頼.json --company 事業所ID --preview out`
4. 出力の `freee_body`・`totals`・`warnings` と下書きの PDF を利用者に見せ、**「保存してよい」と言われてから** `post_path` に `freee_body` を POST する。言われる前に保存しない
5. 保存で返ってきた書類を上の「PDF にする」に渡す。合計が `totals` と違ったら利用者に知らせる

```json
{
  "kind": "quotation",
  "partner_id": 77,
  "partner_name": "見本イベント合同会社",
  "date": "2099-12-01",
  "subject": "見本ホール 架空の催し",
  "days": 3,
  "lines": [
    { "type": "heading", "text": "映像機材" },
    { "type": "item", "name": "見本プロジェクター", "category": "A", "quantity": 2, "unit": "台", "unit_price": 40000 },
    { "type": "discount_percent", "percent": 10 },
    { "type": "item", "name": "オペレーター", "category": "none", "quantity": 3, "unit": "人日", "unit_price": 35000 }
  ]
}
```

- `category`：A＝映像、B＝音響、C＝カメラ、none＝掛率なし（人件費・交通費など）。掛率は日数から表で決まる（5日まで。6日以上は利用者に掛率を聞いて `rate` に入れる）
- `unit_price` は1日の単価。分からないときは推測せず利用者に聞く。`--items 単価表.json`（`[{"name","category","unit","unitPrice"}]`）を渡すと、表にある品名は表の単価が使われる
- そのほかの項目：`due_date`（支払期日・有効期限）、`note`（備考）、行ごとの `days`。敬称は「御中」で入る
- 失敗したら終了コードが 0 以外になり、理由が標準エラーに日本語で出る。`need_price`・`need_rate` に当たる内容は利用者に聞く
- PDF 化には Chrome が要る（無ければ HTML だけ作り、その旨を返す。`CHROME=場所` で指定できる）

## 決まり

- 金額・消費税は freee の数字をそのまま出す。紙面で計算し直さない（`validateDoc` で照合し、合わなければ PDF を作らない）
- 掛率・金額の計算は `src/shared/calc.ts` だけで行う。AI に計算させない
- サイトから freee への書き込みは `/api/drafts/:id/commit` だけ。AI 用の入口（`mcp.ts`）に freee へ書き込む道具を足さない
- 機材リストは freee に保存しない（保存箱だけ）。入力の形直しは `src/server/equip.ts`、紙面は `src/shared/equip.ts`。題字の EQUIPMENT LIST に要る P・M は `make-glyphs.py` の文字集合に入れてある
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
