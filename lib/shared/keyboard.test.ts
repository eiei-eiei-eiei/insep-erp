import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { comboKey, enterSubmits, trapTab, type ComboState, type EnterContext } from "./keyboard";

const S = (p: Partial<ComboState> = {}): ComboState => ({ open: true, hi: 0, count: 5, touched: false, ...p });
const E = (p: Partial<EnterContext> = {}): EnterContext => ({
  key: "Enter", ctrlOrMeta: false, composing: false, defaultPrevented: false,
  tag: "INPUT", inputType: "text", expanded: false, ownEnter: false, busy: false, ...p,
});

describe("ดร็อปดาวน์พิมพ์ค้น — คีย์บอร์ด (D173)", () => {
  it("↓ ↑ เลื่อนไฮไลต์ ไม่ทะลุขอบ", () => {
    expect(comboKey("ArrowDown", S({ hi: 1 }))).toEqual({ type: "move", hi: 2 });
    expect(comboKey("ArrowDown", S({ hi: 4 }))).toEqual({ type: "move", hi: 4 });
    expect(comboKey("ArrowUp", S({ hi: 0 }))).toEqual({ type: "move", hi: 0 });
    expect(comboKey("ArrowUp", S({ hi: 3 }))).toEqual({ type: "move", hi: 2 });
  });

  it("รายการปิดอยู่ กดลูกศร = เปิด (ไม่ขยับไฮไลต์)", () => {
    expect(comboKey("ArrowDown", S({ open: false }))).toEqual({ type: "open" });
    expect(comboKey("ArrowUp", S({ open: false }))).toEqual({ type: "open" });
  });

  it("Enter เลือกรายการที่ไฮไลต์แล้วอยู่ช่องเดิม", () => {
    expect(comboKey("Enter", S({ hi: 2 }))).toEqual({ type: "pick", index: 2, stay: true });
  });

  it("Tab หลังพิมพ์ค้น/กดลูกศร = เลือกแล้วไปช่องถัดไป", () => {
    expect(comboKey("Tab", S({ hi: 1, touched: true }))).toEqual({ type: "pick", index: 1, stay: false });
  });

  it("🪤 Tab ผ่านช่องเฉย ๆ (ยังไม่ได้พิมพ์) ต้องไม่เปลี่ยนค่า — แค่ปิดรายการ", () => {
    expect(comboKey("Tab", S({ touched: false }))).toEqual({ type: "close" });
    expect(comboKey("Tab", S({ open: false, touched: true }))).toBeNull();
  });

  it("ไม่มีรายการให้เลือก (ค้นไม่เจอ) — Enter ไม่ทำอะไร · Tab แค่ปิด", () => {
    expect(comboKey("Enter", S({ count: 0 }))).toBeNull();
    expect(comboKey("Tab", S({ count: 0, touched: true }))).toEqual({ type: "close" });
  });

  it("ไฮไลต์ค้างเกินจำนวนหลังกรอง — เลือกตัวสุดท้ายที่มีจริง ไม่ใช่ undefined", () => {
    expect(comboKey("Enter", S({ hi: 9, count: 2 }))).toEqual({ type: "pick", index: 1, stay: true });
  });

  it("Esc ปิดรายการเมื่อเปิดอยู่ · ปิดอยู่แล้ว = ปล่อยผ่าน (ให้ป๊อปอัพรับไปปิดตัวเอง)", () => {
    expect(comboKey("Escape", S())).toEqual({ type: "close" });
    expect(comboKey("Escape", S({ open: false }))).toBeNull();
  });

  it("ปุ่มอื่นไม่เกี่ยว", () => {
    expect(comboKey("a", S())).toBeNull();
  });
});

describe("Enter = บันทึก ในป๊อปอัพ (D173)", () => {
  it("Enter ในช่องกรอกบรรทัดเดียว = บันทึก", () => {
    expect(enterSubmits(E())).toBe(true);
    expect(enterSubmits(E({ inputType: "date" }))).toBe(true);
    expect(enterSubmits(E({ inputType: "" }))).toBe(true);
  });

  it("textarea: Enter = ขึ้นบรรทัด · Ctrl+Enter = บันทึก", () => {
    expect(enterSubmits(E({ tag: "TEXTAREA", inputType: "" }))).toBe(false);
    expect(enterSubmits(E({ tag: "TEXTAREA", inputType: "", ctrlOrMeta: true }))).toBe(true);
  });

  it("บนปุ่ม / ช่องติ๊ก / select — Enter เป็นของตัวมันเอง", () => {
    expect(enterSubmits(E({ tag: "BUTTON", inputType: "" }))).toBe(false);
    expect(enterSubmits(E({ inputType: "checkbox" }))).toBe(false);
    expect(enterSubmits(E({ inputType: "radio" }))).toBe(false);
    expect(enterSubmits(E({ tag: "SELECT", inputType: "" }))).toBe(false);
  });

  it("🪤 ดร็อปดาวน์เปิดอยู่ — Enter คือเลือกรายการ ห้ามบันทึกทั้งฟอร์ม (แม้กด Ctrl)", () => {
    expect(enterSubmits(E({ expanded: true }))).toBe(false);
    expect(enterSubmits(E({ expanded: true, ctrlOrMeta: true }))).toBe(false);
    expect(enterSubmits(E({ defaultPrevented: true }))).toBe(false);
  });

  it("ช่องที่ประกาศ data-enter=own (Enter = เพิ่มแถว) ไม่บันทึก · Ctrl+Enter ยังบันทึกได้", () => {
    expect(enterSubmits(E({ ownEnter: true }))).toBe(false);
    expect(enterSubmits(E({ ownEnter: true, ctrlOrMeta: true }))).toBe(true);
  });

  it("กำลังบันทึกอยู่ / กำลังประกอบคำผ่าน IME — ไม่ยิงซ้ำ", () => {
    expect(enterSubmits(E({ busy: true }))).toBe(false);
    expect(enterSubmits(E({ composing: true }))).toBe(false);
    expect(enterSubmits(E({ key: "a" }))).toBe(false);
  });
});

describe("Tab วนอยู่ในป๊อปอัพ (D173)", () => {
  it("ตัวสุดท้าย + Tab → ตัวแรก · ตัวแรก + Shift+Tab → ตัวสุดท้าย", () => {
    expect(trapTab(3, 4, false)).toBe(0);
    expect(trapTab(0, 4, true)).toBe(3);
  });
  it("อยู่กลาง ๆ = ปล่อยให้เบราว์เซอร์เดินเอง", () => {
    expect(trapTab(1, 4, false)).toBeNull();
    expect(trapTab(2, 4, true)).toBeNull();
  });
  it("โฟกัสหลุดออกนอกป๊อปอัพ → ดึงกลับเข้ามา", () => {
    expect(trapTab(-1, 4, false)).toBe(0);
    expect(trapTab(-1, 4, true)).toBe(3);
  });
  it("ไม่มีอะไรให้โฟกัส = ไม่ทำอะไร", () => {
    expect(trapTab(-1, 0, false)).toBeNull();
  });
});

/**
 * อ่านซอร์สจริง — component ต้อง "ทำตามผล" ของฟังก์ชันข้างบน ไม่ตัดสินเอง
 * (กติกาอยู่ที่เดียว · ไม่งั้นแก้เทสผ่านแต่หน้าจอทำอีกอย่าง — ตระกูล D81)
 */
describe("component ใช้กติกากลาง (อ่านซอร์ส)", () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, f), "utf8");
  const ui = read("ui.tsx");
  const modal = read("modal.tsx");

  it("Combobox เรียก comboKey และเลื่อนรายการตามไฮไลต์", () => {
    const combo = ui.slice(ui.indexOf("export function Combobox("), ui.indexOf("// ── buttons"));
    expect(combo).toContain("comboKey(");
    expect(combo).toContain("scrollIntoView");
    expect(combo).toContain('role="combobox"');
    expect(combo).toContain("aria-expanded");
  });

  it("Modal เรียก enterSubmits / trapTab · ล็อกหน้าหลัง · คืนโฟกัสตอนปิด", () => {
    expect(modal).toContain("enterSubmits(");
    expect(modal).toContain("trapTab(");
    expect(modal).toContain("document.body.style.overflow");
    expect(modal).toContain('role="dialog"');
    expect(modal).toMatch(/prev\w*\??\.focus\(/);
  });

  it("🪤 Modal ปิดพื้นหลังด้วย onMouseDown ไม่ใช่ onClick (ลากคลุมข้อความแล้วปล่อยนอกกล่อง = ปิดเอง · D73)", () => {
    expect(modal).toContain("onMouseDown");
    expect(modal).not.toMatch(/onClick=\{[^}]*currentTarget/);
  });

  it("กล่องยืนยัน (useConfirm) ใช้ Modal ตัวกลาง — ได้ล็อกหน้าหลัง/วน Tab/ลำดับ Esc มาด้วย", () => {
    const confirm = ui.slice(ui.indexOf("export function useConfirm("));
    expect(confirm).toContain("<Modal");
    expect(confirm).not.toContain("fixed inset-0");
  });
});

/**
 * ป๊อปอัพต้องผ่าน <Modal> ตัวเดียว — เดิมเขียนแยกกัน 29 ไฟล์ (ฉากหลัง 5 ความเข้ม · ส่วนใหญ่เปิดแล้วไม่พร้อมพิมพ์ ·
 * Tab หลุดไปหน้าหลัง) · ใครเขียนฉากหลังเองอีก เทสนี้แดง
 */
describe("ป๊อปอัพทั้งแอปใช้ Modal ตัวกลาง (อ่านซอร์สทุกไฟล์)", () => {
  const ROOT = path.join(__dirname, "../..");
  function walk(dir: string, out: string[] = []): string[] {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p, out);
      else if (f.name.endsWith(".tsx")) out.push(p);
    }
    return out;
  }
  const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib"))];
  const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
  // ตัดคอมเมนต์ออกก่อนตรวจ — คอมเมนต์ยกตัวอย่างของต้องห้ามไว้สอนคน
  const code = (f: string) => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("อ่านไฟล์ได้จริง (กันเทสเปล่า)", () => {
    expect(files.length).toBeGreaterThan(80);
    expect(files.map(rel)).toContain("lib/shared/modal.tsx");
  });

  it("ไม่มีฉากหลัง fixed inset-0 เขียนเองนอก modal.tsx", () => {
    const bad = files.filter((f) => rel(f) !== "lib/shared/modal.tsx" && /fixed inset-0/.test(code(f))).map(rel);
    expect(bad).toEqual([]);
  });

  it("ป๊อปอัพหลายสิบจุดใช้ <Modal> จริง", () => {
    const users = files.filter((f) => /<Modal\b/.test(code(f)));
    expect(users.length).toBeGreaterThanOrEqual(25);
  });

  it("🚨 ป๊อปอัพที่ยกเลิก/ออกเอกสารมีเลข/รับ-จ่ายเงิน ต้องไม่มี onSubmit (Enter ห้ามทำงานแทนการกดปุ่ม)", () => {
    for (const f of [
      "app/(app)/sales/_components/CancelOrderDialog.tsx",
      "app/(app)/sales/_components/CreditNoteDialog.tsx",
      "app/(app)/sales/_components/EditPaymentDialog.tsx",
      "app/(app)/sales/_components/PlanPanel.tsx",
      "app/(app)/sales/_components/WarehouseTab.tsx",
      "app/(app)/accounting/_components/TaxPayCard.tsx",
      "app/(app)/payroll/_components/FilingTab.tsx",
      "app/(app)/bar/_components/EditSaleModal.tsx",
      "app/(app)/_components/billing-notice.tsx",
    ]) {
      const c = code(path.join(ROOT, f));
      expect(c, f).toMatch(/<Modal\b/);
      expect(c, f).not.toMatch(/onSubmit=/);
    }
  });
});
