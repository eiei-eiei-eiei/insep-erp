import { describe, it, expect } from "vitest";
import { ROLES, CAPS, ROLE_CAPS, ROLE_LABEL, ROLE_HINT, can, canAny, toRole, type Role, type Cap } from "./roles";

/**
 * เทสชุดนี้ทำหน้าที่ต่างจากเทสทั่วไป — มันคือ **สัญญาว่าสิทธิ์ของใครเป็นอย่างไร**
 * ตารางด้านล่างถูกล็อกไว้ทั้งใบโดยตั้งใจ: แก้ `ROLE_CAPS` เมื่อไหร่เทสจะพังทันที
 * เพื่อบังคับให้คนแก้ต้องมาแก้ตารางนี้ด้วย = **ตัดสินใจอย่างรู้ตัว ไม่ใช่หลุดไปเงียบ ๆ**
 *
 * 🚨 ฝั่ง DB มีฝาแฝดอยู่ที่ฟังก์ชัน `has_cap()` (migration 0051) ซึ่งเป็นตัวจริงที่บังคับสิทธิ์
 *    เทสไฟล์นี้มองไม่เห็น SQL — ตัวที่ตรวจฝั่งนั้นคือ `npm run test:tenant` (บทเรียน D79)
 */

/** ตารางที่ตกลงกับผู้ใช้ไว้ (แผน §2) — เขียนซ้ำที่นี่เพื่อให้เทสไม่ได้อ่านจากไฟล์เดียวกับที่ตรวจ */
const EXPECTED: Record<Role, Cap[]> = {
  main: [...CAPS],
  viewer: ["prod.read", "acct.read", "sales.read"],
  sales_manager: ["sales.read", "sales.write", "sales.config"],
  sales: ["sales.read", "sales.write"],
  finance_manager: ["acct.read", "acct.write", "acct.config", "pay.read", "pay.write", "pay.config"],
  accounting_manager: ["acct.read", "acct.write", "acct.config"],
  accounting: ["acct.read", "acct.write"],
  payroll_manager: ["pay.read", "pay.write", "pay.config"],
  payroll: ["pay.read", "pay.write"],
};

const sorted = (a: readonly string[]) => [...a].sort();

describe("ROLE_CAPS — ตารางสิทธิ์ทั้งใบ", () => {
  it.each(ROLES)("%s ได้ความสามารถตรงตามที่ตกลงไว้เป๊ะ (ไม่ขาด ไม่เกิน)", (role) => {
    expect(sorted(ROLE_CAPS[role])).toEqual(sorted(EXPECTED[role]));
  });

  it("ทุกบทบาทมีชื่อไทยและคำอธิบาย", () => {
    for (const r of ROLES) {
      expect(ROLE_LABEL[r], `${r} ไม่มีชื่อไทย`).toBeTruthy();
      expect(ROLE_HINT[r], `${r} ไม่มีคำอธิบาย`).toBeTruthy();
    }
  });

  it("ชื่อไทยห้ามซ้ำกัน — ซ้ำเมื่อไหร่แปลว่ามีบทบาทถูกกลืนไปเป็นอีกตัว (อาการของ D84)", () => {
    const labels = ROLES.map((r) => ROLE_LABEL[r]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("ไม่มีบทบาทไหนอ้าง cap ที่ไม่มีอยู่จริง", () => {
    for (const r of ROLES) {
      for (const c of ROLE_CAPS[r]) expect(CAPS).toContain(c);
    }
  });
});

describe("เส้นแบ่งที่ห้ามหลุด", () => {
  it("main ได้ครบทุกความสามารถ", () => {
    for (const c of CAPS) expect(can("main", c)).toBe(true);
  });

  it("🔴 viewer แก้อะไรไม่ได้เลยสักอย่าง", () => {
    const writeOrConfig = CAPS.filter((c) => c.endsWith(".write") || c.endsWith(".config"));
    for (const c of writeOrConfig) expect(can("viewer", c), `viewer ไม่ควรมี ${c}`).toBe(false);
    expect(can("viewer", "admin")).toBe(false);
  });

  it("🔴 viewer ต้องไม่เห็นเงินเดือน (ตัดสินไว้ตอนวางแผน — ข้อมูลอ่อนไหวที่สุดในระบบ)", () => {
    expect(can("viewer", "pay.read")).toBe(false);
  });

  it("🔴 มีแต่ main ที่แตะหน้าตั้งค่ากลาง/จัดการผู้ใช้ได้", () => {
    for (const r of ROLES) expect(can(r, "admin")).toBe(r === "main");
  });

  it("🔴 ฝ่ายขายไม่เห็นข้อมูลบัญชีและเงินเดือน", () => {
    for (const r of ["sales", "sales_manager"] as Role[]) {
      expect(can(r, "acct.read"), `${r} ไม่ควรอ่านบัญชี`).toBe(false);
      expect(can(r, "pay.read"), `${r} ไม่ควรอ่านเงินเดือน`).toBe(false);
    }
  });

  it("🔴 ฝ่ายขายไม่มี prod.read — แคตตาล็อกสินค้าเปิดให้ที่ policy ของตารางนั้นแทน", () => {
    for (const r of ["sales", "sales_manager"] as Role[]) {
      expect(can(r, "prod.read")).toBe(false);
    }
  });

  it("🔴 บัญชีล้วนไม่เห็นเงินเดือน — มีแต่ finance_manager ที่ข้ามได้ทั้งสองฝั่ง", () => {
    expect(can("accounting", "pay.read")).toBe(false);
    expect(can("accounting_manager", "pay.read")).toBe(false);
    expect(can("finance_manager", "pay.read")).toBe(true);
    expect(can("finance_manager", "acct.read")).toBe(true);
  });

  it("🔴 เงินเดือนล้วนไม่เห็นบัญชี (บิลทุกใบของกิจการ)", () => {
    expect(can("payroll", "acct.read")).toBe(false);
    expect(can("payroll_manager", "acct.read")).toBe(false);
  });

  it("ตัวที่ไม่ใช่ manager ตั้งค่าโดเมนตัวเองไม่ได้", () => {
    expect(can("accounting", "acct.config")).toBe(false);
    expect(can("payroll", "pay.config")).toBe(false);
    expect(can("sales", "sales.config")).toBe(false);
  });

  it("แต่ยังทำงานประจำวันของโดเมนตัวเองได้", () => {
    expect(can("accounting", "acct.write")).toBe(true);
    expect(can("payroll", "pay.write")).toBe(true);
    expect(can("sales", "sales.write")).toBe(true);
  });

  it("มีสิทธิ์เขียนแล้วต้องอ่านได้เสมอ (เขียนได้แต่มองไม่เห็นคือสภาพที่ใช้งานไม่ได้)", () => {
    for (const r of ROLES) {
      for (const domain of ["prod", "acct", "sales", "pay"] as const) {
        if (can(r, `${domain}.write` as Cap)) {
          expect(can(r, `${domain}.read` as Cap), `${r} เขียน ${domain} ได้แต่อ่านไม่ได้`).toBe(true);
        }
      }
    }
  });
});

describe("can / canAny", () => {
  it("role ว่าง/null = ไม่มีสิทธิ์อะไรเลย (fail-closed)", () => {
    expect(can(null, "sales.read")).toBe(false);
    expect(can(undefined, "acct.read")).toBe(false);
    expect(canAny(null, ["acct.read", "pay.read"])).toBe(false);
  });

  it("canAny ผ่านเมื่อมีอย่างน้อยหนึ่งอย่าง", () => {
    expect(canAny("payroll", ["acct.read", "pay.read"])).toBe(true);
    expect(canAny("payroll", ["acct.read", "sales.read"])).toBe(false);
  });
});

describe("toRole — ค่าจาก DB", () => {
  it("ค่าที่รู้จักคืนตามเดิม", () => {
    for (const r of ROLES) expect(toRole(r)).toBe(r);
  });

  it("★ ค่าเก่าก่อน 0051 แปลงให้ (sale/warehouse รวมเป็น sales)", () => {
    expect(toRole("sale")).toBe("sales");
    expect(toRole("warehouse")).toBe("sales");
  });

  it("🚨 ค่าแปลก/ว่าง = viewer ไม่ใช่ main — อ่านพลาดต้องปิด ไม่ใช่เปิด", () => {
    expect(toRole(null)).toBe("viewer");
    expect(toRole("")).toBe("viewer");
    expect(toRole("superadmin")).toBe("viewer");
    expect(toRole("MAIN")).toBe("viewer"); // ตัวพิมพ์ใหญ่ไม่ใช่ค่าที่ DB เก็บ
  });
});
