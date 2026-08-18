import { describe, it, expect } from "vitest";
import { ssoContribution, ssoEmployerContribution, ssoWageBase, ratesOn } from "./sso";
import type { PayRates } from "./types";

const RATES: PayRates = {
  effectiveFrom: "2026-01-01",
  ssoRate: 5,
  ssoWageMin: 1650,
  ssoWageMax: 17500,
  pitBrackets: [],
  personalAllowance: 60000,
  expenseRate: 50,
  expenseCap: 100000,
};

describe("ssoWageBase — บีบฐานค่าจ้างเข้าช่วงที่กฎหมายกำหนด", () => {
  it("อยู่ในช่วง = ใช้ตามจริง", () => {
    expect(ssoWageBase(15000, RATES)).toBe(15000);
  });

  it("ต่ำกว่าพื้น = ใช้พื้น (ลูกจ้างรายวันที่ทำงานไม่กี่วัน)", () => {
    expect(ssoWageBase(1000, RATES)).toBe(1650);
  });

  it("เกินเพดาน = ใช้เพดาน", () => {
    expect(ssoWageBase(50000, RATES)).toBe(17500);
  });

  it("ไม่มีค่าจ้าง = 0 (ไม่ใช่ดันขึ้นไปที่พื้น)", () => {
    expect(ssoWageBase(0, RATES)).toBe(0);
    expect(ssoWageBase(-100, RATES)).toBe(0);
  });
});

describe("ssoContribution", () => {
  it("🪤 บีบเพดานที่ฐาน ไม่ใช่ที่ยอดเงินสมทบ — 50,000 → 17,500×5% = 875", () => {
    expect(ssoContribution(50000, RATES)).toBe(875);
  });

  it("ปัดเป็นจำนวนเต็มบาท — 15,867×5% = 793.35 → 793", () => {
    expect(ssoContribution(15867, RATES)).toBe(793);
  });

  it("ได้รับยกเว้น = 0 แม้มีค่าจ้าง", () => {
    expect(ssoContribution(20000, RATES, true)).toBe(0);
  });

  it("นายจ้างสมทบเท่าลูกจ้าง (แต่เป็นรายจ่ายคนละก้อน)", () => {
    expect(ssoEmployerContribution(15867, RATES)).toBe(793);
  });

  it("★ อัตราเปลี่ยนแล้วผลต้องเปลี่ยนตาม (เคยลดอัตราชั่วคราวจริงช่วงโควิด)", () => {
    const cut = { ...RATES, ssoRate: 2.5 };
    expect(ssoContribution(50000, cut)).toBe(438); // 17500×2.5% = 437.5 → 438
  });
});

describe("ratesOn — เลือกชุดอัตราตามวันเริ่มมีผล", () => {
  const older: PayRates = { ...RATES, effectiveFrom: "2024-01-01", ssoWageMax: 15000 };
  const newer: PayRates = { ...RATES, effectiveFrom: "2026-01-01", ssoWageMax: 17500 };
  const all = [newer, older]; // จงใจสลับลำดับ ฟังก์ชันต้องเรียงเอง

  it("ใช้แถวล่าสุดที่มีผลแล้ว ณ วันนั้น", () => {
    expect(ratesOn(all, "2026-06-30")?.ssoWageMax).toBe(17500);
  });

  it("🚨 เปิดดูงวดเก่าต้องได้อัตราของตอนนั้น ไม่ใช่อัตราปัจจุบัน", () => {
    expect(ratesOn(all, "2025-06-30")?.ssoWageMax).toBe(15000);
  });

  it("ตรงวันเริ่มมีผลพอดี = ใช้ชุดใหม่", () => {
    expect(ratesOn(all, "2026-01-01")?.ssoWageMax).toBe(17500);
  });

  it("ก่อนมีอัตราใด ๆ = null (ผู้เรียกต้องฟ้อง ไม่ใช่คำนวณด้วยศูนย์)", () => {
    expect(ratesOn(all, "2020-01-01")).toBeNull();
  });
});
