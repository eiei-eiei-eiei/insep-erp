import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { companySectionsFor, rolesFor, auditTableModule, auditTablesFor, lineEventsFor } from "./moduleScope";
import { AUDITED_TABLES } from "./tenantTables";
import { ROLES } from "./roles";
import { salesProductionText, menuCategoryOptions } from "../sales/productionText";

/**
 * D133 — ลูกค้าที่ไม่ได้ซื้อโมดูลไหน ไม่เห็นของโมดูลนั้นบนจอ
 * ★ ทุกข้อพิสูจน์ 2 ทิศ: ไม่ซื้อ = ไม่เห็น · ซื้อ = เห็น · อ่านโมดูลไม่ได้ (null) = เห็นครบ (fail-open D53)
 */

const ACCT_ONLY = ["accounting"];
const ALL = null;

describe("ตั้งค่า → กิจการ", () => {
  it("ซื้อแค่บัญชี = ไม่มีเลขสรรพสามิต · ไม่มีเลขนายจ้าง สปส. · ไม่มีการ์ดเอกสารการค้า แต่ยังมีวิธียื่นภาษี", () => {
    expect(companySectionsFor(ACCT_ONLY)).toEqual({ excise: false, filingMethod: true, ssoEmployer: false, salesDocs: false });
  });
  it("ซื้อครบ / อ่านไม่ได้ = เห็นครบ", () => {
    expect(companySectionsFor(["production", "accounting", "sales", "payroll", "bar"])).toEqual({ excise: true, filingMethod: true, ssoEmployer: true, salesDocs: true });
    expect(companySectionsFor(ALL)).toEqual({ excise: true, filingMethod: true, ssoEmployer: true, salesDocs: true });
  });
  it("🚨 หน้าจอใช้ธงจริง — ช่องเลขสรรพสามิตอยู่ใต้ sections.excise", () => {
    const src = fs.readFileSync("app/(app)/settings/_components/CompanyCard.tsx", "utf8");
    const at = src.indexOf("เลขทะเบียนสรรพสามิต (ขึ้นหัวฟอร์ม ภส.)");
    expect(src.lastIndexOf("{sections.excise && (", at)).toBeGreaterThan(src.lastIndexOf("</Field>", at));
    for (const flag of ["sections.filingMethod", "sections.ssoEmployer", "sections.salesDocs"]) expect(src).toContain(flag);
  });
});

describe("ตั้งค่า → ผู้ใช้: บทบาทที่ให้เลือก", () => {
  it("ไม่มีบาร์ = ไม่มี 'พนักงานบาร์' · ไม่มีขาย = ไม่มีบทบาทฝ่ายขาย", () => {
    const r = rolesFor(ACCT_ONLY);
    expect(r).not.toContain("bar");
    expect(r).not.toContain("sales");
    expect(r).not.toContain("payroll");
    expect(r).toEqual(expect.arrayContaining(["main", "viewer", "accounting", "accounting_manager", "finance_manager"]));
  });
  it("ซื้อบาร์ = มี 'พนักงานบาร์'", () => {
    expect(rolesFor(["bar"])).toContain("bar");
  });
  it("เจ้าของกิจการโชว์เสมอ แม้โมดูลเดียว", () => {
    expect(rolesFor(["bar"])).toContain("main");
  });
  it("★ บทบาทเดิมของผู้ใช้ที่มีอยู่แล้วต้องอยู่ในลิสต์เสมอ (ไม่งั้นเปลี่ยนบทบาทเงียบ ๆ)", () => {
    expect(rolesFor(ACCT_ONLY, "bar")).toContain("bar");
  });
  it("อ่านโมดูลไม่ได้ = ครบทุกบทบาท", () => {
    expect(rolesFor(ALL)).toEqual([...ROLES]);
  });
  it("🚨 หน้าจัดการผู้ใช้เรียก rolesFor (ไม่วน ROLES เอง)", () => {
    const src = fs.readFileSync("app/(app)/settings/users/_components/users-manager.tsx", "utf8");
    expect(src).toContain("rolesFor(modules)");
    expect(src).toContain("rolesFor(modules, u.role)");
    expect(src).not.toMatch(/ROLES\.map|ROLE_OPTIONS/);
  });
});

describe("ตั้งค่า → ประวัติการแก้ไข: ตารางที่ให้กรอง", () => {
  it("ทุกตารางที่ audit ระบุโมดูลได้ (ตารางใหม่ลืมกำหนด = เทสนี้แดง)", () => {
    for (const t of AUDITED_TABLES) expect(() => auditTableModule(t), t).not.toThrow();
  });
  it("ซื้อแค่บัญชี = ไม่มีตารางผลิต/บาร์ · ยังมีกิจการ/คู่ค้า/บิล", () => {
    const t = auditTablesFor(ACCT_ONLY);
    expect(t.some((x) => x.startsWith("log_") || x.startsWith("bar_"))).toBe(false);
    expect(t).toEqual(expect.arrayContaining(["transactions", "entities", "contacts", "bank_accounts"]));
  });
  it("อ่านโมดูลไม่ได้ = ครบ", () => {
    expect(auditTablesFor(ALL)).toEqual([...AUDITED_TABLES]);
  });
});

describe("ตั้งค่า → แจ้งเตือน LINE", () => {
  it("ซื้อแค่บัญชี = บอกแค่เตือนภาษี ไม่พูดถึงออเดอร์/สรรพสามิต/บาร์", () => {
    expect(lineEventsFor(ACCT_ONLY)).toEqual(["เตือนกำหนดยื่น ภพ.30 / ภงด.3/53"]);
  });
  it("ซื้อครบ = บอกครบ 4 อย่าง", () => {
    expect(lineEventsFor(ALL)).toHaveLength(4);
  });
});

describe("แอปขายของลูกค้าที่ไม่มีโมดูลผลิต", () => {
  it("ไม่มีประโยคพูดถึงสุรา / ภส. / โรงกลั่น / แอปผลิต", () => {
    const t = salesProductionText(false);
    for (const v of Object.values(t)) {
      if (typeof v === "string" && v !== "ทั่วไป") expect(v).not.toMatch(/สุรา|ภส\.|โรงกลั่น|แอปผลิต/);
    }
    expect(t.manualStockNote).toBeNull();
    expect(t.defaultMenuCategory).toBe("ทั่วไป");
  });
  it("มีโมดูลผลิต = ประโยคเดิม (ไม่ขยับ)", () => {
    const t = salesProductionText(true);
    expect(t.defaultMenuCategory).toBe("สุรา");
    expect(t.shipConfirm).toContain("ฟอร์ม ภส.");
  });
  it("หมวดเมนู 'สุรา' ไม่มีให้เลือก — ยกเว้นเมนูที่เป็นหมวดนั้นอยู่แล้ว", () => {
    expect(menuCategoryOptions(false).map((o) => o.value)).toEqual(["ทั่วไป"]);
    expect(menuCategoryOptions(false, "สุรา").map((o) => o.value)).toEqual(["สุรา", "ทั่วไป"]);
    expect(menuCategoryOptions(true).map((o) => o.value)).toEqual(["สุรา", "ทั่วไป"]);
  });
  it("🚨 หน้าขายไม่เหลือประโยคสุรา/ภส. ที่เขียนตายตัว (ต้องผ่าน salesProductionText)", () => {
    for (const f of ["WarehouseTab.tsx", "PosTab.tsx", "CustomerFields.tsx", "MenuTab.tsx"]) {
      const code = fs.readFileSync(`app/(app)/sales/_components/${f}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(code, f).not.toMatch(/ฟอร์ม ภส\.|โรงกลั่น|ส่งข้อมูลให้แอปผลิต|สุรา \(ตัดสต็อกผลิต\)/);
    }
  });
});

describe("ข้อความระดับสินค้าไม่พูดถึงโรงกลั่น", () => {
  it("หน้าล็อกอิน + manifest + metadata", () => {
    for (const f of ["lib/shared/branding.ts", "app/manifest.ts", "app/layout.tsx"]) {
      const code = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(code, f).not.toMatch(/โรงกลั่น|สุราคราฟต์/);
    }
  });
  it("manifest ไม่มีปุ่มลัดไปโมดูลที่ลูกค้าอาจไม่ได้ซื้อ", () => {
    expect(fs.readFileSync("app/manifest.ts", "utf8")).not.toContain("shortcuts:");
  });
});
