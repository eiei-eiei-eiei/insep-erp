/**
 * lib/production/reports — ข้อมูลรายงานสรรพสามิต ภส. (P5/P6/P7)
 * port จาก Reports.js: getMaterialReportData / getProductReportData /
 *   getProductionReportData / getSummaryReportData — ไม่แตะสูตร
 * ⚠️ aggregate ตาม "ชื่อสุรา" · running balance ไหลข้าม ส่า→กลั่น→ปรุง→บรรจุ (P5)
 *   filter เดือน/ปีด้วย y/m/d ตรง ๆ (กัน timezone) · golden test = reports.test.ts
 */
import { drawnAbv, drawnVol } from "./calc";


// ── input types (ชื่อคอลัมน์ตาม DB ใหม่) ────────────────────────────────────────
export type MaterialMaster = { material_id: string; name: string; unit: string | null };
export type ProductMaster = {
  product_id: string;
  name: string;
  degree: number | string | null;
  bottle_size_l: number | string | null;
  liquor_type: string | null;
  liquor_kind: string | null;
};
export type LogMaterial = {
  doc_date: string;
  trans_type: string;
  material_id: string;
  amount: number | string;
  doc_ref: string | null;
};
export type LogFerment = {
  ferment_date: string;
  product_name: string;
  batch: string;
  container_qty: number | string | null;
  material_amounts: string | null;
  /** D78: ใช้เฉพาะฟอร์มสุราแช่ (ช่องท้ายกระดาษ "ขนาดบรรจุของภาชนะหมัก") — optional ไม่กระทบฟอร์มกลั่น */
  container_id?: string | null;
};

export type ContainerMaster = { container_id: string; capacity_l: number | string | null };
export type LogDistill = {
  distill_date: string;
  product_name: string;
  batch: string;
  vol: number | string;
  abv: number | string;
};
export type LogDilute = {
  dilute_date: string;
  product_name: string;
  start_vol: number | string | null;
  final_vol: number | string | null;
  final_abv: number | string | null;
};
export type LogProduct = {
  doc_date: string;
  trans_type: string;
  product_id: string;
  amount: number | string;
  note: string | null;
};

export type Entity = { company: string; exciseId: string };

// ── helpers ─────────────────────────────────────────────────────────────────────
type YMD = { y: number; m: number; d: number };
function ymd(dateStr: string | null | undefined): YMD | null {
  if (!dateStr) return null;
  const s = String(dateStr).slice(0, 10).split("-");
  const y = Number(s[0]), m = Number(s[1]), d = Number(s[2]);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d }; // m 0-indexed เทียบ getMonth เดิม
}
function parseMonth(monthStr: string) {
  const [y, m] = monthStr.split("-").map(Number);
  return { year: y, month: m - 1 };
}
function daysIn(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
const before = (r: YMD, y: number, m: number) => r.y < y || (r.y === y && r.m < m);
const upto = (r: YMD, y: number, m: number) => r.y === y && r.m <= m;
const inMonth = (r: YMD, y: number, m: number) => r.y === y && r.m === m;
const num = (v: unknown) => parseFloat(String(v)) || 0;

/** 'YYYY-MM-DD' → 'dd/mm/yy' (ปี พ.ศ. 2 หลัก) — ใช้กับวันที่ที่อาจอยู่คนละเดือนกับรายงาน (D78) */
export function fmtIsoDMY(iso: string): string {
  const p = String(iso).slice(0, 10).split("-");
  if (p.length !== 3) return String(iso);
  const yy = ((parseInt(p[0], 10) || 0) + 543) % 100;
  return p[2] + "/" + p[1] + "/" + String(yy).padStart(2, "0");
}

/** dd/mm/yy (ปี พ.ศ. 2 หลัก) เช่น day=5,'2026-06' → '05/06/69' */
export function fmtDateDMY(day: number, monthStr: string): string {
  const parts = String(monthStr).split("-");
  const yy = ((parseInt(parts[0], 10) || 0) + 543) % 100;
  const dd = String(day).padStart(2, "0");
  const mm = String(parseInt(parts[1], 10) || 0).padStart(2, "0");
  return dd + "/" + mm + "/" + String(yy).padStart(2, "0");
}

export function getThaiMonthYear(monthStr: string): string {
  if (!monthStr) return "";
  const months = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const parts = monthStr.split("-");
  if (parts.length !== 2) return monthStr;
  return `${months[parseInt(parts[1], 10) - 1]} ${parseInt(parts[0], 10) + 543}`;
}

// ── P6a: ภส.๐๗-๐๑/๑ วัตถุดิบ (getMaterialReportData) ───────────────────────────────
export function materialReport(
  monthStr: string,
  materialId: string,
  entity: Entity,
  logMaterial: LogMaterial[],
  materials: MaterialMaster[],
  products: ProductMaster[],
) {
  const { year: targetYear, month: targetMonth } = parseMonth(monthStr);
  const dim = daysIn(targetYear, targetMonth);
  const mat = materials.find((m) => m.material_id === materialId);
  const matName = mat ? mat.name : materialId;
  const unit = mat ? mat.unit || "" : "";

  let bfBalance = 0, monthIn = 0, monthOut = 0, yearIn = 0, yearOut = 0;
  const daily: Record<number, { in: number; out: number; ref: string[]; batches: string[] }> = {};
  for (let i = 1; i <= 31; i++) daily[i] = { in: 0, out: 0, ref: [], batches: [] };

  for (const row of logMaterial) {
    if (row.material_id !== materialId) continue;
    const r = ymd(row.doc_date);
    if (!r) continue;
    const qty = num(row.amount);
    const type = row.trans_type;
    const docRef = String(row.doc_ref || "").trim();
    if (before(r, targetYear, targetMonth)) bfBalance += type === "รับ" ? qty : -qty;
    if (upto(r, targetYear, targetMonth)) { if (type === "รับ") yearIn += qty; else yearOut += qty; }
    if (inMonth(r, targetYear, targetMonth)) {
      const day = r.d;
      if (type === "รับ") { monthIn += qty; daily[day].in += qty; if (docRef) daily[day].ref.push(docRef); }
      else { monthOut += qty; daily[day].out += qty; if (docRef) daily[day].batches.push(docRef); }
    }
  }

  const grid = [];
  let bal = bfBalance;
  for (let i = 1; i <= dim; i++) {
    const dIn = daily[i].in, dOut = daily[i].out;
    bal = bal + dIn - dOut;
    let desc = "";
    if (dIn > 0 || dOut > 0) {
      desc = matName;
      const ub = [...new Set(daily[i].batches)].filter((b) => b);
      if (ub.length) desc += " " + ub.join(", ");
    }
    grid.push({
      day: i, date: fmtDateDMY(i, monthStr), desc,
      ref: daily[i].ref.length ? daily[i].ref.join(", ") : "",
      inv: dIn > 0 ? dIn : null, outv: dOut > 0 ? dOut : null, bal,
    });
  }

  const liquorType = products[0] ? products[0].liquor_type || "" : "";
  return {
    company: entity.company, exciseId: entity.exciseId,
    monthThai: getThaiMonthYear(monthStr), materialName: matName, unit, liquorType,
    bfBalance, monthIn, monthOut, yearIn, yearOut, grid,
  };
}

// ── P6b: ภส.๐๗-๐๒/๑(๒) สุราบรรจุขวด (getProductReportData) ─────────────────────────
export function productReport(
  monthStr: string,
  productId: string,
  entity: Entity,
  logProduct: LogProduct[],
  products: ProductMaster[],
) {
  const { year: targetYear, month: targetMonth } = parseMonth(monthStr);
  const dim = daysIn(targetYear, targetMonth);
  const prd = products.find((p) => p.product_id === productId);
  const prdName = prd ? prd.name || productId : productId;
  const degree = prd ? prd.degree || "" : "";
  const sizeNum = prd ? parseFloat(String(prd.bottle_size_l)) : NaN;
  const bottleSize = isNaN(sizeNum) ? "" : sizeNum.toFixed(3);
  const liquorType = prd ? prd.liquor_type || "" : "";
  const liquorKind = prd ? prd.liquor_kind || "" : "";
  const prdDesc = prdName + (degree ? " " + degree + "%" : "") + (bottleSize ? " " + bottleSize + "L" : "");

  let bfBalance = 0, monthIn = 0, monthOut = 0, yearIn = 0, yearOut = 0;
  const daily: Record<number, { in: number; out: number; ref: string[] }> = {};
  for (let i = 1; i <= 31; i++) daily[i] = { in: 0, out: 0, ref: [] };

  for (const row of logProduct) {
    if (row.product_id !== productId) continue;
    const r = ymd(row.doc_date);
    if (!r) continue;
    const qty = num(row.amount);
    const type = row.trans_type;
    const note = String(row.note || "");
    if (before(r, targetYear, targetMonth)) bfBalance += type === "รับ" ? qty : -qty;
    if (upto(r, targetYear, targetMonth)) { if (type === "รับ") yearIn += qty; else yearOut += qty; }
    if (inMonth(r, targetYear, targetMonth)) {
      const day = r.d;
      if (type === "รับ") { monthIn += qty; daily[day].in += qty; }
      else { monthOut += qty; daily[day].out += qty; const m = note.match(/(ORD\d{6}-\d{3})/); if (m) daily[day].ref.push(m[1]); }
    }
  }

  const grid = [];
  let bal = bfBalance;
  for (let i = 1; i <= dim; i++) {
    const dIn = daily[i].in, dOut = daily[i].out;
    bal = bal + dIn - dOut;
    grid.push({
      day: i, date: fmtDateDMY(i, monthStr),
      desc: dIn > 0 || dOut > 0 ? prdDesc : "",
      ref: daily[i].ref.length ? [...new Set(daily[i].ref)].join(", ") : "",
      inv: dIn > 0 ? dIn : null, outv: dOut > 0 ? dOut : null, bal,
    });
  }

  return {
    company: entity.company, exciseId: entity.exciseId,
    monthThai: getThaiMonthYear(monthStr), productName: prdName, degree,
    bottleSize, unit: "ขวด", liquorType, liquorKind,
    bfBalance, monthIn, monthOut, yearIn, yearOut, grid,
  };
}

// ── P5: ภส.๐๗-๐๒/๑(๑) บัญชีผลิตสุรา (getProductionReportData) ──────────────────────
export function productionReport(
  monthStr: string,
  productId: string,
  entity: Entity,
  products: ProductMaster[],
  fermLog: LogFerment[],
  distLog: LogDistill[],
  diluLog: LogDilute[],
  packLog: LogProduct[],
) {
  const { year: targetYear, month: targetMonth } = parseMonth(monthStr);
  const dim = daysIn(targetYear, targetMonth);

  const targetProduct = products.find((p) => String(p.product_id) === String(productId));
  let productName = "", targetProductIds: string[] = [], degree: number | string = "", liquorType = "";
  if (targetProduct) {
    productName = targetProduct.name;
    targetProductIds = [String(productId)];
    degree = targetProduct.degree || "";
    liquorType = targetProduct.liquor_type || "";
  } else {
    productName = productId;
    targetProductIds = products.filter((p) => p.name === productName).map((p) => String(p.product_id));
    const anyP = products.find((p) => p.name === productName);
    if (anyP) { degree = anyP.degree || ""; liquorType = anyP.liquor_type || ""; }
  }

  let bfSaa = 0, bfDistill = 0, bfDilute = 0;
  let monthFermSaa = 0, monthDistSaa = 0, monthDiluStart = 0, monthPackVol = 0;
  let yearFermSaa = 0, yearDistSaa = 0, yearDiluStart = 0, yearPackVol = 0;

  type Daily = {
    fermBatch: string[]; fermQty: number; fermSaa: number;
    distBatch: string[]; distFermQty: number; distFermVolAvg: number[]; distSaa: number; distVol: number; distAbv: number[];
    diluStartVol: number; diluFinalVol: number; diluNote: string[];
    packVol: number; packSize: number[]; packQty: number;
  };
  const daily: Record<number, Daily> = {};
  for (let i = 1; i <= 31; i++) daily[i] = {
    fermBatch: [], fermQty: 0, fermSaa: 0,
    distBatch: [], distFermQty: 0, distFermVolAvg: [], distSaa: 0, distVol: 0, distAbv: [],
    diluStartVol: 0, diluFinalVol: 0, diluNote: [],
    packVol: 0, packSize: [], packQty: 0,
  };

  const batchInfo: Record<string, { qty: number; volPerTank: number; totalSaa: number }> = {};
  for (const row of fermLog) {
    if (row.product_name === productName) {
      const batch = String(row.batch);
      const qty = num(row.container_qty);
      const totalSaa = parseFloat(String(row.material_amounts ?? "").split(",")[0]) || 0;
      batchInfo[batch] = { qty, volPerTank: qty > 0 ? totalSaa / qty : 0, totalSaa };
    }
  }

  for (const row of fermLog) {
    if (row.product_name !== productName) continue;
    const r = ymd(row.ferment_date); if (!r) continue;
    const batch = String(row.batch);
    const qty = num(row.container_qty);
    const totalSaa = batchInfo[batch] ? batchInfo[batch].totalSaa : 0;
    if (before(r, targetYear, targetMonth)) bfSaa += totalSaa;
    if (upto(r, targetYear, targetMonth)) yearFermSaa += totalSaa;
    if (inMonth(r, targetYear, targetMonth)) {
      const day = r.d;
      monthFermSaa += totalSaa;
      if (batch && !daily[day].fermBatch.includes(batch)) daily[day].fermBatch.push(batch);
      daily[day].fermQty += qty;
      daily[day].fermSaa += totalSaa;
    }
  }

  for (const row of distLog) {
    if (row.product_name !== productName) continue;
    const r = ymd(row.distill_date); if (!r) continue;
    const batch = String(row.batch);
    const saaUsed = batchInfo[batch] ? batchInfo[batch].totalSaa : 0;
    const distVol = num(row.vol);
    const abv = num(row.abv);
    if (before(r, targetYear, targetMonth)) { bfSaa -= saaUsed; bfDistill += distVol; }
    if (upto(r, targetYear, targetMonth)) yearDistSaa += saaUsed;
    if (inMonth(r, targetYear, targetMonth)) {
      const day = r.d;
      monthDistSaa += saaUsed;
      if (batch && !daily[day].distBatch.includes(batch)) daily[day].distBatch.push(batch);
      daily[day].distFermQty += batchInfo[batch] ? batchInfo[batch].qty : 0;
      if (batchInfo[batch]) daily[day].distFermVolAvg.push(batchInfo[batch].volPerTank);
      daily[day].distSaa += saaUsed;
      daily[day].distVol += distVol;
      if (abv > 0) daily[day].distAbv.push(abv);
    }
  }

  for (const row of diluLog) {
    if (row.product_name !== productName) continue;
    const r = ymd(row.dilute_date); if (!r) continue;
    const startVol = num(row.start_vol);
    const finalVol = num(row.final_vol);
    const finalAbv = num(row.final_abv);
    if (before(r, targetYear, targetMonth)) { bfDistill -= startVol; bfDilute += finalVol; }
    if (upto(r, targetYear, targetMonth)) yearDiluStart += startVol;
    if (inMonth(r, targetYear, targetMonth)) {
      const day = r.d;
      monthDiluStart += startVol;
      daily[day].diluStartVol += startVol;
      daily[day].diluFinalVol += finalVol;
      daily[day].diluNote.push("ปรุงปรับดีกรี " + finalAbv + " ได้ปริมาณ " + finalVol.toFixed(2) + " ลิตร");
    }
  }

  for (const row of packLog) {
    if (row.trans_type !== "รับ") continue;
    const prodId = String(row.product_id);
    if (!targetProductIds.includes(prodId)) continue;
    const r = ymd(row.doc_date); if (!r) continue;
    const product = products.find((p) => String(p.product_id) === prodId);
    if (!product) continue;
    const qty = num(row.amount);
    const size = num(product.bottle_size_l);
    const totalVol = qty * size;
    if (before(r, targetYear, targetMonth)) bfDilute -= totalVol;
    if (upto(r, targetYear, targetMonth)) yearPackVol += totalVol;
    if (inMonth(r, targetYear, targetMonth)) {
      const day = r.d;
      monthPackVol += totalVol;
      daily[day].packVol += totalVol;
      daily[day].packQty += qty;
      if (!daily[day].packSize.includes(size)) daily[day].packSize.push(size);
    }
  }

  const grid = [];
  let curSaa = bfSaa, curDist = bfDistill, curDilu = bfDilute;
  const numOrNull = (v: number) => (v && v !== 0 ? v : null);
  for (let i = 1; i <= dim; i++) {
    const dData = daily[i];
    curSaa = curSaa + dData.fermSaa - dData.distSaa;
    curDist = curDist + dData.distVol - dData.diluStartVol;
    curDilu = curDilu + dData.diluFinalVol - dData.packVol;
    const hasActivity = dData.fermBatch.length || dData.distBatch.length ||
      dData.fermQty || dData.distVol || dData.diluStartVol || dData.packVol;
    if (!hasActivity) continue;
    const avgFermVol = dData.fermQty > 0 ? dData.fermSaa / dData.fermQty : 0;
    const avgDistFermVol = dData.distFermVolAvg.length > 0 ? dData.distFermVolAvg.reduce((a, b) => a + b, 0) / dData.distFermVolAvg.length : 0;
    const avgAbv = dData.distAbv.length > 0 ? dData.distAbv.reduce((a, b) => a + b, 0) / dData.distAbv.length : 0;
    const packSizeStr = dData.packSize.length > 0 ? dData.packSize.map((s) => { const n = parseFloat(String(s)); return isNaN(n) ? "-" : n.toFixed(3); }).join(", ") : "";
    grid.push({
      day: i, date: fmtDateDMY(i, monthStr),
      fermBatch: dData.fermBatch.length ? dData.fermBatch.join(", ") : "",
      fermQty: numOrNull(dData.fermQty), avgFermVol: numOrNull(avgFermVol), fermSaa: numOrNull(dData.fermSaa),
      distBatch: dData.distBatch.length ? dData.distBatch.join(", ") : "",
      distFermQty: numOrNull(dData.distFermQty), avgDistFermVol: numOrNull(avgDistFermVol), distSaa: numOrNull(dData.distSaa),
      curSaa, avgAbv: numOrNull(avgAbv), distVol: numOrNull(dData.distVol), diluStartVol: numOrNull(dData.diluStartVol),
      curDist, packSize: packSizeStr, packQty: numOrNull(dData.packQty), packVol: numOrNull(dData.packVol),
      curDilu, note: dData.diluNote.length ? dData.diluNote.join(", ") : "",
    });
  }

  return {
    company: entity.company, exciseId: entity.exciseId,
    monthThai: getThaiMonthYear(monthStr),
    productName, liquorType, degree,
    bfSaa, bfDistill, bfDilute,
    monthFermSaa, monthDistSaa, monthDiluStart, monthPackVol,
    yearFermSaa, yearDistSaa, yearDiluStart, yearPackVol,
    endSaa: curSaa, endDist: curDist, endDilu: curDilu,
    grid,
  };
}

// ── P7: งบเดือน ภส.๐๗-๐๔/๑ (getSummaryReportData) ─────────────────────────────────
export function summaryReport(
  monthStr: string,
  entity: Entity,
  materials: MaterialMaster[],
  products: ProductMaster[],
  logMaterial: LogMaterial[],
  logProduct: LogProduct[],
) {
  const { year: targetYear, month: targetMonth } = parseMonth(monthStr);

  const matAgg: Record<string, { name: string; unit: string; bf: number; inv: number; outMain: number; outOther: number; damage: number; misc: number }> = {};
  for (const m of materials) matAgg[m.material_id] = { name: m.name, unit: m.unit || "", bf: 0, inv: 0, outMain: 0, outOther: 0, damage: 0, misc: 0 };
  const prodAgg: Record<string, { name: string; degree: number | string; size: number | string | null; type: string; kind: string; bf: number; inv: number; outLocal: number; outExport: number; damage: number; misc: number }> = {};
  for (const p of products) prodAgg[p.product_id] = { name: p.name, degree: p.degree || "", size: p.bottle_size_l, type: p.liquor_type || "", kind: p.liquor_kind || "", bf: 0, inv: 0, outLocal: 0, outExport: 0, damage: 0, misc: 0 };

  for (const row of logMaterial) {
    const id = String(row.material_id); if (!matAgg[id]) continue;
    const r = ymd(row.doc_date); if (!r) continue;
    const qty = num(row.amount);
    const type = String(row.trans_type);
    if (before(r, targetYear, targetMonth)) matAgg[id].bf += type === "รับ" ? qty : -qty;
    else if (inMonth(r, targetYear, targetMonth)) {
      if (type === "รับ") matAgg[id].inv += qty;
      else if (type === "จ่าย") matAgg[id].outMain += qty;
      else if (type === "ผลิตสินค้าอื่น") matAgg[id].outOther += qty;
      else if (type === "เสียหาย") matAgg[id].damage += qty;
      else if (type === "อื่นๆ" || type === "อื่น ๆ") matAgg[id].misc += qty;
    }
  }

  for (const row of logProduct) {
    const id = String(row.product_id); if (!prodAgg[id]) continue;
    const r = ymd(row.doc_date); if (!r) continue;
    const qty = num(row.amount);
    const type = String(row.trans_type);
    if (before(r, targetYear, targetMonth)) prodAgg[id].bf += type === "รับ" ? qty : -qty;
    else if (inMonth(r, targetYear, targetMonth)) {
      if (type === "รับ") prodAgg[id].inv += qty;
      else if (type === "จ่าย") prodAgg[id].outLocal += qty;
      else if (type === "จำหน่ายต่างประเทศ") prodAgg[id].outExport += qty;
      else if (type === "แตกหักเสียหาย" || type === "เสียหาย") prodAgg[id].damage += qty;
      else if (type === "อื่นๆ" || type === "อื่น ๆ") prodAgg[id].misc += qty;
    }
  }

  const prodActive = (p: (typeof prodAgg)[string]) => p.bf || p.inv || p.outLocal || p.outExport || p.damage || p.misc;

  const materialsOut = Object.values(matAgg).map((m) => {
    const total = m.bf + m.inv;
    const balance = total - (m.outMain + m.outOther + m.damage + m.misc);
    return { name: m.name, unit: m.unit, bf: m.bf, inv: m.inv, total, outMain: m.outMain, outOther: m.outOther, damage: m.damage, misc: m.misc, balance };
  });
  const productsOut = Object.values(prodAgg).filter(prodActive).map((p) => {
    const total = p.bf + p.inv;
    const balance = total - (p.outLocal + p.outExport + p.damage + p.misc);
    const sizeNum = parseFloat(String(p.size));
    const sizeStr = isNaN(sizeNum) ? "-" : sizeNum.toFixed(3);
    return { name: p.name, degree: p.degree, size: sizeStr, unit: "ขวด", bf: p.bf, inv: p.inv, total, outLocal: p.outLocal, outExport: p.outExport, damage: p.damage, misc: p.misc, balance };
  });

  const firstP = Object.values(prodAgg).find(prodActive);
  const liquorType = firstP ? firstP.type || "" : products[0]?.liquor_type || "";
  const liquorKind = firstP ? firstP.kind || "" : products[0]?.liquor_kind || "";

  return {
    company: entity.company, exciseId: entity.exciseId,
    monthThai: getThaiMonthYear(monthStr),
    liquorType, liquorKind, materials: materialsOut, products: productsOut,
  };
}

// ── D78: ภส.๐๗-๐๒/๑(๑) **ฉบับสุราแช่** (fermentedReport) ─────────────────────────────
//  🚨 ฟังก์ชันนี้เป็นของใหม่ทั้งก้อน **ห้ามแก้ productionReport ข้างบนแม้แต่บรรทัดเดียว**
//     golden test เดิม (reports.test.ts + __golden__/reports.json) ต้องผ่านโดยไม่แก้ไฟล์เทส
//     = หลักฐานว่าเส้นทางสุรากลั่นไม่ขยับ (เทคนิคเดียวกับ D55/D69/D70)
//
//  ต่างจากฟอร์มกลั่น: ไม่มีการกลั่น ไม่มีขั้นปรุงแยก → running balance เหลือ **2 ยอด**
//     น้ำหมักคงเหลือ = ยกมา + Σ น้ำหมักที่หมักได้ − Σ น้ำหมักของ batch ที่รินแล้ว (หักทั้งก้อน · D78 ข้อ 3)
//     สุราแช่คงเหลือ = ยกมา + Σ น้ำสุราแช่ที่รินได้ (หลังปรุง) − Σ ปริมาณที่บรรจุ
export type LogFermentDraw = {
  draw_date: string;
  product_name: string;
  batch: string;
  vol: number | string;
  abv: number | string;
  adjust_date?: string | null;
  water?: number | string | null;
  final_vol?: number | string | null;
  final_abv?: number | string | null;
  note?: string | null;
};

export function fermentedReport(
  monthStr: string,
  productId: string,
  entity: Entity,
  products: ProductMaster[],
  fermLog: LogFerment[],
  drawLog: LogFermentDraw[],
  packLog: LogProduct[],
  containers: ContainerMaster[] = [],
) {
  const { year: targetYear, month: targetMonth } = parseMonth(monthStr);
  const dim = daysIn(targetYear, targetMonth);

  // เลือกสินค้าเป้าหมายด้วยตรรกะเดียวกับ productionReport (รับได้ทั้ง product_id และชื่อสุรา)
  const targetProduct = products.find((p) => String(p.product_id) === String(productId));
  let productName = "", targetProductIds: string[] = [], degree: number | string = "", liquorType = "";
  if (targetProduct) {
    productName = targetProduct.name;
    targetProductIds = [String(productId)];
    degree = targetProduct.degree || "";
    liquorType = targetProduct.liquor_type || "";
  } else {
    productName = productId;
    targetProductIds = products.filter((p) => p.name === productName).map((p) => String(p.product_id));
    const anyP = products.find((p) => p.name === productName);
    if (anyP) { degree = anyP.degree || ""; liquorType = anyP.liquor_type || ""; }
  }

  let bfMash = 0, bfWine = 0;
  let monthFermMash = 0, monthWine = 0, monthPackVol = 0;
  let yearFermMash = 0, yearWine = 0, yearPackVol = 0;

  type Daily = {
    fermBatch: string[]; fermQty: number; fermMash: number;
    drawBatch: string[]; drawMash: number; drawVol: number; drawAbv: number[]; drawNote: string[];
    packVol: number; packSize: number[]; packQty: number;
  };
  const daily: Record<number, Daily> = {};
  for (let i = 1; i <= 31; i++) daily[i] = {
    fermBatch: [], fermQty: 0, fermMash: 0,
    drawBatch: [], drawMash: 0, drawVol: 0, drawAbv: [], drawNote: [],
    packVol: 0, packSize: [], packQty: 0,
  };

  // ★ ค่าแรกของ material_amounts = วัตถุดิบหลัก = ปริมาณน้ำหมัก (ล.) — ตรรกะเดิมเป๊ะ (P4)
  //   FermentTab เติมค่าแถวแรกให้เป็น ปริมาณต่อถัง(ล.) × จำนวนถัง อยู่แล้ว
  const batchInfo: Record<string, { qty: number; volPerTank: number; totalSaa: number }> = {};
  for (const row of fermLog) {
    if (row.product_name === productName) {
      const batch = String(row.batch);
      const qty = num(row.container_qty);
      const totalSaa = parseFloat(String(row.material_amounts ?? "").split(",")[0]) || 0;
      batchInfo[batch] = { qty, volPerTank: qty > 0 ? totalSaa / qty : 0, totalSaa };
    }
  }

  for (const row of fermLog) {
    if (row.product_name !== productName) continue;
    const r = ymd(row.ferment_date); if (!r) continue;
    const batch = String(row.batch);
    const qty = num(row.container_qty);
    const totalSaa = batchInfo[batch] ? batchInfo[batch].totalSaa : 0;
    if (before(r, targetYear, targetMonth)) bfMash += totalSaa;
    if (upto(r, targetYear, targetMonth)) yearFermMash += totalSaa;
    if (inMonth(r, targetYear, targetMonth)) {
      const day = r.d;
      monthFermMash += totalSaa;
      if (batch && !daily[day].fermBatch.includes(batch)) daily[day].fermBatch.push(batch);
      daily[day].fermQty += qty;
      daily[day].fermMash += totalSaa;
    }
  }

  for (const row of drawLog) {
    if (row.product_name !== productName) continue;
    const r = ymd(row.draw_date); if (!r) continue;
    const batch = String(row.batch);
    const mashUsed = batchInfo[batch] ? batchInfo[batch].totalSaa : 0;
    const wine = drawnVol(row);   // 🔴 ยอดหลังปรุง — จุดเดียวที่ตัดสิน (ดู calc.drawnVol)
    const abv = drawnAbv(row);
    if (before(r, targetYear, targetMonth)) { bfMash -= mashUsed; bfWine += wine; }
    if (upto(r, targetYear, targetMonth)) yearWine += wine;
    if (inMonth(r, targetYear, targetMonth)) {
      const day = r.d;
      monthWine += wine;
      if (batch && !daily[day].drawBatch.includes(batch)) daily[day].drawBatch.push(batch);
      daily[day].drawMash += mashUsed;
      daily[day].drawVol += wine;
      if (abv > 0) daily[day].drawAbv.push(abv);
      // หมายเหตุอัตโนมัติเมื่อมีการปรุง — รูปแบบเดียวกับ diluNote ของฟอร์มกลั่น
      //   ★ ข้อความสั้นโดยตั้งใจ: ช่องหมายเหตุกว้าง 64 จุด — ยาวกว่านี้ตัวอักษรจะล้นออกนอกกระดาษ
      //     (ตัวเติมฟอร์มมีตัวคุมความกว้างอีกชั้นให้ note ที่ผู้ใช้พิมพ์เองด้วย — cols.note.maxW)
      const rawVol = num(row.vol);
      if (wine !== rawVol || num(row.water) > 0) {
        const adj = String(row.adjust_date ?? "").slice(0, 10);
        const when = adj && adj !== String(row.draw_date).slice(0, 10) ? " " + fmtIsoDMY(adj) : "";
        daily[day].drawNote.push("ปรุง" + when + " " + abv + "° ได้ " + wine.toFixed(2) + " ล.");
      }
      if (row.note) daily[day].drawNote.push(String(row.note));
    }
  }

  for (const row of packLog) {
    if (row.trans_type !== "รับ") continue;
    const prodId = String(row.product_id);
    if (!targetProductIds.includes(prodId)) continue;
    const r = ymd(row.doc_date); if (!r) continue;
    const product = products.find((p) => String(p.product_id) === prodId);
    if (!product) continue;
    const qty = num(row.amount);
    const size = num(product.bottle_size_l);
    const totalVol = qty * size;
    if (before(r, targetYear, targetMonth)) bfWine -= totalVol;
    if (upto(r, targetYear, targetMonth)) yearPackVol += totalVol;
    if (inMonth(r, targetYear, targetMonth)) {
      const day = r.d;
      monthPackVol += totalVol;
      daily[day].packVol += totalVol;
      daily[day].packQty += qty;
      if (!daily[day].packSize.includes(size)) daily[day].packSize.push(size);
    }
  }

  const grid = [];
  let curMash = bfMash, curWine = bfWine;
  const numOrNull = (v: number) => (v && v !== 0 ? v : null);
  for (let i = 1; i <= dim; i++) {
    const d = daily[i];
    curMash = curMash + d.fermMash - d.drawMash;
    curWine = curWine + d.drawVol - d.packVol;
    const hasActivity = d.fermBatch.length || d.drawBatch.length || d.fermQty || d.drawVol || d.packVol;
    if (!hasActivity) continue;
    const avgFermVol = d.fermQty > 0 ? d.fermMash / d.fermQty : 0;
    const avgAbv = d.drawAbv.length > 0 ? d.drawAbv.reduce((a, b) => a + b, 0) / d.drawAbv.length : 0;
    const packSizeStr = d.packSize.length > 0
      ? d.packSize.map((s) => { const n = parseFloat(String(s)); return isNaN(n) ? "-" : n.toFixed(3); }).join(", ")
      : "";
    grid.push({
      day: i, date: fmtDateDMY(i, monthStr),
      fermBatch: d.fermBatch.length ? d.fermBatch.join(", ") : "",
      fermQty: numOrNull(d.fermQty), avgFermVol: numOrNull(avgFermVol), fermMash: numOrNull(d.fermMash),
      drawBatch: d.drawBatch.length ? d.drawBatch.join(", ") : "",
      avgAbv: numOrNull(avgAbv), drawVol: numOrNull(d.drawVol),
      curMash,
      packSize: packSizeStr, packQty: numOrNull(d.packQty), packVol: numOrNull(d.packVol),
      curWine,
      note: d.drawNote.length ? d.drawNote.join(", ") : "",
    });
  }

  // ช่องท้ายกระดาษ: "ปริมาณสุทธิของภาชนะสำหรับบรรจุน้ำหมัก หน่วยมีขนาดบรรจุ ___ ลิตร"
  // = ความจุของภาชนะที่ใช้หมักสุราตัวนี้ (ไม่มีข้อมูล → เว้นว่างไว้ให้เขียนมือ ห้ามเดา)
  const capMap = new Map(containers.map((c) => [String(c.container_id), num(c.capacity_l)]));
  const caps: number[] = [];
  for (const row of fermLog) {
    if (row.product_name !== productName || !row.container_id) continue;
    const cap = capMap.get(String(row.container_id));
    if (cap && !caps.includes(cap)) caps.push(cap);
  }
  const containerSize = caps.length ? caps.sort((a, b) => a - b).map((c) => String(c)).join(", ") : "";

  return {
    company: entity.company, exciseId: entity.exciseId,
    monthThai: getThaiMonthYear(monthStr),
    productName, liquorType, degree, containerSize,
    bfMash, bfWine,
    monthFermMash, monthWine, monthPackVol,
    yearFermMash, yearWine, yearPackVol,
    endMash: curMash, endWine: curWine,
    grid,
  };
}
