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

describe("usernameToEmail (แยก namespace ต่อ tenant)", () => {
  it("ไม่ส่ง slug = พฤติกรรมเดิมเป๊ะ (ห้ามทำให้บัญชีเดิมล็อกอินไม่ได้)", () => {
    expect(usernameToEmail("admin")).toBe("admin@insep.local");
    expect(usernameToEmail("Admin")).toBe("admin@insep.local");
    expect(usernameToEmail("  admin  ")).toBe("admin@insep.local");
  });

  it("ส่ง slug = แยก namespace → 2 ลูกค้าใช้ชื่อ admin พร้อมกันได้", () => {
    expect(usernameToEmail("admin", "rongkor")).toBe("admin@rongkor.insep.local");
    expect(usernameToEmail("admin", "rongkhor")).toBe("admin@rongkhor.insep.local");
    expect(usernameToEmail("admin", "rongkor")).not.toBe(usernameToEmail("admin", "rongkhor"));
  });

  it("slug รูปแบบไม่ผ่าน = ถอยไปโดเมนกลาง ไม่ประกอบอีเมลพิกล", () => {
    expect(usernameToEmail("admin", "rong.kor")).toBe("admin@insep.local");
    expect(usernameToEmail("admin", "")).toBe("admin@insep.local");
    expect(usernameToEmail("admin", null)).toBe("admin@insep.local");
  });

  it("กรอกอีเมลเต็มเอง = ใช้ตามนั้น ไม่สนใจ slug ของ subdomain ที่ยืนอยู่", () => {
    // เคสนี้คือทางออกตอนล็อกอินผิด subdomain — ได้ข้อมูลถูก (RLS ตัดสินจาก profile) แบรนด์ผิด
    expect(usernameToEmail("admin@rongkor.insep.local", "rongkhor")).toBe(
      "admin@rongkor.insep.local",
    );
  });

  it("ค่าว่างคืนค่าว่าง ไม่ประกอบอีเมลลอย ๆ", () => {
    expect(usernameToEmail("", "rongkor")).toBe("");
    expect(usernameToEmail("   ", "rongkor")).toBe("");
  });
});
