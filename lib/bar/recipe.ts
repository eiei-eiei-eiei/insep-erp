/**
 * lib/bar/recipe — โหมดต้นทุนของเมนู + แผนตัดสต็อก (golden B2 · D96)
 *
 * ── 3 โหมด (ผู้ใช้แก้ดีไซน์ 2026-09-10) ────────────────────────────────────
 * · `recipe` มีสูตร        → ตัดสต็อกตามสูตร · ต้นทุน = Σ(ปริมาณ × ต้นทุนถัวเฉลี่ย)
 * · `fixed`  ต้นทุนตายตัว  → ไม่ตัดสต็อก · ต้นทุนตามที่ตั้ง (อาหาร/กับแกล้ม)
 * · `unset`  ยังไม่ตั้ง    → ไม่ตัดสต็อก · ต้นทุน 0 · **ต้องขึ้นป้ายบนจอเสมอ**
 *
 * 🎯 โหมด `recipe` คือ **ทางหลัก** ไม่ใช่ทางเลือก — คนชงคือคนที่รู้สูตรดีที่สุด
 *    ณ วินาทีที่ตวงอยู่กับมือ · โหมด `unset` เป็นทางฉุกเฉินตอนคิวแน่นเท่านั้น
 *
 * 🚨 โหมด `unset` **ห้ามถูกข้ามเงียบ ๆ** — ต้องมีป้ายบนแถวและแถบรวมในแท็บเมนู
 *    ไม่งั้นมันค้างตลอดกาลแล้วกำไรพองขึ้นเรื่อย ๆ โดยไม่มีใครรู้ (บทเรียน D83/D86)
 */
import type { BarItem, BarMenu, CartLine } from "./types";

export type MenuMode = "recipe" | "fixed" | "unset";

/**
 * โหมดต้นทุนของเมนูนี้
 * 🪤 มีทั้งสูตรและ `fixedCost` → **สูตรชนะ** (แม่นกว่าและตัดสต็อกได้)
 *    แต่ห้ามเงียบ — `menuWarning()` ต้องบอกผู้ใช้ว่าค่าที่กรอกไว้ไม่ถูกใช้
 */
export function menuMode(menu: Pick<BarMenu, "recipe" | "fixedCost">): MenuMode {
  if (menu.recipe && menu.recipe.length > 0) return "recipe";
  if (menu.fixedCost !== null && menu.fixedCost !== undefined && Number.isFinite(menu.fixedCost)) {
    return "fixed";
  }
  return "unset";
}

/** ตัดสต็อกได้ไหม — มีแต่โหมด `recipe` เท่านั้นที่ขยับสต็อก */
export function deductsStock(menu: Pick<BarMenu, "recipe" | "fixedCost">): boolean {
  return menuMode(menu) === "recipe";
}

/**
 * ข้อความเตือนของเมนูนี้ (`null` = ไม่มีอะไรต้องบอก)
 * 🚨 ทุกครั้งที่ระบบไม่ทำอะไรให้ ต้องบอกว่าทำไม (กติกาที่ D92/D83 ย้ำไว้)
 */
export function menuWarning(menu: Pick<BarMenu, "recipe" | "fixedCost">): string | null {
  const mode = menuMode(menu);
  if (mode === "unset") return "ยังไม่ตั้งต้นทุน — ขายได้แต่ไม่ตัดสต็อกและกำไรจะเกินจริง";
  if (mode === "recipe" && menu.fixedCost !== null && menu.fixedCost !== undefined) {
    return "มีทั้งสูตรและต้นทุนตายตัว — ระบบใช้สูตร ค่าต้นทุนตายตัวไม่ถูกใช้";
  }
  return null;
}

/** เมนูที่ยังไม่ตั้งต้นทุน — ใช้ทำแถบรวม "ยังไม่ตั้งต้นทุน N รายการ" */
export function unsetMenus(menus: readonly BarMenu[]): BarMenu[] {
  return menus.filter((m) => menuMode(m) === "unset");
}

export type StockPlanLine = { itemId: string; qty: number };

/**
 * ตะกร้า → รายการหักสต็อก (รวมยอดต่อ item แล้ว)
 *
 * · เมนูที่ไม่มีสูตร ไม่ปรากฏในแผน (ไม่ใช่ปรากฏด้วยยอด 0 — คนละความหมาย)
 * · 🚨 **ของแถมก็ตัดสต็อก** — แถมแล้วเหล้าก็หายจากขวดจริง
 * · เมนูที่หาไม่เจอใน `menus` ถูกข้าม (ชื่อยังอยู่ในบิลเป็น snapshot)
 */
export function stockPlan(cart: readonly CartLine[], menus: readonly BarMenu[]): StockPlanLine[] {
  const byId = new Map(menus.map((m) => [m.menuId, m]));
  const acc = new Map<string, number>();
  for (const line of cart) {
    if (!line.menuId) continue;
    const menu = byId.get(line.menuId);
    if (!menu || !deductsStock(menu)) continue;
    for (const r of menu.recipe) {
      acc.set(r.itemId, (acc.get(r.itemId) ?? 0) + r.qty * line.qty);
    }
  }
  return [...acc.entries()].map(([itemId, qty]) => ({ itemId, qty }));
}

export type Shortage = { itemId: string; name: string; need: number; have: number; unit: string };

/**
 * ของที่ไม่พอ — ใช้ **เตือน ไม่ใช่บล็อก** เป็นค่าปริยาย
 * (บาร์จริงเปิดขวดใหม่แล้วค่อยคีย์รับของทีหลังตลอด · สลับเป็นบล็อกได้ที่ `bar_block_negative`)
 *
 * 🪤 item ที่ไม่มีในทะเบียนเลย = **ไม่รู้ ≠ ไม่มี** → ไม่นับเป็นของขาด แต่คืนไว้ใน
 *    `unknownItems` ให้หน้าจอบอกได้ว่ามีสูตรอ้างของที่ถูกลบไปแล้ว
 */
export function shortages(
  cart: readonly CartLine[],
  menus: readonly BarMenu[],
  items: readonly BarItem[],
): { short: Shortage[]; unknownItems: string[] } {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const short: Shortage[] = [];
  const unknownItems: string[] = [];
  for (const p of stockPlan(cart, menus)) {
    const item = byId.get(p.itemId);
    if (!item) {
      unknownItems.push(p.itemId);
      continue;
    }
    if (item.qty < p.qty) {
      short.push({ itemId: p.itemId, name: item.name, need: p.qty, have: item.qty, unit: item.unit });
    }
  }
  return { short, unknownItems };
}

/** รวมบรรทัดที่เป็นเมนูเดียวกัน ราคาเดียวกัน และสถานะแถมเหมือนกัน */
export function mergeCart(cart: readonly CartLine[]): CartLine[] {
  const out: CartLine[] = [];
  for (const line of cart) {
    const hit = out.find(
      (o) =>
        o.menuId === line.menuId &&
        o.price === line.price &&
        Boolean(o.isComp) === Boolean(line.isComp) &&
        (o.lineDiscount ?? 0) === (line.lineDiscount ?? 0),
    );
    if (hit) hit.qty += line.qty;
    else out.push({ ...line });
  }
  return out;
}

/**
 * ── แถวสูตรระหว่างกรอกบนฟอร์ม (D96) ────────────────────────────────────────
 *
 * 🐛 ผู้ใช้แจ้ง: "ราคาขายกับจำนวนวัตถุดิบที่ใส่มี 0 ค้าง ลบไม่ได้"
 *    ต้นเหตุคือช่องกรอกเป็น `<input type="number">` ดิบที่แปลงค่าด้วย `Number(e.target.value)`
 *    → ลบตัวเลขทิ้งจนว่าง ได้ `Number("") === 0` แล้ว React ก็เขียน 0 กลับลงช่องทันที
 *
 * ⇒ ฟอร์มต้องยอมให้ช่อง **ว่าง** ได้ระหว่างพิมพ์ (ชนิด `number | ""`)
 *   แล้วค่อยกรองทิ้งตอนบันทึก — ที่นี่คือจุดกรองจุดเดียว ใช้ทั้งแท็บเมนูและปุ่ม ＋เมนูใหม่ ในหน้าขาย
 */
export type RecipeDraftRow = { itemId: string; qty: number | "" };

export const blankRecipeRow = (): RecipeDraftRow => ({ itemId: "", qty: "" });

/**
 * แถวที่ใช้ได้จริง = เลือกวัตถุดิบแล้ว **และ** ปริมาณมากกว่า 0
 *
 * 🚨 แถวที่กรอกปริมาณแต่ลืมเลือกวัตถุดิบ **ถูกทิ้งเงียบ ๆ ไม่ได้** —
 *    ฝั่งหน้าจอต้องเอา `danglingRows()` ไปเตือน (บทเรียน D79 ข้อ 2:
 *    แถวที่กรอกครึ่งเดียวเคยล้มการบันทึกทั้งใบโดยไม่บอกว่าแถวไหน)
 */
export function cleanRecipe(rows: readonly RecipeDraftRow[]): { itemId: string; qty: number }[] {
  return rows
    .filter((r): r is { itemId: string; qty: number } => Boolean(r.itemId) && r.qty !== "" && r.qty > 0)
    .map((r) => ({ itemId: r.itemId, qty: r.qty }));
}

/** แถวที่กรอกไม่ครบ (มีอย่างใดอย่างหนึ่ง แต่ไม่ครบคู่) — เอาไปเตือน ไม่ใช่บล็อก */
export function danglingRows(rows: readonly RecipeDraftRow[]): number {
  return rows.filter((r) => {
    const hasQty = r.qty !== "" && r.qty > 0;
    return (Boolean(r.itemId) && !hasQty) || (!r.itemId && hasQty);
  }).length;
}
