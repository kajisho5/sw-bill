# SW BILL

freee の請求書・見積書・納品書を、SEVENTHWELL のデザインの PDF にして出すツールです。
書類の作成もでき、台数と日数を入れると掛率と金額が自動で出ます。iPhone のブラウザで使います。
同じデザインで、機材リスト（会場ごとの機材一覧）も作れます。機材リストは freee には無い、このツールだけの書類です。

- 番号を振る・取引に登録する・入金を管理するのは、今までどおり freee です
- freee に書き込むのは、プレビューを見て「freee に保存」を押したときだけです
- AI（Claude・Muse など）からは「下書き」まで作れます。freee への保存は人が押します

設計の経緯と画面のデザインは [docs/design.md](docs/design.md) にあります。

## できること

| 画面 | できること |
| --- | --- |
| 一覧 | 月ごとに請求書・見積書・納品書を表示。未送付・未入金・下書きで絞り込み。選んだ分をまとめて PDF（ZIP） |
| プレビュー | PDF と同じ紙面を確認。PDF を作って共有・保存。別の種類の書類に複製。書類を直す |
| 作成 | 取引先・件名・日付・明細を入力。区分（A 映像・B 音響・C カメラ）と日数から掛率を自動で入れる。値引き行 |
| 機材リスト | 一覧の切り替えから表示。発注元・日程・件名・会場と、グループごとの機材（コード・型番・数量・備考）を入力。プレビューから PDF。複製もできる |
| 設定 | 掛率の表、単価表、AI 用の入口の URL、ログアウト |

## 掛率の扱い

freee には掛率の欄がないので、次のように保存します。

| ツールで入れたもの | freee の欄 | 例 |
| --- | --- | --- |
| 数量 × 掛率 | 数量 | 1台 × 1.5 → 1.5 |
| 単位・日数・掛率 | 単位 | 台・3日・掛率1.5 |
| 単価（1日） | 単価 | 40000 |

紙面では単位欄の文字を読み取って「数量・単位・日数・掛率・単価（1日）・金額」の列に分けて出します。
単位欄がこの形でない書類（これまでの書類）は、今までどおり数量だけで出します。
掛率の表の最初の値は、株式会社ハーツの 2023 Rental GUIDE と同じです（設定画面で直せます）。

## 動かし方（手元）

Node.js 22.18 以上が必要です。手元では本物の freee につながず、「偽物の freee」（架空のデータ）で動かします。

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run fake-freee   # 別の画面で。偽物の freee（ポート 8799）
npm run dev          # 画面をビルドして http://127.0.0.1:8787 で起動
```

確かめるコマンド：

```bash
npm run check   # 型の検査・テスト・ビルド
npm run e2e     # 画面を自動で動かして一通り試す（fake-freee と dev を動かした状態で。Chrome が要る）
```

手元では PDF を作る機能（Cloudflare のサーバー側ブラウザ）は動きません。紙面の確認はプレビューで行います。

## 公開のしかた

main に反映すると、GitHub Actions が検査を通してから Cloudflare Workers に公開します（`.github/workflows/deploy.yml`）。
公開用の鍵と DNS は [tower](https://github.com/kajisho5/tower) の `projects/sw-bill.toml` が用意します。

公開先：https://bill.seventh-well.com

### 最初の1回だけ必要な設定

1. **freee のアプリ登録**
   1. https://app.secure.freee.co.jp/developers/applications を開き、「アプリを新規作成」を押す
   2. アプリ名に `SW BILL`、コールバックURLに `https://bill.seventh-well.com/auth/callback` を入れて作成する
   3. 権限の設定で、請求書（見積書・請求書・納品書）の読み取りと書き込み、会計の取引先と事業所の読み取りにあたる項目にチェックを入れて保存する（画面上の項目名は未確認。最初の設定のときに確かめて、ここを書き直す）
   4. 画面に出る Client ID と Client Secret を控える
2. **Cloudflare に2つの値を入れる**
   1. https://dash.cloudflare.com/?to=/:account/workers/services/view/sw-bill/production/settings を開く
   2. 「Variables and Secrets（変数とシークレット）」の「Add（追加）」を押す
   3. Type を「Secret」にして、`FREEE_CLIENT_ID` と `FREEE_CLIENT_SECRET` を1つずつ入れて「Deploy」を押す

ログインの印の署名に使う合言葉と、AI 用の入口の合言葉は、初回に自動で作られてツールの保存箱に入ります（設定は要りません）。

## AI がリポから直接使う（サイトなし）

GitHub からこのリポを取ってくれば、サイトにログインしなくても PDF づくりと掛率の計算ができます。freee の読み書きは、使う AI（Muse など）が自分の freee 接続で行います。

- `npm run bill -- pdf invoice 書類.json out` … freee の書類を SEVENTHWELL の紙面の PDF にする
- `npm run bill -- body 依頼.json --company 事業所ID --preview out` … 掛率と金額を計算し、freee に保存する中身を出す

AI 向けの手順と依頼の書き方は `AGENTS.md` にあります。

## AI から使う（MCP）

設定画面の「AI から下書きを作る」で URL をコピーし、Claude や Muse のコネクタ（MCP）に登録します。
AI が使える道具は、取引先を探す・単価表を見る・掛率の表を見る・下書きを作る・下書きを直す・下書きを見る・機材リストを作る・機材リストを直す・機材リストを見る・機材リストの一覧、の10個です。

- 掛率と金額はサーバーが計算します（AI には計算させません）
- 単価は単価表を優先します。単価表にない品名は、AI が単価を示したときだけ「未確認」の印つきで入ります
- URL は合言葉を兼ねます。漏れたら設定画面の「作り直す」で無効にできます

## 構成

- 画面：React 19 ＋ TypeScript 7 ＋ Tailwind CSS 4 ＋ Vite 8
- サーバー：Cloudflare Workers ＋ Hono 4（1つの Worker が画面の配信・freee との通信・PDF・AI 用の入口を受け持つ）
- 保存：Durable Object（freee の鍵・掛率の表・単価表・下書き・機材リスト・合言葉）。請求書のデータと PDF は保存しない
- PDF：Cloudflare Browser Run（サーバー側の Chrome）。紙面は1ページ1枚の SVG で、プレビューと同じもの

```
src/shared/   画面とサーバーの両方で使うもの（データの形・掛率と金額・freee との変換・紙面）
src/server/   サーバー（入口・freee との通信・保存箱・PDF・下書き・AI 用の入口）
src/client/   画面
test/         テストと架空のデータ
scripts/      偽物の freee、画面の自動試験、ロゴ文字の輪郭を作る道具
```

## 分かっている制限

- PDF は Cloudflare の無料枠（1日10分）の中で作ります。まとめ書き出しは1件ずつ順番に作るので、件数が多いと時間がかかります
- 掛率の表は5日まで。6日以上は明細ごとに手で入れます
- 新しい取引先の登録、書類の取り消し、メール送信は freee で行います
- 消費税などの最終の数字は freee の計算が正です。下書きのプレビューの数字と違ったときは、保存の直後に知らせます
- 紙面の日本語の文字は、PDF では Cloudflare 側の Noto Sans CJK、プレビューでは端末の文字で出ます（文字の幅は同じなので配置は変わりません）

テスト・見本のデータは、取引先・金額・住所・口座・登録番号とも、すべて架空です。
