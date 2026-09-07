import { describe, it, expect } from "vitest";
import { productionReport, type ProductMaster, type LogFerment, type LogDistill, type LogDilute, type LogProduct } from "./reports";
import { dilutePlan, type RedistillLot, type RedistillRound } from "./redistill";

/**
 * D94 — ล็อตกลั่นซ้ำมองจากฝั่ง **ฟอร์ม ภส.๐๗-๐๒/๑(๑)**
 *
 * ไฟล์นี้เทสสิ่งที่ golden test ของ reports.test.ts เทสไม่ได้ เพราะ fixture ของ golden
 * มาจากระบบเดิมที่ยังไม่มีการกลั่นซ้ำ — ★ golden เดิมยังต้องผ่าน **โดยไม่แก้ไฟล์เทส**
 * (หลักฐานว่าเส้นทางกลั่นรอบเดียวไม่ขยับ)
 *
 * เคส: ยกออก 240 ล. @70 วันที่ 28 ก.ย. → กลั่นซ้ำ 10 ต.ค. ได้ 180 @65
 *      → ปรับดีกรี 12 ต.ค. ได้ 292.50 @40 → บรรจุ 13 ต.ค.
 */
const ENTITY = { company: "โรงทดสอบ", exciseId: "12345678901234567" };

const PRODUCTS: ProductMaster[] = [
  { product_id: "P-GIN", name: "ยินทดสอบ", degree: 40, bottle_size_l: 0.7, liquor_type: "สุรากลั่น", liquor_kind: "ยิน" },
];

// หมัก 6 batch ในเดือน ส.ค. (ก่อนเดือนที่ดู) แล้วกลั่นรอบแรกได้ batch ละ 40 ล.
const FERMENT: LogFerment[] = Array.from({ length: 6 }, (_, i) => ({
  ferment_date: "2026-08-0" + (i + 1),
  product_name: "ยินทดสอบ",
  batch: i + 1 + "/69",
  container_qty: 1,
  material_amounts: "200",
}));
const DISTILL: LogDistill[] = Array.from({ length: 6 }, (_, i) => ({
  distill_date: "2026-08-1" + (i + 1),
  product_name: "ยินทดสอบ",
  batch: i + 1 + "/69",
  vol: 40,
  abv: 70,
}));

const LOT: RedistillLot = {
  lot_no: "S1/69",
  product_name: "ยินทดสอบ",
  draw_date: "2026-09-28",
  draw_vol: 240,
  draw_abv: 70,
};
const ROUND: RedistillRound = {
  lot_no: "S1/69", round_no: 2,
  soak_date: "2026-09-28", distill_date: "2026-10-10",
  start_vol: 240, start_abv: 70, end_vol: 180, end_abv: 65,
};
const CLOSE = { diluteDate: "2026-10-12", water: 112.5, finalVol: 292.5, finalAbv: 40 };

/** แปลงแผนของ dilutePlan → แถว log_dilute จริง (แบบเดียวกับที่ RPC เขียนลง DB) */
function diluteRows(close?: typeof CLOSE): LogDilute[] {
  return dilutePlan(LOT, [ROUND], close).map((p) => ({
    dilute_date: p.date,
    product_name: LOT.product_name,
    start_vol: p.startVol,
    final_vol: p.finalVol,
    final_abv: p.finalAbv,
    redistill_lot: LOT.lot_no,
    note: p.note,
  }));
}

const PACK: LogProduct[] = [
  { doc_date: "2026-10-13", trans_type: "รับ", product_id: "P-GIN", amount: 100, note: null }, // 100 × 0.7 = 70 ล.
];

const run = (month: string, dilu: LogDilute[], pack: LogProduct[] = []) =>
  productionReport(month, "P-GIN", ENTITY, PRODUCTS, FERMENT, DISTILL, dilu, pack);

describe("ล็อตกลั่นซ้ำบนฟอร์ม ภส.๐๗-๐๒/๑(๑)", () => {
  it("เดือนที่ยกออก (ก.ย.) — คงเหลือสุรากลั่นลดลง 240 · สุราปรุงยังไม่ขยับ", () => {
    const r = run("2026-09", diluteRows());
    expect(r.bfDistill).toBe(240);         // ยกมาจาก ส.ค. 6 batch × 40
    expect(r.monthDiluStart).toBe(240);
    expect(r.endDist).toBe(0);             // 🔴 ของออกจากถังสุรากลั่นหมดแล้ว
    expect(r.endDilu).toBe(0);             // ยังไม่มีสุราปรุง (ของอยู่ในถังแช่)
  });

  it("เดือนที่ยกออก — มีบรรทัดวันที่ 28 พร้อมหมายเหตุที่อธิบายว่าของอยู่ไหน", () => {
    const row = run("2026-09", diluteRows()).grid.find((g) => g.day === 28);
    expect(row?.diluStartVol).toBe(240);
    expect(row?.note).toBe("ยกไปแช่สมุนไพรและกลั่นซ้ำ S1/69 (อยู่ระหว่างดำเนินการ)");
    // 🚨 ห้ามหลุดข้อความอัตโนมัติเดิมออกมา — ท่อนนี้ final_vol = 0
    expect(row?.note).not.toContain("ได้ปริมาณ 0.00");
  });

  it("🔴 เดือนที่ปรับดีกรี (ต.ค.) — วันที่ 12 ต้องขึ้นบนฟอร์ม (บั๊ก hasActivity)", () => {
    // ท่อน "ปรุงเสร็จ" มีแต่ final_vol · ก่อน D94 วันนี้จะถูกข้ามทั้งวัน
    // แล้วยอดคงเหลือสุราปรุงจะกระโดดขึ้นบนบรรทัดวันที่ 13 โดยไม่มีอะไรอธิบาย
    const r = run("2026-10", diluteRows(CLOSE), PACK);
    const row = r.grid.find((g) => g.day === 12);
    expect(row, "วันที่ปรับดีกรีเสร็จหายไปจากฟอร์ม").toBeTruthy();
    expect(row?.diluStartVol).toBeNull();
    expect(row?.curDilu).toBe(292.5);
    expect(row?.note).toContain("S1/69 ได้ 180.00 ล. 65 ดีกรี");
  });

  it("เดือนที่ปรับดีกรี — ยอดคงเหลือ 3 ถัง ตรงกับของจริงตอนสิ้นเดือน", () => {
    const r = run("2026-10", diluteRows(CLOSE), PACK);
    expect(r.bfDistill).toBe(0);           // ยกมาจาก ก.ย. = 0 (ยกออกไปหมดแล้ว)
    expect(r.endDist).toBe(0);
    expect(r.monthPackVol).toBeCloseTo(70, 6);
    expect(r.endDilu).toBeCloseTo(222.5, 6);  // 292.50 − 70.00
  });

  it("🚨 คงเหลือสุรากลั่นไม่พองสะสม — ถ้าใช้ 180 แทน 240 จะค้าง 60 ล. ตลอดกาล", () => {
    const sep = run("2026-09", diluteRows());
    const oct = run("2026-10", diluteRows(CLOSE), PACK);
    expect(sep.endDist).toBe(0);
    expect(oct.endDist).toBe(0);
  });

  it("ยอดยกมาของเดือนถัดไป ต่อจากเดือนก่อนพอดี (ไม่มีของหายระหว่างเดือน)", () => {
    const sep = run("2026-09", diluteRows());
    const oct = run("2026-10", diluteRows(CLOSE), PACK);
    expect(oct.bfDistill).toBe(sep.endDist);
    expect(oct.bfDilute).toBe(sep.endDilu);
  });

  it("แถวปรุงธรรมดา (ไม่มีล็อต) ยังใช้ข้อความอัตโนมัติเดิม", () => {
    const plain: LogDilute[] = [
      { dilute_date: "2026-10-05", product_name: "ยินทดสอบ", start_vol: 40, final_vol: 70, final_abv: 40 },
    ];
    const row = run("2026-10", plain).grid.find((g) => g.day === 5);
    expect(row?.note).toBe("ปรุงปรับดีกรี 40 ได้ปริมาณ 70.00 ลิตร");
  });
});

describe("กลั่นซ้ำ 3 รอบ — ฟอร์มเห็นเหมือนเดิมทุกประการ", () => {
  it("เพิ่มรอบที่ 3 ไม่ขยับตัวเลขบนฟอร์มสักช่อง (รอบเป็นแค่รายการ)", () => {
    const r3: RedistillRound = {
      lot_no: "S1/69", round_no: 3, distill_date: "2026-10-11",
      start_vol: 180, start_abv: 65, end_vol: 140, end_abv: 68,
    };
    const close3 = { diluteDate: "2026-10-12", water: 98, finalVol: 238, finalAbv: 40 };
    const rows3 = dilutePlan(LOT, [ROUND, r3], close3).map((p) => ({
      dilute_date: p.date, product_name: LOT.product_name,
      start_vol: p.startVol, final_vol: p.finalVol, final_abv: p.finalAbv,
      redistill_lot: LOT.lot_no, note: p.note,
    }));
    // ยอดที่หักจากถังสุรากลั่นยังอยู่ที่ ก.ย. และยังเป็น 240 เท่าเดิม ไม่ใช่ 180/140 ของรอบหลัง
    const sep = run("2026-09", rows3);
    expect(sep.monthDiluStart).toBe(240);
    expect(sep.endDist).toBe(0);

    const r = run("2026-10", rows3);
    expect(r.monthDiluStart).toBe(0);      // ท่อน "ยกไปปรุง" ตกเดือน ก.ย. ไม่ถูกนับซ้ำ
    expect(r.endDist).toBe(0);
    expect(r.endDilu).toBe(238);
    expect(r.grid.find((g) => g.day === 12)?.note).toContain("S1/69 ได้ 140.00 ล. 68 ดีกรี");
  });
});
