import { describe, it, expect } from "vitest";
import {
  countedSales,
  inRange,
  summarize,
  byChannel,
  byMethod,
  topMenus,
  lapsedCustomers,
  type SaleRow,
  type SaleItemRow,
} from "./dashboard";

/** golden **B7** — แดชบอร์ด/สรุปยอด (D96) */

const S = (over: Partial<SaleRow> = {}): SaleRow => ({
  saleNo: "B1",
  status: "ปกติ",
  businessDate: "2026-09-11",
  channel: "บาร์",
  method: "เงินสด",
  grandTotal: 600,
  costTotal: 155,
  ...over,
});

describe("บิลที่นับเป็นยอดขาย", () => {
  it("🚨 บิลที่ยังเปิดอยู่ไม่นับ — ยังไม่ได้เงินและยอดยังเปลี่ยนได้", () => {
    expect(countedSales([S(), S({ saleNo: "B2", status: "เปิดอยู่" })]).map((r) => r.saleNo))
      .toEqual(["B1"]);
  });

  it("บิลที่ถูกยกเลิกไม่นับ", () => {
    expect(countedSales([S({ status: "ยกเลิก" })])).toEqual([]);
  });
});

describe("สรุปยอด", () => {
  it("รวมยอดขาย ต้นทุน กำไร จำนวนบิล และยอดเฉลี่ยต่อบิล", () => {
    const s = summarize([S(), S({ saleNo: "B2", grandTotal: 400, costTotal: 100 })]);
    expect(s).toMatchObject({ bills: 2, revenue: 1000, cost: 255, profit: 745, avgPerBill: 500 });
  });

  it("🚨 อ่านค่าที่แช่ไว้ในบิลเท่านั้น — เปลี่ยนต้นทุนวัตถุดิบวันนี้ ยอดเดือนก่อนต้องไม่ขยับ", () => {
    // ชนิดข้อมูลขาเข้าไม่มีช่องให้ส่งราคาวัตถุดิบมาเลย = บังคับด้วยโครงสร้าง ไม่ใช่ด้วยวินัย
    const s = summarize([S({ costTotal: 155 })]);
    expect(s.cost).toBe(155);
  });

  it("🪤 ไม่มีบิลเลย → marginPct และ avgPerBill เป็น null ไม่ใช่ 0 (บทเรียน D94)", () => {
    const s = summarize([]);
    expect(s).toMatchObject({ bills: 0, revenue: 0, marginPct: null, avgPerBill: null });
  });

  it("ขาดทุนแสดงตามจริง", () => {
    expect(summarize([S({ grandTotal: 100, costTotal: 150 })]).profit).toBe(-50);
  });
});

describe("กรองช่วงวัน", () => {
  const rows = [
    S({ saleNo: "A", businessDate: "2026-09-10" }),
    S({ saleNo: "B", businessDate: "2026-09-11" }),
    S({ saleNo: "C", businessDate: "2026-09-12" }),
  ];

  it("รวมปลายทั้งสองข้าง", () => {
    expect(inRange(rows, "2026-09-10", "2026-09-11").map((r) => r.saleNo)).toEqual(["A", "B"]);
  });

  it("บิลที่ยังไม่มีวันขาย (ยังเปิดอยู่) ถูกข้าม ไม่ใช่ตกไปวันนี้", () => {
    expect(inRange([S({ businessDate: null })], "2026-01-01", "2026-12-31")).toEqual([]);
  });
});

describe("แยกตามช่องทาง — ตอบว่า 'บูธงานนี้คุ้มไหม'", () => {
  it("รวมยอดและกำไรของแต่ละช่องทาง เรียงยอดมากก่อน", () => {
    const out = byChannel([
      S({ saleNo: "A", channel: "บาร์", grandTotal: 300, costTotal: 100 }),
      S({ saleNo: "B", channel: "บูธ Craft Fest", grandTotal: 900, costTotal: 400 }),
      S({ saleNo: "C", channel: "บูธ Craft Fest", grandTotal: 100, costTotal: 40 }),
    ]);
    expect(out[0]).toMatchObject({ channel: "บูธ Craft Fest", bills: 2, revenue: 1000, profit: 560 });
    expect(out[1]).toMatchObject({ channel: "บาร์", bills: 1 });
  });

  it("ช่องทางว่างตกเป็น 'บาร์' ไม่ใช่หายไป", () => {
    expect(byChannel([S({ channel: "" })])[0].channel).toBe("บาร์");
  });
});

describe("แยกตามวิธีรับเงิน — ใช้ทำบิลลงบัญชีรายวัน", () => {
  it("รวมยอดต่อวิธี", () => {
    const out = byMethod([
      S({ saleNo: "A", method: "เงินสด", grandTotal: 300 }),
      S({ saleNo: "B", method: "QR", grandTotal: 900 }),
      S({ saleNo: "C", method: "เงินสด", grandTotal: 200 }),
    ]);
    expect(out).toEqual([
      { method: "QR", bills: 1, revenue: 900 },
      { method: "เงินสด", bills: 2, revenue: 500 },
    ]);
  });

  it("ไม่ระบุวิธี = 'ไม่ระบุ' (ต้องยังปรากฏในสรุป ไม่ใช่หายจากยอดรวม)", () => {
    expect(byMethod([S({ method: null })])[0].method).toBe("ไม่ระบุ");
  });
});

describe("เมนูขายดี", () => {
  const sales = [S({ saleNo: "A" }), S({ saleNo: "B" }), S({ saleNo: "C", status: "ยกเลิก" })];
  const items: SaleItemRow[] = [
    { saleNo: "A", menuId: "M1", menuName: "Negroni", qty: 2, amount: 520, cost: 120 },
    { saleNo: "B", menuId: "M1", menuName: "Negroni ใหม่", qty: 1, amount: 260, cost: 60 },
    { saleNo: "B", menuId: "M2", menuName: "ถั่วทอด", qty: 3, amount: 240, cost: 105 },
    { saleNo: "C", menuId: "M1", menuName: "Negroni", qty: 9, amount: 9999, cost: 1 },
  ];

  it("รวมยอดต่อเมนู เรียงตามจำนวนที่ขายได้", () => {
    const top = topMenus(sales, items);
    expect(top.map((t) => t.menuId)).toEqual(["M1", "M2"]);
    expect(top.find((t) => t.menuId === "M1")).toMatchObject({ qty: 3, revenue: 780, cost: 180, profit: 600 });
    expect(top.find((t) => t.menuId === "M2")).toMatchObject({ qty: 3, revenue: 240, cost: 105, profit: 135 });
  });

  it("ขายได้เท่ากัน → ตัวตัดสินรองคือยอดขาย (M1 กับ M2 ขายได้ 3 เท่ากัน)", () => {
    const top = topMenus(sales, items);
    expect(top[0].menuId).toBe("M1");
    expect(top[0].revenue).toBeGreaterThan(top[1].revenue);
  });

  it("🚨 บิลที่ถูกยกเลิกไม่นับเข้าเมนูขายดี", () => {
    expect(topMenus(sales, items).find((t) => t.menuId === "M1")!.qty).toBe(3); // ไม่ใช่ 12
  });

  it("รายการที่ถูกยกเลิกทีละแถวไม่นับ", () => {
    const withVoid = [...items, { saleNo: "A", menuId: "M2", menuName: "ถั่ว", qty: 5, amount: 400, cost: 175, voidedAt: "x" }];
    expect(topMenus(sales, withVoid).find((t) => t.menuId === "M2")!.qty).toBe(3);
  });

  it("🪤 จัดกลุ่มด้วย menuId ไม่ใช่ชื่อ — เมนูถูกเปลี่ยนชื่อทีหลังได้", () => {
    const top = topMenus(sales, items);
    expect(top.filter((t) => t.menuId === "M1")).toHaveLength(1);
    expect(top.find((t) => t.menuId === "M1")!.menuName).toBe("Negroni ใหม่");
  });

  it("เมนูที่ถูกลบ (menuId ว่าง) ตกไปจัดกลุ่มด้วยชื่อแทน ไม่ใช่หายไป", () => {
    const orphan: SaleItemRow[] = [
      { saleNo: "A", menuId: null, menuName: "เมนูเก่า", qty: 2, amount: 100, cost: 20 },
    ];
    expect(topMenus(sales, orphan)[0]).toMatchObject({ menuId: null, menuName: "เมนูเก่า", qty: 2 });
  });
});

describe("ลูกค้าที่ไม่ได้มานาน", () => {
  type Cust = { name: string; lastSeen?: string | null };

  it("เก่ากว่าเกณฑ์ = เข้าลิสต์", () => {
    const rows: Cust[] = [
      { name: "ก", lastSeen: "2026-05-01" },
      { name: "ข", lastSeen: "2026-09-01" },
    ];
    expect(lapsedCustomers(rows, "2026-09-11", 90).map((c) => c.name)).toEqual(["ก"]);
  });

  it("🪤 ไม่เคยมีวันที่เลย = **ไม่นับ** (ไม่รู้ ≠ หายไปนาน)", () => {
    const noDate: Cust[] = [{ name: "ค", lastSeen: null }, { name: "ง" }];
    expect(lapsedCustomers(noDate, "2026-09-11")).toEqual([]);
  });
});
