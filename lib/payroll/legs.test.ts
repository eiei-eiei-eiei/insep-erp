import { describe, it, expect } from "vitest";
import { legAmount, legTotal, legCoverage, suggestLegDate } from "./legs";
import type { PayPostLeg } from "./types";

/**
 * ขาลงบัญชีที่ลูกค้าตั้งเอง — เทสเน้นที่ **ตัวเลขคุมกันรายจ่ายซ้ำ**
 * เพราะเป็นความเสี่ยงเดียวที่การเปิดให้ตั้งขาเองสร้างขึ้นมาใหม่
 */

const leg = (o: Partial<PayPostLeg>): PayPostLeg =>
  ({ code: "x", name: "x", amountSource: "net", category: "เงินเดือน", ...o });

// พนักงาน 2 คน: รวมเงินได้ 18,000 · สปส. ลูกจ้าง 900 นายจ้าง 900 · ภาษี 200 · สุทธิ 16,900
const lines = [
  {
    gross: 10000, net: 9400, sso: 500, ssoEmployer: 500, wht: 100,
    items: [{ code: "ot", kind: "earning" as const, amount: 800 }],
  },
  {
    gross: 8000, net: 7500, sso: 400, ssoEmployer: 400, wht: 100,
    items: [{ code: "ot", kind: "earning" as const, amount: 300 }],
  },
];

describe("legAmount — แปลงขาเป็นยอด", () => {
  it("แต่ละแหล่งยอดคืนค่าถูกต้อง", () => {
    const l = lines[0];
    expect(legAmount(leg({ amountSource: "net" }), l)).toBe(9400);
    expect(legAmount(leg({ amountSource: "gross" }), l)).toBe(10000);
    expect(legAmount(leg({ amountSource: "sso_employee" }), l)).toBe(500);
    expect(legAmount(leg({ amountSource: "sso_employer" }), l)).toBe(500);
    expect(legAmount(leg({ amountSource: "sso_total" }), l)).toBe(1000);
    expect(legAmount(leg({ amountSource: "wht" }), l)).toBe(100);
  });

  it("ขาที่อ้างรายการเพิ่ม/หักตัวหนึ่ง (เช่นแยกคอมมิชชั่นออกมา)", () => {
    expect(legAmount(leg({ amountSource: "component", componentCode: "ot" }), lines[0])).toBe(800);
    expect(legAmount(leg({ amountSource: "component", componentCode: "ไม่มีจริง" }), lines[0])).toBe(0);
  });

  it("legTotal รวมทั้งงวด", () => {
    expect(legTotal(leg({ amountSource: "net" }), lines)).toBe(16900);
  });
});

describe("🚨 legCoverage — ตัวเลขคุมกันลงรายจ่ายซ้ำ/ขาด", () => {
  it("★ ชุด สุทธิ + สปส.รวม + ภาษี ครอบพอดี (นี่คือชุดที่ปลอดภัย)", () => {
    const legs = [
      leg({ code: "net", amountSource: "net" }),
      leg({ code: "sso", amountSource: "sso_total" }),
      leg({ code: "wht", amountSource: "wht" }),
    ];
    const c = legCoverage(legs, lines);
    // 16,900 + 1,800 + 200 = 18,900 = รวมเงินได้ 18,000 + สมทบนายจ้าง 900
    expect(c.legsTotal).toBe(18900);
    expect(c.shouldBe).toBe(18900);
    expect(c.ok).toBe(true);
  });

  it("🚨 เผลอตั้งขา 'โอที' เพิ่มทั้งที่โอทีอยู่ในยอดสุทธิแล้ว → เกิน = รายจ่ายซ้ำ", () => {
    const legs = [
      leg({ code: "net", amountSource: "net" }),
      leg({ code: "sso", amountSource: "sso_total" }),
      leg({ code: "wht", amountSource: "wht" }),
      leg({ code: "ot", amountSource: "component", componentCode: "ot" }),
    ];
    const c = legCoverage(legs, lines);
    expect(c.ok).toBe(false);
    expect(c.diff).toBe(1100); // โอทีรวม 800+300 ถูกนับสองรอบ
  });

  it("🚨 ตั้ง net + gross พร้อมกัน = ซ้ำหนัก", () => {
    const c = legCoverage(
      [leg({ code: "net", amountSource: "net" }), leg({ code: "gross", amountSource: "gross" })],
      lines,
    );
    expect(c.ok).toBe(false);
    expect(c.diff).toBeGreaterThan(0);
  });

  it("ลืมตั้งขาภาษี → ขาด (ติดลบ) ต้องเตือนเหมือนกัน", () => {
    const c = legCoverage(
      [leg({ code: "net", amountSource: "net" }), leg({ code: "sso", amountSource: "sso_total" })],
      lines,
    );
    expect(c.ok).toBe(false);
    expect(c.diff).toBe(-200);
  });

  it("ขาที่ปิดใช้งานไม่ถูกนับ", () => {
    const c = legCoverage(
      [
        leg({ code: "net", amountSource: "net" }),
        leg({ code: "sso", amountSource: "sso_total" }),
        leg({ code: "wht", amountSource: "wht" }),
        leg({ code: "dup", amountSource: "gross", active: false }),
      ],
      lines,
    );
    expect(c.ok).toBe(true);
  });

  it("ไม่มีขาเลย = ขาดทั้งก้อน (ไม่ใช่ ok)", () => {
    expect(legCoverage([], lines).ok).toBe(false);
  });
});

describe("suggestLegDate", () => {
  const period = { year: 2026, month: 5, payDate: "2026-05-28" };

  it("suggestDay = 0 → ใช้วันจ่ายเงินเดือนของงวด", () => {
    expect(suggestLegDate(leg({ suggestDay: 0 }), period)).toBe("2026-05-28");
  });

  it("นับจากสิ้นงวด — สิ้น พ.ค. + 15 วัน = 15 มิ.ย.", () => {
    expect(suggestLegDate(leg({ suggestDay: 15 }), period)).toBe("2026-06-15");
  });

  it("ข้ามปีถูกต้อง — สิ้น ธ.ค. + 7 วัน = 7 ม.ค. ปีถัดไป", () => {
    expect(suggestLegDate(leg({ suggestDay: 7 }), { year: 2026, month: 12, payDate: null }))
      .toBe("2027-01-07");
  });

  it("ไม่มีวันจ่าย + suggestDay 0 → ใช้วันสิ้นงวด", () => {
    expect(suggestLegDate(leg({ suggestDay: 0 }), { year: 2026, month: 2, payDate: null }))
      .toBe("2026-02-28");
  });
});
