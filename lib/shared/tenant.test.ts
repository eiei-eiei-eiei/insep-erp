import { describe, it, expect } from "vitest";
import { hostToTenantSlug, isValidTenantSlug } from "./tenant";
import { usernameToEmail } from "./auth-domain";

// 🚨 เทสชุดนี้คุมกติกาข้อสำคัญที่สุดของ multi-tenant (NEXT_STEPS:181):
//    slug จาก URL ใช้ได้แค่ "แต่งหน้า + ชี้ทาง" — ห้ามเป็นตัวตัดสินสิทธิ์
//    ที่นี่จึงเทสแค่ว่า "แกะ slug ถูกไหม" กับ "ประกอบอีเมลถูกไหม" เท่านั้น

describe("hostToTenantSlug", () => {
  const ROOT = "example.com";

  it("แกะ subdomain ชั้นเดียวจากโดเมนหลักได้", () => {
    expect(hostToTenantSlug("rongkor.example.com", ROOT)).toBe("rongkor");
  });

  it("ตัด port ทิ้ง และไม่สนตัวพิมพ์ใหญ่", () => {
    expect(hostToTenantSlug("RongKor.Example.com:3000", ROOT)).toBe("rongkor");
  });

  it("โดเมนหลักเปล่า ๆ = ไม่มี tenant", () => {
    expect(hostToTenantSlug("example.com", ROOT)).toBeNull();
    expect(hostToTenantSlug("www.example.com", ROOT)).toBeNull();
  });

  it("รองรับ <slug>.localhost เพื่อเทสหลายลูกค้าในเครื่อง", () => {
    expect(hostToTenantSlug("rongkor.localhost:3000", ROOT)).toBe("rongkor");
    expect(hostToTenantSlug("localhost:3000", ROOT)).toBeNull();
  });

  it("โดเมนที่ไม่ใช่ของเรา = null (กันเอา host แปลกปลอมมาสวมเป็น tenant)", () => {
    expect(hostToTenantSlug("rongkor.evil.com", ROOT)).toBeNull();
    // ★ ท้ายชนพอดีแต่ไม่ใช่ subdomain จริง — ต้องไม่หลุด
    expect(hostToTenantSlug("notexample.com", ROOT)).toBeNull();
    expect(hostToTenantSlug("evil-example.com", ROOT)).toBeNull();
  });

  it("ซ้อนหลายชั้น = null (กันความกำกวมว่าใครคือ tenant)", () => {
    expect(hostToTenantSlug("a.b.example.com", ROOT)).toBeNull();
  });

  it("ชื่อสงวนไม่ใช่ลูกค้า", () => {
    for (const s of ["www", "app", "admin", "api"]) {
      expect(hostToTenantSlug(`${s}.example.com`, ROOT)).toBeNull();
    }
  });

  it("ค่าว่าง/undefined ไม่ระเบิด", () => {
    expect(hostToTenantSlug(null, ROOT)).toBeNull();
    expect(hostToTenantSlug(undefined, ROOT)).toBeNull();
    expect(hostToTenantSlug("", ROOT)).toBeNull();
  });

  it("ไม่ตั้งโดเมนหลัก = โหมดลิงก์เดียว ไม่มี tenant จาก URL", () => {
    expect(hostToTenantSlug("rongkor.example.com", "")).toBeNull();
  });
});

describe("isValidTenantSlug", () => {
  it("ผ่านเฉพาะรูปแบบ DNS label", () => {
    expect(isValidTenantSlug("rongkor")).toBe(true);
    expect(isValidTenantSlug("rong-kor-2")).toBe(true);
    expect(isValidTenantSlug("a")).toBe(true);
  });

  it("ตกเมื่อมีอักขระที่ทำให้โดเมน/อีเมลเพี้ยน", () => {
    expect(isValidTenantSlug("-rongkor")).toBe(false);
    expect(isValidTenantSlug("rongkor-")).toBe(false);
    expect(isValidTenantSlug("rong.kor")).toBe(false);
    expect(isValidTenantSlug("rong_kor")).toBe(false);
    expect(isValidTenantSlug("RongKor")).toBe(false);
    expect(isValidTenantSlug("โรงกอ")).toBe(false); // ไทยต้องเป็น punycode — ห้ามใช้
    expect(isValidTenantSlug("")).toBe(false);
  });
});

describe("usernameToEmail (ชื่อผู้ใช้ไม่ซ้ำทั้งระบบ — 0032)", () => {
  it("ชื่อผู้ใช้ → อีเมลภายใน ไม่สน subdomain", () => {
    expect(usernameToEmail("admin")).toBe("admin@insep.local");
    expect(usernameToEmail("Admin")).toBe("admin@insep.local");
    expect(usernameToEmail("  admin  ")).toBe("admin@insep.local");
  });

  /**
   * ★ กติกาที่ทำให้ต้องเปลี่ยนมาเป็นชื่อไม่ซ้ำทั้งระบบ
   *   เคยแยก namespace ด้วย slug (admin@rongkor.insep.local) เพื่อให้ทุกเจ้าใช้ชื่อ admin ได้
   *   แต่เปิดช่องให้คนของกิจการหนึ่งพิมพ์ชื่อตัวเองที่ URL ของอีกกิจการแล้วเข้าได้
   *   ถ้ารหัสผ่านบังเอิญตรงกัน — ตอนนี้พิมพ์ชื่อเดียวกันได้อีเมลเดียวกันเสมอ
   */
  it("ชื่อเดียวกันได้อีเมลเดียวกันเสมอ ไม่ว่ายืนอยู่ที่ subdomain ไหน", () => {
    const fromAnywhere = usernameToEmail("admin");
    expect(fromAnywhere).toBe("admin@insep.local");
    // ไม่มีพารามิเตอร์ slug ให้ส่งอีกแล้ว — ประกอบอีเมลต่างกันตาม URL ไม่ได้โดยโครงสร้าง
    expect(usernameToEmail.length).toBe(1);
  });

  it("กรอกอีเมลจริงเองก็ยังได้", () => {
    expect(usernameToEmail("somchai@gmail.com")).toBe("somchai@gmail.com");
    expect(usernameToEmail("Somchai@Gmail.com")).toBe("somchai@gmail.com");
  });

  it("ค่าว่างคืนค่าว่าง ไม่ประกอบอีเมลลอย ๆ", () => {
    expect(usernameToEmail("")).toBe("");
    expect(usernameToEmail("   ")).toBe("");
  });
});
