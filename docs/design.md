# 設計のまとめ

くわしい設計書（調べたこと・比較・根拠のURL）は Claude の文書にあります：
https://claude.ai/artifact/Q1fy4kLJqU6V4uf7p8si28

確認して決めたデザイン（中のデータはすべて架空）：

| ファイル | 中身 |
| --- | --- |
| [design/invoice-a4.svg](design/invoice-a4.svg) | 請求書（A4・1ページ） |
| [design/invoice-a4-2pages.svg](design/invoice-a4-2pages.svg) | 明細が多くて2ページになる場合 |
| [design/quotation-delivery-a4.svg](design/quotation-delivery-a4.svg) | 見積書・納品書 |
| [design/quotation-rate-a4.svg](design/quotation-rate-a4.svg) | 掛率の列が入った見積書 |
| [design/app-screens.svg](design/app-screens.svg) | 操作画面（ログイン・一覧・プレビュー・まとめて書き出し） |
| [design/create-screens.svg](design/create-screens.svg) | 作成画面（書類を作成・明細を追加・掛率の表） |
| [design/equipment-a4.svg](design/equipment-a4.svg) | 機材リスト（A4・1ページ。実装の見本から書き出したもの） |

## 決めたこと

- 作るのは「freee を読んで PDF を出す」＋「作成（掛率の自動計算）」＋「AI 用の入口（下書きまで）」
- 対象は請求書・見積書・納品書の3種類。同じ型で、題・日付の項目・下の欄だけが変わる
- 機材リスト（2026-11-24 追加）：freee には無い書類なので保存は保存箱だけ。紙面は同じ型を使い、題は EQUIPMENT LIST、宛先は発注元、右は日程、黒帯は会場名と機材の総数、表の列はコード・機材名・型番・仕様・数量・単位・備考・確認
- 掛率は株式会社ハーツの表と同じ値から始める。freee には「数量 × 掛率」を数量に、「台・3日・掛率1.5」を単位欄に入れる
- 金額と消費税は freee の数字を正とする
- PDF は Cloudflare のサーバー側ブラウザで作る。紙面は1ページ1枚の SVG

## 設計書から変えた所（実装のときに決めた）

- `@cloudflare/vite-plugin` は使わない。画面は Vite でビルドし、サーバーは wrangler がまとめる（仕組みが少なくて済むため）
- 紙面は HTML の表ではなく SVG で描く。ページ分けを自前で行い、確認したデザインの座標をそのまま使える
- ログインの印の署名用と AI 用の入口の合言葉は、自動で作って保存箱に置く（iPhone で乱数を作って入れる手間をなくすため）
- 日本語の文字は Web フォントを配らない（PDF は Cloudflare 側の Noto Sans CJK、プレビューは端末の文字）。配るのは Space Mono だけ
- 一覧の日付の絞り込みは `start_billing_date` などで行える（freee 公式の定義 freee/freee-api-schema で確認）
- freee の単位欄は255文字まで、数量は小数3桁まで（同じ定義で確認）
