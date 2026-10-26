/**
 * lib/bar/fraction — จำนวนที่พิมพ์เป็นเศษส่วนได้ (golden B28 · D131)
 *
 * ผู้ใช้ขอ: มะนาว 1 ลูกฝานได้ 7 แว่น → ชุด "Lime Wheel" ใช้มะนาว **1/7 ลูก**
 *           พิมพ์ "1/7" ลงช่องได้เลย ไม่ต้องคิดเป็น 0.142857…
 *
 * ── กติกา ────────────────────────────────────────────────────────────────────
 * · เก็บ **ทั้งตัวเลข** (ใช้คิดสต็อก/ต้นทุน) **และข้อความที่พิมพ์** (ใช้แสดง) — ตัวเลขอย่างเดียว
 *   บนจอจะขึ้น 0.1429 ซึ่งไม่มีใครอ่านแล้วนึกออกว่า "1 ใน 7"
 * · เก็บข้อความเฉพาะเมื่อเป็นเศษส่วน — "0.5" เก็บเป็นตัวเลขอย่างเดียว (ข้อความไม่ได้บอกอะไรเพิ่ม)
 * · 🚨 ตัวเลข **ไม่ปัด** — 1/7 × 7 แก้วต้องได้ 1 ลูกพอดี (ปัดเป็น 0.1429 แล้ว × 7 = 1.0003)
 * · พิมพ์ไม่ถูกรูป / ≤ 0 / หารศูนย์ = null (ไม่เดา) — หน้าจอเตือนเอง
 */

/** "1/7" · "1 1/2" · "0.5" · ".5" · "2" → ตัวเลข · ไม่ถูกรูปหรือ ≤ 0 → null */
export function parseQty(text: string): number | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return null;
  let v: number;
  const mixed = /^(\d+) (\d+)\/(\d+)$/.exec(t);
  const frac = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(t);
  if (mixed) {
    const den = Number(mixed[3]);
    if (den === 0) return null;
    v = Number(mixed[1]) + Number(mixed[2]) / den;
  } else if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    v = Number(frac[1]) / den;
  } else if (/^(\d+\.?\d*|\.\d+)$/.test(t)) {
    v = Number(t);
  } else {
    return null;
  }
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** ข้อความที่ควรเก็บไว้แสดง — เฉพาะเศษส่วน (ตัดช่องว่างซ้ำ) · อย่างอื่น = null */
export function qtyTextToKeep(text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  return t.includes("/") && parseQty(t) !== null ? t : null;
}

/** จำนวนบนจอ — มีข้อความเศษส่วน = ใช้ข้อความ · ไม่มี = ตัวเลขไม่เกิน 4 ตำแหน่ง (ตัด 0 ท้าย) */
export function qtyShown(qty: number, text?: string | null): string {
  if (text && text.trim()) return text.trim();
  return String(Math.round(qty * 10000) / 10000);
}
