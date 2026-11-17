/**
 * กติกาล้วนของ D173 เฟส 5 (ไม่แตะ DOM — เทสได้ตรง ๆ)
 *  · pageTitle      — ชื่อบนแท็บเบราว์เซอร์
 *  · leaveGuard     — กดลิงก์ออกจากหน้าตอนยังมีของที่ไม่ได้บันทึก ต้องถามก่อนไหม
 */

/** ชื่อแท็บเบราว์เซอร์: เฉพาะเจาะจงที่สุดขึ้นก่อน (แท็บ · โมดูล) — เปิดหลายแท็บแล้วแยกออกจากแถบที่ถูกบีบ */
export function pageTitle(parts: (string | null | undefined)[], app = "PROOF"): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...parts, app]) {
    const t = (p ?? "").replace(/^[＋+]\s*/, "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.join(" · ");
}

export type LeaveClick = {
  /** href ของลิงก์ที่กด (ค่าดิบจาก attribute) */
  href: string | null;
  /** target ของลิงก์ */
  target?: string | null;
  download?: boolean;
  /** กดพร้อม ctrl/cmd/shift/alt หรือไม่ใช่ปุ่มซ้าย = เปิดแท็บใหม่ หน้านี้ไม่หาย */
  modified?: boolean;
  /** ที่อยู่ปัจจุบัน */
  origin: string;
  pathname: string;
};

/**
 * คืน path ปลายทางที่ต้อง "ถามก่อน" · null = ปล่อยผ่าน
 * 🚨 ลิงก์ที่ pathname เดิม (สลับ ?tab= / ?sec=) ไม่ถาม — แท็บ mount ค้าง ของที่พิมพ์ไม่หาย
 * 🚨 ลิงก์ออกนอกเว็บ / ดาวน์โหลด / เปิดแท็บใหม่ ไม่ถามที่นี่ (หน้านี้ยังอยู่ หรือ beforeunload รับไปแล้ว)
 */
export function leaveGuard(c: LeaveClick, dirty: boolean): string | null {
  if (!dirty || !c.href || c.modified || c.download) return null;
  if (c.target && c.target !== "_self") return null;
  if (c.href.startsWith("#")) return null;
  let u: URL;
  try {
    u = new URL(c.href, c.origin + c.pathname);
  } catch {
    return null;
  }
  if (u.origin !== c.origin) return null;
  if (u.pathname === c.pathname) return null;
  return u.pathname + u.search + u.hash;
}

/** ข้อความในกล่องถาม — บอกว่าอะไรค้างอยู่ (ซ้ำกันนับครั้งเดียว) */
export function unsavedDetail(labels: string[]): string {
  const uniq = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  if (uniq.length === 0) return "ออกจากหน้านี้แล้วสิ่งที่กรอกไว้จะหาย";
  return `ยังไม่ได้บันทึก: ${uniq.join(" · ")} — ออกจากหน้านี้แล้วสิ่งที่กรอกไว้จะหาย`;
}
