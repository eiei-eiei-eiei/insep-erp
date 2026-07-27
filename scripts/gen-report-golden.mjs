/**
 * gen-report-golden — รันฟังก์ชันรายงาน "เดิม" (Reports.js) บน fixture ชุดเดียว
 * แล้วบันทึกทั้ง db-shaped input + expected output → lib/production/__golden__/reports.json
 * ให้ reports.test.ts เอา port มาเทียบ (P5/P6/P7)
 * รัน: node scripts/gen-report-golden.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = readFileSync("docs/legacy/production/Reports.js", "utf8");
const region = src.slice(src.indexOf("function fmtDateDMY_"));

const ENTITY = { company: "บริษัททดสอบ", exciseId: "EX-TEST" };
const MONTH = "2026-07";
const MATERIAL_ID = "T-MAT01";
const PRODUCT_ID = "T-PROD01";

// ── base fixture (ครอบ bf ก่อนเดือน + กิจกรรมในเดือน ครบ ferment→distill→dilute→pack) ──
const materials = [
  { material_id: "T-MAT01", name: "ข้าวเหนียว", unit: "กก." },
  { material_id: "T-MAT02", name: "น้ำตาล", unit: "กก." },
];
const products = [
  { product_id: "T-PROD01", name: "สาโททดสอบ", degree: 40, bottle_size_l: 0.75, liquor_type: "สุราแช่", liquor_kind: "สาโท" },
];
const logMaterial = [
  { doc_date: "2026-06-20", trans_type: "รับ", material_id: "T-MAT01", amount: 100, doc_ref: "PO-1" },
  { doc_date: "2026-07-05", trans_type: "รับ", material_id: "T-MAT01", amount: 200, doc_ref: "PO-2" },
  { doc_date: "2026-07-06", trans_type: "จ่าย", material_id: "T-MAT01", amount: 120, doc_ref: "1/69" },
  { doc_date: "2026-07-08", trans_type: "เสียหาย", material_id: "T-MAT02", amount: 3, doc_ref: "" },
];
const logFerment = [
  { ferment_date: "2026-07-06", product_name: "สาโททดสอบ", batch: "1/69", container_qty: 2, material_amounts: "120, 5" },
];
const logDistill = [
  { distill_date: "2026-07-10", product_name: "สาโททดสอบ", batch: "1/69", vol: 40, abv: 70 },
];
const logDilute = [
  { dilute_date: "2026-07-12", product_name: "สาโททดสอบ", start_vol: 40, final_vol: 80, final_abv: 40 },
];
const logProduct = [
  { doc_date: "2026-07-15", trans_type: "รับ", product_id: "T-PROD01", amount: 100, note: "" },
  { doc_date: "2026-07-20", trans_type: "จ่าย", product_id: "T-PROD01", amount: 30, note: "ส่ง ORD260720-001" },
];

// ── แปลง db-shaped → sheet-shaped (ชื่อคอลัมน์ไทยตามระบบเดิม) ─────────────────────
const sheet = {
  Master_Material: materials.map((m) => ({ "รหัสวัตถุดิบ": m.material_id, "ชื่อวัตถุดิบ": m.name, "หน่วยนับ": m.unit })),
  Master_Product: products.map((p) => ({ "รหัสสินค้า": p.product_id, "ชื่อสุรา": p.name, "ดีกรี": p.degree, "ขนาดขวด(ลิตร)": p.bottle_size_l, "ประเภทสุรา": p.liquor_type, "ชนิดสุรา": p.liquor_kind })),
  Log_Material: logMaterial.map((r) => ({ "วันที่": r.doc_date, "ประเภท(รับ/จ่าย)": r.trans_type, "รหัสวัตถุดิบ": r.material_id, "จำนวน": r.amount, "หลักฐานเลขที่": r.doc_ref, "หมายเหตุ": "" })),
  Log_Ferment: logFerment.map((r) => ({ "วันที่ลงหมัก": r.ferment_date, "ชื่อสุรา": r.product_name, "รหัสBatch": r.batch, "จำนวนภาชนะ(หน่วย)": r.container_qty, "จำนวนวัตถุดิบที่ใช้": r.material_amounts })),
  Log_Distill: logDistill.map((r) => ({ "วันที่กลั่น": r.distill_date, "ชื่อสุรา": r.product_name, "รหัสBatchที่นำมากลั่น": r.batch, "ปริมาณน้ำสุราที่ได้(ลิตร)": r.vol, "ดีกรี": r.abv })),
  Log_Dilute: logDilute.map((r) => ({ "วันที่ปรุงแต่ง": r.dilute_date, "ชื่อสุรา": r.product_name, "ปริมาณสุราตั้งต้น(ลิตร)": r.start_vol, "ปริมาณสุราหลังปรุง(ลิตร)": r.final_vol, "ดีกรีหลังปรุง": r.final_abv })),
  Log_Product: logProduct.map((r) => ({ "วันที่": r.doc_date, "ประเภท(รับ/จ่าย)": r.trans_type, "รหัสสินค้า": r.product_id, "จำนวน(ขวด)": r.amount, "ลูกค้า/หมายเหตุ": r.note })),
};

// ── stubs + eval ฟังก์ชันเดิม ─────────────────────────────────────────────────────
const stubs = `
  function getConfig_() { return { companyName: ${JSON.stringify(ENTITY.company)}, exciseId: ${JSON.stringify(ENTITY.exciseId)} }; }
  function readSheet(name) { return (SHEET[name] || []); }
  function getMasterAndInitialData() { return { success: true, materials: SHEET.Master_Material, containers: [], products: SHEET.Master_Product }; }
`;
const factory = new Function(
  "SHEET",
  stubs + region + "\n return { getMaterialReportData, getProductReportData, getProductionReportData, getSummaryReportData };",
);
const R = factory(sheet);

const strip = (o) => { const { success, ...rest } = o; void success; return rest; };
const expected = {
  material: strip(R.getMaterialReportData(MONTH, MATERIAL_ID)),
  product: strip(R.getProductReportData(MONTH, PRODUCT_ID)),
  production: strip(R.getProductionReportData(MONTH, PRODUCT_ID)),
  summary: strip(R.getSummaryReportData(MONTH)),
};

mkdirSync("lib/production/__golden__", { recursive: true });
writeFileSync(
  "lib/production/__golden__/reports.json",
  JSON.stringify({
    entity: ENTITY, month: MONTH, materialId: MATERIAL_ID, productId: PRODUCT_ID,
    db: { materials, products, logMaterial, logFerment, logDistill, logDilute, logProduct },
    expected,
  }, null, 1),
  "utf8",
);
console.log("✓ lib/production/__golden__/reports.json");
console.log("  production grid rows:", expected.production.grid.length, "· summary products:", expected.summary.products.length);
