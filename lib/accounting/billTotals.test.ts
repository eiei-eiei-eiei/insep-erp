import { describe, it, expect } from "vitest";
import { billTotals, billTotalsNote, billTotalLabel, type BillTotalInput } from "./billTotals";

const b = (type: string, net: number, extra: Partial<BillTotalInput> = {}): BillTotalInput => ({
  type, net_amount: net, status: "ปกติ", ap_ar_status: null, ...extra,
});

describe("A27 — ยอดรวมบิลในแท็บค้นบิล (D139)", () => {
  it("แยกตามประเภท ไม่บวกปนกัน + รายรับ − รายจ่าย", () => {
    const t = billTotals([b("รายจ่าย", 300), b("รายรับ", 1000), b("รายรับ", 500.5), b("รายจ่าย", 0.1)]);
    expect(t.byType.map((x) => [x.type, x.count, x.total])).toEqual([
      ["รายรับ", 2, 1500.5],
      ["รายจ่าย", 2, 300.1],
    ]);
    expect(t.incomeMinusExpense).toBe(1200.4);
  });

  it("ปัดทศนิยมกันเศษ float (0.1+0.2)", () => {
    expect(billTotals([b("รายรับ", 0.1), b("รายรับ", 0.2)]).byType[0].total).toBe(0.3);
  });

  it("บิลยกเลิกไม่นับ แต่บอกจำนวน", () => {
    const t = billTotals([b("รายรับ", 100), b("รายรับ", 999, { status: "ยกเลิก" })]);
    expect(t.byType[0].total).toBe(100);
    expect(t.voidCount).toBe(1);
    expect(billTotalsNote(t, false)).toContain("ยกเลิก 1 ใบ");
  });

  it("เช็คราคาไม่นับ", () => {
    const t = billTotals([b("เช็คราคา", 500), b("รายจ่าย", 100)]);
    expect(t.byType.map((x) => x.type)).toEqual(["รายจ่าย"]);
    expect(t.priceCheckCount).toBe(1);
  });

  it("บิลตั้งค้างยังนับ แต่แยกบอกยอดค้าง", () => {
    const t = billTotals([b("รายจ่าย", 100), b("รายจ่าย", 250, { ap_ar_status: "ค้างจ่าย" })]);
    expect(t.byType[0]).toMatchObject({ count: 2, total: 350, pendingCount: 1, pendingTotal: 250 });
  });

  it("โอน: นับเฉพาะขาเข้า (2 ขาของการโอนเดียว = ยอดโอนเดียว ไม่ใช่ 0)", () => {
    const t = billTotals([b("โอนระหว่างบัญชี", -300), b("โอนระหว่างบัญชี", 300)]);
    expect(t.byType[0]).toMatchObject({ count: 2, total: 300 });
    expect(billTotalLabel("โอนระหว่างบัญชี")).toContain("ขาเข้า");
    // ไม่มีรายรับ/รายจ่าย ⇒ ไม่โชว์ รับ − จ่าย
    expect(t.incomeMinusExpense).toBeNull();
  });

  it("เรียง รายรับ → รายจ่าย → โอน → สำรองจ่าย → รับคืนสำรองจ่าย", () => {
    const t = billTotals([b("รับคืนสำรองจ่าย", 1), b("สำรองจ่าย", 1), b("โอนระหว่างบัญชี", 1), b("รายจ่าย", 1), b("รายรับ", 1)]);
    expect(t.byType.map((x) => x.type)).toEqual(["รายรับ", "รายจ่าย", "โอนระหว่างบัญชี", "สำรองจ่าย", "รับคืนสำรองจ่าย"]);
  });

  it("มีแต่รายจ่าย ⇒ รับ − จ่าย ติดลบ", () => {
    expect(billTotals([b("รายจ่าย", 40)]).incomeMinusExpense).toBe(-40);
  });

  it("ชนเพดาน 500 ⇒ บอกว่ายอดยังไม่ครบ · ไม่มีอะไรตัด ⇒ ประโยคว่าง", () => {
    const t = billTotals([b("รายรับ", 1)]);
    expect(billTotalsNote(t, false)).toBe("");
    expect(billTotalsNote(t, true)).toContain("500");
  });

  it("net เป็น string/null จาก DB ได้", () => {
    expect(billTotals([b("รายรับ", "12.5" as unknown as number), { type: "รายรับ", net_amount: null, status: "ปกติ", ap_ar_status: null }]).byType[0].total).toBe(12.5);
  });
});
