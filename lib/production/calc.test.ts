import { describe, it, expect } from "vitest";
import {
  stockDelta,
  fermVolFromAmounts,
  sumFermVolByBatch,
  volPerTank,
  pendingBatches,
  nextBatchNumber,
  remainingDistillVol,
  diluteCalc,
  closeBatchSummary,
} from "./calc";

/** ค่า expected ตรวจจากการรัน logic ระบบเดิมใน Node (ดู DECISIONS D11) */

describe("stockDelta (P2)", () => {
  it("บวกเฉพาะ 'รับ' ที่เหลือลบหมด", () => {
    expect(stockDelta("รับ", 10)).toBe(10);
    expect(stockDelta(" รับ ", 10)).toBe(10); // trim
    expect(stockDelta("จ่าย", 10)).toBe(-10);
    expect(stockDelta("จำหน่ายต่างประเทศ", 5)).toBe(-5);
    expect(stockDelta("แตกหักเสียหาย", 5)).toBe(-5);
    expect(stockDelta("อื่นๆ", 5)).toBe(-5);
    expect(stockDelta("อื่น ๆ", 5)).toBe(-5); // 2 แบบเว้นวรรค
    expect(stockDelta("รับ", "8")).toBe(8);
    expect(stockDelta("รับ", "x")).toBe(0);
  });
});

describe("fermVol / P4", () => {
  it("ค่าแรกของ comma list", () => {
    expect(fermVolFromAmounts("120, 5, 2")).toBe(120);
    expect(fermVolFromAmounts("80")).toBe(80);
    expect(fermVolFromAmounts("")).toBe(0);
    expect(fermVolFromAmounts(null)).toBe(0);
    expect(fermVolFromAmounts("abc, 5")).toBe(0);
  });

  it("sum ต่อ batch (หลายแถวหมัก)", () => {
    const map = sumFermVolByBatch([
      { batch: "1/69", materialAmounts: "100, 5" },
      { batch: "1/69", materialAmounts: "50, 2" },
      { batch: "2/69", materialAmounts: "80" },
    ]);
    expect(map).toEqual({ "1/69": 150, "2/69": 80 });
  });

  it("volPerTank = totalSaa/qty (q<=0 → 0)", () => {
    expect(volPerTank(150, 3)).toBe(50);
    expect(volPerTank(150, 0)).toBe(0);
  });
});

describe("pendingBatches (P11)", () => {
  it("batch ที่ยังไม่กลั่น · fermVol รวม · productName แถวล่าสุด", () => {
    const ferments = [
      { batch: "1/69", productName: "สาโท", materialAmounts: "100, 5" },
      { batch: "1/69", productName: "สาโท", materialAmounts: "50, 2" },
      { batch: "2/69", productName: "ยิน", materialAmounts: "80" },
      { batch: "3/69", productName: "รัม", materialAmounts: "60" },
    ];
    const result = pendingBatches(ferments, ["2/69"]); // 2/69 กลั่นแล้ว
    expect(result).toEqual([
      { batch: "1/69", productName: "สาโท", fermVol: 150 },
      { batch: "3/69", productName: "รัม", fermVol: 60 },
    ]);
  });
});

describe("nextBatchNumber (P12)", () => {
  it("N/ปีพ.ศ.2หลัก = max+1", () => {
    expect(nextBatchNumber("2026-07-20", ["3/69", "7/69", "2/68", "abc"])).toBe("8/69");
    expect(nextBatchNumber("2026-07-20", [])).toBe("1/69");
    expect(nextBatchNumber("", ["1/69"])).toBe("");
    expect(nextBatchNumber("2025-01-01", ["5/68"])).toBe("6/68");
  });
});

describe("remainingDistillVol (P9)", () => {
  it("Σกลั่น − Σตั้งต้น (ต่ำสุด 0)", () => {
    expect(remainingDistillVol([100, 50], [30])).toBe(120);
    expect(remainingDistillVol([100], [100, 50])).toBe(0); // ติดลบ → 0
    expect(remainingDistillVol([], [])).toBe(0);
  });
});

describe("closeBatchSummary (P8)", () => {
  it("Σ cumVol + ดีกรีเฉลี่ยถ่วงน้ำหนัก", () => {
    // หม้อ1: 10ล.@70 · หม้อ2: 30ล.@60 → vol=40, abv=(10*70+30*60)/40=62.5
    expect(closeBatchSummary([
      { cumVol: 10, abv20: 70 },
      { cumVol: 30, abv20: 60 },
    ])).toEqual({ totalVol: 40, totalAbv: 62.5, count: 2 });
  });
  it("ข้ามหม้อ vol<=0 · abv ว่างไม่รวม wsum", () => {
    expect(closeBatchSummary([
      { cumVol: 20, abv20: 65 },
      { cumVol: 0, abv20: 70 },
      { cumVol: "", abv20: "" },
    ])).toEqual({ totalVol: 20, totalAbv: 65, count: 1 });
  });
  it("ว่าง → 0", () => {
    expect(closeBatchSummary([])).toEqual({ totalVol: 0, totalAbv: 0, count: 0 });
  });
});

describe("diluteCalc C1V1=C2V2 (P9)", () => {
  it("จาก v1 → คำนวณ v2 + water", () => {
    expect(diluteCalc("v1", { v1: 10, c1: 70, c2: 40, v2: 0 })).toEqual({ v1: 10, v2: 17.5, water: 7.5 });
  });
  it("water ติดลบ → 0", () => {
    expect(diluteCalc("v1", { v1: 10, c1: 40, c2: 70, v2: 0 })).toEqual({ v1: 10, v2: 5.71, water: 0 });
  });
  it("จาก v2 → คำนวณ v1 + water", () => {
    expect(diluteCalc("v2", { v1: 0, c1: 70, c2: 40, v2: 17.5 })).toEqual({ v1: 10, v2: 17.5, water: 7.5 });
  });
  it("ปัด toFixed(2): 5.325 → 5.33", () => {
    expect(diluteCalc("v1", { v1: 3, c1: 71, c2: 40, v2: 0 })).toEqual({ v1: 3, v2: 5.33, water: 2.33 });
  });
  it("ข้อมูลไม่ครบ → ไม่คำนวณ (คงค่าเดิม)", () => {
    expect(diluteCalc("v1", { v1: 0, c1: 70, c2: 40, v2: 0 })).toEqual({ v1: 0, v2: 0, water: 0 });
  });
});
