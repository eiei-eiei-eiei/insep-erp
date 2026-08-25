import { describe, it, expect } from "vitest";
import { changedFields, fmtVal, rawBefore, columnLabel } from "./editLog";
import { tableLabel } from "./tenantTables";

describe("fmtVal — ค่าที่โชว์บนจอ", () => {
  it("ว่าง/null เป็น — เสมอ (ต้องแยกออกจาก 'ไม่ได้แตะ')", () => {
    expect(fmtVal(null)).toBe("—");
    expect(fmtVal(undefined)).toBe("—");
    expect(fmtVal("")).toBe("—");
    expect(fmtVal([])).toBe("—");
  });
  it("boolean เป็นภาษาไทย · เลข 0 ต้องไม่กลายเป็น —", () => {
    expect(fmtVal(true)).toBe("ใช่");
    expect(fmtVal(false)).toBe("ไม่ใช่");
    expect(fmtVal(0)).toBe("0");
  });
  it("array เป็นข้อความคั่นด้วยจุลภาค", () => {
    expect(fmtVal(["ลูกค้า", "ผู้ขาย"])).toBe("ลูกค้า, ผู้ขาย");
  });
});

describe("changedFields — โชว์เฉพาะที่เปลี่ยนจริง", () => {
  it("update: ตัดฟิลด์ที่ค่าเท่าเดิมทิ้งหมด", () => {
    const r = {
      action: "update" as const,
      before: { product_id: "P1", name: "สุราขาว", degree: 35, bottle_size_l: 330 },
      after: { product_id: "P1", name: "สุราขาว", degree: 35, bottle_size_l: 0.33 },
    };
    const f = changedFields(r);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ key: "bottle_size_l", label: "ขนาดขวด (ล.)", before: "330", after: "0.33" });
  });

  it("update: ลบค่าทิ้ง (มีค่า → null) ต้องยังขึ้น ไม่ใช่หายไปเงียบ ๆ", () => {
    const f = changedFields({
      action: "update",
      before: { excise_id: "123-1-001" },
      after: { excise_id: null },
    });
    expect(f).toEqual([{ key: "excise_id", label: "เลขทะเบียนสรรพสามิต", before: "123-1-001", after: "—" }]);
  });

  it("🚨 ไม่โชว์ tenant_id / created_at (ของระบบ ไม่ใช่สิ่งที่ผู้ใช้แก้)", () => {
    const f = changedFields({
      action: "update",
      before: { tenant_id: "aaa", created_at: "2026-01-01", name: "ก่อน" },
      after: { tenant_id: "bbb", created_at: "2026-01-02", name: "หลัง" },
    });
    expect(f.map((x) => x.key)).toEqual(["name"]);
  });

  it("insert: โชว์ทุกฟิลด์ที่มีค่า · ก่อน = —", () => {
    const f = changedFields({ action: "insert", before: null, after: { name: "ใหม่", note: null } });
    expect(f).toEqual([{ key: "name", label: "ชื่อ", before: "—", after: "ใหม่" }]);
  });

  it("delete: โชว์ค่าที่หายไป (ต้องก๊อปกลับได้ตอนลบผิด)", () => {
    const f = changedFields({ action: "delete", before: { name: "ที่ถูกลบ" }, after: null });
    expect(f).toEqual([{ key: "name", label: "ชื่อ", before: "ที่ถูกลบ", after: "—" }]);
  });
});

describe("rawBefore — ปุ่มคัดลอกค่าเก่า", () => {
  it("คืนค่าดิบ ไม่ใช่ค่าที่ฟอร์แมตแล้ว (เอาไปวางในช่องกรอกต้องใช้ได้)", () => {
    const r = { before: { bottle_size_l: 0.33, active: false, note: null } };
    expect(rawBefore(r, "bottle_size_l")).toBe("0.33");
    expect(rawBefore(r, "active")).toBe("false"); // ไม่ใช่ "ไม่ใช่"
    expect(rawBefore(r, "note")).toBe("");        // ไม่ใช่ "—"
  });
});

describe("ป้ายภาษาไทย", () => {
  it("ตาราง/คอลัมน์ที่รู้จัก แปลเป็นไทย", () => {
    expect(tableLabel("products")).toBe("สินค้า/สุรา (ข้อมูลหลัก)");
    expect(columnLabel("liquor_type")).toBe("ประเภทสุรา");
  });
  it("ที่ไม่รู้จัก คืนชื่อจริง (ดีกว่าเดาผิดหรือขึ้นว่าง)", () => {
    expect(tableLabel("some_new_table")).toBe("some_new_table");
    expect(columnLabel("weird_col")).toBe("weird_col");
  });
});
