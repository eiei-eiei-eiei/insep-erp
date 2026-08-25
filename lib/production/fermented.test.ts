import { describe, it, expect } from "vitest";
import { fermentedReport, type LogFermentDraw } from "./reports";
import type { LogFerment, LogProduct, ProductMaster } from "./reports";

/**
 * D78 — ภส.๐๗-๐๒/๑(๑) ฉบับสุราแช่
 *
 * ⚠️ ใบนี้ **ไม่มีระบบเดิมให้เทียบ** (แอป GAS เดิมทำแต่สุรากลั่น) → ไม่มี golden จากของจริง
 *    ค่าที่คาดหวังจึงเป็นตัวเลขที่ตกลงกับผู้ใช้ไว้ตรง ๆ (ตัวเลขกลม ตรวจด้วยตาได้)
 *    fixture วางไว้ในไฟล์เทสเลย ไม่ใช่ __golden__/*.json เพื่อให้อ่านคู่กับค่าที่คาดหวังได้ในที่เดียว
 *
 * เหตุการณ์ (ถังหมัก 100 ล./ถัง · พ.ค. 2569 · ยอดยกมา 0):
 *   3 พ.ค.  หมัก 1/69  2 ถัง × 100 = น้ำหมัก 200 ล.
 *   8 พ.ค.  หมัก 2/69  1 ถัง × 100 = น้ำหมัก 100 ล.
 *  24 พ.ค.  ริน 1/69 ได้ 160 ล. 12 ดีกรี → ปรุงเป็น 200 ล. 9 ดีกรี (เติมน้ำ 40)
 *  28 พ.ค.  บรรจุ 0.75 ล. × 200 ขวด = 150 ล.
 */
const MONTH = "2026-05";
const ENTITY = { company: "โรงงานทดสอบ", exciseId: "EX-TEST" };
const NAME = "ไวน์ลิ้นจี่ทดสอบ";

const products: ProductMaster[] = [
  { product_id: "T-PROD01", name: NAME, degree: 9, bottle_size_l: 0.75, liquor_type: "สุราแช่", liquor_kind: "ไวน์ผลไม้" },
];
const fermLog: LogFerment[] = [
  { ferment_date: "2026-05-03", product_name: NAME, batch: "1/69", container_qty: 2, material_amounts: "200, 5" },
  { ferment_date: "2026-05-08", product_name: NAME, batch: "2/69", container_qty: 1, material_amounts: "100, 3" },
];
const drawLog: LogFermentDraw[] = [
  { draw_date: "2026-05-24", product_name: NAME, batch: "1/69", vol: 160, abv: 12, adjust_date: null, water: 40, final_vol: 200, final_abv: 9, note: null },
];
const packLog: LogProduct[] = [
  { doc_date: "2026-05-28", trans_type: "รับ", product_id: "T-PROD01", amount: 200, note: null },
];

const run = () => fermentedReport(MONTH, "T-PROD01", ENTITY, products, fermLog, drawLog, packLog);

describe("D78 fermentedReport — ภส.๐๗-๐๒/๑(๑) ฉบับสุราแช่", () => {
  it("หัวฟอร์ม + ยอดยกมา", () => {
    const r = run();
    expect(r.company).toBe("โรงงานทดสอบ");
    expect(r.monthThai).toBe("พฤษภาคม 2569");
    expect(r.productName).toBe(NAME);
    expect(r.liquorType).toBe("สุราแช่");
    expect(r.degree).toBe(9);
    expect(r.bfMash).toBe(0);
    expect(r.bfWine).toBe(0);
  });

  it("แถวรวม — ตรงตารางที่ตกลงกับผู้ใช้ (300 / 200 / 150 · คงเหลือ 100 / 50)", () => {
    const r = run();
    expect(r.monthFermMash).toBe(300);
    expect(r.monthWine).toBe(200);   // ★ ยอด**หลังปรุง** ไม่ใช่ 160 (drawnVol · D78)
    expect(r.monthPackVol).toBe(150);
    expect(r.yearFermMash).toBe(300);
    expect(r.yearWine).toBe(200);
    expect(r.yearPackVol).toBe(150);
    expect(r.endMash).toBe(100);     // 300 − น้ำหมักของ 1/69 ทั้งก้อน (200)
    expect(r.endWine).toBe(50);      // 200 − 150
  });

  it("ตารางรายวัน — เฉพาะวันที่มีความเคลื่อนไหว 4 แถว", () => {
    const g = run().grid;
    expect(g.map((r) => r.date)).toEqual(["03/05/69", "08/05/69", "24/05/69", "28/05/69"]);

    // 3 พ.ค. — หมัก 1/69: 2 ถัง · 100 ล./ถัง · สุทธิ 200 → น้ำหมักคงเหลือ 200
    expect(g[0]).toMatchObject({
      fermBatch: "1/69", fermQty: 2, avgFermVol: 100, fermMash: 200,
      drawBatch: "", avgAbv: null, drawVol: null, curMash: 200, curWine: 0,
      packSize: "", packQty: null, packVol: null, note: "",
    });

    // 8 พ.ค. — หมัก 2/69 → คงเหลือสะสม 300
    expect(g[1]).toMatchObject({ fermBatch: "2/69", fermQty: 1, avgFermVol: 100, fermMash: 100, curMash: 300, curWine: 0 });

    // 24 พ.ค. — ริน 1/69: หักน้ำหมักทั้งก้อน 200 → 100 · ได้น้ำสุราแช่ 200 ล. 9 ดีกรี
    expect(g[2]).toMatchObject({
      fermBatch: "", fermQty: null, fermMash: null,
      drawBatch: "1/69", avgAbv: 9, drawVol: 200,
      curMash: 100, curWine: 200,
      note: "ปรุง 9° ได้ 200.00 ล.",
    });

    // 28 พ.ค. — บรรจุ 200 ขวด × 0.75 = 150 → สุราแช่คงเหลือ 50
    expect(g[3]).toMatchObject({
      drawBatch: "", packSize: "0.750", packQty: 200, packVol: 150,
      curMash: 100, curWine: 50,
    });
  });

  it("ไม่ปรุง (final_vol/final_abv ว่าง) → ใช้ยอดตอนริน และไม่มีหมายเหตุปรุง", () => {
    const r = fermentedReport(MONTH, "T-PROD01", ENTITY, products, fermLog,
      [{ draw_date: "2026-05-24", product_name: NAME, batch: "1/69", vol: 160, abv: 12 }], packLog);
    expect(r.monthWine).toBe(160);
    expect(r.endWine).toBe(10);      // 160 − 150
    expect(r.grid[2]).toMatchObject({ avgAbv: 12, drawVol: 160, note: "" });
  });

  it("ยอดยกมา — หมัก/ริน/บรรจุ ของเดือนก่อนไหลมาเป็นยอดยกมา ไม่ขึ้นตารางรายวัน", () => {
    const r = fermentedReport(MONTH, "T-PROD01", ENTITY, products,
      [{ ferment_date: "2026-04-10", product_name: NAME, batch: "9/69", container_qty: 1, material_amounts: "500" }, ...fermLog],
      [{ draw_date: "2026-04-20", product_name: NAME, batch: "9/69", vol: 400, abv: 10 }, ...drawLog],
      packLog);
    expect(r.bfMash).toBe(0);        // หมัก 500 แล้วรินหมดทั้งก้อน 500
    expect(r.bfWine).toBe(400);
    expect(r.grid).toHaveLength(4);  // เดือน เม.ย. ไม่โผล่
    expect(r.endMash).toBe(100);
    expect(r.endWine).toBe(450);     // 400 + 200 − 150
  });

  it("สินค้าชื่ออื่นไม่ปนเข้ามา", () => {
    const r = fermentedReport(MONTH, "อย่างอื่น", ENTITY, products, fermLog, drawLog, packLog);
    expect(r.grid).toHaveLength(0);
    expect(r.monthFermMash).toBe(0);
  });
});

describe("D78 ช่องท้ายกระดาษ — ขนาดบรรจุของภาชนะหมัก", () => {
  const conts = [{ container_id: "T-C1", capacity_l: 120 }, { container_id: "T-C2", capacity_l: 60 }];
  it("รวมความจุของภาชนะที่ใช้หมักสุราตัวนี้ (ไม่ซ้ำ · เรียงน้อยไปมาก)", () => {
    const fl = [
      { ...fermLog[0], container_id: "T-C1" },
      { ...fermLog[1], container_id: "T-C2" },
    ];
    expect(fermentedReport(MONTH, "T-PROD01", ENTITY, products, fl, drawLog, packLog, conts).containerSize).toBe("60, 120");
  });
  it("ไม่มีข้อมูลภาชนะ → เว้นว่าง (ไม่เดา)", () => {
    expect(run().containerSize).toBe("");
    expect(fermentedReport(MONTH, "T-PROD01", ENTITY, products, fermLog, drawLog, packLog, conts).containerSize).toBe("");
  });
});
