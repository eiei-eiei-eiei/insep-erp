/**
 * lib/bar/receiveHistory — ประวัติราคารับของของวัตถุดิบบาร์ (golden B22 · D126)
 *
 * ── ที่มา ────────────────────────────────────────────────────────────────
 * `bar_receive` เก็บทุกครั้งที่รับของมาตั้งแต่ 0064 (วันที่ · จำนวน · เงินที่จ่ายจริง · ร้าน)
 * แต่ไม่เคยมีหน้าจอไหนอ่าน — ปุ่ม "ประวัติ" เดิมอ่าน `bar_move` ซึ่งมีแต่จำนวน ไม่มีราคา
 *
 * 🚨 ชั้นแสดงผลล้วน — **ห้ามเอาไปคิดต้นทุน** (ต้นทุนถัวเฉลี่ยมาจาก `fn_bar_receive` / cost.ts)
 *
 * ── ราคาต่อหน่วยซื้อ คิดจากแถวนั้นเอง ไม่ใช่จากค่าตั้งปัจจุบัน ─────────────
 * `qty_pack` = จำนวนที่ผู้ใช้กรอก (ขวด) · `qty` = หน่วยฐาน (ml) ณ วันที่รับ
 * ⇒ ขนาดหน่วยซื้อของล็อตนั้น = `qty / qty_pack`
 * 🪤 ห้ามใช้ `packSize` ปัจจุบันของ item — ถ้าเคยเปลี่ยนขนาดขวด (700 → 750)
 *    ราคาต่อขวดของล็อตเก่าจะถูกหารผิดขนาดเงียบ ๆ
 * · ไม่ได้ตั้งหน่วยซื้อ → `qty_pack = qty` ⇒ ขนาด 1 = ราคาต่อหน่วยฐานพอดี
 * · `qty_pack` ว่าง (ไม่มีข้อมูล) → ไม่มีราคาต่อหน่วยซื้อ (ไม่เดา) แต่ราคาต่อหน่วยฐานยังมี
 *
 * ── ราคาขึ้น/ลง เทียบ "ต่อหน่วยฐาน" ─────────────────────────────────────
 * เพราะเป็นตัวเดียวที่เทียบข้ามล็อตได้เสมอ แม้ขนาดขวดเปลี่ยน
 * · เทียบกับครั้งก่อนหน้าที่ **กรอกราคา** — ครั้งที่ไม่กรอกราคา (0) ข้ามไป
 *   (ไม่งั้นรับของแถมมา 1 ครั้งแล้วครั้งถัดไปขึ้นว่าราคาขึ้นไม่สิ้นสุด)
 * · ไม่กรอกราคา = `null` ทุกช่องราคา **ห้ามแสดงเป็น 0.00** (ไม่รู้ ≠ ฟรี · หลัก D86)
 */

export type ReceiveRecord = {
  id: number;
  docDate: string;
  qtyPack: number | null;
  qty: number;
  costTotal: number;
  source: string | null;
  note: string | null;
};

export type ReceiveView = ReceiveRecord & {
  /** ขนาด 1 หน่วยซื้อของล็อตนี้ (หน่วยฐาน) · null = ไม่รู้ */
  packSize: number | null;
  /** ราคาต่อหน่วยซื้อ · null = ไม่ได้กรอกราคา หรือไม่รู้จำนวนหน่วยซื้อ */
  perPack: number | null;
  /** ราคาต่อหน่วยฐาน · null = ไม่ได้กรอกราคา */
  perUnit: number | null;
  /** เปลี่ยนจากครั้งก่อนที่มีราคา (สัดส่วน · 0.1 = แพงขึ้น 10%) · null = ไม่มีอะไรให้เทียบ */
  change: number | null;
};

const pos = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** เรียงใหม่สุดก่อน (วันที่ แล้วตัดสินด้วย id) — ไม่พึ่งลำดับที่ DB ส่งมา (บทเรียน D86/D107) */
function newestFirst(a: ReceiveRecord, b: ReceiveRecord): number {
  if (a.docDate !== b.docDate) return a.docDate < b.docDate ? 1 : -1;
  return b.id - a.id;
}

export function receiveHistory(rows: ReceiveRecord[]): ReceiveView[] {
  const sorted = [...rows].sort(newestFirst);
  const views: ReceiveView[] = sorted.map((r) => {
    const priced = pos(r.costTotal);
    const packSize = pos(r.qtyPack) && pos(r.qty) ? r.qty / r.qtyPack : null;
    return {
      ...r,
      packSize,
      perPack: priced && pos(r.qtyPack) ? r.costTotal / r.qtyPack : null,
      perUnit: priced && pos(r.qty) ? r.costTotal / r.qty : null,
      change: null,
    };
  });
  // เทียบกับครั้ง "ก่อนหน้า" = แถวถัดไปในลำดับใหม่→เก่า ที่มีราคา
  for (let i = 0; i < views.length; i++) {
    const cur = views[i].perUnit;
    if (cur === null) continue;
    const prev = views.slice(i + 1).find((v) => v.perUnit !== null)?.perUnit ?? null;
    if (prev !== null && prev > 0) views[i].change = cur / prev - 1;
  }
  return views;
}

/** "▲ 12.5%" / "▼ 3%" / "เท่าเดิม" · null = ไม่แสดงอะไร */
export function changeText(change: number | null): string | null {
  if (change === null || !Number.isFinite(change)) return null;
  const pct = Math.round(change * 1000) / 10;
  if (pct === 0) return "เท่าเดิม";
  return `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

/** วันที่ `2026-10-20` → `20/10/69` (พ.ศ. 2 หลัก) · ค่าแปลกคืนตามเดิม ไม่เดา */
export function receiveDateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const yy = String((Number(m[1]) + 543) % 100).padStart(2, "0");
  return `${m[3]}/${m[2]}/${yy}`;
}
