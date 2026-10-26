/**
 * lib/bar/houseSlot — เหล้าประจำบ้าน (house spirit) (golden B23 · D127)
 *
 * ผู้ใช้ขอ: ตั้ง "ช่อง" เองได้ (House Gin / House Vodka / House Dark Rum …) แต่ละช่องชี้ขวด 1 ตัว
 *           สูตรอ้างช่องแทนขวดยี่ห้อ · เปลี่ยนขวดในช่อง = ทุกเมนูที่อ้างช่องเปลี่ยนตามทันที
 *
 * ── กติกาที่ล็อกไว้ ──────────────────────────────────────────────────────────
 * · ช่อง **ต้องมีขวดเสมอ** (ผู้ใช้เลือก) — ไม่มีสถานะช่องว่างที่ขายแล้วต้นทุน 0 เงียบ ๆ
 * · ตัวตัดสต็อก/คิดต้นทุน **ตัวจริงคือ SQL** (`bar_menu_lines` ใน 0090) — ไฟล์นี้ใช้บนจอ
 *   (ต้นทุน/ราคาแนะนำ · เตือนของไม่พอ · ล็อกหน่วย) และต้องแปลงช่องแบบเดียวกันเป๊ะ
 * · 🚨 **ช่องที่มีสูตรอ้าง เปลี่ยนได้เฉพาะเป็นขวดหน่วยเดียวกัน** — "House Gin 45" เขียนตอนขวดเป็น ml
 *   ถ้าเปลี่ยนเป็นขวดที่ตั้งหน่วยเป็น "ขวด" ระบบจะตัด 45 ขวดต่อแก้วโดยไม่มีอะไรฟ้อง
 *   (อาการเดียวกับที่ D104 ล็อกหน่วยของวัตถุดิบไว้) · DB กันซ้ำอีกชั้นด้วย trigger
 * · ลบช่องที่มีสูตรอ้าง = บล็อก + บอกรายชื่อเมนู (ผู้ใช้เลือก) · FK กันซ้ำที่ DB
 * · ขวดหมด = ปล่อยติดลบ **ห้ามสลับขวดเอง** (ผู้ใช้สั่ง) — ไฟล์นี้จึงไม่มีตรรกะ "หาขวดสำรอง" เลย
 */
import type { BarGarnish, BarItem, BarItemLine, BarMenu, BarRecipeLine, HouseSlot, RecipeRefs } from "./types";
import { qtyShown } from "./fraction";

/**
 * บรรทัดสูตร → บรรทัดขวด (แปลงช่อง/ชุดตกแต่งเป็นขวดที่ตั้งไว้ ณ ตอนนี้ · รวมยอดของขวดเดียวกัน)
 *
 * ★ D131 ชุดตกแต่ง = วัตถุดิบของชุด × (จำนวนชุด × ปริมาณต่อชุด) · ชุดที่ไม่ตัดสต็อก = ไม่มีบรรทัด
 *   (ตรงกับ `bar_menu_lines` ใน 0093 ที่กรอง `item_id is not null`)
 *
 * ★ รวมยอดต่อขวด — "House Gin 30 + Gordon's 15" ตอนช่องชี้ Gordon's = Gordon's 45 (ตรงกับ SQL ที่ group by item)
 * 🪤 ช่องที่หาไม่เจอ (ถูกลบจากอีกเครื่องขณะเปิดหน้าค้าง) → ไม่เดา ไม่นับเป็น 0 เงียบ ๆ
 *    คืนไว้ใน `missing` ให้หน้าจอบอก (DB มี FK กันอยู่ — ที่นี่คือข้อมูลบนจอที่เก่ากว่า DB)
 */
export function resolveRecipe(
  recipe: readonly BarRecipeLine[],
  refs: RecipeRefs,
): { lines: BarItemLine[]; missing: string[] } {
  const bySlot = new Map(refs.slots.map((s) => [s.slotId, s]));
  const byGarnish = new Map(refs.garnishes.map((g) => [g.garnishId, g]));
  const acc = new Map<string, number>();
  const missing: string[] = [];
  for (const r of recipe) {
    let itemId: string;
    let qty = r.qty;
    if (r.garnishId !== undefined) {
      const g = byGarnish.get(r.garnishId);
      if (!g) {
        missing.push(r.garnishId);
        continue;
      }
      if (g.itemId === null || g.qty === null) continue; // ชุดที่ไม่ตัดสต็อก
      itemId = g.itemId;
      qty = r.qty * g.qty;
    } else if (r.slotId !== undefined) {
      const s = bySlot.get(r.slotId);
      if (!s) {
        missing.push(r.slotId);
        continue;
      }
      itemId = s.itemId;
    } else {
      itemId = r.itemId;
    }
    acc.set(itemId, rq((acc.get(itemId) ?? 0) + qty));
  }
  return { lines: [...acc].map(([itemId, qty]) => ({ itemId, qty })), missing };
}

/** ตัวอ้างอิงของสูตรจากข้อมูลตั้งต้นของหน้าบาร์ — ช่องเหล้าประจำบ้าน + ชุดตกแต่ง (D131) */
export function refsOf(b: { houseSlots: readonly HouseSlot[]; garnishes: readonly BarGarnish[] }): RecipeRefs {
  return { slots: b.houseSlots, garnishes: b.garnishes };
}

/** เมนูที่อ้างช่องนี้ (ชื่อ เรียงตามชื่อ) — ใช้บอกเหตุผลที่ลบไม่ได้ และนับการใช้ */
export function menusUsingSlot(slotId: string, menus: readonly Pick<BarMenu, "name" | "recipe">[]): string[] {
  return menus
    .filter((m) => m.recipe.some((r) => r.slotId === slotId))
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b, "th"));
}

/** ลบช่องได้ไหม — คืนเหตุผล (บอกว่าต้องทำอะไรก่อน · D88) หรือ null = ลบได้ */
export function slotDeleteBlock(slotId: string, menus: readonly Pick<BarMenu, "name" | "recipe">[]): string | null {
  return inUseBlock(menusUsingSlot(slotId, menus));
}

/** เหตุผลที่ลบไม่ได้เพราะมีเมนูใช้ — ข้อความเดียวทั้งช่องเหล้าประจำบ้านและชุดตกแต่ง */
function inUseBlock(used: readonly string[]): string | null {
  if (used.length === 0) return null;
  const shown = used.slice(0, 5).join(" · ");
  const more = used.length > 5 ? ` และอีก ${used.length - 5} เมนู` : "";
  return `ใช้อยู่ในสูตร ${used.length} เมนู: ${shown}${more} — เอาออกจากสูตรก่อนถึงจะลบได้`;
}

/**
 * เปลี่ยนขวดของช่องได้ไหม — คืนเหตุผลหรือ null
 * 🚨 ช่องที่ยังไม่มีเมนูไหนใช้ เปลี่ยนได้ทุกหน่วย (ยังไม่มีตัวเลขไหนผูกกับหน่วยเดิม)
 */
export function slotItemChangeBlock(
  cur: Pick<BarItem, "unit"> | undefined,
  next: Pick<BarItem, "unit" | "name"> | undefined,
  usedIn: number,
): string | null {
  if (!next) return "เลือกขวดของช่องนี้ก่อน";
  if (!cur || usedIn === 0) return null;
  if (cur.unit !== next.unit) {
    return `ขวดเดิมใช้หน่วย ${cur.unit} แต่ ${next.name} ใช้หน่วย ${next.unit} — ช่องนี้ใช้อยู่ใน ${usedIn} เมนู ` +
      `ปริมาณในสูตรจะเปลี่ยนความหมาย เลือกได้เฉพาะขวดหน่วย ${cur.unit}`;
  }
  return null;
}

/**
 * ขวดที่เลือกให้ช่องได้ — วัตถุดิบที่ยังใช้อยู่ · ช่องที่มีสูตรอ้างได้เฉพาะหน่วยเดียวกับขวดเดิม
 * ★ ขวดปัจจุบันอยู่ในรายการเสมอแม้ถูกปิดใช้ (ไม่งั้นช่องเลือกว่างแล้วกดบันทึก = ค่าหลุดเงียบ ๆ · D125)
 */
export function slotItemChoices(
  curItemId: string | null,
  items: readonly BarItem[],
  usedIn: number,
): BarItem[] {
  const cur = curItemId ? items.find((i) => i.itemId === curItemId) : undefined;
  return items.filter((i) => {
    if (i.itemId === curItemId) return true;
    if (i.active === false) return false;
    return !cur || usedIn === 0 || i.unit === cur.unit;
  });
}

/** ป้ายของช่องบนจอ — "House Gin → Gordon's (ml)" · ขวดหาไม่เจอ = บอกตรง ๆ */
export function slotLabel(slot: Pick<HouseSlot, "name" | "itemId">, items: readonly Pick<BarItem, "itemId" | "name" | "unit">[]): string {
  const it = items.find((i) => i.itemId === slot.itemId);
  return it ? `${slot.name} → ${it.name} (${it.unit})` : `${slot.name} → (ไม่พบขวด)`;
}

/** ป้ายของช่องในรายการค้นของช่องวัตถุดิบ — ต่างจากป้ายวัตถุดิบ "ชื่อ (หน่วย)" เสมอ (ห้ามชนกัน) */
export function slotOption(slot: Pick<HouseSlot, "name">): string {
  return `${slot.name} (เหล้าประจำบ้าน)`;
}

/** ข้อความเตือนของช่อง — ขวดถูกปิดใช้ (ยังขายได้และยังตัดขวดนั้น · แค่บอก) */
export function slotWarning(slot: Pick<HouseSlot, "itemId">, items: readonly BarItem[]): string | null {
  const it = items.find((i) => i.itemId === slot.itemId);
  if (!it) return "ไม่พบขวดของช่องนี้ — เลือกขวดใหม่";
  if (it.active === false) return `${it.name} ถูกปิดใช้แล้ว แต่ช่องนี้ยังตัดขวดนี้อยู่ — เปลี่ยนขวดถ้าเลิกใช้จริง`;
  return null;
}

/**
 * วัตถุดิบตัวไหนถูกใช้ในสูตรกี่เมนู — **นับการอ้างผ่านช่องและชุดตกแต่งด้วย** (D104 + D127 + D131)
 * `viaSlots` = ชื่อช่อง/ชุดตกแต่งที่ชี้ขวดนี้และมีเมนูใช้อยู่ — ใช้บอกเหตุผลที่ล็อกหน่วยให้ถูก
 */
export type ItemUse = { menus: number; viaSlots: string[] };

export function itemUses(
  menus: readonly Pick<BarMenu, "recipe">[],
  refs: RecipeRefs,
): Map<string, ItemUse> {
  const bySlot = new Map(refs.slots.map((s) => [s.slotId, s]));
  const byGarnish = new Map(refs.garnishes.map((g) => [g.garnishId, g]));
  const out = new Map<string, ItemUse>();
  const get = (id: string) => {
    let u = out.get(id);
    if (!u) out.set(id, (u = { menus: 0, viaSlots: [] }));
    return u;
  };
  for (const m of menus) {
    const hit = new Set<string>();
    for (const r of m.recipe) {
      if (r.garnishId !== undefined) {
        // D131: ชุดตกแต่งที่มีเมนูอ้าง ล็อกหน่วยของวัตถุดิบในชุดด้วย (จำนวนต่อชุดผูกกับหน่วยนั้น)
        const g = byGarnish.get(r.garnishId);
        if (!g || g.itemId === null) continue;
        hit.add(g.itemId);
        const u = get(g.itemId);
        if (!u.viaSlots.includes(g.name)) u.viaSlots.push(g.name);
      } else if (r.slotId !== undefined) {
        const s = bySlot.get(r.slotId);
        if (!s) continue;
        hit.add(s.itemId);
        const u = get(s.itemId);
        if (!u.viaSlots.includes(s.name)) u.viaSlots.push(s.name);
      } else {
        hit.add(r.itemId);
      }
    }
    for (const id of hit) get(id).menus += 1;
  }
  return out;
}

// ── บันทึกช่องทั้งชุด (การ์ดในตั้งค่าบาร์) ─────────────────────────────────────

export type SlotDraft = { slotId: string | null; name: string; itemId: string };

/**
 * ตรวจก่อนบันทึก — คืนข้อความไทย ("" = ผ่าน) · ใช้ทั้งบนจอ (ปิดปุ่ม) และ server (ด่านจริงก่อน RPC)
 * 🪤 ช่องที่หายไปจากฉบับร่าง = จะถูกลบ ⇒ ต้องตรวจว่าไม่มีสูตรอ้าง
 */
export function slotEditsError(
  drafts: readonly SlotDraft[],
  existing: readonly HouseSlot[],
  items: readonly BarItem[],
  menus: readonly Pick<BarMenu, "name" | "recipe">[],
): string {
  const key = (s: string) => s.trim().toLowerCase();
  const seen = new Set<string>();
  for (const [i, d] of drafts.entries()) {
    const row = `แถว ${i + 1}`;
    const name = d.name.trim();
    if (!name) return `${row}: ตั้งชื่อช่องก่อน`;
    if (seen.has(key(name))) return `${row}: ชื่อ "${name}" ซ้ำกับช่องอื่น`;
    seen.add(key(name));
    const next = items.find((it) => it.itemId === d.itemId);
    if (!d.itemId || !next) return `${row} (${name}): เลือกขวดของช่องนี้ก่อน`;
    if (d.slotId) {
      const prev = existing.find((s) => s.slotId === d.slotId);
      if (!prev) return `ช่อง ${name} ถูกลบจากอีกเครื่องไปแล้ว — รีเฟรชหน้าแล้วลองใหม่`;
      if (prev.itemId !== d.itemId) {
        const cur = items.find((it) => it.itemId === prev.itemId);
        const block = slotItemChangeBlock(cur, next, menusUsingSlot(prev.slotId, menus).length);
        if (block) return `${name}: ${block}`;
      }
    }
  }
  const kept = new Set(drafts.map((d) => d.slotId).filter(Boolean));
  for (const s of existing) {
    if (kept.has(s.slotId)) continue;
    const block = slotDeleteBlock(s.slotId, menus);
    if (block) return `ลบช่อง ${s.name} ไม่ได้ — ${block}`;
  }
  return "";
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * สูตรของเมนูเป็นข้อความบรรทัดเดียว — แท็บเมนู & สูตร (ผู้ใช้ขอ: แสดงทั้งชื่อช่องและขวดปัจจุบัน)
 * "House Gin (Gordon's) 30 ml · Campari 30 ml"
 * ★ ข้อความทั้งหมดตัดสินที่นี่ ไม่ใช่ในคอมโพเนนต์ (D84/D88)
 */
export function recipeText(
  recipe: readonly BarRecipeLine[],
  items: readonly Pick<BarItem, "itemId" | "name" | "unit">[],
  refs: RecipeRefs,
): string {
  return recipeLines(recipe, items, refs).join(" · ");
}

/** สูตรทีละบรรทัด (การ์ดสูตรในหน้าขาย) — ข้อความเดียวกับ `recipeText` */
export function recipeLines(
  recipe: readonly BarRecipeLine[],
  items: readonly Pick<BarItem, "itemId" | "name" | "unit">[],
  refs: RecipeRefs,
): string[] {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const bySlot = new Map(refs.slots.map((s) => [s.slotId, s]));
  const byGarnish = new Map(refs.garnishes.map((g) => [g.garnishId, g]));
  return recipe
    .map((r) => {
      if (r.garnishId !== undefined) {
        const g = byGarnish.get(r.garnishId);
        if (!g) return `(ไม่พบชุดตกแต่ง) × ${num(r.qty)}`;
        return `${g.name} × ${num(r.qty)} (${garnishContent(g, byId, r.qty !== 1)})`;
      }
      if (r.slotId !== undefined) {
        const s = bySlot.get(r.slotId);
        if (!s) return `(ไม่พบช่อง) ${num(r.qty)}`;
        const it = byId.get(s.itemId);
        return it ? `${s.name} (${it.name}) ${num(r.qty)} ${it.unit}` : `${s.name} (ไม่พบขวด) ${num(r.qty)}`;
      }
      const it = byId.get(r.itemId);
      return it ? `${it.name} ${num(r.qty)} ${it.unit}` : `(ไม่พบวัตถุดิบ) ${num(r.qty)}`;
    });
}

const num = (v: number) => String(r4(v));

/**
 * สิ่งที่ชุดตกแต่ง 1 ชุดตัด — "มะนาว 1/7 ลูก" · ไม่ตัดสต็อก = "ไม่ตัดสต็อก"
 * `perSet` = เติมคำว่า "ชุดละ" (ใช้ตอนสูตรใส่มากกว่า 1 ชุด ไม่งั้นอ่านเป็นยอดรวม)
 */
export function garnishContent(
  g: Pick<BarGarnish, "itemId" | "qty" | "qtyText">,
  byId: ReadonlyMap<string, Pick<BarItem, "name" | "unit">>,
  perSet = false,
): string {
  if (g.itemId === null || g.qty === null) return "ไม่ตัดสต็อก";
  const it = byId.get(g.itemId);
  const body = it ? `${it.name} ${qtyShown(g.qty, g.qtyText)} ${it.unit}` : `ไม่พบวัตถุดิบ ${qtyShown(g.qty, g.qtyText)}`;
  return perSet ? `ชุดละ ${body}` : body;
}

/** เมนูที่อ้างชุดตกแต่งนี้ (ชื่อ เรียงตามชื่อ) — ใช้บอกเหตุผลที่ลบไม่ได้ และนับการใช้ */
export function menusUsingGarnish(garnishId: string, menus: readonly Pick<BarMenu, "name" | "recipe">[]): string[] {
  return menus
    .filter((m) => m.recipe.some((r) => r.garnishId === garnishId))
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b, "th"));
}

/** ลบชุดตกแต่งได้ไหม — เหตุผล (บอกว่าต้องทำอะไรก่อน) หรือ null = ลบได้ · ข้อความเดียวกับช่อง */
export function garnishDeleteBlock(garnishId: string, menus: readonly Pick<BarMenu, "name" | "recipe">[]): string | null {
  return inUseBlock(menusUsingGarnish(garnishId, menus));
}

/**
 * ปัดเศษลอยของการบวก/คูณ — 10 ตำแหน่ง (ไม่ใช่ 4) เพราะชุดตกแต่ง 1/7 ลูก × 7 แก้วต้องได้ 1 พอดี
 * (ปัด 4 ตำแหน่ง = 0.1429 × 7 = 1.0003 · D131)
 */
const rq = (v: number) => Math.round(v * 1e10) / 1e10;
