import { can, ROLE_LABEL, type Role } from "@/lib/shared/roles";
import { hasModule } from "@/lib/shared/workspaces";

/**
 * Claude connector ทำอะไรได้บ้างสำหรับแอคเค้านี้ (D172)
 *
 * ★ ตัดสินจาก **บทบาท × โมดูลที่ลูกค้าซื้อ** ทุกคำขอ — แหล่งเดียวของทั้ง connector
 *   (ด่านเข้า · เครื่องมือที่ลงทะเบียน · คำแนะนำที่ Claude ได้)
 * 🚨 เครื่องมือที่ไม่มีสิทธิ์ต้อง **ไม่ถูกลงทะเบียนเลย** ไม่ใช่ลงทะเบียนแล้วคืนลิสต์ว่าง —
 *    RLS ตอบ "อ่านไม่ได้" เป็นลิสต์ว่าง ⇒ Claude จะบอกผู้ใช้ว่า "ไม่มีออเดอร์ค้าง" ทั้งที่มองไม่เห็น (D89)
 * ★ ตัวจริงที่บังคับสิทธิ์ยังเป็น RLS/RPC ในฐานข้อมูล — ที่นี่แค่ไม่เสนอสิ่งที่ทำไม่ได้
 */
export type ConnectorAccess = {
  /** บันทึก/แก้บิลบัญชี + เครื่องมือปิดเดือน (เส้นทางเดิมของ D141) */
  accounting: boolean;
  /** ค้นออเดอร์ · ลูกหนี้ค้าง · สต็อก (อ่านอย่างเดียว) */
  salesRead: boolean;
  /** ขายหน้าร้านผ่านการ์ด (ตัดสต็อก + ออกใบเสร็จ/ใบกำกับ + ลงรายได้) */
  salesWrite: boolean;
};

export function connectorAccess(role: Role, modules: string[] | null | undefined): ConnectorAccess {
  return {
    accounting: can(role, "acct.write") && hasModule(modules, "accounting"),
    salesRead: can(role, "sales.read") && hasModule(modules, "sales"),
    salesWrite: can(role, "sales.write") && hasModule(modules, "sales"),
  };
}

export function hasAnyAccess(a: ConnectorAccess): boolean {
  return a.accounting || a.salesRead || a.salesWrite;
}

/** เหตุผลที่ต่อไม่ได้ — บอกบทบาทปัจจุบันและบทบาทที่ใช้ได้ (ห้ามเขียนชื่อบทบาทตายตัว · D85) */
export function noAccessText(role: Role): string {
  return (
    `บทบาท "${ROLE_LABEL[role]}" ใช้ Claude connector ไม่ได้ — ต้องบันทึกบัญชีได้หรือดูหน้าขายได้ ` +
    `(และกิจการต้องใช้โมดูลนั้น) · ให้เจ้าของกิจการเปลี่ยนบทบาทที่ ตั้งค่า → ผู้ใช้`
  );
}

/** สิ่งที่การเชื่อมต่อนี้ทำได้ — who_am_i ตอบให้ Claude บอกผู้ใช้ */
export function accessSummary(a: ConnectorAccess): string[] {
  const out: string[] = [];
  if (a.accounting) out.push("บันทึกบิลบัญชี + ตรวจยอดปิดเดือน");
  if (a.salesRead) out.push("ดูออเดอร์ · ลูกหนี้ค้าง · สต็อกสินค้า");
  if (a.salesWrite) out.push("ขายหน้าร้าน (ตัดสต็อก + ออกใบเสร็จ)");
  return out;
}
