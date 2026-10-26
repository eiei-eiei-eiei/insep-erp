/**
 * lib/bar/menuPricing — ต้นทุนตามสูตร + ราคาแนะนำ + ค้นวัตถุดิบด้วยการพิมพ์ (golden B19 · D110)
 *
 * ผู้ใช้ขอ: ตอนเพิ่มเมนู เลือกวัตถุดิบโดยพิมพ์แล้วขึ้นตัวเลือกให้ (ไล่หาในรายการยาวยาก)
 *           และใส่สูตรแล้วให้คำนวณต้นทุน + เสนอราคาขาย
 * ผู้ใช้เลือก: **ต้นทุน 30% ของราคาขาย** (pour cost) · ตั้ง % ได้ในหน้าเพิ่มเมนูเอง · **ปัดขึ้นหลัก 10**
 *
 * ── 🚨 ราคาหน้าบาร์รวม VAT อยู่แล้ว (D96 · golden B11) ──────────────────────
 * % ต้นทุนต้องเทียบกับ **ยอดก่อน VAT** — 7% นั้นเป็นของสรรพากร ไม่ใช่รายได้ร้าน
 * ⇒ กิจการจด VAT: ราคาแนะนำ = ต้นทุน ÷ % × 1.07 · ไม่จด: ต้นทุน ÷ %
 *    (ลืมข้อนี้ = เมนูทุกตัวของร้านที่จด VAT ได้ % ต้นทุนจริงสูงกว่าที่ตั้งใจ ~7% เงียบ ๆ)
 *
 * ★ ราคาแนะนำ **ไม่เขียนทับราคาที่ผู้ใช้กรอกเอง** — เป็นปุ่ม "ใช้ราคานี้" เท่านั้น
 * ★ ต้นทุนเห็นเฉพาะผู้มีสิทธิ์ `bar.config` (stripCost ใน data.ts) — ไม่มีสิทธิ์ = ไม่มีตัวเลขให้คิด
 */
import type { BarGarnish, BarItem, BarItemLine, RecipeRefs } from "./types";
import { slotOption } from "./houseSlot";
import { VAT_RATE } from "../shared/vat";

export const DEFAULT_TARGET_PCT = 30;
export const PRICE_STEP = 10;

/** ป้ายของวัตถุดิบในช่องค้น — ชื่อ + หน่วยฐาน (ให้รู้ว่าปริมาณที่กรอกเป็นหน่วยอะไร) */
export function itemLabel(it: Pick<BarItem, "name" | "unit">): string {
  return `${it.name} (${it.unit})`;
}

/**
 * ข้อความที่พิมพ์ → itemId
 * ★ ตรงกับป้ายเต็ม (เลือกจากรายการ) หรือตรงกับชื่อเปล่า ๆ (พิมพ์ครบเอง) · ไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหัวท้าย
 * 🚨 ไม่เดาจากคำบางส่วน — พิมพ์ "จิน" แล้วมีจิน 3 ขวด เลือกให้เองตัวไหนก็ผิด (ตัดสต็อกผิดขวดเงียบ ๆ)
 *    ไม่ตรง = "" แล้วหน้าจอบอกว่ายังไม่ได้เลือก
 */
export function matchItem(text: string, items: readonly BarItem[]): string {
  const t = text.trim().toLowerCase();
  if (!t) return "";
  const hit =
    items.find((it) => itemLabel(it).toLowerCase() === t) ?? items.find((it) => it.name.trim().toLowerCase() === t);
  return hit?.itemId ?? "";
}

/**
 * ข้อความที่พิมพ์ → วัตถุดิบ · ช่องเหล้าประจำบ้าน (D127) · **หรือชุดตกแต่ง** (D131) · ไม่ตรง = ว่างทั้งหมด
 * ★ ป้ายเต็มลงท้าย "(เหล้าประจำบ้าน)" / "(ชุดตกแต่ง)" เสมอ ⇒ ไม่ชนกับป้ายวัตถุดิบ "ชื่อ (หน่วย)"
 * 🚨 พิมพ์ชื่อเปล่าที่ตรงมากกว่าหนึ่งอย่าง = **ไม่เลือกให้** (เลือกผิด = ตัดผิดขวดเงียบ ๆ) ให้เลือกจากรายการ
 */
export function matchRef(
  text: string,
  items: readonly BarItem[],
  refs: RecipeRefs,
): { itemId: string; slotId?: string; garnishId?: string } {
  const t = text.trim().toLowerCase();
  if (!t) return { itemId: "" };
  const fullItem = items.find((it) => itemLabel(it).toLowerCase() === t);
  if (fullItem) return { itemId: fullItem.itemId };
  const fullSlot = refs.slots.find((s) => slotOption(s).toLowerCase() === t);
  if (fullSlot) return { itemId: "", slotId: fullSlot.slotId };
  const fullGarnish = refs.garnishes.find((g) => garnishOption(g).toLowerCase() === t);
  if (fullGarnish) return { itemId: "", garnishId: fullGarnish.garnishId };
  const bareItem = items.find((it) => it.name.trim().toLowerCase() === t);
  const bareSlot = refs.slots.find((s) => s.name.trim().toLowerCase() === t);
  const bareGarnish = refs.garnishes.find((g) => g.name.trim().toLowerCase() === t);
  if ([bareItem, bareSlot, bareGarnish].filter(Boolean).length > 1) return { itemId: "" };
  if (bareSlot) return { itemId: "", slotId: bareSlot.slotId };
  if (bareGarnish) return { itemId: "", garnishId: bareGarnish.garnishId };
  return { itemId: bareItem?.itemId ?? "" };
}

/** ป้ายของชุดตกแต่งในรายการค้นของช่องวัตถุดิบ (D131) — ลงท้ายต่างจากวัตถุดิบ/ช่องเสมอ */
export function garnishOption(g: Pick<BarGarnish, "name">): string {
  return `${g.name} (ชุดตกแต่ง)`;
}

export type RecipeCostLine = { itemId: string; qty: number; cost: number; noCost: boolean };

/**
 * ต้นทุนรายบรรทัด + รวม — ราคาต่อหน่วยฐานของวัตถุดิบ × ปริมาณ
 * `noCost` = วัตถุดิบยังไม่มีต้นทุน (ยังไม่เคยรับของเข้า) → รวมแล้วต่ำกว่าจริง ต้องเตือน
 */
export function recipeCost(
  recipe: readonly BarItemLine[],
  items: readonly BarItem[],
): { lines: RecipeCostLine[]; total: number; missing: number } {
  const byId = new Map(items.map((it) => [it.itemId, it]));
  const lines = recipe.map((r) => {
    const cpu = byId.get(r.itemId)?.costPerUnit ?? 0;
    return { itemId: r.itemId, qty: r.qty, cost: round2(r.qty * cpu), noCost: !(cpu > 0) };
  });
  const total = round2(lines.reduce((s, l) => s + l.cost, 0));
  return { lines, total, missing: lines.filter((l) => l.noCost).length };
}

/** ยอดก่อน VAT ของราคาป้าย (ราคาป้ายรวม VAT แล้วเมื่อจด VAT) */
function netOf(price: number, isVat: boolean): number {
  return isVat ? price / (1 + VAT_RATE / 100) : price;
}

/**
 * ราคาแนะนำ — ต้นทุน ÷ % เป้าหมาย (บวก VAT กลับเมื่อจด) แล้ว **ปัดขึ้น** หลัก 10
 * ★ ปัดขึ้นเสมอ (ปัดลง = % ต้นทุนจริงเกินเป้าที่ตั้ง) · ต้นทุน 0 หรือ % ผิดช่วง = null (ไม่มีอะไรให้แนะนำ)
 */
export function suggestPrice(cost: number, targetPct: number, isVat: boolean, step = PRICE_STEP): number | null {
  if (!(cost > 0) || !(targetPct > 0) || targetPct >= 100) return null;
  const net = cost / (targetPct / 100);
  const gross = isVat ? net * (1 + VAT_RATE / 100) : net;
  // ตัดเศษทศนิยมจากการคูณ/หารก่อนปัด (183.0000000002 ต้องไม่กลายเป็น 190)
  const clean = Math.round(gross * 1e6) / 1e6;
  return Math.ceil(clean / step) * step;
}

/** % ต้นทุนจริงที่ราคาที่กรอก (เทียบยอดก่อน VAT) · ราคา 0 = null */
export function costPct(price: number, cost: number, isVat: boolean): number | null {
  const net = netOf(price, isVat);
  if (!(net > 0)) return null;
  return Math.round((cost / net) * 1000) / 10;
}

/** อ่านค่า % ที่ผู้ใช้กรอก — นอกช่วง 1–99 ใช้ค่าปริยาย */
export function normalizeTargetPct(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : DEFAULT_TARGET_PCT;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
