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
import { entryCalc, priceFromInput, round2, num, missingInvoiceWarn, type VatMode } from "../accounting/calc";
import { buildItemInputs, type BillItem, type SaveTxInput, type TxItemInput } from "../accounting/itemInputs";
import { isForwardCat } from "../accounting/forwardCats";

/** ประเภทบิลที่ connector บันทึกได้ (รอบแรก) — แบ่งงวด/สำรองจ่าย/โอน ทำในแอปเหมือนเดิม */
export const CONNECTOR_TYPES = ["รายจ่าย", "รายรับ"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

/** ยอมให้ต่างจากยอดบนบิลได้เท่านี้ (บาท) — เศษปัดของผู้ขายบางเจ้า */
export const TOTAL_TOLERANCE = 0.01;

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

export type CheckResult = {
  /** ด่านที่ไม่ผ่าน — มีแม้ตัวเดียว = ห้ามบันทึก */
  errors: string[];
  /** ผ่านได้ แต่ Claude ต้องบอกผู้ใช้ในแชทก่อนกดอนุญาต */
  warnings: string[];
  computed: Computed | null;
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

  if (errors.length) return { errors, warnings, computed: null, payload: null };

  // ── คิดยอดด้วยสูตรเดิม ──────────────────────────────────────────────────────
  // ★ กิจการไม่จด VAT + ราคารวม VAT: ฟอร์มตกกลับโหมด ex (effectiveVatMode) ⇒ ยอด = ราคาที่พิมพ์ ×
  //   จำนวน ตรงกับเงินที่จ่ายจริง (ต้นทุนรวม VAT) — ส่ง "ex" ให้ entryCalc ตามนั้น
  const mode: VatMode = hasVat ? d.price_mode : "ex";
  const billItems = toBillItems(d, mode);
  const c = entryCalc({
    items: billItems.map((it) => ({ quantity: num(it.quantity), exVat: it.exVat, inVat: it.inVat, discBaht: it.discBaht })),
    discount: num(d.bill_discount),
    hasVat,
    hasWht: whtRate > 0,
    whtRate,
    vatMode: mode,
  });
  const gross = round2(c.amountAfterDiscount + c.vatAmount);
  const computed: Computed = {
    base_amount: c.baseAmount,
    amount_after_discount: c.amountAfterDiscount,
    vat_amount: c.vatAmount,
    wht_rate: c.whtRate,
    wht_amount: c.whtAmount,
    net_amount: c.netAmount,
    gross_total: gross,
  };

  const diff = round2(gross - num(d.total_on_bill));
  if (Math.abs(diff) > TOTAL_TOLERANCE) {
    // hasVat ตัวที่มีผลจริง — กิจการไม่จด VAT ไม่มีโหมดให้สลับ คำแนะนำเรื่อง price_mode จะผิด
    errors.push(totalMismatchText(gross, num(d.total_on_bill), hasVat, d.price_mode));
  }
  if (!(gross > 0)) errors.push("ยอดรวมบิลเป็น 0 — ตรวจราคาและจำนวนอีกครั้ง");

  const vatWarn = missingInvoiceWarn(d.type, hasVat, d.tax_invoice_no);
  if (vatWarn) warnings.push(vatWarn);

  if (errors.length) return { errors, warnings, computed, payload: null };

  const p: SaveTxInput = {
    transaction_date: d.transaction_date,
    type: d.type,
    account_name: d.unpaid ? "" : account,
    category: d.category.trim(),
    contact_name: String(d.contact_name ?? "").trim(),
    contact_id: d.contact_id || undefined,
    description: String(d.description ?? "").trim(),
    base_amount: c.baseAmount,
    discount: num(d.bill_discount),
    amount_after_discount: c.amountAfterDiscount,
    vat_amount: c.vatAmount,
    wht_rate: c.whtRate,
    wht_amount: c.whtAmount,
    net_amount: c.netAmount,
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
  return { errors, warnings, computed, payload: { p, items: buildItemInputs(billItems, mode, c.baseAmount) } };
}

/**
 * ยอดไม่ตรงบิล — บอกตัวเลขทั้งสองฝั่ง + เดาสาเหตุที่พบบ่อย (ไม่แก้ให้เอง)
 * 🪤 ต่าง 7% พอดี = เกือบทุกครั้งคือเลือก price_mode ผิด
 */
export function totalMismatchText(computed: number, onBill: number, hasVat: boolean, mode: VatMode): string {
  const head = `ยอดที่คิดได้ ${baht(computed)} ไม่ตรงกับยอดรวมบนบิล ${baht(onBill)} (ต่าง ${baht(round2(computed - onBill))})`;
  const ratio = onBill > 0 ? computed / onBill : 0;
  if (hasVat && Math.abs(ratio - 1.07) < 0.002) {
    return `${head} — มากกว่าบิล 7% พอดี: ราคาบนบิลน่าจะรวม VAT แล้ว ลองส่ง price_mode = "in"`;
  }
  if (hasVat && Math.abs(ratio - 1 / 1.07) < 0.002) {
    return `${head} — น้อยกว่าบิล 7% พอดี: ราคาบนบิลน่าจะยังไม่รวม VAT ลองส่ง price_mode = "ex"${mode === "ex" ? " หรือเช็คว่าติ๊ก has_vat แล้ว" : ""}`;
  }
  return `${head} — อ่านรายการ จำนวน ราคา หรือส่วนลดใหม่อีกครั้ง ห้ามปรับตัวเลขให้ยอดตรงเอง`;
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
