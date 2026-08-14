import { describe, it, expect } from "vitest";
import {
  normalizeNewTenant,
  validateModules,
  validateNewEntity,
  validateNewTenant,
  validateQuota,
  type NewTenantInput,
} from "./provision";

/**
 * ตรวจ input ของงาน "รับลูกค้าใหม่" — ด่านนี้สำคัญเพราะ **สร้างลูกค้าครึ่งทางแล้วค้าง
 * คือสิ่งที่แก้ยากที่สุด** (tenant เกิดแล้วแต่ผู้ใช้ไม่เกิด = ลูกค้าเข้าระบบไม่ได้และลบก็ยาก)
 */
const ok: NewTenantInput = {
  slug: "rongsomchai",
  name: "โรงกลั่นสมชาย",
  color: "copper",
  entityId: "EID01",
  maxEntities: 1,
  modules: ["production", "accounting", "sales"],
};

describe("validateNewTenant", () => {
  it("ข้อมูลครบถูกต้อง = ผ่าน", () => {
    expect(validateNewTenant(ok)).toBeNull();
  });

  it("slug ภาษาไทย/มีช่องว่าง/มีจุด = ไม่ผ่าน (ต้องใช้เป็น subdomain + โดเมนอีเมลได้)", () => {
    expect(validateNewTenant({ ...ok, slug: "โรงสมชาย" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "rong somchai" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "rong.somchai" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "-rong" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "" })).not.toBeNull();
  });

  it("★ slug ที่เป็นชื่อสงวนใช้ไม่ได้ — 'platform' เป็นแถวของแอดมินเอง", () => {
    expect(validateNewTenant({ ...ok, slug: "platform" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "www" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "admin" })).not.toBeNull();
  });

  it("ชื่อกิจการว่าง = ไม่ผ่าน", () => {
    expect(validateNewTenant({ ...ok, name: "   " })).not.toBeNull();
  });

  it("ชุดสีที่ไม่มีใน BRAND_COLORS = ไม่ผ่าน (กันสีที่อ่านตัวหนังสือบนปุ่มไม่ออก)", () => {
    expect(validateNewTenant({ ...ok, color: "neon" })).not.toBeNull();
  });

  it("★★ ไม่เลือกโมดูลเลย = ไม่ผ่าน — ค่าว่างแปลว่า 'เปิดหมด' (fail-open ตาม D53)", () => {
    const err = validateNewTenant({ ...ok, modules: [] });
    expect(err, "ปล่อยผ่าน = ลูกค้าที่ไม่ติ๊กอะไรเลยได้ทุกโมดูลฟรี").not.toBeNull();
  });

  it("โมดูลที่ไม่รู้จัก = ไม่ผ่าน", () => {
    expect(validateNewTenant({ ...ok, modules: ["production", "hr"] })).not.toBeNull();
  });

  it("โควตาต้องเป็นจำนวนเต็ม >= 1", () => {
    expect(validateNewTenant({ ...ok, maxEntities: 0 })).not.toBeNull();
    expect(validateNewTenant({ ...ok, maxEntities: 1.5 })).not.toBeNull();
    expect(validateNewTenant({ ...ok, maxEntities: Number.NaN })).not.toBeNull();
    expect(validateNewTenant({ ...ok, maxEntities: 3 })).toBeNull();
  });

  it("รหัสกิจการต้องเป็นตัวพิมพ์ใหญ่/ตัวเลข", () => {
    expect(validateNewTenant({ ...ok, entityId: "eid01" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, entityId: "กิจการ" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, entityId: "E" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, entityId: "EID02" })).toBeNull();
  });
});

describe("normalizeNewTenant", () => {
  it("ตัดช่องว่าง + slug เป็นตัวเล็ก + รหัสกิจการเป็นตัวใหญ่", () => {
    const n = normalizeNewTenant({
      ...ok,
      slug: "  RongSomchai  ",
      name: "  โรงกลั่นสมชาย ",
      entityId: " eid02 ",
      modules: [" production ", "", "sales"],
    });
    expect(n.slug).toBe("rongsomchai");
    expect(n.name).toBe("โรงกลั่นสมชาย");
    expect(n.entityId).toBe("EID02");
    expect(n.modules).toEqual(["production", "sales"]);
  });

  it("★ normalize แล้วต้องผ่าน validate — ผู้ใช้พิมพ์ตัวใหญ่มาไม่ควรโดนปฏิเสธ", () => {
    expect(validateNewTenant(normalizeNewTenant({ ...ok, slug: "RONGSOMCHAI" }))).toBeNull();
  });
});

describe("validateQuota", () => {
  it("ขยายโควตาได้", () => {
    expect(validateQuota(3, 1)).toBeNull();
  });

  it("★ ลดโควตาต่ำกว่าจำนวนกิจการที่มีอยู่จริงไม่ได้ (เหตุผลเดียวกับ D53)", () => {
    const err = validateQuota(1, 2);
    expect(err, "ข้อมูลที่ขัดกับความจริง = ต้นทางของบั๊ก 'ลูกค้าเข้าถึงข้อมูลตัวเองไม่ได้'").not.toBeNull();
  });

  it("เท่ากับจำนวนที่มีอยู่ = ได้ (แค่ปิดไม่ให้เพิ่มอีก)", () => {
    expect(validateQuota(2, 2)).toBeNull();
  });

  it("ค่าที่ไม่ใช่จำนวนเต็ม >= 1 = ไม่ผ่าน", () => {
    expect(validateQuota(0, 0)).not.toBeNull();
    expect(validateQuota(-1, 0)).not.toBeNull();
  });
});

describe("validateModules", () => {
  it("อย่างน้อย 1 โมดูล และต้องรู้จักทุกตัว", () => {
    expect(validateModules(["production"])).toBeNull();
    expect(validateModules([])).not.toBeNull();
    expect(validateModules(["production", "warehouse"])).not.toBeNull();
  });
});

describe("validateNewEntity", () => {
  it("รหัส + ชื่อ ต้องครบ", () => {
    expect(validateNewEntity({ entityId: "EID02", name: "สมชาย", isVat: false })).toBeNull();
    expect(validateNewEntity({ entityId: "EID02", name: "  ", isVat: true })).not.toBeNull();
    expect(validateNewEntity({ entityId: "e2", name: "สมชาย", isVat: true })).not.toBeNull();
  });
});
