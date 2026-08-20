import { describe, it, expect } from "vitest";
import { isEmployedInPeriod, notInPeriodReason, periodRange } from "./employment";

/** งวดที่ใช้ทดสอบ = มกราคม 2026 (1–31 ม.ค.) */
const Y = 2026;
const M = 1;

describe("periodRange", () => {
  it("เดือน 31 วัน", () => {
    expect(periodRange(2026, 1)).toEqual({ start: "2026-01-01", end: "2026-01-31" });
  });
  it("เดือน 28 วัน", () => {
    expect(periodRange(2026, 2)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
  it("ปีอธิกสุรทิน", () => {
    expect(periodRange(2028, 2).end).toBe("2028-02-29");
  });
});

describe("isEmployedInPeriod", () => {
  it("ทำงานอยู่ปกติ ไม่มีวันพ้นสภาพ", () => {
    expect(isEmployedInPeriod({ startDate: "2025-06-01", active: true }, Y, M)).toBe(true);
  });

  it("🔴 ลาออกกลางงวด — ต้องยังอยู่ในงวดนั้น (ต้องได้เงิน)", () => {
    expect(isEmployedInPeriod({ endDate: "2026-01-20", active: false }, Y, M)).toBe(true);
  });

  it("ลาออกวันสุดท้ายของงวด — ยังอยู่", () => {
    expect(isEmployedInPeriod({ endDate: "2026-01-31", active: false }, Y, M)).toBe(true);
  });

  it("🔴 พ้นสภาพก่อนงวดเริ่ม — ต้องไม่ขึ้นในงวด", () => {
    expect(isEmployedInPeriod({ endDate: "2025-12-31", active: false }, Y, M)).toBe(false);
  });

  it("พ้นสภาพก่อนงวด แต่ยังติ๊ก 'ยังทำงานอยู่' ค้างไว้ — วันที่ชนะ", () => {
    expect(isEmployedInPeriod({ endDate: "2025-12-31", active: true }, Y, M)).toBe(false);
  });

  it("🔴 ติ๊ก 'ยังทำงานอยู่' ออก แต่ไม่กรอกวันพ้นสภาพ — ไม่ขึ้น", () => {
    expect(isEmployedInPeriod({ active: false }, Y, M)).toBe(false);
  });

  it("เริ่มงานหลังงวดนี้ — ยังไม่ขึ้น", () => {
    expect(isEmployedInPeriod({ startDate: "2026-02-01", active: true }, Y, M)).toBe(false);
  });

  it("เริ่มงานกลางงวด — ขึ้น (ทำงานบางส่วนของเดือน)", () => {
    expect(isEmployedInPeriod({ startDate: "2026-01-15", active: true }, Y, M)).toBe(true);
  });

  it("เริ่มงานวันสุดท้ายของงวด — ขึ้น", () => {
    expect(isEmployedInPeriod({ startDate: "2026-01-31", active: true }, Y, M)).toBe(true);
  });

  it("ไม่กรอกอะไรเลย + active ไม่ระบุ = ถือว่ายังทำงาน", () => {
    expect(isEmployedInPeriod({}, Y, M)).toBe(true);
  });

  it("ช่องวันที่เป็นสตริงว่าง ต้องไม่ถูกตีความเป็นวันที่", () => {
    expect(isEmployedInPeriod({ startDate: "", endDate: "", active: true }, Y, M)).toBe(true);
  });
});

describe("notInPeriodReason — ป้ายบอกเหตุผลบนหน้าจอ", () => {
  it("อยู่ในงวดปกติ = ไม่มีป้าย", () => {
    expect(notInPeriodReason({ active: true }, Y, M)).toBeNull();
  });
  it("พ้นสภาพก่อนงวด", () => {
    expect(notInPeriodReason({ endDate: "2025-12-31" }, Y, M)).toContain("พ้นสภาพ 2025-12-31");
  });
  it("เริ่มงานหลังงวด", () => {
    expect(notInPeriodReason({ startDate: "2026-03-01" }, Y, M)).toContain("เริ่มงาน 2026-03-01");
  });
  it("ไม่ได้ทำงานแล้วแต่ไม่ระบุวัน", () => {
    expect(notInPeriodReason({ active: false }, Y, M)).toContain("ไม่ได้ระบุวันพ้นสภาพ");
  });
});
