/**
 * lib/bar/menuRemove — ลบ/ปิดใช้เมนูบาร์ (D138 · migration 0096)
 *
 * ผู้ใช้ตัดสิน (แพตเทิร์นบัญชีเงิน D125):
 *   · ปิดใช้/เปิดใช้ = สิทธิ์แก้เมนู (`bar.write` · พนักงานบาร์กดได้ เช่นของหมดชั่วคราว)
 *   · ลบทิ้ง = `bar.config` และ**เฉพาะเมนูที่ไม่เคยขาย/ไม่เคยใช้ทำคอนเทนต์**
 *     🚨 เมนูที่เคยขาย: บิลก่อน 0090 ยกเลิกทีหลังจะคืนสต็อกตามสูตรปัจจุบัน (D127)
 *        ลบเมนู = สูตรหายตาม cascade = สต็อกไม่คืนเงียบ ๆ ⇒ ให้ปิดใช้แทน
 *
 * ★ ตัวตัดสินจริงอยู่ใน `fn_bar_delete_menu` — ที่นี่แค่บอกบนจอล่วงหน้า (ปุ่มเทา + เหตุผล · D83/D88)
 * ★ ประโยคทุกตัวตัดสินที่นี่ ห้ามแต่งในคอมโพเนนต์ (D84/D91)
 */

/** ข้อมูลที่ใช้ตัดสินปุ่มของเมนูหนึ่งแถว */
export type MenuRemoveInput = {
  name: string;
  active: boolean;
  /** เคยขาย/เคยใช้ทำคอนเทนต์ไหม · null = ยังโหลดไม่เสร็จ/โหลดไม่ได้ (ไม่รู้ ≠ ไม่เคย · D89) */
  used: boolean | null;
  canWrite: boolean;
  canConfig: boolean;
};

export type MenuRemoveState = {
  /** แสดงปุ่มปิดใช้/เปิดใช้ไหม */
  showToggle: boolean;
  toggleLabel: "ปิดใช้" | "เปิดใช้";
  /** แสดงปุ่มลบไหม (ไม่มีสิทธิ์ = ไม่แสดง · มีสิทธิ์แต่ลบไม่ได้ = แสดงเทาพร้อมเหตุผล) */
  showDelete: boolean;
  /** เหตุผลที่ลบไม่ได้ · null = กดได้ */
  deleteBlocked: string | null;
};

export const MENU_USED_REASON = "เมนูนี้เคยขายหรือเคยใช้ทำคอนเทนต์แล้ว — ลบไม่ได้เพราะบิลเก่าต้องอ้างสูตรนี้ตอนยกเลิก · ใช้ปุ่ม ปิดใช้ แทน";
export const MENU_USAGE_LOADING = "กำลังตรวจว่าเมนูนี้เคยขายหรือยัง…";
export const MENU_USAGE_UNKNOWN = "ตรวจไม่ได้ว่าเมนูนี้เคยขายหรือยัง — โหลดหน้าใหม่แล้วลองอีกครั้ง";

export function menuRemoveState(x: MenuRemoveInput, loading = false): MenuRemoveState {
  const deleteBlocked = x.used === true
    ? MENU_USED_REASON
    : x.used === null
      ? (loading ? MENU_USAGE_LOADING : MENU_USAGE_UNKNOWN)
      : null;
  return {
    showToggle: x.canWrite,
    toggleLabel: x.active ? "ปิดใช้" : "เปิดใช้",
    showDelete: x.canConfig,
    deleteBlocked,
  };
}

/** กล่องยืนยันการลบ — ปุ่มแดง (ข้อมูลหายจริง) */
export function menuDeleteConfirm(name: string, hasRecipe: boolean): { title: string; detail: string; confirmText: string } {
  return {
    title: `ลบเมนู "${name}" ทิ้ง?`,
    detail:
      "เมนูนี้ยังไม่เคยขาย จึงลบได้" +
      (hasRecipe ? " · สูตรของเมนูนี้จะถูกลบด้วย" : "") +
      " · ถ้าส่งขึ้นมาจากห้องทดลอง การ์ดสูตรจะกลับเป็น กำลังลอง · กู้คืนไม่ได้",
    confirmText: "ลบเมนู",
  };
}

/** ป้ายผลหลังปิด/เปิดใช้ */
export function menuToggleDoneText(name: string, nowActive: boolean): string {
  return nowActive
    ? `เปิดใช้ "${name}" แล้ว — กลับมาขึ้นหน้าขาย`
    : `ปิดใช้ "${name}" แล้ว — ซ่อนจากหน้าขาย (เปิดคืนได้ที่ แสดงเมนูที่ปิดใช้)`;
}

/** ป้ายผลหลังลบ */
export function menuDeletedText(name: string, labCardsReset: number): string {
  return `ลบเมนู "${name}" แล้ว` + (labCardsReset > 0 ? ` · การ์ดสูตรห้องทดลอง ${labCardsReset} ใบกลับเป็น กำลังลอง` : "");
}

/** ปุ่มสลับดูเมนูที่ปิดใช้ — ไม่มีเลย = ไม่ต้องแสดงปุ่ม */
export function inactiveToggleLabel(count: number, showing: boolean): string | null {
  if (count <= 0) return null;
  return showing ? `ซ่อนเมนูที่ปิดใช้ (${count})` : `แสดงเมนูที่ปิดใช้ (${count})`;
}
