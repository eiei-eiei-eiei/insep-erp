import { describe, it, expect } from "vitest";
import { platformEnabled, isPlatformPath } from "./guard";

/**
 * ด่านแรกของแอปจัดการหลังบ้าน — deployment ที่ไม่ได้ตั้ง PLATFORM_ADMIN ต้องตอบ 404
 * (Definition of Done ข้อ 2 ใน docs/ADMIN_APP_REQUIREMENTS.md)
 *
 * ตัวที่ตอบ 404 จริงคือ middleware.ts — ที่นี่คุม "ตรรกะการตัดสิน" ซึ่งเป็นจุดที่พลาดได้ง่ายสุด
 * (เช่นเผลอเขียน `if (process.env.PLATFORM_ADMIN)` ซึ่ง "0" / "false" จะกลายเป็นจริง)
 */
describe("platformEnabled — ค่าที่ยอมรับ", () => {
  it("เปิดเมื่อเป็น 1 หรือ true (Vercel เก็บ env เป็น string เสมอ)", () => {
    expect(platformEnabled("1")).toBe(true);
    expect(platformEnabled("true")).toBe(true);
    expect(platformEnabled("TRUE")).toBe(true);
    expect(platformEnabled(" 1 ")).toBe(true);
  });

  it("★ ไม่ตั้งค่า / ค่าว่าง = ปิด (deployment ของลูกค้าต้องไม่มีหน้านี้)", () => {
    expect(platformEnabled(undefined)).toBe(false);
    expect(platformEnabled(null)).toBe(false);
    expect(platformEnabled("")).toBe(false);
    expect(platformEnabled("   ")).toBe(false);
  });

  it('★★ "0" และ "false" ต้องเป็นปิด — กับดักของการเช็ค truthiness ตรง ๆ', () => {
    expect(platformEnabled("0")).toBe(false);
    expect(platformEnabled("false")).toBe(false);
    expect(platformEnabled("no")).toBe(false);
    expect(platformEnabled("yes")).toBe(false); // ไม่อยู่ในรายการที่รับ = ปิดไว้ก่อน
  });
});

describe("isPlatformPath — ครอบทุก path ใต้แอปแอดมิน", () => {
  it("จับทั้งหน้าแรกและหน้าลูก", () => {
    expect(isPlatformPath("/platform")).toBe(true);
    expect(isPlatformPath("/platform/")).toBe(true);
    expect(isPlatformPath("/platform/billing")).toBe(true);
  });

  it("ไม่จับ path ของแอปลูกค้าที่ขึ้นต้นคล้ายกัน", () => {
    expect(isPlatformPath("/")).toBe(false);
    expect(isPlatformPath("/production")).toBe(false);
    expect(isPlatformPath("/platformx")).toBe(false); // ★ ต้องไม่ใช่ startsWith เปล่า ๆ
    expect(isPlatformPath("/settings/platform")).toBe(false);
  });
});
