/**
 * scripts/sample-redistill-pdf — เรนเดอร์ฟอร์ม ภส.๐๗-๐๒/๑(๑) ตัวอย่างที่มีล็อตกลั่นซ้ำ (D94)
 *
 * ใช้ดูด้วยตาว่าหมายเหตุ 2 บรรทัดในช่องกว้าง 60.4 pt ชิดเส้นแนวนอนไหม
 * (build/lint/test มองไม่เห็นเรื่องนี้เลย — ต้องเปิดไฟล์ดู)
 *
 *   npx tsx scripts/sample-redistill-pdf.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { productionReport, type LogDilute, type LogProduct } from "../lib/production/reports";
import { dilutePlan, type RedistillLot, type RedistillRound } from "../lib/production/redistill";
import { fillExciseForm } from "../lib/pdf/excise";

const ROOT = path.resolve(__dirname, "..");
const TPL = readFileSync(path.join(ROOT, "docs/form/ภส_07-02ทับ1.pdf"));
const FONT = readFileSync(path.join(ROOT, "docs/form/THSARABUN.TTF"));

const ENTITY = { company: "บริษัท ทดสอบคราฟต์ดิสทิลเลอรี่ จำกัด", exciseId: "10130000112233445" };
const PRODUCTS = [
  { product_id: "P-GIN", name: "ยินทดสอบ", degree: 40, bottle_size_l: 0.7, liquor_type: "สุรากลั่น", liquor_kind: "ยิน" },
];
const FERMENT = Array.from({ length: 6 }, (_, i) => ({
  ferment_date: `2026-09-0${i + 1}`, product_name: "ยินทดสอบ",
  batch: `${i + 1}/69`, container_qty: 1, material_amounts: "200",
}));
const DISTILL = Array.from({ length: 6 }, (_, i) => ({
  distill_date: `2026-09-1${i + 1}`, product_name: "ยินทดสอบ",
  batch: `${i + 1}/69`, vol: 40, abv: 70,
}));

const LOT: RedistillLot = {
  lot_no: "S1/69", product_name: "ยินทดสอบ",
  draw_date: "2026-09-28", draw_vol: 240, draw_abv: 70,
};
const ROUND: RedistillRound = {
  lot_no: "S1/69", round_no: 2, soak_date: "2026-09-28", distill_date: "2026-10-10",
  start_vol: 240, start_abv: 70, end_vol: 180, end_abv: 65,
};
const CLOSE = { diluteDate: "2026-10-12", water: 112.5, finalVol: 292.5, finalAbv: 40 };

const lotRows: LogDilute[] = dilutePlan(LOT, [ROUND], CLOSE).map((p) => ({
  dilute_date: p.date, product_name: "ยินทดสอบ",
  start_vol: p.startVol, final_vol: p.finalVol, final_abv: p.finalAbv,
  redistill_lot: LOT.lot_no, note: p.note,
}));
// แถวปรุงธรรมดา (ไม่มีล็อต) — ไว้เทียบว่าข้อความอัตโนมัติเดิมตกบรรทัดยังไง
const plainRow: LogDilute = {
  dilute_date: "2026-10-20", product_name: "ยินทดสอบ",
  start_vol: 0, final_vol: 40, final_abv: 40,
};
const PACK: LogProduct[] = [
  { doc_date: "2026-10-13", trans_type: "รับ", product_id: "P-GIN", amount: 100, note: null },
];

const OUT_DIR = process.argv[2] ?? ROOT;
// ล็อตที่ยังไม่ปิด — เคสหมายเหตุยาวสุด (100.8 pt → ต้องตก 2 บรรทัด)
const openRows: LogDilute[] = dilutePlan(LOT, [ROUND]).map((p) => ({
  dilute_date: p.date, product_name: "ยินทดสอบ",
  start_vol: p.startVol, final_vol: p.finalVol, final_abv: p.finalAbv,
  redistill_lot: LOT.lot_no, note: p.note,
}));

async function main() {
  for (const [tag, month, dilu, pack] of [
    ["09-ยังไม่ปิดล็อต", "2026-09", openRows, [] as LogProduct[]],
    ["09-ปิดล็อตแล้ว", "2026-09", lotRows, [] as LogProduct[]],
    ["10", "2026-10", [...lotRows, plainRow], PACK],
  ] as const) {
    const data = productionReport(month, "P-GIN", ENTITY, PRODUCTS, FERMENT, DISTILL, [...dilu], [...pack]);
    const bytes = await fillExciseForm("0702_1", data, TPL, FONT);
    const out = path.join(OUT_DIR, `sample-0702-1-${tag}.pdf`);
    writeFileSync(out, bytes);
    console.log(`${out}  (${data.grid.length} แถว)`);
    for (const r of data.grid) if (r.note) console.log(`   วันที่ ${r.date}: ${r.note}`);
  }
}
main();
