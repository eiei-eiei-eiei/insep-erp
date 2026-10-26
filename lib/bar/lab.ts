/**
 * lib/bar/lab — ห้องทดลองบาร์: ลองชงสูตรใหม่ · ใช้ทำคอนเทนต์ · สรุปทุน (golden B26 · D129)
 *
 * ── โฟลว์ที่ตกลงกับผู้ใช้ ────────────────────────────────────────────────────
 * · **ลองชง 1 ครั้ง = บันทึกสูตร + ตัดสต็อก + แช่ทุน ทีเดียว** — การ์ดสูตรมีหลาย "รอบ"
 *   (ผู้ใช้แก้ดีไซน์: ไม่แยกหน้า "สร้างดราฟต์" กับ "กดใช้" — ตอนเริ่มบันทึกก็คือตอนลองชงแล้ว)
 * · โน้ตต่อรอบเขียนทีหลังได้ (ลำดับจริง: ชงก่อน ชิมทีหลัง)
 * · ส่งขึ้นเมนูขายอยู่บนการ์ดสูตร เลือกได้ว่าใช้สูตรรอบไหน
 * · ใช้เมนูที่มี/สูตรทดลอง/วัตถุดิบเดี่ยว ทำคอนเทนต์ (หมวดตั้งเองได้ · ผู้ใช้เลือกแบบ ก)
 * · รอบทดลองลงหมวด "ทดลองสูตร" เสมอ (ผู้ใช้: "ทำเพื่อทดลองเป็นหลัก คอนเทนต์แถม")
 *
 * 🚨 ตัวเลขทุนอ่านจากค่าที่แช่ไว้ในรายการเท่านั้น ห้ามคิดใหม่ (D75) — คิดสดได้เฉพาะ "พรีวิวก่อนกด"
 * 🚨 ไม่ลงบัญชี · ไม่หักกำไรขั้นต้นของการขายบนแดชบอร์ด (แยกบรรทัด)
 */
import type { BarItem, BarMenu, RecipeRefs } from "./types";
import { cleanRecipe, type RecipeDraftRow } from "./recipe";
import { matchesQuery } from "./stockNav";
import { lineCost } from "./cost";
import { resolveRecipe } from "./houseSlot";

export const LAB_STATUSES = ["กำลังลอง", "ขึ้นเมนูแล้ว", "เลิกลอง"] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];

/** หมวดของระบบ — รอบทดลองลงหมวดนี้เสมอ · ลบไม่ได้ เปลี่ยนชื่อได้ */
export const TRIAL_CATEGORY = "trial";

/** ลบเองได้ภายในกี่ชั่วโมง (ชงผิด/กดซ้ำ) — 🚨 ต้องตรงกับ fn_bar_lab_delete_use (0091) */
export const SELF_DELETE_HOURS = 12;

export type LabCategory = { categoryId: string; name: string; sort: number; isSystem: boolean };

/**
 * หมวดที่ใช้บนจอ — DB สร้างหมวดตั้งต้น 2 ตัวให้เองตอนลงรายการแรก (`bar_lab_ensure_categories`)
 * ⇒ ก่อนมีรายการแรก ลิสต์ใน DB ยังว่าง: ต้องโชว์ 2 ตัวนี้ไว้ก่อน ไม่งั้นช่องเลือกหมวดว่างแล้วลงอะไรไม่ได้
 * 🚨 id/ชื่อต้องตรงกับ 0091
 */
export const DEFAULT_LAB_CATEGORIES: LabCategory[] = [
  { categoryId: TRIAL_CATEGORY, name: "ทดลองสูตร", sort: 0, isSystem: true },
  { categoryId: "content", name: "ถ่ายคอนเทนต์", sort: 1, isSystem: false },
];
export function labCategories(saved: readonly LabCategory[]): LabCategory[] {
  return saved.length > 0 ? [...saved].sort((a, b) => a.sort - b.sort || (a.categoryId < b.categoryId ? -1 : 1)) : DEFAULT_LAB_CATEGORIES;
}
export type LabRecipe = { recipeId: string; name: string; status: LabStatus; menuId: string | null; createdAt: string };
export type LabLineKind = "สูตร" | "เมนู" | "สูตรทดลอง" | "วัตถุดิบ" | "ชุดตกแต่ง";
export type LabLine = {
  lineNo: number;
  kind: LabLineKind;
  itemId: string | null;
  slotId: string | null;
  /** D131 บรรทัดชุดตกแต่ง: ชุดที่อ้าง + ปริมาณวัตถุดิบต่อ 1 ชุด ณ ตอนชง (ไว้ใช้ถ้าชุดถูกลบทีหลัง) */
  garnishId: string | null;
  garnishQty: number | null;
  menuId: string | null;
  labRecipeId: string | null;
  label: string;
  unit: string | null;
  qty: number;
  cost: number;
};
export type LabUse = {
  useId: string;
  usedAt: string;
  businessDate: string;
  categoryId: string;
  recipeId: string | null;
  roundNo: number | null;
  glasses: number | null;
  eventName: string | null;
  note: string | null;
  costTotal: number;
  createdBy: string | null;
  lines: LabLine[];
};

// ── การ์ดสูตร ────────────────────────────────────────────────────────────────

/** รอบของสูตรนี้ ใหม่สุดก่อน */
export function roundsOf(recipeId: string, uses: readonly LabUse[]): LabUse[] {
  return uses
    .filter((u) => u.recipeId === recipeId && u.roundNo !== null)
    .sort((a, b) => (b.roundNo as number) - (a.roundNo as number));
}

/** ทุนพัฒนาของสูตร = รอบทดลองทั้งหมด (ไม่รวมตอนเอาไปใช้ทำคอนเทนต์ — นั่นคือการใช้ ไม่ใช่การพัฒนา) */
export function recipeSpent(recipeId: string, uses: readonly LabUse[]): { rounds: number; glasses: number; cost: number } {
  const rs = roundsOf(recipeId, uses);
  return {
    rounds: rs.length,
    glasses: r2(rs.reduce((s, u) => s + (u.glasses ?? 0), 0)),
    cost: r2(rs.reduce((s, u) => s + u.costTotal, 0)),
  };
}

/**
 * สูตรของรอบ → แถวบนฟอร์ม (ลองรอบใหม่ / ส่งขึ้นเมนู)
 * ★ บรรทัดที่เคยอ้างช่อง House กลับเป็นช่องเดิม (ขวดตามช่องตอนนี้) · ช่องถูกลบแล้ว → ใช้ขวดที่ตัดในรอบนั้น
 * ★ D131 บรรทัดชุดตกแต่งกลับเป็นชุดเดิม · ชุดถูกลบแล้ว → วัตถุดิบ × (จำนวนชุด × ปริมาณต่อชุดที่จำไว้)
 *   ชุดที่ถูกลบและไม่เคยตัดสต็อก = ไม่มีอะไรให้ตัด ⇒ ไม่มีแถว (ไม่เดา)
 */
export function roundToDraft(use: Pick<LabUse, "lines">, refs: RecipeRefs): RecipeDraftRow[] {
  const alive = new Set(refs.slots.map((s) => s.slotId));
  const aliveG = new Set(refs.garnishes.map((g) => g.garnishId));
  const out: RecipeDraftRow[] = [];
  for (const l of [...use.lines].filter((x) => x.kind === "สูตร" || x.kind === "ชุดตกแต่ง").sort((a, b) => a.lineNo - b.lineNo)) {
    if (l.kind === "ชุดตกแต่ง") {
      if (l.garnishId && aliveG.has(l.garnishId)) out.push({ itemId: "", garnishId: l.garnishId, qty: l.qty });
      else if (l.itemId && l.garnishQty !== null) out.push({ itemId: l.itemId, qty: Math.round(l.qty * l.garnishQty * 1e10) / 1e10 });
      continue;
    }
    out.push(l.slotId && alive.has(l.slotId) ? { itemId: "", slotId: l.slotId, qty: l.qty } : { itemId: l.itemId ?? "", qty: l.qty });
  }
  return out;
}

/**
 * สูตรของรอบเป็นข้อความ (ชื่อ/หน่วยที่แช่ไว้ตอนชง) — "House Gin (Gordon's) 30 ml · มะนาว 20 ml"
 * ชุดตกแต่ง: "Lime Wheel (มะนาว 1/7 ลูก) × 1" (ป้ายแช่ไว้ตอนชงแล้ว · จำนวน = ชุด ไม่มีหน่วย)
 */
export function roundLinesText(use: Pick<LabUse, "lines">): string {
  return use.lines
    .filter((l) => l.kind === "สูตร" || l.kind === "ชุดตกแต่ง")
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => (l.kind === "ชุดตกแต่ง" ? `${l.label} × ${num(l.qty)}` : `${l.label} ${num(l.qty)}${l.unit ? ` ${l.unit}` : ""}`))
    .join(" · ");
}

/** ลองรอบใหม่ได้ไหม — คืนเหตุผลหรือ null (ต้องตรงกับ fn_bar_lab_round) */
export function roundBlock(status: LabStatus): string | null {
  return status === "เลิกลอง" ? "สูตรนี้เลิกลองไปแล้ว — กด กลับมาลองต่อ ก่อน" : null;
}

export type RecipeFilter = "all" | LabStatus;
export const RECIPE_FILTERS: RecipeFilter[] = ["กำลังลอง", "ขึ้นเมนูแล้ว", "เลิกลอง", "all"];
export const RECIPE_FILTER_LABEL: Record<RecipeFilter, string> = {
  "กำลังลอง": "กำลังลอง",
  "ขึ้นเมนูแล้ว": "ขึ้นเมนูแล้ว",
  "เลิกลอง": "เลิกลอง",
  all: "ทั้งหมด",
};

/** การ์ดที่แสดง — ใหม่สุดก่อน (สร้างล่าสุด) · ตัวตัดสินสุดท้าย id (ลำดับคงที่ · D107) */
export function filterRecipes(recipes: readonly LabRecipe[], query: string, filter: RecipeFilter): LabRecipe[] {
  return recipes
    .filter((r) => (filter === "all" || r.status === filter) && matchesQuery(r.name, query))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.recipeId < b.recipeId ? 1 : -1));
}

// ── ลบรายการ ─────────────────────────────────────────────────────────────────

/**
 * ลบได้ไหม — คืนเหตุผลหรือ null · 🚨 ต้องตรงกับ fn_bar_lab_delete_use (0091)
 * คนที่ลงเอง ลบได้ภายใน 12 ชม. (ชงผิด/กดซ้ำ) · นอกนั้นต้องมีสิทธิ์ตั้งค่าบาร์
 */
export function deleteBlock(
  use: Pick<LabUse, "createdBy" | "usedAt">,
  me: string | null,
  nowMs: number,
  canConfig: boolean,
): string | null {
  if (canConfig) return null;
  const mine = me !== null && use.createdBy === me;
  const fresh = nowMs - Date.parse(use.usedAt) < SELF_DELETE_HOURS * 3600_000;
  if (mine && fresh) return null;
  return mine
    ? `ลงไว้เกิน ${SELF_DELETE_HOURS} ชั่วโมงแล้ว — ให้ผู้มีสิทธิ์ตั้งค่าบาร์เป็นคนลบ`
    : "ลบได้เฉพาะรายการที่ตัวเองลง (ภายใน 12 ชั่วโมง) — นอกนั้นให้ผู้มีสิทธิ์ตั้งค่าบาร์เป็นคนลบ";
}

/** ประโยคถามก่อนลบ — บอกว่าของจะคืนเข้าสต็อก และถ้าเป็นรอบสุดท้าย การ์ดสูตรหายด้วย */
export function deleteConfirmText(use: LabUse, uses: readonly LabUse[], recipeName: string | null): string {
  const base = "ของที่ตัดไปจะคืนเข้าสต็อก (เข้าขวดที่ตัดไปจริง)";
  if (use.recipeId && roundsOf(use.recipeId, uses).length === 1) {
    return `${base} · เป็นรอบเดียวของสูตร "${recipeName ?? ""}" — ลบแล้วการ์ดสูตรจะหายไปด้วย`;
  }
  return base;
}

// ── ใช้เมนูที่มี / คอนเทนต์ ──────────────────────────────────────────────────

export type UseDraft = { kind: "menu" | "recipe" | "item"; id: string; qty: number | "" };

/**
 * ตรวจก่อนตัดสต็อก — แถวว่าง (ยังไม่เลือก + ไม่ใส่จำนวน) ข้ามได้ · กรอกครึ่งเดียว = error (ไม่ข้ามเงียบ · D79)
 */
export function planUse(rows: readonly UseDraft[]): {
  menus: { menuId: string; qty: number }[];
  recipes: { recipeId: string; qty: number }[];
  items: { itemId: string; qty: number }[];
  errors: string[];
} {
  const out = { menus: [] as { menuId: string; qty: number }[], recipes: [] as { recipeId: string; qty: number }[], items: [] as { itemId: string; qty: number }[], errors: [] as string[] };
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const no = i + 1;
    const hasQty = r.qty !== "" && r.qty > 0;
    if (!r.id && !hasQty) return;
    if (!r.id) return void out.errors.push(`แถว ${no}: ยังไม่ได้เลือก`);
    if (!hasQty) return void out.errors.push(`แถว ${no}: ใส่จำนวนมากกว่า 0`);
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) return void out.errors.push(`แถว ${no}: เลือกซ้ำกับแถวอื่น — รวมเป็นแถวเดียว`);
    seen.add(key);
    const qty = r.qty as number;
    if (r.kind === "menu") out.menus.push({ menuId: r.id, qty });
    else if (r.kind === "recipe") out.recipes.push({ recipeId: r.id, qty });
    else out.items.push({ itemId: r.id, qty });
  });
  return out;
}

/**
 * ทุนโดยประมาณก่อนกด (พรีวิวเท่านั้น — ตัวจริงคิดที่ SQL ตอนตัด แล้วแช่ไว้)
 * สูตรทดลอง = สูตรรอบล่าสุด (บรรทัดช่อง House แปลงเป็นขวดตอนนี้ · ตรงกับ fn_bar_lab_use)
 */
export function previewUseCost(
  plan: ReturnType<typeof planUse>,
  menus: readonly BarMenu[],
  items: readonly BarItem[],
  refs: RecipeRefs,
  uses: readonly LabUse[],
): number {
  const byItem = new Map(items.map((i) => [i.itemId, i]));
  let total = 0;
  for (const m of plan.menus) {
    const menu = menus.find((x) => x.menuId === m.menuId);
    total += lineCost({ menuId: m.menuId, menuName: menu?.name ?? "", qty: m.qty, price: 0 }, menus, items, refs);
  }
  for (const r of plan.recipes) {
    const last = roundsOf(r.recipeId, uses)[0];
    if (!last) continue;
    const lines = resolveRecipe(cleanRecipe(roundToDraft(last, refs)), refs).lines;
    for (const l of lines) total += l.qty * r.qty * (byItem.get(l.itemId)?.costPerUnit ?? 0);
  }
  for (const it of plan.items) total += it.qty * (byItem.get(it.itemId)?.costPerUnit ?? 0);
  return r2(total);
}

// ── สรุปทุน ──────────────────────────────────────────────────────────────────

export type LabSummary = {
  total: number;
  count: number;
  byCategory: { id: string; name: string; cost: number; count: number }[];
  byRecipe: { id: string; name: string; cost: number; count: number }[];
  byEvent: { name: string; cost: number; count: number }[];
};

/**
 * สรุปทุนช่วงวันที่ (ใช้วันขาย `businessDate` แบบเดียวกับบิล) — เรียงทุนมากสุดก่อน
 * · ตามสูตร = รอบทดลองของสูตรนั้น
 * · ตามงาน = เฉพาะรายการที่ใส่ชื่องาน
 */
export function labSummary(
  uses: readonly LabUse[],
  categories: readonly LabCategory[],
  recipes: readonly LabRecipe[],
  from: string,
  to: string,
): LabSummary {
  const inRange = uses.filter((u) => u.businessDate >= from && u.businessDate <= to);
  const add = <K>(m: Map<K, { cost: number; count: number }>, k: K, c: number) => {
    const v = m.get(k) ?? { cost: 0, count: 0 };
    m.set(k, { cost: v.cost + c, count: v.count + 1 });
  };
  const cat = new Map<string, { cost: number; count: number }>();
  const rec = new Map<string, { cost: number; count: number }>();
  const ev = new Map<string, { cost: number; count: number }>();
  for (const u of inRange) {
    add(cat, u.categoryId, u.costTotal);
    if (u.recipeId) add(rec, u.recipeId, u.costTotal);
    if (u.eventName?.trim()) add(ev, u.eventName.trim(), u.costTotal);
  }
  const catName = new Map(categories.map((c) => [c.categoryId, c.name]));
  const recName = new Map(recipes.map((r) => [r.recipeId, r.name]));
  const byCost = <T extends { cost: number }>(a: T, b: T) => b.cost - a.cost;
  return {
    total: r2(inRange.reduce((s, u) => s + u.costTotal, 0)),
    count: inRange.length,
    byCategory: [...cat].map(([id, v]) => ({ id, name: catName.get(id) ?? id, cost: r2(v.cost), count: v.count })).sort(byCost),
    byRecipe: [...rec].map(([id, v]) => ({ id, name: recName.get(id) ?? "(สูตรที่ถูกลบ)", cost: r2(v.cost), count: v.count })).sort(byCost),
    byEvent: [...ev].map(([name, v]) => ({ name, cost: r2(v.cost), count: v.count })).sort(byCost),
  };
}

/**
 * บรรทัดบนแดชบอร์ดบาร์ — 🚨 บอกตรง ๆ ว่าไม่ได้หักจากกำไรขั้นต้นข้างบน ("" = ไม่มีรายการในช่วงนี้)
 */
export function labDashboardText(s: Pick<LabSummary, "total" | "count" | "byCategory">, fmt: (n: number) => string): string {
  if (s.count === 0) return "";
  const parts = s.byCategory.map((c) => `${c.name} ${fmt(c.cost)}`).join(" · ");
  return `ใช้ในห้องทดลอง ${fmt(s.total)} บาท (${parts}) — ไม่ได้หักจากกำไรขั้นต้นข้างบน`;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: number) => String(Math.round(v * 10000) / 10000);
