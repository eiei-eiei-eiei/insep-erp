import { describe, it, expect } from "vitest";
import { workspacesFor, hasModule, WORKSPACES, ALL_MODULES } from "./workspaces";

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
    expect(keys(workspacesFor("main", ["production"]))).toEqual(["production", "reports"]);
  });

  it("รายงานราชการผูกกับโมดูลผลิต (ฟอร์ม ภส. เป็นเอกสารของโรงกลั่น)", () => {
    expect(keys(workspacesFor("main", ["accounting"]))).toEqual(["accounting"]);
    expect(keys(workspacesFor("main", ["production"]))).toContain("reports");
  });

  it("sale เห็นแค่ขาย และหายไปถ้าไม่ได้ซื้อโมดูลขาย", () => {
    expect(keys(workspacesFor("sale", ALL_MODULES))).toEqual(["sales"]);
    expect(keys(workspacesFor("sale", ["production"]))).toEqual([]);
  });

  it("role ยังคุมเหมือนเดิม — warehouse ไม่เห็นบัญชีแม้ซื้อครบ", () => {
    expect(keys(workspacesFor("warehouse", ALL_MODULES))).toEqual(["sales"]);
  });

  it("ไม่ส่งโมดูลมา = เปิดหมด (พฤติกรรมเดิมก่อนมี 4.5 ต้องไม่พัง)", () => {
    expect(keys(workspacesFor("main"))).toEqual(keys(WORKSPACES));
    expect(keys(workspacesFor("viewer"))).toEqual(["accounting", "production", "reports", "sales"]);
  });
});
