import { describe, it, expect } from "vitest";
import {
  costPct,
  itemLabel,
  matchItem,
  normalizeTargetPct,
  recipeCost,
  suggestPrice,
  DEFAULT_TARGET_PCT,
} from "./menuPricing";
import type { BarItem } from "./types";

/** golden **B19** — ต้นทุนตามสูตร + ราคาแนะนำ + ค้นวัตถุดิบ (D110) */

const mk = (itemId: string, name: string, unit: string, costPerUnit: number): BarItem => ({
  itemId,
  name,
  unit,
  qty: 0,
  costPerUnit,
});
const ITEMS = [
  mk("G1", "จิน Tanqueray", "ml", 1.2),
  mk("G2", "จิน Bombay", "ml", 1.0),
  mk("V1", "Vermouth", "ml", 0.5),
  mk("L1", "มะนาว", "ml", 0),
];

describe("ค้นวัตถุดิบด้วยการพิมพ์", () => {
  it("เลือกจากรายการ (ป้ายเต็ม) = ได้ itemId", () => {
    expect(matchItem(itemLabel(ITEMS[0]), ITEMS)).toBe("G1");
  });
  it("พิมพ์ชื่อครบเอง ไม่สนตัวพิมพ์/ช่องว่าง", () => {
    expect(matchItem("  vermouth ", ITEMS)).toBe("V1");
  });
  it("🚨 พิมพ์คำบางส่วนที่ตรงหลายตัว = ไม่เดา (จิน 2 ขวด)", () => {
    expect(matchItem("จิน", ITEMS)).toBe("");
  });
  it("ว่าง / ไม่มี = ''", () => {
    expect(matchItem("", ITEMS)).toBe("");
    expect(matchItem("วอดก้า", ITEMS)).toBe("");
  });
});

describe("ต้นทุนตามสูตร", () => {
  it("รายบรรทัด + รวม", () => {
    const r = recipeCost(
      [
        { itemId: "G1", qty: 45 },
        { itemId: "V1", qty: 30 },
      ],
      ITEMS,
    );
    expect(r.lines.map((l) => l.cost)).toEqual([54, 15]);
    expect(r.total).toBe(69);
    expect(r.missing).toBe(0);
  });
  it("วัตถุดิบที่ยังไม่มีต้นทุน ถูกนับว่าขาด (ต้องเตือน ยอดรวมต่ำกว่าจริง)", () => {
    const r = recipeCost([{ itemId: "L1", qty: 20 }, { itemId: "GONE", qty: 5 }], ITEMS);
    expect(r.total).toBe(0);
    expect(r.missing).toBe(2);
  });
});

describe("ราคาแนะนำ — 30% ปัดขึ้นหลัก 10 (ผู้ใช้เลือก)", () => {
  it("ค่าปริยาย 30%", () => {
    expect(DEFAULT_TARGET_PCT).toBe(30);
  });
  it("ไม่จด VAT: 55 ÷ 30% = 183.33 → 190", () => {
    expect(suggestPrice(55, 30, false)).toBe(190);
  });
  it("🚨 จด VAT: คิด % จากยอดก่อน VAT → 183.33 × 1.07 = 196.17 → 200", () => {
    expect(suggestPrice(55, 30, true)).toBe(200);
  });
  it("ลงตัวพอดีไม่ปัดเกิน: 60 ÷ 30% = 200 → 200 (ไม่ใช่ 210 จากเศษทศนิยม)", () => {
    expect(suggestPrice(60, 30, false)).toBe(200);
    expect(suggestPrice(0.3 * 3, 30, false)).toBe(10);
  });
  it("ปัดขึ้นเสมอ — ราคาที่ได้ทำให้ % ต้นทุนจริงไม่เกินเป้า", () => {
    for (const cost of [12.5, 37, 55, 69, 101.11, 240]) {
      for (const vat of [false, true]) {
        const p = suggestPrice(cost, 30, vat)!;
        expect(costPct(p, cost, vat)!).toBeLessThanOrEqual(30);
      }
    }
  });
  it("ต้นทุน 0 / % ผิดช่วง = ไม่แนะนำ", () => {
    expect(suggestPrice(0, 30, false)).toBeNull();
    expect(suggestPrice(50, 0, false)).toBeNull();
    expect(suggestPrice(50, 100, false)).toBeNull();
  });
});

describe("% ต้นทุนจริงที่ราคาที่กรอก", () => {
  it("ไม่จด VAT", () => {
    expect(costPct(200, 60, false)).toBe(30);
  });
  it("จด VAT เทียบยอดก่อน VAT: 214 → 200 ก่อน VAT → 60/200 = 30%", () => {
    expect(costPct(214, 60, true)).toBe(30);
  });
  it("ราคา 0 = null", () => {
    expect(costPct(0, 60, false)).toBeNull();
  });
});

describe("ค่า % ที่ผู้ใช้กรอก", () => {
  it("ในช่วงใช้ได้ · นอกช่วง/ขยะ = 30", () => {
    expect(normalizeTargetPct(25)).toBe(25);
    expect(normalizeTargetPct("22.5")).toBe(22.5);
    expect(normalizeTargetPct(0)).toBe(30);
    expect(normalizeTargetPct(150)).toBe(30);
    expect(normalizeTargetPct("abc")).toBe(30);
    expect(normalizeTargetPct(null)).toBe(30);
  });
});
