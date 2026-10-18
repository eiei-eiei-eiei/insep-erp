import { describe, it, expect } from "vitest";
import {
  dailyRows, presetRange, matchPreset, previousRange, changePct, sortTopMenus, addDays,
  RANGE_LABEL, type RangeKey,
} from "./dashDays";
import type { SaleRow, TopMenu } from "./dashboard";

const sale = (p: Partial<SaleRow>): SaleRow => ({
  saleNo: Math.random().toString(36), status: "ปกติ", businessDate: "2026-10-10",
  channel: "บาร์", method: "เงินสด", grandTotal: 100, costTotal: 30, ...p,
});

describe("B20 — ตารางรายวัน (D115)", () => {
  const sales = [
    sale({ businessDate: "2026-10-10", method: "เงินสด", grandTotal: 200, costTotal: 50 }),
    sale({ businessDate: "2026-10-10", method: "QR", grandTotal: 300, costTotal: 90 }),
    sale({ businessDate: "2026-10-10", method: "QR", grandTotal: 100, costTotal: 20 }),
    sale({ businessDate: "2026-10-11", method: "  ", grandTotal: 50, costTotal: 10 }),
    sale({ businessDate: "2026-10-12", grandTotal: 80 }),
    sale({ businessDate: "2026-10-12", status: "ยกเลิก", grandTotal: 999 }),
    sale({ businessDate: null, status: "เปิดอยู่", grandTotal: 999 }),
  ];
  const rows = dailyRows(sales, ["2026-10-10"], "2026-10-12");

  it("1 แถวต่อวันที่มีบิลปิดแล้ว เรียงวันใหม่ก่อน · ไม่นับบิลยกเลิก/บิลเปิด", () => {
    expect(rows.map((r) => r.date)).toEqual(["2026-10-12", "2026-10-11", "2026-10-10"]);
    expect(rows[0]).toMatchObject({ bills: 1, revenue: 80 });
  });

  it("ยอดแยกวิธีรับเงินของวันนั้นเอง (= บิลบัญชีที่จะได้) · ผลรวมเท่ายอดวัน", () => {
    const d10 = rows.find((r) => r.date === "2026-10-10")!;
    expect(d10.methods).toEqual([
      { method: "QR", bills: 2, revenue: 400 },
      { method: "เงินสด", bills: 1, revenue: 200 },
    ]);
    expect(d10.methods.reduce((s, m) => s + m.revenue, 0)).toBe(d10.revenue);
    expect(d10).toMatchObject({ revenue: 600, cost: 160, profit: 440 });
    // วิธีว่าง → "ไม่ระบุ" ตรงกับ fn_bar_post_day
    expect(rows.find((r) => r.date === "2026-10-11")!.methods[0].method).toBe("ไม่ระบุ");
  });

  it("🚨 สถานะ: ลงแล้ว / ผ่านไปแล้วยังไม่ลง / วันขายปัจจุบัน", () => {
    expect(rows.map((r) => r.state)).toEqual(["selling", "unposted", "posted"]);
    // วันที่ลงแล้ว ชนะ selling (ลงวันนี้ไปแล้วก็คือลงแล้ว)
    expect(dailyRows(sales, ["2026-10-12"], "2026-10-12")[0].state).toBe("posted");
  });
});

describe("B20 — ช่วงเวลา", () => {
  const today = "2026-10-18";
  it("ช่วงสำเร็จรูป", () => {
    expect(presetRange("today", today)).toEqual({ from: today, to: today });
    expect(presetRange("yesterday", today)).toEqual({ from: "2026-10-17", to: "2026-10-17" });
    expect(presetRange("7d", today)).toEqual({ from: "2026-10-12", to: today });
    expect(presetRange("30d", today)).toEqual({ from: "2026-09-19", to: today });
    expect(presetRange("thisMonth", today)).toEqual({ from: "2026-10-01", to: today });
    expect(presetRange("lastMonth", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("🪤 เดือนก่อนข้ามปี + ก.พ.", () => {
    expect(presetRange("lastMonth", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("lastMonth", "2028-03-31")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("จับคู่ช่วงกลับเป็นปุ่ม · ช่วงที่พิมพ์เอง = null", () => {
    for (const k of Object.keys(RANGE_LABEL) as RangeKey[]) {
      const r = presetRange(k, today);
      // วันนี้กับเดือนนี้วันที่ 1 อาจชนกัน — ตรวจแค่ว่าได้ preset ที่ให้ช่วงเดียวกัน
      expect(presetRange(matchPreset(r.from, r.to, today)!, today)).toEqual(r);
    }
    expect(matchPreset("2026-10-02", "2026-10-05", today)).toBeNull();
  });
  it("ช่วงก่อนหน้า ยาวเท่ากัน ติดกันพอดี", () => {
    expect(previousRange("2026-10-12", "2026-10-18")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(previousRange("2026-10-18", "2026-10-18")).toEqual({ from: "2026-10-17", to: "2026-10-17" });
    // ★ เดือนนี้ 1-18 เทียบ 18 วันก่อนหน้า ไม่ใช่ทั้งเดือนก่อน
    expect(previousRange("2026-10-01", "2026-10-18")).toEqual({ from: "2026-09-13", to: "2026-09-30" });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("🪤 % เปลี่ยน — ช่วงก่อนเป็น 0 = null ไม่ใช่ +100%", () => {
    expect(changePct(120, 100)).toBe(20);
    expect(changePct(80, 100)).toBe(-20);
    expect(changePct(100, 0)).toBeNull();
    expect(changePct(0, 0)).toBeNull();
    expect(changePct(1, 3)).toBe(-66.7);
  });
});

describe("B20 — เรียงเมนูขายดี", () => {
  const m = (menuName: string, qty: number, revenue: number, profit: number): TopMenu =>
    ({ menuId: menuName, menuName, qty, revenue, cost: revenue - profit, profit });
  const list = [m("A", 10, 100, 10), m("B", 5, 500, 300), m("C", 8, 200, 150), m("D", 8, 300, 50)];
  it("เรียงตามที่เลือก · เสมอกันตัดสินด้วยยอดขาย · ตัดตาม limit", () => {
    expect(sortTopMenus(list, "qty").map((x) => x.menuName)).toEqual(["A", "D", "C", "B"]);
    expect(sortTopMenus(list, "revenue").map((x) => x.menuName)).toEqual(["B", "D", "C", "A"]);
    expect(sortTopMenus(list, "profit", 2).map((x) => x.menuName)).toEqual(["B", "C"]);
  });
});

describe("B20 — ถามยืนยันก่อนลงวันขายปัจจุบัน", () => {
  it("เฉพาะวันขายปัจจุบัน · บอกจำนวนบิลเปิดเมื่อมี · บอกผลที่ตามมา", async () => {
    const { postConfirmText } = await import("./dashDays");
    expect(postConfirmText("unposted", 3)).toBeNull();
    expect(postConfirmText("posted", 3)).toBeNull();
    const t = postConfirmText("selling", 2)!;
    expect(t).toContain("บิลเปิดอยู่ 2 ใบ");
    expect(t).toContain("ปิดบิลเข้าวันนี้ไม่ได้");
    expect(postConfirmText("selling", 0)).not.toContain("บิลเปิดอยู่");
  });
});
