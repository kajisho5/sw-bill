// 機材リストの組み立て。画面から来たものもAIから来たものも、ここで形を確かめてから保存する。
import { todayJst } from "../shared/format";
import { EQUIP_VERSION, equipItemCount, type EquipDoc, type EquipItem, type EquipSection } from "../shared/types";
import { AppError } from "./freee";
import { randomId } from "./session";

type J = Record<string, any>;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.normalize("NFC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max) : "");
const number = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.normalize("NFKC").replaceAll(",", "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const date = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function sections(input: unknown): EquipSection[] {
  const raw = Array.isArray(input) ? (input as J[]).slice(0, 40) : [];
  return raw.map((s) => ({
    title: text(s?.title, 120),
    items: (Array.isArray(s?.items) ? (s.items as J[]).slice(0, 300) : []).map((it): EquipItem => {
      const q = number(it?.qty);
      return {
        code: text(it?.code, 60),
        name: text(it?.name, 300),
        model: text(it?.model, 300),
        qty: q == null ? null : Math.round(q * 1000) / 1000,
        unit: text(it?.unit, 20),
        note: text(it?.note, 300),
      };
    }),
  }));
}

/** 画面から届いた機材リストを、決まった形に直す（知らない項目は捨てる）。 */
export function sanitizeEquip(input: unknown, base: EquipDoc | null): EquipDoc {
  const j = (input && typeof input === "object" ? input : {}) as J;
  const schedule = (Array.isArray(j.schedule) ? (j.schedule as J[]).slice(0, 6) : [])
    .map((r) => ({ label: text(r?.label, 40), value: text(r?.value, 120) }))
    .filter((r) => r.label || r.value);
  const clientLines = (Array.isArray(j.clientLines) ? (j.clientLines as unknown[]).slice(0, 4) : [])
    .map((s) => text(s, 120))
    .filter(Boolean);
  return {
    version: EQUIP_VERSION,
    id: base?.id ?? randomId(9),
    docNo: text(j.docNo, 60),
    created: date(j.created) ?? base?.created ?? todayJst(),
    clientName: text(j.clientName, 200),
    clientLines,
    schedule,
    subject: text(j.subject, 300),
    subjectShort: text(j.subjectShort, 120),
    place: text(j.place, 200),
    venueName: text(j.venueName, 60),
    venueSub: text(j.venueSub, 120),
    venueEn: text(j.venueEn, 120),
    sections: sections(j.sections),
    updatedAt: new Date().toISOString(),
    source: base?.source ?? "app",
  };
}

export interface BuiltEquip {
  equip: EquipDoc;
  warnings: string[];
}

/** AI から届いた依頼を機材リストにする。中身が無ければ作らない。 */
export function buildEquipFromAi(input: unknown, base: EquipDoc | null): BuiltEquip {
  const equip = sanitizeEquip(input, base);
  equip.source = "ai";
  const warnings: string[] = [];
  if (equipItemCount(equip) === 0) throw new AppError(400, "bad_input", "sections に機材を1件以上入れてください。");
  if (!equip.clientName) warnings.push("発注元が入っていません。画面で確かめてください。");
  if (!equip.subject) warnings.push("件名が入っていません。画面で確かめてください。");
  if (equip.sections.some((s) => !s.title)) warnings.push("見出しの無いグループがあります。");
  return { equip, warnings };
}
