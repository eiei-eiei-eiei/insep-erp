import { describe, it, expect } from "vitest";
import { mapDbError, mustRead } from "./dbError";

describe("mapDbError — ฝั่งเขียน (ของเดิม ต้องไม่ขยับ)", () => {
  it("SQLSTATE ที่รู้จักได้ข้อความไทย", () => {
    expect(mapDbError({ code: "23505" })).toContain("มีข้อมูลนี้อยู่แล้ว");
    expect(mapDbError({ code: "23503" })).toContain("ลบไม่ได้");
    expect(mapDbError({ code: "23502" })).toContain("ข้อมูลไม่ครบ");
    expect(mapDbError({ code: "23514" })).toContain("ไม่ถูกต้องตามที่ระบบกำหนด");
    expect(mapDbError({ code: "42501" })).toContain("สิทธิ์ไม่พอ");
  });

  it("P0001 (RAISE จาก RPC) คืนข้อความเดิม — เป็นไทยอยู่แล้ว", () => {
    expect(mapDbError({ code: "P0001", message: "งวดนี้บันทึกการจ่ายไปแล้ว" })).toBe("งวดนี้บันทึกการจ่ายไปแล้ว");
  });

  it("ไม่รู้จัก = คืน message เดิม · ไม่มีอะไรเลย = ข้อความกลาง", () => {
    expect(mapDbError({ code: "XXXXX", message: "boom" })).toBe("boom");
    expect(mapDbError(null)).toBe("เกิดข้อผิดพลาด");
  });
});

// ── D89: โค้ดที่เจอตอน "อ่าน" พัง — ของเดิมตกไป default แล้วขึ้นอังกฤษดิบให้ผู้ใช้ ──
describe("mapDbError — ฝั่งอ่าน (D89)", () => {
  const cases: [string, string][] = [
    ["42P01", "ยังไม่ได้ติดตั้งตารางข้อมูลนี้"],
    ["42703", "โครงข้อมูลไม่ตรงกับเวอร์ชันของแอป"],
    ["22008", "ช่วงวันที่ไม่ถูกต้อง"],
    ["57014", "ใช้เวลานานเกินไป"],
    ["PGRST103", "ช่วงข้อมูลที่ขอไม่ถูกต้อง"],
  ];
  for (const [code, want] of cases) {
    it(`${code} → ข้อความไทย`, () => {
      const out = mapDbError({ code, message: "date/time field value out of range" });
      expect(out).toContain(want);
      expect(out, "ห้ามหลุดข้อความอังกฤษดิบไปถึงผู้ใช้").not.toContain("out of range");
    });
  }

  // 🪤 เคสจริงจาก D88 บั๊กที่ 2 — cron สร้างช่วงวันที่ `2026-11-31` ที่ไม่มีอยู่จริง
  //    Postgres คืน 22008 แต่ไม่มีใครอ่าน error → เตือน ภงด. เงียบหายไป 5 จาก 12 เดือน
  it("🪤 22008 คือเคสจริงที่เคยทำให้งานเตือนภาษีเงียบหายทั้งเดือน", () => {
    expect(mapDbError({ code: "22008" })).toMatch(/วันที่/);
  });
});

describe("mustRead", () => {
  it("สำเร็จ = คืน data ตรง ๆ", () => {
    expect(mustRead({ data: [1, 2, 3], error: null }, "บิล")).toEqual([1, 2, 3]);
  });

  it("🚨 error = throw พร้อมบอกว่าโหลดอะไรไม่สำเร็จ (ไม่คืนลิสต์ว่าง)", () => {
    expect(() => mustRead({ data: null, error: { code: "42501", message: "denied" } }, "บิล")).toThrow(/โหลดบิลไม่สำเร็จ/);
    expect(() => mustRead({ data: null, error: { code: "42501", message: "denied" } }, "บิล")).toThrow(/สิทธิ์ไม่พอ/);
  });

  it("🚨 มี error แต่ data ไม่ว่าง ก็ยังต้อง throw — ข้อมูลบางส่วนอันตรายกว่าไม่มี", () => {
    expect(() => mustRead({ data: [1], error: { code: "57014" } }, "รายการบัญชี")).toThrow(/รายการบัญชี/);
  });

  it("🪤 data: null ที่ไม่มี error ต้อง **ไม่** throw — maybeSingle() ไม่เจอแถวเป็นเรื่องปกติ", () => {
    expect(mustRead({ data: null, error: null }, "กลุ่มงวด")).toBeNull();
  });

  it("🪤 ลิสต์ว่างที่ไม่มี error ต้องไม่ throw — 'ไม่มีข้อมูลจริง ๆ' ต่างจาก 'อ่านไม่ได้'", () => {
    expect(mustRead({ data: [], error: null }, "บิล")).toEqual([]);
  });

  it("label โผล่ในข้อความเสมอ — ผู้ใช้ต้องรู้ว่าอะไรพัง ไม่ใช่ 'เกิดข้อผิดพลาด' ลอย ๆ", () => {
    expect(() => mustRead({ data: null, error: { code: "42P01" } }, "ประวัติชำระภาษี")).toThrow(/ประวัติชำระภาษี/);
  });
});
