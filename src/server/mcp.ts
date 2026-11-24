// AI 用の入口（MCP）。Claude や Muse から「下書き」までを作れる。
// freee への保存はここからはできない（画面でプレビューを見て、人が押す）。
import { draftLineAmount, draftTotals } from "../shared/calc";
import { equipItemCount, equipTotalQty, KIND_LABEL, type Draft, type EquipDoc } from "../shared/types";
import { buildDraftFromAi } from "./drafts";
import { buildEquipFromAi } from "./equip";
import { AppError, getPartner, searchPartners, vault, type Env } from "./freee";

type J = Record<string, any>;

const lineSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["heading", "item", "discount_percent"], description: "heading=見出し行、item=金額の行、discount_percent=ここまでの機材費（掛率のある行）の◯%を値引きする行" },
    text: { type: "string", description: "heading のときの見出し（例：12/12-14 催事名、映像機材、交通諸経費）" },
    name: { type: "string", description: "item のときの品名。list_price_items の品名と同じ書き方にすると単価表の単価が使われる" },
    category: { type: "string", enum: ["none", "A", "B", "C"], description: "掛率の区分。A=映像、B=音響、C=カメラ、none=掛率なし（人件費・交通費など）。省略すると単価表の区分" },
    quantity: { type: "number", description: "数量（台数・人数×日数など）。掛率は掛けない" },
    unit: { type: "string", description: "単位（台・本・式など）。省略可" },
    days: { type: "integer", description: "機材を使う日数。省略すると書類全体の days" },
    rate: { type: "number", description: "掛率。表にない日数（6日以上）のときだけ、利用者に聞いた値を入れる。ふだんは入れない" },
    unit_price: { type: "number", description: "1日の単価（円・税抜）。単価表にある品名なら入れない。単価表にない品名のときだけ、利用者に聞いた値を入れる。推測で入れない" },
    percent: { type: "number", description: "discount_percent のときの割合（例：10）" },
  },
  required: ["type"],
};

const draftProps = {
  kind: { type: "string", enum: ["invoice", "quotation", "delivery_slip"], description: "invoice=請求書、quotation=見積書、delivery_slip=納品書" },
  partner_id: { type: "integer", description: "search_partners で見つけた取引先の id" },
  subject: { type: "string", description: "件名" },
  date: { type: "string", description: "書類の日付（YYYY-MM-DD）。省略すると今日" },
  due_date: { type: "string", description: "請求書は支払期限、見積書は有効期限（YYYY-MM-DD）。省略可" },
  days: { type: "integer", description: "機材を使う日数の初期値（1以上）" },
  note: { type: "string", description: "備考。省略可" },
  lines: { type: "array", items: lineSchema, description: "明細。上から順に並べる" },
};

const equipItemSchema = {
  type: "object",
  properties: {
    code: { type: "string", description: "機材コード（発注書の番号など）。無ければ省略" },
    name: { type: "string", description: "機材名" },
    model: { type: "string", description: "型番・仕様。無ければ省略" },
    qty: { type: "number", description: "数量。数えられないもの（会場備品など）は入れない" },
    unit: { type: "string", description: "単位（台・式・本など）" },
    note: { type: "string", description: "備考（手配先・共用先など）。無ければ省略" },
  },
  required: ["name"],
};

const equipProps = {
  docNo: { type: "string", description: "案件番号（発注書の番号など）。無ければ省略" },
  created: { type: "string", description: "作成日（YYYY-MM-DD）。省略すると今日" },
  clientName: { type: "string", description: "発注元（会社名）" },
  clientLines: { type: "array", items: { type: "string" }, description: "発注元の補足行（部署・担当者など）。最大3行まで紙面に出る" },
  schedule: {
    type: "array",
    items: { type: "object", properties: { label: { type: "string", description: "見出し（設営日・使用日・撤去日など）" }, value: { type: "string", description: "日時" } }, required: ["label", "value"] },
    description: "日程。最大4行まで紙面に出る",
  },
  subject: { type: "string", description: "件名（催事名）" },
  subjectShort: { type: "string", description: "フッターに出す短い件名。省略すると紙面では空欄" },
  place: { type: "string", description: "場所（会場施設名）" },
  venueName: { type: "string", description: "会場名（例：第1会場）" },
  venueSub: { type: "string", description: "会場の補足（例：メインホール）" },
  venueEn: { type: "string", description: "会場の英字表記（例：VENUE 01 — MAIN HALL）。省略可" },
  sections: {
    type: "array",
    items: { type: "object", properties: { title: { type: "string", description: "グループの見出し（例：メイン機材）" }, items: { type: "array", items: equipItemSchema } }, required: ["title", "items"] },
    description: "グループと機材。上から順に並べる",
  },
};

const TOOLS = [
  {
    name: "search_partners",
    description: "freee に登録されている取引先を名前で探す。下書きを作る前に、宛先の id を調べるために使う。",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "取引先名の一部" } }, required: ["query"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_price_items",
    description: "単価表（よく使う品名・区分・単位・1日の単価）を返す。item の品名と単価はここから選ぶ。",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_rate_table",
    description: "日数ごとの掛率の表（区分 A・B・C、1〜5日）を返す。掛率は下書きを作るときに自動で入るので、計算には使わなくてよい。",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_draft",
    description:
      "見積書・納品書・請求書の下書きを作る。掛率と金額はこのツールが計算する（AI は計算しない）。作れるのは下書きまでで、freee への保存は利用者が画面で行う。返ってきた open_url を利用者に伝える。",
    inputSchema: { type: "object", properties: draftProps, required: ["kind", "lines"] },
  },
  {
    name: "update_draft",
    description: "下書きを作り直す。lines を渡すと明細が丸ごと入れ替わる。freee に保存済みの下書きは直せない。",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "下書きの id" }, ...draftProps }, required: ["id", "lines"] },
  },
  {
    name: "get_draft",
    description: "下書きの中身（明細・掛率・金額・合計）を返す。",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_equipment_list",
    description:
      "機材リスト（会場ごとの機材一覧）を作る。freee には関係しない、このツールだけの書類。発注書などの内容を sections に分けて渡す。返ってきた open_url を利用者に伝える。",
    inputSchema: { type: "object", properties: equipProps, required: ["sections"] },
  },
  {
    name: "update_equipment_list",
    description: "機材リストを作り直す。渡した内容で丸ごと入れ替わる。",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "機材リストの id" }, ...equipProps }, required: ["id"] },
  },
  {
    name: "get_equipment_list",
    description: "機材リストの中身を返す。",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_equipment_lists",
    description: "機材リストの一覧（新しい順）を返す。",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
];


function describe(d: Draft, origin: string, warnings: string[] = []) {
  const t = draftTotals(d);
  return {
    id: d.id,
    kind: KIND_LABEL[d.kind],
    partner: d.partnerName || null,
    subject: d.subject,
    date: d.date,
    lines: d.lines.map((l) =>
      l.kind === "text"
        ? { heading: l.description }
        : { name: l.description, quantity: l.quantity, unit: l.unit, days: l.days, rate: l.rate, unit_price: l.unitPrice, amount: draftLineAmount(l), price_checked: l.priceChecked },
    ),
    subtotal: t.excl,
    tax: t.tax,
    total: t.total,
    saved_to_freee: d.freeeId != null,
    warnings,
    open_url: `${origin}/edit/${d.id}`,
    next_step: "利用者に open_url を伝え、画面でプレビューを確かめて「freee に保存」を押してもらう。",
  };
}

function describeEquip(e: EquipDoc, origin: string, warnings: string[] = []) {
  return {
    id: e.id,
    subject: e.subject,
    venue: [e.venueName, e.venueSub].filter(Boolean).join(" ") || null,
    client: e.clientName || null,
    total_qty: equipTotalQty(e),
    sections: e.sections.map((s) => ({
      title: s.title,
      items: s.items.map((it) => ({ code: it.code || null, name: it.name, model: it.model || null, qty: it.qty, unit: it.unit, note: it.note || null })),
    })),
    warnings,
    open_url: `${origin}/equip/${e.id}`,
    next_step: "利用者に open_url を伝え、画面で確かめて「PDF を作る」を押してもらう。",
  };
}

async function callTool(env: Env, origin: string, name: string, args: J): Promise<unknown> {
  const v = vault(env);
  switch (name) {
    case "search_partners":
      return { partners: (await searchPartners(env, String(args.query ?? "").trim())).slice(0, 30) };
    case "list_price_items":
      return { items: await v.getItems(), note: "単価は税抜・1日あたり。ここにない品名は、利用者に単価を聞いてから unit_price に入れる。" };
    case "get_rate_table":
      return { rates: await v.getRates(), note: "配列の左から 1日・2日・3日・4日・5日。6日以上は表にない。" };
    case "create_draft":
    case "update_draft": {
      let base: Draft | null = null;
      if (name === "update_draft") {
        base = await v.getDraft(String(args.id ?? ""));
        if (!base) throw new AppError(404, "not_found", "その下書きはありません。");
        if (base.freeeId) throw new AppError(409, "already_saved", "この下書きは freee に保存済みなので直せません。");
      }
      const [rates, items] = await Promise.all([v.getRates(), v.getItems()]);
      const built = buildDraftFromAi(args, rates, items, base);
      if (built.draft.partnerId && !built.draft.partnerName) {
        const hit = await getPartner(env, built.draft.partnerId).catch(() => null);
        if (!hit) throw new AppError(400, "bad_input", "partner_id が freee の取引先にありません。search_partners で調べ直してください。");
        built.draft.partnerName = hit.name;
      }
      await v.putDraft(built.draft);
      return describe(built.draft, origin, built.warnings);
    }
    case "get_draft": {
      const d = await v.getDraft(String(args.id ?? ""));
      if (!d) throw new AppError(404, "not_found", "その下書きはありません。");
      return describe(d, origin);
    }
    case "create_equipment_list":
    case "update_equipment_list": {
      let base: EquipDoc | null = null;
      if (name === "update_equipment_list") {
        base = await v.getEquip(String(args.id ?? ""));
        if (!base) throw new AppError(404, "not_found", "その機材リストはありません。");
      }
      const built = buildEquipFromAi(args, base);
      await v.putEquip(built.equip);
      return describeEquip(built.equip, origin, built.warnings);
    }
    case "get_equipment_list": {
      const e = await v.getEquip(String(args.id ?? ""));
      if (!e) throw new AppError(404, "not_found", "その機材リストはありません。");
      return describeEquip(e, origin);
    }
    case "list_equipment_lists":
      return {
        equipment_lists: (await v.listEquips()).map((e) => ({
          id: e.id,
          subject: e.subject,
          venue: [e.venueName, e.venueSub].filter(Boolean).join(" ") || null,
          client: e.clientName || null,
          total_qty: equipTotalQty(e),
          items: equipItemCount(e),
          updated_at: e.updatedAt,
          open_url: `${origin}/equip/${e.id}`,
        })),
      };
    default:
      throw new AppError(404, "unknown_tool", `知らない道具です：${name}`);
  }
}

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

async function handleOne(env: Env, origin: string, msg: J): Promise<J | null> {
  const id = msg?.id;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid Request");
  if (id === undefined) return null; // 通知には返事をしない
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: VERSIONS.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "sw-bill", version: "0.1.0" },
        instructions:
          "SEVENTHWELL の見積書・納品書・請求書の下書きと、機材リストを作る道具。掛率と金額はサーバーが計算する。単価は単価表から選び、無ければ利用者に聞く（推測しない）。freee への保存はできないので、できた下書きの open_url を利用者に伝える。機材リストは freee に関係しない書類で、作った open_url を利用者に伝える。",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      try {
        const out = await callTool(env, origin, name, (msg.params?.arguments ?? {}) as J);
        return reply({ content: [{ type: "text", text: JSON.stringify(out) }] });
      } catch (e) {
        const text = e instanceof AppError ? e.message : "道具の実行に失敗しました。少し待ってからやり直してください。";
        if (!(e instanceof AppError)) console.log("MCP の道具で失敗", name, String(e));
        return reply({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(env: Env, req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.slice(0, 20).map((m) => handleOne(env, origin, m)))).filter(Boolean);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const out = await handleOne(env, origin, body as J);
  return out ? Response.json(out) : new Response(null, { status: 202 });
}
