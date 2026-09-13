/**
 * lib/bar/cost — ต้นทุนถัวเฉลี่ยถ่วงน้ำหนัก + ต้นทุนต่อบิล (golden B3 · D96)
 *
 * ── 🚨 กติกาที่สำคัญที่สุดของไฟล์นี้ ───────────────────────────────────────
 * **ต้นทุนบนบิลต้องถูกแช่ไว้ ห้ามคำนวณสดตอนเปิดดู**
 * `costPerUnit` ขยับทุกครั้งที่รับของเข้า — ถ้าหน้ารายงานคำนวณสด
 * **กำไรของเดือนที่แล้วจะขยับเองเมื่อเดือนนี้ซื้อของแพงขึ้น** (กติกา D75)
 *
 * ★ และแช่ **ณ ตอนสั่ง ไม่ใช่ตอนปิดบิล** — บิลค้าง 3 ชั่วโมงแล้วรับของใหม่ระหว่างนั้นได้
 *   ฟังก์ชันในไฟล์นี้จึงคืน "ต้นทุน ณ ขณะนี้" ให้ผู้เรียกเอาไปเก็บ ไม่ใช่ให้เรียกซ้ำทีหลัง
 */
import type { BarItem, BarMenu, CartLine } from "./types";
import { menuMode } from "./recipe";

/**
 * ต้นทุนต่อหน่วยใหม่หลังรับของเข้า — ถัวเฉลี่ยถ่วงน้ำหนัก
 *
 * · ยอดเดิม ≤ 0 (รวมกรณีสต็อกติดลบ) → ใช้ราคาล็อตใหม่ล้วน
 *   🪤 เอาสูตรถัวเฉลี่ยไปใช้กับยอดเดิมติดลบ จะได้ต้นทุน**ติดลบ**ซึ่งทำให้กำไรพองมหาศาล
 * · รับเข้า ≤ 0 → ไม่เปลี่ยนอะไร (ป้องกันหารศูนย์)
 * · รับของฟรี (`costTotal = 0`) → ค่าเฉลี่ยลดลงจริงตามเลขคณิต
 *   ⚠️ ถ้าโรงกลั่นให้เหล้าฟรี ควรคีย์ราคาส่งไปเลยแล้วหักกลบหลังบ้าน ไม่งั้นกำไรบาร์ดูดีเกินจริง
 */
export function weightedAvgCost(
  prev: { qty: number; costPerUnit: number },
  add: { qty: number; costTotal: number },
): number {
  if (!(add.qty > 0)) return prev.costPerUnit;
  const unitNew = add.costTotal / add.qty;
  if (!(prev.qty > 0)) return round4(unitNew);
  const total = prev.qty * prev.costPerUnit + add.costTotal;
  return round4(total / (prev.qty + add.qty));
}

/** ปัด 4 ตำแหน่งให้ตรงกับ `numeric(14,4)` ฝั่ง DB — ไม่งั้นค่าในแอปกับใน DB ต่างกันทีละนิด */
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** ปัด 2 ตำแหน่งให้ตรงกับ `numeric(14,2)` */
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * ต้นทุนของ 1 บรรทัดในตะกร้า ณ ขณะนี้
 *
 * · โหมด `recipe` → Σ(ปริมาณในสูตร × ต้นทุนต่อหน่วย) × จำนวนที่สั่ง
 * · โหมด `fixed`  → `fixedCost` × จำนวนที่สั่ง
 * · โหมด `unset`  → 0
 * 🚨 **ของแถมมีต้นทุนเท่าของขาย** — `isComp` ตัดแค่ยอดขาย ไม่ตัดต้นทุน
 *    ไม่งั้นแถมทั้งคืนแล้วกำไรยังสวย ทั้งที่เหล้าหายไปจริง
 */
export function lineCost(
  line: CartLine,
  menus: readonly BarMenu[],
  items: readonly BarItem[],
): number {
  if (!line.menuId) return 0;
  const menu = menus.find((m) => m.menuId === line.menuId);
  if (!menu) return 0;
  const mode = menuMode(menu);
  if (mode === "unset") return 0;
  if (mode === "fixed") return round2((menu.fixedCost ?? 0) * line.qty);
  const byId = new Map(items.map((i) => [i.itemId, i]));
  let per = 0;
  for (const r of menu.recipe) per += r.qty * (byId.get(r.itemId)?.costPerUnit ?? 0);
  return round2(per * line.qty);
}

/** ต้นทุนรวมของทั้งบิล ณ ขณะนี้ */
export function cartCost(
  cart: readonly CartLine[],
  menus: readonly BarMenu[],
  items: readonly BarItem[],
): number {
  return round2(cart.reduce((s, l) => s + lineCost(l, menus, items), 0));
}

/**
 * กำไรขั้นต้น — `null` เมื่อยอดขายเป็น 0 (หารไม่ได้ และ "กำไร 0%" ก็ไม่ใช่ความจริง)
 * 🪤 บทเรียน D94: คืน 0 แทน null ทำให้หน้าจอขึ้น "กำไร 0%" ทั้งที่ยังไม่มีอะไรให้เทียบ
 */
export function grossMargin(revenue: number, cost: number): { profit: number; pct: number | null } {
  const profit = round2(revenue - cost);
  if (!(revenue > 0)) return { profit, pct: null };
  return { profit, pct: Math.round((profit / revenue) * 1000) / 10 };
}
