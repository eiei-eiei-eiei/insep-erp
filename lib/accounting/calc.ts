/**
 * lib/accounting/calc — สูตรบัญชี/ภาษี ที่ห้ามพลาด (MIGRATION_PLAN sec 6.2)
 * port byte-compatible จากโค้ดเดิม — ห้ามแก้สูตร มี golden test (calc.test.ts)
 *
 * A1  taxReport      ภพ.30 (Reports.js generateTaxReportHTML)
 * A2  guard          ข้ามแถว ap_ar_status != null + status 'ยกเลิก' (cash basis)
 *                    — ยกเว้น ภพ.30 ตั้งแต่ D123 (ดู A23)
 * A23 ภาษีตามใบกำกับ  ภพ.30 นับบิลค้างที่มีเลขใบกำกับแล้ว · ยอดเงิน/ภงด.3/53 ของบิลที่เคลียแล้ว
 *                    ใช้วันที่เคลีย (settled_on) — D123
 * A3  entryCalc      VAT/WHT ฝั่งกรอกฟอร์ม (_js_entry.html calculateSummary)
 * A4  itemTotal      ส่วนลด item (Phase A) — total = qty×exVat − ส่วนลดบาท
 * A10 whtReport      ภงด.3/53 (Reports.js generateWHTReportHTML)
 * A11 dashboardData  Dashboard + WHT pending (Reports.js getDashboardAndWhtData)
 * A13 เช็คราคา        type 'เช็คราคา' ไม่ใช่รายรับ/รายจ่าย → ทุกรายงานกรองทิ้งด้วย type อยู่แล้ว
 * A24 ไม่กรองบัญชี     รายงานภาษี/แดชบอร์ดตัดสินจากกิจการ + เอกสาร ไม่ถามว่าเงินเข้า/ออกบัญชีไหน
 *                    · บิลซื้อมี VAT ไม่มีเลขใบกำกับ ยังนับแต่ต้องลิสต์ให้เห็น — D124
 * A21 vatMode        โหมดกรอกราคา "รวม VAT" (D98) — ค่าปริยาย "ex" = เส้นทางเดิมทุกตัวอักษร
 */

import { vatFromGross } from "../shared/vat";

// ── helpers ────────────────────────────────────────────────────────────────
/** parse ตัวเลข (รองรับ string มีคอมม่า) — เหมือน num() เดิม */
export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** ปัด 2 ตำแหน่ง แบบ fmt2 เดิม (Math.round(x*100)/100) */
export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * แสดงวันที่แบบ พ.ศ. 2 หลัก จาก 'yyyy-MM-dd'
 * ภพ.30 ใช้ sep='.', ภงด. ใช้ sep='/' — ทั้งคู่ปี พ.ศ. 2 หลักท้าย
 */
export function formatDateBE(iso: string | null | undefined, sep = "."): string {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  const yy = ((parseInt(m[1], 10) + 543) % 100).toString().padStart(2, "0");
  return `${m[3]}${sep}${m[2]}${sep}${yy}`;
}

/** timestamp สำหรับเรียงลำดับจาก 'yyyy-MM-dd' (UTC midnight — เสถียร) */
function sortTsOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(String(iso).substring(0, 10) + "T00:00:00Z");
  return Number.isNaN(t) ? 0 : t;
}

/** yyyy-MM จากวันที่ 'yyyy-MM-dd' */
function monthOf(iso: string | null | undefined): string {
  return String(iso ?? "").substring(0, 7);
}

/**
 * แยกนิติบุคคล/บุคคลธรรมดา จากชื่อคู่ค้า (Reports.js generateWHTReportHTML)
 * match = นิติบุคคล (ภงด.53) · ไม่ match = บุคคลธรรมดา (ภงด.3)
 */
export function isCorporate(name: string | null | undefined): boolean {
  return /บริษัท|บจก|ห้างหุ้นส่วน|หจก|บมจ|จำกัด/i.test(String(name ?? ""));
}

/** entity scope (Entities.js inEntityScope_) — '' / 'ALL' = ทุกกิจการ */
function inScope(rowEntity: string | null | undefined, scope: string): boolean {
  if (!scope || scope === "ALL") return true;
  return String(rowEntity ?? "").trim() === scope;
}

// ── A4: ส่วนลด item + ยอดรวมรายการ ───────────────────────────────────────────
/** ส่วนลดบาทจากเปอร์เซ็นต์ (recalcDesktopRow) — round2(qty×exVat×pct/100) */
export function itemDiscBahtFromPct(qty: number, exVat: number, pct: number): number {
  return round2(num(qty) * num(exVat) * num(pct) / 100);
}

/** ยอดรวมรายการ (ก่อน VAT หลังหักส่วนลด item) = round2(qty×exVat − ส่วนลดบาท) */
export function itemTotal(qty: number, exVat: number, discBaht: number): number {
  return round2(num(qty) * num(exVat) - num(discBaht));
}

/** ราคา ex-vat จาก in-vat และกลับกัน (handleInVat/ExVatChange) */
export function exVatFromInVat(inVat: number): number {
  const v = num(inVat);
  return v > 0 ? round2(v / 1.07) : 0;
}
export function inVatFromExVat(exVat: number): number {
  const v = num(exVat);
  return v > 0 ? round2(v * 1.07) : 0;
}

// ── A21: โหมดกรอกราคา "รวม VAT" (D98) ──────────────────────────────────────
/**
 * ผู้ใช้พิมพ์ราคาลงช่องไหน — "ex" = ไม่รวม VAT (เดิม) · "in" = รวม VAT มาแล้ว
 *
 * 🚨 ทำไมต้องแยกเป็นโหมด แทนที่จะ "ปรับปรุง" สูตรถอด VAT เดิมให้แม่นขึ้นเฉย ๆ:
 * ของเดิมถอด VAT **ต่อหน่วยแล้วปัด 2 ตำแหน่ง ก่อนคูณจำนวน** ⇒ 16 ชิ้น × 75 (รวม VAT)
 * ได้ฐาน 1,121.44 + VAT 78.50 = **1,199.94** แต่เงินที่จ่ายผู้ขายจริงคือ 1,200.00
 * (เศษที่ปัดทิ้งต่อหน่วย 0.0034579 × 16 หายไป) — บิลซื้อไม่ตรงใบกำกับของผู้ขาย
 *
 * ★ หลัก: **ฐานภาษีคือเงินทั้งก้อนที่จ่าย/รับจริง × 100/107** (ม.79) ราคา/หน่วยที่
 *   ถอดออกมาเป็นเพียงค่าที่แสดง ไม่ใช่ฐาน ⇒ **ห้ามปัดก่อนคูณ** ให้ปัดครั้งเดียวที่
 *   ยอดซึ่งปรากฏบนเอกสาร (หลักเดียวกับ ภพ.30 ที่คิด VAT จากยอดรวม ไม่ sum รายแถว)
 *
 * 🚨 แต่เส้นทางเดิม **ถูกอยู่แล้ว** สำหรับบิลที่ตั้งราคาแบบไม่รวม VAT (ฝั่งขายของเราเอง):
 *   ฐานคือ qty×ราคา แล้วบวก 7% — ไม่มีอะไรให้ถอด · แก้ทับ = พังของที่ถูกอยู่
 *   ⇒ แยกโหมด ค่าปริยาย "ex" ⇒ **golden A3/A4 เดิมผ่านโดยไม่แก้ไฟล์เทส**
 */
export type VatMode = "ex" | "in";

export const VAT_MODE_LABEL: Record<VatMode, string> = {
  ex: "ไม่รวม VAT",
  in: "รวม VAT",
};

/**
 * โหมดที่ **มีผลจริง** ต่อการคิดเงิน
 *
 * 🚨 ไม่ติ๊ก "มี VAT" = ไม่มีอะไรให้ถอด → ตกกลับเส้นทางเดิมเสมอ ⇒ กิจการไม่จด VAT
 * และบิลที่ไม่มีภาษี ได้ยอดเท่าเดิมทุกบาท ไม่ขยับเพราะงานนี้
 * 🪤 คนที่กรอกช่องรวม VAT แล้วลืมติ๊ก ต้องได้ข้อความบอก ไม่ใช่เงียบ — vatModeWarn()
 */
export function effectiveVatMode(mode: VatMode | undefined, hasVat: boolean): VatMode {
  return mode === "in" && hasVat ? "in" : "ex";
}

/**
 * ราคา/หน่วย ที่เป็นฐานของ "ยอดรวมบรรทัด" และ "ส่วนลด %" ตามโหมด
 * ⇒ itemTotal() / itemDiscBahtFromPct() ใช้ตัวเดิมได้ทั้งสองโหมด (A4 ไม่ถูกแตะ)
 * 🪤 โหมด "in" ผลของ itemTotal คือยอด **รวม VAT** ของบรรทัดนั้น ไม่ใช่ฐานภาษี
 */
export function unitPriceOf(mode: VatMode, exVat: number, inVat: number | undefined): number {
  return mode === "in" ? num(inVat) : num(exVat);
}

/**
 * A21 (D113) — ช่องราคาช่องเดียว: ตัวเลขที่ผู้ใช้พิมพ์ → ราคาทั้งสองคอลัมน์
 *
 * หน้าจอเหลือช่องกรอกราคาช่องเดียว ปุ่มโหมดบอกว่าตัวเลขนั้น "รวม" หรือ "ไม่รวม" VAT
 * แต่ state/DB ยังเก็บครบทั้ง ex_vat และ in_vat เหมือนเดิม (แท็บประวัติราคา/เช็คราคาอ่านทั้งคู่)
 * ⇒ ช่องที่ผู้ใช้ไม่ได้พิมพ์ถูกเติมด้วยสูตรเดิม inVatFromExVat / exVatFromInVat ทุกตัวอักษร
 * 🚨 entryCalc() อ่านแค่คอลัมน์ของโหมดที่มีผล (unitPriceOf) — ค่าที่เติมให้อีกช่องเป็นแค่ค่าแสดง
 *    ไม่เคยเข้าสูตรยอดบิล ⇒ ยอดเท่ากับตอนที่มี 2 ช่องแล้วพิมพ์ช่องเดียวกันเป๊ะ
 */
export function priceFromInput(mode: VatMode, value: number): { exVat: number; inVat: number } {
  const v = num(value);
  return mode === "in"
    ? { inVat: v, exVat: exVatFromInVat(v) }
    : { exVat: v, inVat: inVatFromExVat(v) };
}

/**
 * A21 (D113) — สลับปุ่มโหมดแล้ว **ตัวเลขในช่องคงเดิม เปลี่ยนแค่ความหมาย** (ผู้ใช้เลือก)
 * เช่น พิมพ์ 75 ไว้ในโหมดไม่รวม VAT แล้วกด "รวม VAT" ⇒ 75 กลายเป็นราคารวม VAT
 * 🪤 ไม่ใช่การแปลงค่า (75 → 70.09) — ปุ่มคือการบอกว่าเลขที่พิมพ์ไปแล้ว "คืออะไร"
 */
export function reinterpretPrice(
  from: VatMode,
  to: VatMode,
  exVat: number,
  inVat: number | undefined,
): { exVat: number; inVat: number } {
  if (from === to) return { exVat: num(exVat), inVat: num(inVat) };
  return priceFromInput(to, unitPriceOf(from, exVat, inVat));
}

/** A21 (D113) — หัวช่องราคาช่องเดียว (บอกความหมายของตัวเลขตามปุ่มที่เลือก) */
export function unitPriceHeader(mode: VatMode): string {
  return mode === "in" ? "ราคา/หน่วย (รวม VAT)" : "ราคา/หน่วย (ไม่รวม VAT)";
}

// ── A3: สรุปยอดบิล (calculateSummary source='items') ─────────────────────────
export type EntryItem = {
  quantity: number;
  exVat: number;
  discBaht: number;
  /** ราคา/หน่วย รวม VAT — อ่านเฉพาะ vatMode "in" (A21) · โหมดเดิมไม่แตะช่องนี้เลย */
  inVat?: number;
};
export type EntryCalcInput = {
  items: EntryItem[];
  discount: number; // ส่วนลดระดับบิล
  hasVat: boolean;
  hasWht: boolean;
  whtRate: number;
  /** A21 — ผู้ใช้กรอกราคาในช่องไหน · ไม่ส่ง = "ex" (เส้นทางเดิม) */
  vatMode?: VatMode;
};
export type EntryCalcResult = {
  baseAmount: number;
  amountAfterDiscount: number;
  vatAmount: number;
  whtRate: number;
  whtAmount: number;
  netAmount: number;
};

/**
 * A3 — คำนวณยอดบิลจากรายการสินค้า (โหมด 'items' อัตโนมัติ)
 *
 * โหมด "ex" (เดิม · ค่าปริยาย):
 *   base = Σ item-total (แต่ละ item ปัด 2 ตำแหน่งแล้ว) → aad = base − ส่วนลดบิล
 *   vat = aad×7% (ถ้ามี) · wht = aad×rate% (ถ้ามี) · net = aad + vat − wht
 *
 * โหมด "in" (A21 · D98) — ราคาที่กรอกรวม VAT มาแล้ว:
 *   gross = Σ (qty×ราคารวมVAT − ส่วนลดบรรทัด) → grossAfter = gross − ส่วนลดบิล
 *   {base, vat} = vatFromGross(grossAfter) — **ลบเอา** ⇒ base+vat = grossAfter เป๊ะ
 *   wht = base×rate% (WHT คิดบนยอดก่อน VAT เสมอ) · net = grossAfter − wht
 *   🪤 โหมดนี้ ส่วนลดทั้งระดับบรรทัดและระดับบิลเป็น "บาทรวม VAT" (ตามใบของผู้ขาย)
 */
export function entryCalc(input: EntryCalcInput): EntryCalcResult {
  const mode = effectiveVatMode(input.vatMode, input.hasVat);
  const sub = round2(
    input.items.reduce(
      (s, it) => s + itemTotal(it.quantity, unitPriceOf(mode, it.exVat, it.inVat), it.discBaht),
      0,
    ),
  );
  const subAfter = round2(sub - num(input.discount));
  // 🚨 ถอด VAT ที่ยอดรวม **ครั้งเดียว** ไม่ใช่ต่อหน่วย — เหตุผลอยู่ที่ VatMode ข้างบน
  const base = mode === "in" ? vatFromGross(sub).base : sub;
  const split = mode === "in" ? vatFromGross(subAfter) : null;
  const aad = split ? split.base : subAfter;
  const vat = split ? split.vat : input.hasVat ? round2(aad * 0.07) : 0;
  const rate = input.hasWht ? num(input.whtRate) : 0;
  const wht = input.hasWht ? round2(aad * (rate / 100)) : 0;
  const net = round2(aad + vat - wht);
  return {
    baseAmount: base,
    amountAfterDiscount: aad,
    vatAmount: vat,
    whtRate: rate,
    whtAmount: wht,
    netAmount: net,
  };
}

/**
 * A21 — แบ่ง "ยอดก่อน VAT" ของบิลลงแต่ละบรรทัด (โหมด "in")
 * เพื่อเก็บลง transaction_items.total_price ซึ่งการ์ด "ดู" และแท็บประวัติราคาเอาไปแสดง
 *
 * 🚨 ผลรวมต้องเท่ากับ base ของบิล **เป๊ะ** — ไม่งั้นผู้ใช้บวกคอลัมน์รายการแล้วได้ไม่ตรง
 *    กับยอดก่อน VAT ในบิลใบเดียวกัน (ตระกูล D81/D88: เลข 2 ตัวที่ควรตรงกันแล้วไม่ตรง
 *    ผู้ใช้จะสรุปว่าข้อมูลเพี้ยน)
 * ★ เศษปัดตกที่บรรทัดยอดใหญ่ที่สุด — คลาดเป็นสัดส่วนน้อยที่สุด
 */
export function allocateExTotals(lineGross: number[], base: number): number[] {
  const out = lineGross.map((g) => vatFromGross(num(g)).base);
  if (out.length === 0) return out;
  const diff = round2(num(base) - round2(out.reduce((a, b) => a + b, 0)));
  if (diff === 0) return out;
  let k = 0;
  for (let i = 1; i < lineGross.length; i++) if (num(lineGross[i]) > num(lineGross[k])) k = i;
  out[k] = round2(out[k] + diff);
  return out;
}

/**
 * A21 — บิลเก่าถูกกรอกด้วยโหมดไหน (ใช้ตอนเปิดหน้าแก้บิล)
 *
 * 🚨 นี่ไม่ใช่การเดา — เป็นการถามว่า "โหมดไหนคำนวณแล้วได้ยอดที่บันทึกไว้จริง"
 * ⇒ ไม่ต้องเพิ่มคอลัมน์/ไม่ต้อง migration ลง DB ทั้ง fleet เพื่อเก็บธงตัวเดียว
 * 🪤 เข้าทั้งคู่ (บิลที่ไม่มีเศษ เช่น 2×100) หรือไม่เข้าเลย → "ex" เสมอ
 *    ค่าปริยายต้องเป็นพฤติกรรมเดิม · ไม่เข้าเลย = หน้าแก้บิลเปิดโหมดแก้ยอดเองอยู่แล้ว
 */
export function detectVatMode(
  input: Omit<EntryCalcInput, "vatMode">,
  stored: { amountAfterDiscount: number; vatAmount: number; whtAmount: number },
): VatMode {
  const hit = (m: VatMode) => {
    const c = entryCalc({ ...input, vatMode: m });
    return Math.abs(c.amountAfterDiscount - num(stored.amountAfterDiscount)) <= 0.005
      && Math.abs(c.vatAmount - num(stored.vatAmount)) <= 0.005
      && Math.abs(c.whtAmount - num(stored.whtAmount)) <= 0.005;
  };
  if (hit("ex")) return "ex";
  return hit("in") ? "in" : "ex";
}

/**
 * A21 — เตือนเมื่อกรอกช่อง "รวม VAT" แต่ยังไม่ได้ติ๊กว่าบิลมี VAT
 * 🚨 ระบบจะคิดแบบไม่รวม VAT ให้ (effectiveVatMode) ซึ่งได้ยอดคนละตัว —
 *    ทุกครั้งที่ระบบไม่ทำตามที่ผู้ใช้น่าจะคาด ต้องบอกว่าทำไม (D92) · ไม่บล็อก
 * ★ คืน "" = ไม่มีอะไรต้องเตือน (หน้าจอไม่ render อะไรเลย)
 */
export function vatModeWarn(mode: VatMode | undefined, hasVat: boolean): string {
  if (mode !== "in" || hasVat) return "";
  return "เลือกว่าราคาที่กรอกเป็น รวม VAT แต่ยังไม่ได้ติ๊ก \"มี VAT 7%\" — ตอนนี้ระบบคิดยอดแบบไม่รวม VAT ให้ก่อน ถ้าบิลนี้มีภาษีให้ติ๊กช่อง มี VAT 7% ที่การ์ดสรุปยอด";
}

/** A21 — หัวคอลัมน์ "รวม" ของตารางรายการ (ความหมายต่างกันตามโหมด ต้องบอกให้ชัด) */
export function lineTotalHeader(mode: VatMode): string {
  return mode === "in" ? "รวม (รวม VAT)" : "รวม (ก่อน VAT)";
}

/**
 * A21 — คำกำกับใต้ตารางรายการ
 * 🚨 ตัดสินที่นี่ (มีเทสคุม) ห้ามแต่งประโยคในคอมโพเนนต์ — บทเรียน D84/D88/D91:
 *    ตรรกะถูกแต่ประโยคผิด อันตรายพอกัน เพราะผู้ใช้ทำตามประโยค
 */
export function itemsHintText(mode: VatMode): string {
  const head = mode === "in"
    ? "ราคาที่กรอกเป็นราคารวม VAT · ส่วนลด % ↔ บาท คิดจากราคารวม VAT × จำนวน · ยอดบิลถอด VAT ออกจากยอดรวมครั้งเดียว (ไม่ถอดต่อหน่วย)"
    : "ราคาที่กรอกเป็นราคาไม่รวม VAT · ส่วนลด % ↔ บาท คิดจากราคาไม่รวม VAT × จำนวน · ยอดบิล = ผลรวมรายการ แล้วบวก VAT 7%";
  return head + " · สลับปุ่มด้านบน = ตัวเลขที่กรอกไว้คงเดิม เปลี่ยนแค่ความหมาย";
}
/**
 * A3 (reverse) — ถอดยอดจากยอดสุทธิ + อัตรา WHT (applyReverseCalc)
 * base = round2(net / (1 − rate/100)) · wht = round2(base − net)
 */
export function reverseWht(net: number, rate: number): { base: number; wht: number } {
  const n = num(net);
  const r = num(rate);
  if (n <= 0 || r <= 0) return { base: 0, wht: 0 };
  const base = round2(n / (1 - r / 100));
  const wht = round2(base - n);
  return { base, wht };
}

// ── A6: แบ่งจ่ายงวด (Installments.js saveTransactionInstallments) ─────────────
export type InstallmentInput = { percent: number; dueDate: string };
export type InstallmentRow = {
  installmentNo: number;
  installmentTotal: number;
  base: number;
  vatAmount: number;
  whtRate: number;
  whtAmount: number;
  netAmount: number;
  dueDate: string;
};

/**
 * A6 — แบ่งยอด totalBase เป็น N งวดตามเปอร์เซ็นต์
 * base งวด i = round2(total × pct) · งวดสุดท้ายซับ remainder (ผลรวม = total เป๊ะ)
 * vat = hasVat ? round2(base×7%) : 0 · wht = round2(base×rate%) · net = base+vat−wht
 * @param startNo/totalNo ใช้ต่อเลขงวดตอนแก้เฉพาะงวดค้าง (mode B) — default 1..N
 */
export function splitInstallments(
  totalBase: number,
  installments: InstallmentInput[],
  hasVat: boolean,
  whtRate: number,
  opts?: { startNo?: number; totalNo?: number; normalize?: boolean },
): InstallmentRow[] {
  const total = num(totalBase);
  const rate = num(whtRate);
  const N = installments.length;
  const startNo = opts?.startNo ?? 1;
  const totalNo = opts?.totalNo ?? N;
  // mode B: normalize เปอร์เซ็นต์ด้วยผลรวมจริง (แบ่งยอดคงเหลือ)
  const sumPct = installments.reduce((s, x) => s + num(x.percent), 0);
  const denom = opts?.normalize ? sumPct : 100;

  const rows: InstallmentRow[] = [];
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const w = num(installments[i].percent) / denom;
    const base = i < N - 1 ? round2(total * w) : round2(total - acc);
    acc += base;
    const vat = hasVat ? round2(base * 0.07) : 0;
    const wht = round2((base * rate) / 100);
    const net = round2(base + vat - wht);
    rows.push({
      installmentNo: startNo + i,
      installmentTotal: totalNo,
      base,
      vatAmount: vat,
      whtRate: rate,
      whtAmount: wht,
      netAmount: net,
      dueDate: installments[i].dueDate || "",
    });
  }
  return rows;
}

// ── transaction row (ชื่อคอลัมน์ตาม DB ใหม่) ─────────────────────────────────
export type Tx = {
  tx_id: string;
  transaction_date: string | null; // yyyy-MM-dd
  type: string;
  account_name: string | null;
  category: string | null;
  contact_name: string | null;
  contact_id?: string | null; // ระบุสาขาที่แน่นอน (multi-branch) — null = fallback ชื่อ (D30)
  description?: string | null;
  amount_after_discount: number | string;
  vat_amount: number | string;
  wht_rate: number | string;
  wht_amount: number | string;
  net_amount: number | string;
  tax_invoice_no: string | null;
  tax_invoice_date: string | null; // yyyy-MM-dd
  status: string;
  entity_id: string;
  ap_ar_status: string | null;
  /** D123 — วันที่กดชำระบิลค้าง (null = ไม่เคยค้าง หรือเคลียก่อนมีคอลัมน์นี้) */
  settled_on?: string | null;
};

export type ContactInfo = { tax_id?: string | null; branch?: string | null; address?: string | null };
export type ContactMap = Record<string, ContactInfo>;

/**
 * หา ContactInfo ของ tx — ระบุด้วย contact_id ก่อน (แม่นสาขา multi-branch) แล้ว fallback ชื่อ
 * (contactMap เก็บ key ทั้ง contact_id และ name ชี้ info เดียวกัน — ดู loadContactMap)
 */
function resolveContact(tx: { contact_id?: string | null; contact_name: string | null }, map: ContactMap): ContactInfo {
  return (tx.contact_id ? map[tx.contact_id] : undefined) || map[tx.contact_name ?? ""] || {};
}

import { formatTaxId, formatBranch } from "../shared/format";

/**
 * A2 — guard cash basis: เข้ารายงานเฉพาะแถวปกติที่ไม่ใช่ AP/AR ค้าง + อยู่ในขอบเขตกิจการ
 * 🚨 A24 (D124) — **ไม่มีตัวกรองบัญชีแล้ว** (เดิม: บัญชีต้องอยู่ใน "บัญชีในระบบภาษี")
 *   ภาษีขึ้นกับกิจการ + เอกสาร ไม่ได้ขึ้นกับว่าเงินเข้า/ออกบัญชีไหน — เงินส่วนตัวแยกด้วย "กิจการ"
 *   (กิจการส่วนตัว · สำรองจ่าย D119) ไม่ใช่ด้วยรายชื่อบัญชี
 */
function passesTaxGuard(tx: Tx, entityId: string): boolean {
  return tx.status === "ปกติ" && !tx.ap_ar_status && inScope(tx.entity_id, entityId);
}

/**
 * A23 (D123) — วันที่เงินเข้า/ออกจริง: บิลค้างที่กดชำระแล้วใช้วันที่ชำระ · นอกนั้นใช้วันที่รายการ
 * ★ ใช้กับยอดเงิน/statement (ledger.ts) และ ภงด.3/53 (หัก ณ ที่จ่ายเกิดตอนจ่ายเงิน)
 * 🚨 ห้ามใช้กับ ภพ.30 — ภาษีขาย/ซื้อเกิดตามใบกำกับ ใช้วันที่รายการเสมอ (กติกาเหล็ก)
 * 🚨 อ่าน `settled_on` ไม่ใช่ `payment_date` — ช่องหลังถูกเขียนตอนออก 50ทวิ ด้วย (ดู migration 0088)
 */
export function cashDateOf(tx: { transaction_date: string | null; settled_on?: string | null }): string | null {
  return tx.settled_on || tx.transaction_date;
}

/** มีเลขใบกำกับภาษีบันทึกไว้หรือยัง */
export function hasTaxInvoice(tx: { tax_invoice_no: string | null }): boolean {
  return String(tx.tax_invoice_no ?? "").trim() !== "";
}

/**
 * A23/A24 — ด่านของ ภพ.30 เท่านั้น
 * บิลปกติ: นับทุกใบของกิจการนั้น (D124 ไม่ถามบัญชีแล้ว)
 * บิลค้าง (AP/AR): นับเมื่อ **มีเลขใบกำกับภาษีแล้ว** (D123)
 *   ★ กดชำระแล้วบิลยังเป็นแถวเดิม เดือนเดิม (fn_settle_apar ไม่แตะวันที่รายการ) ⇒ ไม่มีวันนับซ้ำ
 */
function passesVatGuard(tx: Tx, entityId: string): boolean {
  if (tx.status !== "ปกติ" || !inScope(tx.entity_id, entityId)) return false;
  if (tx.ap_ar_status) return hasTaxInvoice(tx);
  return true;
}

/** ประเภทบิลที่เป็นภาษีซื้อใน ภพ.30 */
export function isPurchaseType(type: string | null | undefined): boolean {
  return type === "รายจ่าย" || type === "บันทึกภาษี";
}

/**
 * A24 (D124) — บิลซื้อเดือนนั้นที่มี VAT แต่ยัง **ไม่ได้กรอกเลขใบกำกับ**
 * ★ ผู้ใช้ตัดสิน (ทาง ก): ยังนับเข้า ภพ.30 — ข้อมูลเก่าส่วนใหญ่มีใบกำกับจริงแต่ตอนคีย์ไม่ได้กรอกเลข
 *   ไม่นับ = ภาษีซื้อของเดือนที่ยื่นไปแล้วหายเงียบ ๆ · แต่ **ต้องลิสต์ให้เห็นทุกใบ**
 * ★ ใช้ด่านเดียวกับ ภพ.30 (passesVatGuard) ⇒ ลิสต์นี้คือบิลที่อยู่ในตัวเลขจริงพอดี ไม่ขาดไม่เกิน
 */
export function missingInvoicePurchases(period: string, entityId: string, txs: Tx[]): Tx[] {
  return txs.filter((tx) =>
    passesVatGuard(tx, entityId) && isPurchaseType(tx.type) && num(tx.vat_amount) > 0 &&
    !hasTaxInvoice(tx) && monthOf(tx.transaction_date) === period,
  );
}

/** คำเตือนตอนบันทึก/แก้บิล — คืน null เมื่อไม่มีอะไรต้องเตือน (ประโยคตัดสินใน lib · D84/D91) */
export function missingInvoiceWarn(type: string, hasVat: boolean, taxInvoiceNo: string | null | undefined): string | null {
  if (!isPurchaseType(type) || !hasVat || String(taxInvoiceNo ?? "").trim() !== "") return null;
  // 🚨 D136 — เดิมเขียนว่า "(VAT จะรวมเป็นต้นทุน)" แต่เอาติ๊กออกแล้วระบบคิดจากราคาไม่รวม VAT (D98)
  //    ⇒ VAT หายจากยอดบิล ไม่ได้ถูกบวกเข้าต้นทุน · ประโยคต้องบอกให้แก้ราคาเอง (ประโยคผิด = เงินผิด D91/0059)
  return "มี VAT แต่ยังไม่กรอกเลขใบกำกับ — บิลนี้จะนับเป็นภาษีซื้อใน ภพ.30 · ภาษีซื้อใช้ได้เฉพาะบิลที่มีใบกำกับภาษีเต็มรูปในนามกิจการ ถ้าไม่มีใบจริงให้เอาติ๊ก VAT ออก แล้วแก้ราคาเป็นยอดที่จ่ายจริงรวม VAT (ระบบไม่บวก VAT เข้าต้นทุนให้เอง)";
}

/** หัวข้อ + วิธีแก้ของลิสต์บนการ์ด ภพ.30 — null เมื่อไม่มีบิลค้างกรอก (D124) */
export function missingInvoiceListText(count: number, vatTotal: number): { title: string; howTo: string } | null {
  if (count <= 0) return null;
  return {
    title: `บิลซื้อ ${count} ใบ มี VAT แต่ยังไม่กรอกเลขใบกำกับ — ภาษีซื้อ ${vatTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท นับอยู่ใน ภพ.30 เดือนนี้แล้ว`,
    howTo: "แก้ที่ บัญชี → ค้นบิล → แก้ไข · มีใบกำกับจริง = กรอกเลขใบกำกับ · ไม่มีใบจริง = เอาติ๊ก VAT ออก แล้วแก้ราคาเป็นยอดที่จ่ายจริงรวม VAT (ภาษีซื้อจะลดลง · ระบบไม่บวก VAT เข้าต้นทุนให้เอง)",
  };
}

// ── A1: ภพ.30 ────────────────────────────────────────────────────────────────
export type TaxReportRow = {
  date: string; // dd.mm.yy (พ.ศ.)
  invoiceNo: string;
  name: string;
  taxId: string;
  isHQMark: string; // '/' ถ้า สนญ.
  branchMark: string; // เลขสาขา ถ้าไม่ใช่ สนญ.
  amount: number; // amountAfterDiscount
  vat: number; // vat_amount รายแถว (แสดงเท่านั้น)
  sortTs: number;
};
export type TaxReport = {
  period: string;
  sales: TaxReportRow[];
  purchases: TaxReportRow[];
  totalSalesAmount: number;
  totalSalesVat: number;
  totalPurchaseAmount: number;
  totalPurchaseVat: number;
  forwardedVatIn: number;
  netPayable: number;
  forwardedVatOut: number;
};

/**
 * A1 — รายงานภาษีซื้อ-ขาย (ภพ.30)
 * filter เดือนด้วย transaction_date · แสดงวันที่ด้วย tax_invoice_date (fallback transaction_date)
 * VAT รวมคำนวณรอบเดียวจากยอดรวม (ไม่ sum vat รายแถว)
 * netPayable = (tSVat − tPVat) − forwardedVatIn · ติดลบ → forwardedVatOut
 */
export function taxReport(
  period: string,
  entityId: string,
  forwardedVatIn: number,
  txs: Tx[],
  contactMap: ContactMap,
): TaxReport {
  const sales: TaxReportRow[] = [];
  const purchases: TaxReportRow[] = [];
  let tSAmt = 0;
  let tPAmt = 0;

  for (const tx of txs) {
    if (!passesVatGuard(tx, entityId)) continue;
    if (num(tx.vat_amount) <= 0) continue;
    if (monthOf(tx.transaction_date) !== period) continue;

    const displayDate = tx.tax_invoice_date || tx.transaction_date;
    const cInfo = resolveContact(tx, contactMap);
    const branchInfo = formatBranch(cInfo.branch);
    const amt = num(tx.amount_after_discount);
    const rec: TaxReportRow = {
      date: formatDateBE(displayDate, "."),
      invoiceNo: tx.tax_invoice_no || "-",
      name: tx.contact_name ?? "",
      taxId: formatTaxId(cInfo.tax_id),
      isHQMark: branchInfo.isHQ ? "/" : "",
      branchMark: branchInfo.isHQ ? "" : branchInfo.text,
      amount: amt,
      vat: num(tx.vat_amount),
      sortTs: sortTsOf(displayDate),
    };
    if (tx.type === "รายรับ") {
      sales.push(rec);
      tSAmt += amt;
    } else if (tx.type === "รายจ่าย" || tx.type === "บันทึกภาษี") {
      // 'บันทึกภาษี' = ภาษีซื้อนำเข้า/ศุลกากร → นับเป็นภาษีซื้อเหมือนรายจ่าย (D29)
      // (ไม่กระทบยอดบัญชี — ledger.txEffect คืน 0 ให้ type นี้อยู่แล้ว)
      purchases.push(rec);
      tPAmt += amt;
    }
  }

  sales.sort((a, b) => a.sortTs - b.sortTs);
  purchases.sort((a, b) => a.sortTs - b.sortTs);

  const tSVat = round2(tSAmt * 7 / 100);
  const tPVat = round2(tPAmt * 7 / 100);
  const netPayable = tSVat - tPVat - num(forwardedVatIn);
  const forwardedVatOut = netPayable < 0 ? Math.abs(netPayable) : 0;

  return {
    period,
    sales,
    purchases,
    totalSalesAmount: tSAmt,
    totalSalesVat: tSVat,
    totalPurchaseAmount: tPAmt,
    totalPurchaseVat: tPVat,
    forwardedVatIn: num(forwardedVatIn),
    netPayable,
    forwardedVatOut,
  };
}

/**
 * getPreviousVAT — ภาษีซื้อยกมา = forwarded_vat_out ของแถวล่าสุด เดือนก่อนหน้า (ต่อกิจการ)
 * รับ tax_summaries ทั้งหมด (คัดเดือน/กิจการ + เอาแถว created_at ล่าสุด)
 */
export type TaxSummaryRow = {
  report_month: string;
  forwarded_vat_out: number | string | null;
  entity_id: string | null;
  created_at: string;
};
export function previousVat(
  period: string,
  entityId: string,
  summaries: TaxSummaryRow[],
): number {
  const [y, m] = period.split("-").map((x) => parseInt(x, 10));
  let year = y;
  let month = m - 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  const prev = `${year}-${String(month).padStart(2, "0")}`;
  const scope = entityId || "EID01";
  const matched = summaries
    .filter(
      (s) =>
        String(s.report_month).replace(/^'/, "").trim() === prev &&
        (String(s.entity_id ?? "").trim() || "EID01") === scope,
    )
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const last = matched[matched.length - 1];
  return last ? num(last.forwarded_vat_out) : 0;
}

// ── A10: ภงด.3/53 ────────────────────────────────────────────────────────────
export type WhtReportRow = {
  date: string; // dd/mm/yy (พ.ศ.)
  taxId: string;
  contactName: string;
  category: string;
  whtRate: number;
  amountPaid: number;
  whtAmount: number;
  address: string;
};
export type WhtReport = {
  pnd3: WhtReportRow[];
  pnd53: WhtReportRow[];
  pnd3TotalPaid: number;
  pnd3TotalWht: number;
  pnd53TotalPaid: number;
  pnd53TotalWht: number;
};

/**
 * A10 — รายละเอียดหักภาษี ณ ที่จ่าย (ภงด.3 บุคคล / ภงด.53 นิติบุคคล)
 * เฉพาะ type='รายจ่าย' && wht_amount>0 + guard เดิม · filter เดือนด้วย transaction_date
 */
export function whtReport(
  period: string,
  entityId: string,
  txs: Tx[],
  contactMap: ContactMap,
): WhtReport {
  const pnd3: WhtReportRow[] = [];
  const pnd53: WhtReportRow[] = [];

  for (const tx of txs) {
    if (!passesTaxGuard(tx, entityId)) continue;
    if (tx.type !== "รายจ่าย") continue;
    if (num(tx.wht_amount) <= 0) continue;
    // D123 — หัก ณ ที่จ่ายเกิดตอนจ่ายเงิน: บิลค้างที่เคลียแล้วเข้าเดือนที่จ่ายจริง
    const payDate = cashDateOf(tx);
    if (monthOf(payDate) !== period) continue;

    const cInfo = resolveContact(tx, contactMap);
    const rec: WhtReportRow = {
      date: formatDateBE(payDate, "/"),
      taxId: formatTaxId(cInfo.tax_id),
      contactName: tx.contact_name ?? "",
      category: tx.category ?? "",
      whtRate: num(tx.wht_rate),
      amountPaid: num(tx.amount_after_discount),
      whtAmount: num(tx.wht_amount),
      address: cInfo.address ?? "",
    };
    if (isCorporate(tx.contact_name)) pnd53.push(rec);
    else pnd3.push(rec);
  }

  const sum = (rows: WhtReportRow[], k: "amountPaid" | "whtAmount") =>
    rows.reduce((s, r) => s + r[k], 0);

  return {
    pnd3,
    pnd53,
    pnd3TotalPaid: sum(pnd3, "amountPaid"),
    pnd3TotalWht: sum(pnd3, "whtAmount"),
    pnd53TotalPaid: sum(pnd53, "amountPaid"),
    pnd53TotalWht: sum(pnd53, "whtAmount"),
  };
}

// ── A11: Dashboard + WHT pending ─────────────────────────────────────────────
export type DashPending = {
  transactionId: string;
  displayDate: string; // dd/mm/yy (พ.ศ.)
  transactionDateISO: string; // yyyy-MM-dd (วันออกหนังสือ 50ทวิ)
  contactName: string;
  contactId: string; // สาขาที่แน่นอน (multi-branch D30) — "" = ข้อมูลเก่า fallback ชื่อ
  category: string;
  amount: number;
  whtAmount: number;
  whtRate: number;
};
export type DashboardData = {
  dash: { income: number; expense: number; netIncome: number; netExpense: number; vatOut: number; vatIn: number };
  whtPending: DashPending[];
};

/**
 * A11 — Dashboard สรุปรายเดือน + WHT ค้างออก 50ทวิ
 * ⚠️ filter เดือนด้วย tax_invoice_date ก่อน (fallback transaction_date) — ต่างจาก ภพ.30 (จงใจ)
 * pending WHT = รายจ่ายมี wht ที่ tx_id ยังไม่อยู่ใน issuedTxIds (จาก wht_certificates.tx_ids)
 */
export function dashboardData(
  period: string,
  entityId: string,
  txs: Tx[],
  issuedTxIds: Set<string>,
): DashboardData {
  let income = 0;
  let expense = 0;
  let netIncome = 0;
  let netExpense = 0;
  let vatOut = 0;
  let vatIn = 0;
  const whtPending: DashPending[] = [];

  for (const tx of txs) {
    if (!passesTaxGuard(tx, entityId)) continue;
    const filterDate = tx.tax_invoice_date || tx.transaction_date;
    if (!filterDate) continue;
    // D123 — 50ทวิ ค้างออกของบิลค้างที่เคลียแล้ว อยู่เดือนที่จ่ายจริง · ยอดแดชบอร์ดคงเดิม (filterDate)
    const pendDate = tx.settled_on || filterDate;
    const inDash = monthOf(filterDate) === period;
    const inPend = monthOf(pendDate) === period;
    if (!inDash && !inPend) continue;

    const amount = num(tx.amount_after_discount);
    const net = num(tx.net_amount);
    const vat = num(tx.vat_amount);
    const whtAmount = num(tx.wht_amount);

    if (tx.type === "รายรับ") {
      if (!inDash) continue;
      income += amount;
      netIncome += net;
      vatOut += vat;
    } else if (tx.type === "รายจ่าย") {
      if (inDash) {
        expense += amount;
        netExpense += net;
        vatIn += vat;
      }
      if (inPend && whtAmount > 0 && !issuedTxIds.has(tx.tx_id)) {
        whtPending.push({
          transactionId: tx.tx_id,
          displayDate: formatDateBE(pendDate, "/"),
          // ★ ค่าตั้งต้นของ "วันที่จ่าย" บนฟอร์ม 50ทวิ — บิลที่เคลียแล้วใช้วันที่จ่ายจริง
          transactionDateISO: String(tx.settled_on || tx.transaction_date || "").substring(0, 10),
          contactName: tx.contact_name ?? "",
          contactId: tx.contact_id ?? "",
          category: tx.category ?? "",
          amount,
          whtAmount,
          whtRate: num(tx.wht_rate),
        });
      }
    }
  }

  return { dash: { income, expense, netIncome, netExpense, vatOut, vatIn }, whtPending };
}
