/**
 * D173 — กติกาคีย์บอร์ดของป๊อปอัพและดร็อปดาวน์พิมพ์ค้น (ตรรกะล้วน ไม่มี React)
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพราะเทสของ repo รันบน node (ไม่มี DOM) —
 * ตัวตัดสิน "กดปุ่มนี้แล้วเกิดอะไร" ต้องมีเทสคุม ส่วน component แค่ทำตามผล
 */

// ── ดร็อปดาวน์พิมพ์ค้น (Combobox) ────────────────────────────────────────────
export type ComboState = {
  open: boolean;
  /** ตำแหน่งที่ไฮไลต์อยู่ */
  hi: number;
  /** จำนวนรายการหลังกรอง */
  count: number;
  /** ผู้ใช้พิมพ์ค้นหรือกดลูกศรไปแล้วหรือยัง (ยัง = แค่ Tab ผ่านช่อง) */
  touched: boolean;
};

export type ComboAction =
  | { type: "open" }
  | { type: "move"; hi: number }
  /** `stay` = โฟกัสอยู่ช่องเดิม (Enter) · ไม่ stay = ปล่อยให้ Tab พาไปช่องถัดไป */
  | { type: "pick"; index: number; stay: boolean }
  | { type: "close" }
  | null;

/**
 * ↓ ↑ เลื่อนไฮไลต์ · Enter เลือกแล้วอยู่ช่องเดิม · Tab เลือกแล้วไปช่องถัดไป · Esc ปิดรายการ
 *
 * 🪤 Tab เลือกให้ **เฉพาะเมื่อผู้ใช้พิมพ์ค้นหรือกดลูกศรแล้ว** — ไม่งั้นคนที่แค่กด Tab ผ่านช่อง
 *    (ช่องเปิดรายการเองตอนได้โฟกัส) จะถูกเปลี่ยนค่าเป็นรายการแรกโดยไม่รู้ตัว
 */
export function comboKey(key: string, s: ComboState): ComboAction {
  const last = Math.max(0, s.count - 1);
  switch (key) {
    case "ArrowDown":
      if (!s.open) return { type: "open" };
      return { type: "move", hi: Math.min(s.hi + 1, last) };
    case "ArrowUp":
      if (!s.open) return { type: "open" };
      return { type: "move", hi: Math.max(s.hi - 1, 0) };
    case "Home":
      return s.open && s.touched ? { type: "move", hi: 0 } : null;
    case "End":
      return s.open && s.touched ? { type: "move", hi: last } : null;
    case "Enter":
      return s.open && s.count > 0 ? { type: "pick", index: Math.min(s.hi, last), stay: true } : null;
    case "Tab":
      if (!s.open) return null;
      return s.touched && s.count > 0 ? { type: "pick", index: Math.min(s.hi, last), stay: false } : { type: "close" };
    case "Escape":
      return s.open ? { type: "close" } : null;
    default:
      return null;
  }
}

// ── Enter = บันทึก ในป๊อปอัพ ─────────────────────────────────────────────────
export type EnterContext = {
  key: string;
  ctrlOrMeta: boolean;
  /** กำลังประกอบตัวอักษรผ่าน IME — Enter ตอนนี้คือยืนยันคำ ไม่ใช่ส่งฟอร์ม */
  composing: boolean;
  /** มี handler ข้างในจัดการ Enter ไปแล้ว (เช่น Combobox เลือกรายการ) */
  defaultPrevented: boolean;
  /** ชื่อแท็กของช่องที่โฟกัสอยู่ ตัวพิมพ์ใหญ่ (INPUT / TEXTAREA / SELECT / BUTTON …) */
  tag: string;
  /** ค่า type ของ <input> */
  inputType: string;
  /** ช่องนั้นเป็นดร็อปดาวน์ที่กำลังเปิดรายการอยู่ */
  expanded: boolean;
  /** ช่องนั้น (หรือกล่องที่ครอบ) ประกาศ `data-enter="own"` = Enter มีความหมายของตัวเอง เช่น "เพิ่มแถว" */
  ownEnter: boolean;
  /** กำลังบันทึกอยู่ — กันกดซ้ำ */
  busy: boolean;
};

const TEXT_LIKE = new Set(["", "text", "number", "tel", "email", "url", "search", "password", "date", "month", "time"]);

/**
 * Enter ในช่องกรอกบรรทัดเดียว = บันทึก · Ctrl/⌘+Enter = บันทึกจากที่ไหนก็ได้ในป๊อปอัพ
 *
 * ไม่บันทึกเมื่อ: อยู่ใน textarea (Enter = ขึ้นบรรทัด) · อยู่บนปุ่ม/ลิงก์ (Enter = กดปุ่มนั้น) ·
 * ดร็อปดาวน์กำลังเปิด (Enter = เลือกรายการ) · ช่องประกาศว่า Enter เป็นของตัวเอง · กำลังบันทึกอยู่
 */
export function enterSubmits(c: EnterContext): boolean {
  if (c.key !== "Enter" || c.busy || c.composing || c.defaultPrevented) return false;
  if (c.ownEnter && !c.ctrlOrMeta) return false;
  if (c.ctrlOrMeta) return !c.expanded;
  if (c.expanded) return false;
  return c.tag === "INPUT" && TEXT_LIKE.has(c.inputType);
}

// ── วน Tab อยู่ในป๊อปอัพ ─────────────────────────────────────────────────────
/**
 * กด Tab แล้วโฟกัสควรไปตัวที่เท่าไร (วนอยู่ในป๊อปอัพ ไม่หลุดไปหน้าหลัง)
 * คืน `null` = ปล่อยให้เบราว์เซอร์จัดการตามปกติ (อยู่กลาง ๆ ไม่ใช่ขอบ)
 *
 * @param index ตำแหน่งของช่องที่โฟกัสอยู่ในลิสต์ที่โฟกัสได้ · -1 = โฟกัสอยู่นอกลิสต์
 */
export function trapTab(index: number, count: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (index < 0) return shift ? count - 1 : 0;
  if (shift && index === 0) return count - 1;
  if (!shift && index === count - 1) return 0;
  return null;
}

/** ตัวเลือก CSS ของสิ่งที่กด Tab ไปถึงได้ */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** ช่องที่ "พร้อมพิมพ์" — ใช้เลือกว่าจะวางเคอร์เซอร์ที่ไหนตอนเปิดป๊อปอัพ */
export const TYPEABLE =
  'input:not([disabled]):not([readonly]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), select:not([disabled]), textarea:not([disabled]):not([readonly])';
