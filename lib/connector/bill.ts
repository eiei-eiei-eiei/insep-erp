/**
 * lib/connector/bill — Claude อ่านรูปบิล → ตรวจ + คิดยอด → payload ของ fn_save_transaction (D141)
 *
 * 🚨 ไม่มีสูตรเงินในไฟล์นี้ — ยอดทุกตัวมาจาก `entryCalc()` และรายการจาก `buildItemInputs()`
 *    ตัวเดียวกับฟอร์มบันทึกบิล ⇒ golden A3/A4/A21 คุมอยู่แล้ว (กติกาเหล็กข้อ 1)
 * 🚨 Claude อ่านผิดได้ ⇒ ด่านตรวจต้องอยู่ฝั่ง server ที่นี่ ไม่ใช่ฝากไว้ใน prompt
 *    ด่านหลัก: **ยอดที่คิดได้ต้องเท่ายอดรวมที่พิมพ์บนบิล** (Claude ส่งมาแยกกันจากการอ่านคนละจุด)
 *    อ่านราคาต่อหน่วยหรือจำนวนผิดตัวเดียว ยอดจะไม่ตรง ⇒ ไม่ยอมบันทึก
 * ★ ฟอร์มบนจอมีคำเตือนบางตัวที่ทำงานฝั่งหน้าจอ (D98/D124) — connector ไม่มีจอ จึงคืนเป็น warnings
 *   ให้ Claude พูดในแชท · ประโยคยังมาจากฟังก์ชันตัวเดิมใน lib/accounting/calc
 * ★ ประโยคทุกตัวตัดสินที่นี่ (มีเทสคุม) ไม่ใช่ในตัว route (D84/D91)
 */
import { entryCalc, priceFromInput, round2, num, missingInvoiceWarn, type VatMode, type EntryCalcResult } from "../accounting/calc";
import { buildItemInputs, type BillItem, type SaveTxInput, type TxItemInput } from "../accounting/itemInputs";
import { isForwardCat } from "../accounting/forwardCats";

/** ประเภทบิลที่ connector บันทึกได้ (รอบแรก) — แบ่งงวด/สำรองจ่าย/โอน ทำในแอปเหมือนเดิม */
export const CONNECTOR_TYPES = ["รายจ่าย", "รายรับ"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

/** ยอมให้ต่างจากยอดบนบิลได้เท่านี้ (บาท) — เศษปัดของผู้ขายบางเจ้า */
export const TOTAL_TOLERANCE = 0.01;

/**
 * เพดาน "ใช้ยอดตามบิล" (บาท · ผู้ใช้ตัดสิน D141) — อ่านรายการถูกหมดแต่ผู้ขายคิดเลขคนละวิธี
 * (ปัด VAT ทีละบรรทัด · ปัดยอดรวมเป็นบาทเต็ม) ⇒ ต่างไม่เกินนี้ให้บันทึกด้วยตัวเลขที่พิมพ์บนบิลได้
 * 🚨 เกินนี้ = ไม่ใช่เรื่องปัดเศษ ต้องอ่านใหม่ (ห้ามมีทางลัด)
 */
export const ROUNDING_CAP = 1;

export type DraftItem = {
  name: string;
  quantity: number;
  /** ราคาต่อหน่วยตามที่พิมพ์บนบิล — ความหมายตาม `price_mode` ของทั้งบิล */
  unit_price: number;
  /** ส่วนลดของบรรทัดนี้ (บาท · หน่วยเดียวกับ unit_price) */
  discount_baht?: number;
  category?: string;
  job?: string;
};

export type BillDraft = {
  entity_id: string;
  type: ConnectorType;
  /** YYYY-MM-DD (ค.ศ.) */
  transaction_date: string;
  category: string;
  description?: string;
  contact_name?: string;
  contact_id?: string;
  /** บัญชีเงินที่จ่าย/รับ · ว่างได้เมื่อตั้งค้าง หรือเป็นรายรับ (กติกาเดียวกับฟอร์ม) */
  account_name?: string;
  /** ราคาบนบิล "รวม VAT แล้ว" หรือ "ยังไม่รวม" — โหมดเป็นของบิล ไม่ใช่ของแถว (D98) */
  price_mode: VatMode;
  has_vat: boolean;
  /** ส่วนลดท้ายบิล (บาท · หน่วยเดียวกับราคา) */
  bill_discount?: number;
  /** % หัก ณ ที่จ่าย · 0/ไม่ส่ง = ไม่หัก */
  wht_rate?: number;
  tax_invoice_no?: string;
  tax_invoice_date?: string;
  /** ตั้งค้างจ่าย/ค้างรับ (AP/AR) แทนจ่ายสด */
  unpaid?: boolean;
  due_date?: string;
  items: DraftItem[];
  /** ยอดก่อน VAT ที่พิมพ์บนบิล (ถ้ามี) — ใช้ตอน use_bill_amounts */
  bill_before_vat?: number;
  /** VAT ที่พิมพ์บนบิล (ถ้ามี) — ใช้ตอน use_bill_amounts */
  bill_vat?: number;
  /**
   * บันทึกด้วยยอดก่อน VAT + VAT ตามที่พิมพ์บนบิล แทนยอดที่ระบบคิด (กลไกเดียวกับ "โหมดแก้ยอดเอง" ของฟอร์ม)
   * ★ ภาษีซื้อที่ขอคืนได้คือตัวเลขบนใบกำกับภาษี — ปัดคนละแบบแล้วใช้ยอดของระบบ ภพ.30 จะไม่ตรงเอกสาร
   * 🚨 ใช้ได้เฉพาะต่างไม่เกิน ROUNDING_CAP และลองสลับ price_mode แล้วไม่ตรง
   */
  use_bill_amounts?: boolean;
  /**
   * 🚨 ยอดรวมที่พิมพ์บนบิล (รวม VAT · ก่อนหัก ณ ที่จ่าย) — อ่านแยกจากรายการ
   * ใช้เทียบกับยอดที่คิดได้ ไม่เคยถูกเอาไปบันทึก
   */
  total_on_bill: number;
};

/** บริบทของกิจการที่ server อ่านจาก DB มาให้ (ด้วยสิทธิ์ของผู้ใช้ที่ล็อกอิน) */
export type BillContext = {
  entities: { entity_id: string; name: string; is_vat: boolean }[];
  /** ชื่อบัญชีเงินที่ใช้กับกิจการนี้ได้ (accountsFor + ยังเปิดใช้) */
  accounts: string[];
  forwardCats: readonly string[];
  /** หมวดที่เลือกได้ต่อประเภท (ชุดเดียวกับดร็อปดาวน์ในฟอร์ม: expense_cat + หมวดรับวัตถุดิบ · income_cat) */
  categories: Record<ConnectorType, readonly string[]>;
  /** วันนี้ (Asia/Bangkok) YYYY-MM-DD */
  today: string;
};

export type Computed = {
  base_amount: number;
  amount_after_discount: number;
  vat_amount: number;
  wht_rate: number;
  wht_amount: number;
  net_amount: number;
  /** ยอดรวมบิล (หลังส่วนลด + VAT · ก่อน WHT) = ตัวที่เทียบกับ total_on_bill */
  gross_total: number;
};

/** ยอดไม่ตรงบิล — ข้อมูลให้การ์ดตัดสินว่าจะเสนออะไร (3 ขั้น · D141) */
export type Mismatch = {
  computed: number;
  onBill: number;
  /** ยอดที่คิดได้ − ยอดบนบิล */
  diff: number;
  /** ขั้น 1: สลับโหมดราคาแล้วตรงบิลพอดี (null = ไม่ตรงทั้งสองแบบ) */
  altPriceMode: VatMode | null;
  /** ขั้น 2: ต่างไม่เกิน ROUNDING_CAP และสลับโหมดไม่ช่วย ⇒ เสนอ "ใช้ยอดตามบิล" */
  canUseBillAmounts: boolean;
  /** ขั้น 3: แถว (เริ่ม 0) ที่ส่วนต่างเท่ากับผลของแถวนั้นหลายหน่วยพอดี ⇒ น่าจะอ่านจำนวนผิด */
  suspectLines: number[];
};

export type CheckResult = {
  /** ด่านที่ไม่ผ่าน — มีแม้ตัวเดียว = ห้ามบันทึก */
  errors: string[];
  /** ผ่านได้ แต่ Claude ต้องบอกผู้ใช้ในแชทก่อนกดอนุญาต */
  warnings: string[];
  computed: Computed | null;
  /** ยอดไม่ตรงบิล (null = ตรง หรือยังคิดไม่ได้) */
  mismatch: Mismatch | null;
  /** บันทึกด้วยยอดตามบิล (ขั้น 2) */
  usedBillAmounts: boolean;
  /** พร้อมส่ง fn_save_transaction (null เมื่อมี error) */
  payload: { p: SaveTxInput; items: TxItemInput[] } | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (s: string | undefined) => {
  if (!s || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const baht = (n: number) => num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * เลขประจำตัวผู้เสียภาษี 13 หลัก — ตรวจหลักสุดท้าย (checksum มาตรฐานของกรมสรรพากร/บัตรประชาชน)
 * หลัก 1-12 คูณ 13,12,…,2 รวมกัน → (11 − ผลรวม mod 11) mod 10 ต้องเท่าหลักที่ 13
 * ★ ใช้จับ "Claude อ่านเลขผิดหลัก" ซึ่งเป็นความผิดพลาดที่พบบ่อยที่สุดของการอ่านรูป
 */
export function taxIdValid(raw: string | null | undefined): boolean {
  const d = String(raw ?? "").replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(d[12]);
}

/** ตัดขีด/ช่องว่างออกจากเลขภาษี (เก็บในระบบเป็นตัวเลขล้วน) */
export const normalizeTaxId = (raw: string | null | undefined) => String(raw ?? "").replace(/[\s-]/g, "");

/** รายการจากบิล → แถวแบบเดียวกับที่ฟอร์มส่ง (ราคาอีกช่องเติมด้วยสูตรเดิม priceFromInput) */
function toBillItems(d: BillDraft, mode: VatMode): BillItem[] {
  return d.items.map((it) => {
    const p = priceFromInput(mode, num(it.unit_price));
    const qty = num(it.quantity);
    const gross = qty * num(mode === "in" ? p.inVat : p.exVat);
    const disc = num(it.discount_baht);
    return {
      itemName: String(it.name ?? "").trim(),
      itemCategory: String(it.category ?? "").trim(),
      itemJob: String(it.job ?? "").trim(),
      quantity: qty,
      exVat: p.exVat,
      inVat: p.inVat,
      discPct: gross > 0 ? round2((disc / gross) * 100) : 0,
      discBaht: disc,
    };
  });
}

/**
 * ตรวจ + คิดยอด — ใช้ทั้ง `preview_bill` (ดูก่อน) และ `save_bill` (บันทึกจริง)
 * 🚨 save_bill ต้องเรียกตัวนี้ซ้ำเอง ห้ามเชื่อผลจาก preview รอบก่อน (Claude อาจแก้ค่าระหว่างทาง)
 */
export function checkBill(d: BillDraft, ctx: BillContext): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const ent = ctx.entities.find((e) => e.entity_id === d.entity_id);
  if (!ent) errors.push(`ไม่พบกิจการ ${d.entity_id || "(ว่าง)"} — ใช้รหัสกิจการจาก who_am_i`);
  if (!(CONNECTOR_TYPES as readonly string[]).includes(d.type)) {
    errors.push(`ประเภทบิล "${d.type}" บันทึกผ่าน Claude ไม่ได้ — รองรับแค่ ${CONNECTOR_TYPES.join(" / ")} (แบ่งงวด · สำรองจ่าย · โอน ให้ทำในแอป)`);
  }
  if (!isIsoDate(d.transaction_date)) errors.push("วันที่รายการต้องเป็น ค.ศ. รูปแบบ YYYY-MM-DD (บิลไทยมักพิมพ์ พ.ศ. ให้ลบ 543)");
  else if (d.transaction_date > ctx.today) warnings.push(`วันที่รายการ ${d.transaction_date} เป็นวันในอนาคต — ตรวจว่าแปลง พ.ศ. → ค.ศ. ถูกไหม`);
  if (d.tax_invoice_date && !isIsoDate(d.tax_invoice_date)) errors.push("วันที่ใบกำกับต้องเป็น ค.ศ. รูปแบบ YYYY-MM-DD");
  if (d.unpaid && d.due_date && !isIsoDate(d.due_date)) errors.push("วันครบกำหนดต้องเป็น ค.ศ. รูปแบบ YYYY-MM-DD");

  const cat = String(d.category ?? "").trim();
  if (!cat) errors.push("ต้องระบุหมวดหมู่ — เลือกจาก lookup_options");
  // ฟอร์มเป็นดร็อปดาวน์ — หมวดที่ไม่มีในผังบัญชีลงจากหน้าจอไม่ได้ ที่นี่ก็ต้องไม่ได้ (ไม่งั้นรายงานแยกหมวดมีหมวดงอกเอง)
  else if (ctx.categories[d.type] && !ctx.categories[d.type].includes(cat)) {
    errors.push(`ไม่มีหมวด "${cat}" ใน${d.type}ของกิจการนี้ — ใช้ชื่อจาก lookup_options ให้ตรงทุกตัวอักษร (เพิ่มหมวดใหม่ได้ที่แอป บัญชี → ตั้งค่า)`);
  }
  // กติกาเดียวกับฟอร์ม (EntryTab validate): จ่ายสดต้องมีบัญชี · รายรับเว้นได้
  const account = String(d.account_name ?? "").trim();
  if (!d.unpaid && !account && d.type !== "รายรับ") errors.push("ต้องระบุบัญชีเงินที่จ่าย หรือส่ง unpaid = true เพื่อตั้งค้างจ่าย");
  if (account && !ctx.accounts.includes(account)) {
    errors.push(`ไม่พบบัญชีเงิน "${account}" ในกิจการนี้ — ใช้ชื่อจาก lookup_options ให้ตรงทุกตัวอักษร`);
  }

  const items = Array.isArray(d.items) ? d.items : [];
  if (items.length === 0) errors.push("ต้องมีรายการอย่างน้อย 1 รายการ");
  items.forEach((it, i) => {
    const n = i + 1;
    if (!String(it.name ?? "").trim()) errors.push(`รายการที่ ${n}: ไม่มีชื่อ`);
    if (!(num(it.quantity) > 0)) errors.push(`รายการที่ ${n}: จำนวนต้องมากกว่า 0`);
    if (!(num(it.unit_price) >= 0)) errors.push(`รายการที่ ${n}: ราคาติดลบไม่ได้`);
    if (num(it.discount_baht) < 0) errors.push(`รายการที่ ${n}: ส่วนลดติดลบไม่ได้`);
  });

  const whtRate = num(d.wht_rate);
  if (whtRate < 0 || whtRate > 15) errors.push(`อัตราหัก ณ ที่จ่าย ${whtRate}% ผิดปกติ (ปกติ 1-5%)`);

  // 🚨 ด่าน ม.86/13 (D55) — DB trigger บล็อกอยู่แล้ว แต่ตอบเป็นภาษาไทยก่อนถึงตรงนั้น
  const hasVat = Boolean(d.has_vat) && (ent ? ent.is_vat : true);
  if (d.has_vat && ent && !ent.is_vat) {
    if (d.type === "รายรับ") errors.push(`กิจการ ${ent.name} ไม่ได้จด VAT — บิลรายรับมี VAT ไม่ได้`);
    else warnings.push(`กิจการ ${ent.name} ไม่ได้จด VAT — ภาษีซื้อขอคืนไม่ได้ จึงบันทึกเป็นต้นทุนเต็มจำนวนแบบไม่มี VAT · ราคาต่อหน่วยต้องเป็นราคารวม VAT (ถ้าใช้ราคาก่อน VAT ยอดจะไม่ตรงบิล และระบบไม่ยอมบันทึก)`);
  }

  if (errors.length) return { errors, warnings, computed: null, mismatch: null, usedBillAmounts: false, payload: null };

  // ── คิดยอดด้วยสูตรเดิม ──────────────────────────────────────────────────────
  // ★ กิจการไม่จด VAT + ราคารวม VAT: ฟอร์มตกกลับโหมด ex (effectiveVatMode) ⇒ ยอด = ราคาที่พิมพ์ ×
  //   จำนวน ตรงกับเงินที่จ่ายจริง (ต้นทุนรวม VAT) — ส่ง "ex" ให้ entryCalc ตามนั้น
  const mode: VatMode = hasVat ? d.price_mode : "ex";
  const billItems = toBillItems(d, mode);
  const calcFor: CalcFor = (m, items = toBillItems(d, m)) =>
    entryCalc({
      items: items.map((it) => ({ quantity: num(it.quantity), exVat: it.exVat, inVat: it.inVat, discBaht: it.discBaht })),
      discount: num(d.bill_discount),
      hasVat,
      hasWht: whtRate > 0,
      whtRate,
      vatMode: m,
    });
  const c = calcFor(mode, billItems);
  const gross = round2(c.amountAfterDiscount + c.vatAmount);
  let computed: Computed = {
    base_amount: c.baseAmount,
    amount_after_discount: c.amountAfterDiscount,
    vat_amount: c.vatAmount,
    wht_rate: c.whtRate,
    wht_amount: c.whtAmount,
    net_amount: c.netAmount,
    gross_total: gross,
  };

  const onBill = num(d.total_on_bill);
  const diff = round2(gross - onBill);
  let mismatch: Mismatch | null = null;
  let usedBillAmounts = false;
  if (Math.abs(diff) > TOTAL_TOLERANCE) {
    // ── ขั้น 1: สลับโหมดราคา (กิจการไม่จด VAT ไม่มีโหมดให้สลับ) ──
    const alt: VatMode = mode === "in" ? "ex" : "in";
    const altCalc = calcFor(alt);
    const altPriceMode = hasVat && Math.abs(round2(altCalc.amountAfterDiscount + altCalc.vatAmount) - onBill) <= TOTAL_TOLERANCE ? alt : null;
    // ── ขั้น 2: ต่างนิดเดียว = ผู้ขายปัดเศษคนละวิธี ──
    const canUseBillAmounts = !altPriceMode && Math.abs(diff) <= ROUNDING_CAP;
    // ── ขั้น 3: แถวที่ส่วนต่างเท่ากับ "ผลของ 1 หน่วย" หลายเท่าพอดี ──
    const suspectLines = canUseBillAmounts || altPriceMode ? [] : suspectLinesOf(d, mode, gross, diff, calcFor);
    mismatch = { computed: gross, onBill, diff, altPriceMode, canUseBillAmounts, suspectLines };

    if (d.use_bill_amounts && canUseBillAmounts) {
      const r = billAmounts(d, hasVat, whtRate, onBill);
      if (typeof r === "string") errors.push(r);
      else {
        usedBillAmounts = true;
        // base_amount ยังเป็นยอดจากรายการ (เหมือนโหมดแก้ยอดเองของฟอร์ม) · ตัวเลขที่เข้าบัญชี/ภาษีเป็นของบิล
        computed = { ...computed, ...r, gross_total: round2(r.amount_after_discount + r.vat_amount) };
        warnings.push(`ใช้ยอดตามบิล — ระบบคิดได้ ${baht(gross)} ต่างจากบิล ${baht(Math.abs(diff))} (ผู้ขายปัดเศษคนละวิธี)`);
      }
    } else if (d.use_bill_amounts) {
      errors.push(altPriceMode
        ? `ใช้ยอดตามบิลไม่ได้ — สลับ price_mode เป็น "${altPriceMode}" แล้วยอดตรงบิลพอดี ให้สลับแทน`
        : `ใช้ยอดตามบิลไม่ได้ — ต่าง ${baht(Math.abs(diff))} เกินเพดาน ${baht(ROUNDING_CAP)} ไม่ใช่เรื่องปัดเศษ ต้องอ่านรายการใหม่`);
    } else {
      errors.push(mismatchText(mismatch, d.items));
    }
  }
  if (!(computed.gross_total > 0)) errors.push("ยอดรวมบิลเป็น 0 — ตรวจราคาและจำนวนอีกครั้ง");

  const vatWarn = missingInvoiceWarn(d.type, hasVat, d.tax_invoice_no);
  if (vatWarn) warnings.push(vatWarn);

  if (errors.length) return { errors, warnings, computed, mismatch, usedBillAmounts, payload: null };

  const p: SaveTxInput = {
    transaction_date: d.transaction_date,
    type: d.type,
    account_name: d.unpaid ? "" : account,
    category: d.category.trim(),
    contact_name: String(d.contact_name ?? "").trim(),
    contact_id: d.contact_id || undefined,
    // ใช้ยอดตามบิล = ทิ้งร่องรอยไว้ในคำอธิบาย ให้ย้อนดูได้ว่าทำไมยอดไม่เท่าผลรวมรายการ
    description: [String(d.description ?? "").trim(), usedBillAmounts ? `(ยอดตามบิล ต่างจากคำนวณ ${baht(Math.abs(diff))})` : ""].filter(Boolean).join(" "),
    base_amount: c.baseAmount,
    discount: num(d.bill_discount),
    amount_after_discount: computed.amount_after_discount,
    vat_amount: computed.vat_amount,
    wht_rate: computed.wht_rate,
    wht_amount: computed.wht_amount,
    net_amount: computed.net_amount,
    tax_invoice_no: String(d.tax_invoice_no ?? "").trim(),
    tax_invoice_date: d.tax_invoice_date || (String(d.tax_invoice_no ?? "").trim() ? d.transaction_date : ""),
    entity_id: d.entity_id,
    ap_ar_status: d.unpaid ? (d.type === "รายรับ" ? "AR" : "AP") : "",
    due_date: d.unpaid ? d.due_date ?? "" : "",
    forward_material: d.type === "รายจ่าย" && isForwardCat(d.category, ctx.forwardCats),
    source: "claude",
  };
  if (p.forward_material) {
    warnings.push(`หมวด ${p.category} จะรับวัตถุดิบเข้าสต็อกผลิตอัตโนมัติ — ชื่อรายการต้องตรงกับวัตถุดิบในระบบผลิต`);
  }
  return { errors, warnings, computed, mismatch, usedBillAmounts, payload: { p, items: buildItemInputs(billItems, mode, c.baseAmount) } };
}

type CalcFor = (m: VatMode, items?: BillItem[]) => EntryCalcResult;

/**
 * ขั้น 3 — แถวที่น่าจะอ่านจำนวนผิด: ลดจำนวนแถวนั้นลง 1 หน่วยแล้วดูว่ายอดขยับเท่าไร (ผลของ 1 หน่วย
 * คิดด้วยสูตรเดิม รวม VAT/ส่วนลด) ถ้าส่วนต่างเท่ากับผลนั้นหลายเท่าพอดี = แถวต้องสงสัย
 * ★ ไม่แก้ให้เอง — แค่ไฮไลต์ให้คนดูกระดาษ
 */
function suspectLinesOf(d: BillDraft, mode: VatMode, gross: number, diff: number, calcFor: CalcFor): number[] {
  const out: number[] = [];
  d.items.forEach((_, i) => {
    const one = toBillItems({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, quantity: num(x.quantity) - 1 } : x)) }, mode);
    const r = calcFor(mode, one);
    const unit = round2(gross - round2(r.amountAfterDiscount + r.vatAmount));
    if (unit <= 0) return;
    const k = Math.round(Math.abs(diff) / unit);
    if (k >= 1 && Math.abs(round2(k * unit) - Math.abs(diff)) <= TOTAL_TOLERANCE) out.push(i);
  });
  return out;
}

/**
 * ขั้น 2 — ยอดตามบิล: ตรวจตัวเลขที่ Claude อ่านจากบิลแยกกัน แล้วคืนยอดที่จะบันทึก
 * 🚨 VAT ต้องใกล้ 7% ของยอดก่อน VAT (คลาดได้แค่ระดับเศษปัดทีละบรรทัด) — ไม่ใกล้ = อ่านผิด ไม่ใช่ปัดเศษ
 * ★ ภาษีคิดด้วย entryCalc ตัวเดิม (ไม่เขียน 7% เอง) · หัก ณ ที่จ่ายคิดบนยอดก่อน VAT ตามบิล
 */
function billAmounts(d: BillDraft, hasVat: boolean, whtRate: number, onBill: number):
  | Pick<Computed, "amount_after_discount" | "vat_amount" | "wht_rate" | "wht_amount" | "net_amount">
  | string {
  if (hasVat && (d.bill_before_vat == null || d.bill_vat == null)) {
    return "ใช้ยอดตามบิลต้องส่ง bill_before_vat และ bill_vat ที่พิมพ์บนบิลมาด้วย";
  }
  // ไม่มี VAT (บิลไม่มี VAT หรือกิจการไม่จด VAT) = ยอดก่อน VAT คือยอดรวมทั้งก้อน
  const before = hasVat ? num(d.bill_before_vat) : onBill;
  const vat = hasVat ? num(d.bill_vat) : 0;
  if (before <= 0 || vat < 0) return "ยอดก่อน VAT / VAT ที่อ่านจากบิลไม่ถูกต้อง";
  if (Math.abs(round2(before + vat) - onBill) > TOTAL_TOLERANCE) {
    return `ยอดก่อน VAT ${baht(before)} + VAT ${baht(vat)} = ${baht(round2(before + vat))} ไม่เท่ายอดรวมบนบิล ${baht(onBill)} — อ่านใหม่`;
  }
  const one = (amt: number) => entryCalc({ items: [{ quantity: 1, exVat: amt, discBaht: 0 }], discount: 0, hasVat, hasWht: whtRate > 0, whtRate });
  if (hasVat) {
    const expected = one(before).vatAmount;
    const tol = TOTAL_TOLERANCE * Math.max(1, d.items.length);
    if (Math.abs(round2(vat - expected)) > tol) {
      return `VAT บนบิล ${baht(vat)} ไม่ใช่ 7% ของยอดก่อน VAT ${baht(before)} (ควรประมาณ ${baht(expected)}) — น่าจะอ่านผิด ไม่ใช่เรื่องปัดเศษ`;
    }
  }
  const w = one(before);
  return { amount_after_discount: before, vat_amount: vat, wht_rate: w.whtRate, wht_amount: w.whtAmount, net_amount: round2(before + vat - w.whtAmount) };
}

/** ประโยคตอนยอดไม่ตรง — ตัดสินตาม 3 ขั้น (การ์ดใช้ mismatch ตัวเดียวกันตัดสินปุ่ม) */
export function mismatchText(m: Mismatch, items: DraftItem[]): string {
  const head = `ยอดที่คิดได้ ${baht(m.computed)} ไม่ตรงกับยอดรวมบนบิล ${baht(m.onBill)} (ต่าง ${baht(m.diff)})`;
  if (m.altPriceMode) {
    return `${head} — ถ้านับราคาเป็น${m.altPriceMode === "in" ? "รวม VAT" : "ไม่รวม VAT"} จะตรงบิลพอดี: ส่ง price_mode = "${m.altPriceMode}"`;
  }
  if (m.canUseBillAmounts) {
    return `${head} — ต่างไม่เกิน ${baht(ROUNDING_CAP)} มักเกิดจากผู้ขายปัดเศษคนละวิธี: ถ้าอ่านรายการถูกแล้ว ส่ง use_bill_amounts = true พร้อม bill_before_vat และ bill_vat ที่พิมพ์บนบิล`;
  }
  const sus = m.suspectLines.map((i) => `รายการที่ ${i + 1} (${items[i]?.name ?? ""})`).join(", ");
  return `${head} — ${sus ? `น่าจะอ่านจำนวนผิดที่ ${sus} · ` : ""}อ่านรายการ จำนวน ราคา หรือส่วนลดใหม่อีกครั้ง ห้ามปรับตัวเลขให้ยอดตรงเอง`;
}

/** สรุปบิลที่ Claude ต้องพูดในแชทก่อนขออนุญาตบันทึก (ประโยคเดียวกันทุกครั้ง) */
export function previewSummary(d: BillDraft, entityName: string, tenantName: string, c: Computed): string {
  const who = d.contact_name ? ` · ${d.type === "รายรับ" ? "ลูกค้า" : "ผู้ขาย"} ${d.contact_name}` : "";
  const pay = d.unpaid ? `ตั้งค้าง${d.type === "รายรับ" ? "รับ" : "จ่าย"}` : d.account_name ? `บัญชี ${d.account_name}` : "ไม่ระบุบัญชี";
  const lines = [
    `ลงให้ ${tenantName} · กิจการ ${d.entity_id} ${entityName}`,
    `${d.type} ${d.transaction_date} · หมวด ${d.category}${who} · ${pay}`,
    `ก่อน VAT ${baht(c.amount_after_discount)} · VAT ${baht(c.vat_amount)} · รวม ${baht(c.gross_total)}` +
      (c.wht_amount > 0 ? ` · หัก ณ ที่จ่าย ${c.wht_rate}% ${baht(c.wht_amount)} · สุทธิ ${baht(c.net_amount)}` : ""),
  ];
  return lines.join("\n");
}
