import { describe, it, expect } from "vitest";
import { workspacesFor, workspacesWithLock, hasModule, WORKSPACES, ALL_MODULES, MODULES, MODULE_LABEL } from "./workspaces";

/**
 * เมนูถูกกรอง 2 ชั้น: role (ทำอะไรได้) × โมดูล (ซื้ออะไรไว้)
 * ★ ชั้นโมดูลคือของใหม่ (4.5) — ของเดิม role `main` ลัดผ่านตัวกรองทั้งหมด
 *   ถ้าไม่คุมไว้ เจ้าของกิจการที่ซื้อแค่โมดูลผลิตจะเห็นเมนูบัญชี/ขายที่ไม่ได้จ่าย
 */

const keys = (ws: { key: string }[]) => ws.map((w) => w.key).sort();

describe("hasModule — ค่าว่างต้อง fail-open", () => {
  it("ไม่มีค่า/ว่าง = เปิดหมด (อ่าน DB พลาดต้องไม่ล็อกลูกค้าออกจากระบบที่จ่ายเงินแล้ว)", () => {
    expect(hasModule(null, "sales")).toBe(true);
    expect(hasModule(undefined, "sales")).toBe(true);
    expect(hasModule([], "sales")).toBe(true);
  });

  it("มีค่าแล้วกรองตามจริง", () => {
    expect(hasModule(["production"], "production")).toBe(true);
    expect(hasModule(["production"], "sales")).toBe(false);
  });
});

describe("workspacesFor — role × โมดูล", () => {
  it("main ซื้อครบ = เห็นทุก workspace", () => {
    expect(keys(workspacesFor("main", ALL_MODULES))).toEqual(keys(WORKSPACES));
  });

  it("★ main ที่ซื้อแค่โมดูลผลิต ต้องไม่เห็นเมนูบัญชี/ขาย", () => {
    expect(keys(workspacesFor("main", ["production"]))).toEqual(["production"]);
  });

  it("ไม่มี workspace รายงานราชการแล้ว — ฟอร์ม ภส. เป็นแท็บในผลิต (D62)", () => {
    expect(keys(WORKSPACES)).toEqual(["accounting", "payroll", "production", "sales"]);
    expect(keys(workspacesFor("main", ["accounting"]))).toEqual(["accounting"]);
  });

  it("ฝ่ายขายเห็นแค่ขาย และหายไปถ้าไม่ได้ซื้อโมดูลขาย", () => {
    expect(keys(workspacesFor("sales", ALL_MODULES))).toEqual(["sales"]);
    expect(keys(workspacesFor("sales", ["production"]))).toEqual([]);
  });

  it("🔴 บทบาทเฉพาะโดเมนเห็นแค่หน้าของตัวเอง แม้ tenant ซื้อครบทุกโมดูล", () => {
    expect(keys(workspacesFor("sales_manager", ALL_MODULES))).toEqual(["sales"]);
    expect(keys(workspacesFor("accounting", ALL_MODULES))).toEqual(["accounting"]);
    expect(keys(workspacesFor("accounting_manager", ALL_MODULES))).toEqual(["accounting"]);
    expect(keys(workspacesFor("payroll", ALL_MODULES))).toEqual(["payroll"]);
    expect(keys(workspacesFor("payroll_manager", ALL_MODULES))).toEqual(["payroll"]);
  });

  it("finance_manager เป็นตัวเดียวที่คร่อม 2 โดเมน (บัญชี + เงินเดือน)", () => {
    expect(keys(workspacesFor("finance_manager", ALL_MODULES))).toEqual(["accounting", "payroll"]);
  });

  it("ไม่ส่งโมดูลมา = เปิดหมด (พฤติกรรมเดิมก่อนมี 4.5 ต้องไม่พัง)", () => {
    expect(keys(workspacesFor("main"))).toEqual(keys(WORKSPACES));
    // viewer ไม่เห็นเงินเดือนแม้เปิดโมดูลครบ — เงินเดือนรายคนเป็นข้อมูลอ่อนไหว
    expect(keys(workspacesFor("viewer"))).toEqual(["accounting", "production", "sales"]);
  });
});

describe("เงินเดือน (โมดูลที่ 4) — เปิดเฉพาะคนที่มี pay.read", () => {
  it("main ที่ซื้อโมดูลเงินเดือน เห็นเมนู", () => {
    expect(keys(workspacesFor("main", ["payroll"]))).toEqual(["payroll"]);
  });

  it("★ บทบาทที่ไม่มี pay.read ไม่เห็นเลย แม้ tenant จะซื้อโมดูลไว้ — 🔴 รวม viewer ด้วย", () => {
    for (const r of ["viewer", "sales", "sales_manager", "accounting", "accounting_manager"] as const) {
      expect(keys(workspacesFor(r, ALL_MODULES)), r).not.toContain("payroll");
    }
  });

  it("ไม่ได้ซื้อ = ไม่เห็น (เป็น add-on ที่ขายเพิ่ม ลูกค้าเดิมไม่ได้ฟรี)", () => {
    expect(keys(workspacesFor("main", ["production", "accounting", "sales"]))).not.toContain("payroll");
  });
});

describe("workspacesWithLock — หน้าแรกโชว์ของที่ยังไม่ได้ซื้อเป็นสีเทา", () => {
  it("ไม่ตัดทิ้ง แต่ติดธง locked ให้ตัวที่ยังไม่ได้ซื้อ", () => {
    const ws = workspacesWithLock("main", ["production"]);
    expect(ws).toHaveLength(4); // ครบทุกอัน ไม่หายไปไหน
    const locked = ws.filter((w) => w.locked).map((w) => w.key).sort();
    expect(locked).toEqual(["accounting", "payroll", "sales"]);
  });

  it("ซื้อครบ = ไม่มีอันไหน locked", () => {
    expect(workspacesWithLock("main", ALL_MODULES).some((w) => w.locked)).toBe(false);
  });

  it("★ ชั้นสิทธิ์ยังตัดทิ้งเหมือนเดิม — ฝ่ายขายไม่ต้องเห็นว่ามีโมดูลบัญชีให้ซื้อ", () => {
    const ws = workspacesWithLock("sales", ["sales"]);
    expect(ws.map((w) => w.key)).toEqual(["sales"]);
  });
});

/**
 * 🔴 D84 — หน้าแอดมินเคยเขียน ternary ไล่เช็ค key เองตอนมี 3 โมดูล
 *    พอ D66 เพิ่ม `payroll` มันตกเข้า else กลายเป็น "ขาย" → ลูกค้าที่ซื้อเงินเดือน
 *    ดูเหมือนซื้อขาย 2 อัน บนหน้าจอที่ใช้ตัดสินว่าจะเก็บเงินลูกค้าเท่าไหร่
 */
describe("MODULE_LABEL — ชื่อโมดูลต้องมีแหล่งเดียวและครบทุกตัว", () => {
  it("ทุกโมดูลใน MODULES มีชื่อไทย ไม่มีตัวไหนตกหล่น", () => {
    for (const m of MODULES) {
      expect(MODULE_LABEL[m], `โมดูล "${m}" ยังไม่มีชื่อไทย`).toBeTruthy();
    }
    expect(Object.keys(MODULE_LABEL).sort()).toEqual([...MODULES].sort());
  });

  it("ชื่อต้องไม่ซ้ำกัน — ซ้ำเมื่อไหร่แปลว่ามีโมดูลถูกกลืนไปเป็นชื่อของอีกตัว", () => {
    const labels = MODULES.map((m) => MODULE_LABEL[m]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("ตรงกับชื่อ workspace ที่โมดูลนั้นเปิดให้ (ห้าม drift กันเอง)", () => {
    for (const w of WORKSPACES) {
      expect(MODULE_LABEL[w.module]).toBe(w.label);
    }
  });

  it("★ payroll ต้องเป็น 'เงินเดือน' ไม่ใช่ 'ขาย' — เคสที่พังจริงใน D84", () => {
    expect(MODULE_LABEL.payroll).toBe("เงินเดือน");
  });
});
