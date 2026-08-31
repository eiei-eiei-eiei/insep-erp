/**
 * lib/sales/orders — state machine ออเดอร์ B2B (S2) + wiring ถอด VAT/WHT (S1) +
 *   items บัญชี (S4) + taxDocNo (S5) — port verbatim จาก docs/legacy/sales/Orders.gs
 *   `processB2BOrderAction` (แยก money/logic บริสุทธิ์ออกมาให้ golden test เทียบได้)
 *
 * ⚠️ กติกาเหล็ก: copy เงื่อนไขทีละบรรทัด — ทุก branch, dateCol 22 vs 23, TAX no.
 *   DECISION (ผู้ใช้เลือก): แก้ bug เดิม — PAY_BALANCE/FULL_PAYMENT_LATER "ตั้ง" docToPrint
 *   (โค้ดเดิมไม่ตั้ง → ใบเสร็จยอดค้างไม่ trigger พิมพ์). ดู docs/DECISIONS.md
 *
 *   D45: +ISSUE_INVOICE_DEPOSIT (ใบแจ้งหนี้ค่ามัดจำ ก่อนได้รับเงิน) — action เดียวที่
 *   "ออกใบแจ้งหนี้แต่ยังไม่ลงบัญชี" คู่กับ ISSUE_INVOICE_FULL · เก็บเลข/วันที่/ยอด
 *   ในคอลัมน์ dep_* แยกต่างหาก (ห้ามใช้ inv_no/doc_date1 ร่วม — สองช่องนั้นเป็นของ
 *   ใบแจ้งหนี้ตอนส่งของ ถ้าทับ = ใบกำกับภาษีมัดจำได้วันที่ผิด)
 */

import { round2, reverseVatWht, toAccItem, taxDocNo, type AccItem } from "./calc";

export type OrderAction =
  | "DEPOSIT_AND_SEND"
  | "FULL_PAYMENT_AND_SEND"
  | "SEND_TO_WH"
  | "ISSUE_INVOICE_FULL"
  | "ISSUE_INVOICE_DEPOSIT"
  | "PAY_BALANCE"
  | "FULL_PAYMENT_LATER";

/** สถานะใหม่ D45 — ออกใบแจ้งหนี้มัดจำแล้ว รอลูกค้าโอน (ยังไม่มีรายการบัญชี) */
export const STATUS_AWAIT_DEPOSIT = "รอชำระมัดจำ";

/** สถานะ current ของออเดอร์ (จาก sales_orders) — camelCase */
export type OrderState = {
  quNo: string;
  orderNo: string;
  status: string;
  deposit: number;
  outstandingBalance: number;
  subTotal: number;
  discount: number;
  whtPercent: number;
  category: string;
  customerName: string;
  invNo: string;
  taxNo1: string;
  taxNo2: string;
  /** D45 — เลขใบแจ้งหนี้ค่ามัดจำ (ว่าง = ยังไม่เคยออก) */
  depInvNo?: string;
};

export type ActionPayload = {
  amount?: number;
  method?: string;
  docDate?: string; // 'yyyy-MM-dd'
  creditDays?: number;
  chequeDetails?: string;
};

/** เลขเอกสารที่ generate มาแล้ว (caller สร้างจาก next_serial เฉพาะที่ needed) */
export type GeneratedSerials = { invNo?: string; taxNo1?: string; taxNo2?: string };

/** ฟิลด์คู่ค้า (จาก contacts) สำหรับแนบ payload บัญชี */
/** contactId = สาขาที่แน่นอนของลูกค้า (multi-branch D30) — ว่าง = ข้อมูลเก่า fallback ชื่อ */
export type ContactInfo = { taxId: string; branch: string; address: string; contactId?: string };

/** config รายรับขาย (จาก app_settings) — บัญชีรับเงิน + กิจการ */
/**
 * บัญชี/กิจการที่รับรายได้ + สถานะ VAT ของกิจการที่ออกเอกสาร (4.3)
 *
 * ★ `isVat` ต้องมาจากฝั่ง server เสมอ (อ่าน `entities.is_vat`) **ห้ามรับจาก client**
 *   ไม่งั้นหน้าเว็บส่ง `isVat: true` มาเองได้ = ผู้ไม่จด VAT ออกใบกำกับภาษี (ผิดกฎหมาย ม.86/13)
 *   ค่าปริยาย `true` เพื่อให้จุดเรียก/เทสเดิมได้ผลเท่าเดิมทุกตัว
 */
export type RevenueConfig = { accountName: string; entityId: string; isVat?: boolean };

export type OrderUpdate = {
  status: string;
  deposit?: number;
  outstandingBalance?: number;
  dueDate?: string;
  paymentMethod?: string;
  invNo?: string;
  taxNo1?: string;
  taxNo2?: string;
  checkDetail1?: string;
  checkDetail2?: string;
  docToPrint?: string;
  nextStatus?: string;
  docDate1?: string;
  docDate2?: string;
  // D45 — ใบแจ้งหนี้ค่ามัดจำ (แยกจาก invNo/docDate1 ของใบแจ้งหนี้ตอนส่งของ)
  depInvNo?: string;
  depInvDate?: string;
  depInvAmount?: number;
  depDueDate?: string;
};

export type RevenuePayload = {
  idempotencyKey: string;
  accountName: string;
  entityId: string;
  category: string;
  contactName: string;
  contactId: string; // สาขาลูกค้าที่แน่นอน → transactions.contact_id (ภพ.30/ภงด. ได้สาขาถูก)
  taxId: string;
  branch: string;
  address: string;
  description: string;
  baseAmount: number;
  discount: number;
  amountAfterDiscount: number;
  vatAmount: number;
  whtRate: number;
  whtAmount: number;
  netAmount: number;
  taxInvoiceNo: string;
  taxInvoiceDate: string;
  items: AccItem[];
};

export type ProcessResult = {
  newStatus: string;
  update: OrderUpdate;
  revenue: RevenuePayload | null;
  lineMsg: string | null;
};

/**
 * วันครบกำหนดชำระ = docDate + credit days → ISO 'yyyy-MM-dd' (เก็บลงคอลัมน์ date)
 * ⚠️ เดิม (Sheets) เก็บเป็นสตริงไทย 'dd/MM/yyyy' พ.ศ. — ระบบใหม่เก็บ ISO แล้ว format ตอนแสดง
 */
export function dueDateISO(docDate: string, creditDays: number): string {
  const d = new Date(docDate);
  d.setDate(d.getDate() + (Number(creditDays) || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** format ISO date → 'dd/MM/yyyy' พ.ศ. (สำหรับแสดงผล/พิมพ์เอกสาร) */
export function formatThaiDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear() + 543}`;
}

/**
 * เลขเอกสารที่ต้อง generate ก่อนเรียก processOrder (เฉพาะช่องที่ยังว่าง — เหมือนโค้ดเดิม)
 * caller เรียก next_serial เฉพาะ true เพื่อไม่ให้ consume เลขเกินจำเป็น
 */
/**
 * เลขเอกสารที่ต้อง generate สำหรับ action นี้
 *
 * 🚨 กิจการที่ไม่จด VAT **ห้ามได้เลขใบกำกับภาษี (tax1/tax2) เด็ดขาด** —
 *    ผู้ไม่จด VAT ออกใบกำกับภาษีเป็นความผิดตามประมวลรัษฎากร ม.86/13
 *    เลข INV (ใบแจ้งหนี้/ใบส่งของ/ใบเสร็จรับเงิน) ยังออกได้ปกติ
 *    ★ ตรงนี้เป็นแค่ด่านแรก — ด่านจริงอยู่ที่ DB (migration 0036) เพราะยิงตรงผ่าน API ได้
 */
export function neededSerials(action: OrderAction, order: OrderState, isVat = true): {
  inv: boolean;
  tax1: boolean;
  tax2: boolean;
} {
  if (!isVat) {
    // ไม่จด VAT: ให้เฉพาะเลข INV ตามที่ action นั้นต้องการ · ตัด tax1/tax2 ทิ้งเสมอ
    const base = neededSerials(action, order, true);
    // 🔴 D86 — action ที่ "ออกใบเสร็จ" ของเส้นทางจด VAT กินแต่เลข TAX (inv: false)
    //    พอตัด tax ทิ้งเพราะไม่จด VAT จึงไม่ได้เลขอะไรเลยสักชุด →
    //    ใบเสร็จรับเงินไม่มีเลขที่ และ taxDocNo() คืน "-" ลง transactions.tax_invoice_no
    //    (บั๊กมาตั้งแต่ D55 · ไม่มีใครเจอเพราะกิจการของผู้ใช้จด VAT · POS ชนเต็ม ๆ)
    //    → ให้ใช้เลขชุด INV เป็นเลขใบเสร็จแทน เฉพาะตอนที่ยังไม่มีเลข INV ในใบนั้น
    // ⚠️ PAY_BALANCE ของใบที่มี invNo แล้ว ยังใช้เลขซ้ำกับใบแจ้งหนี้อยู่ —
    //    ต้องมีช่องเลขที่ 2 (schema) ถึงจะแก้จริงได้ · ไม่ใช่เส้นทางของ POS
    const issuesReceipt = action === "FULL_PAYMENT_AND_SEND" || action === "FULL_PAYMENT_LATER";
    return { inv: base.inv || (issuesReceipt && !order.invNo), tax1: false, tax2: false };
  }
  const noInv = !order.invNo;
  const noTax1 = !order.taxNo1;
  const noTax2 = !order.taxNo2;
  switch (action) {
    case "DEPOSIT_AND_SEND":
      return { inv: noInv, tax1: noTax1, tax2: false };
    case "FULL_PAYMENT_AND_SEND":
      return { inv: false, tax1: noTax1, tax2: false };
    case "SEND_TO_WH":
      return { inv: noInv, tax1: false, tax2: false };
    case "ISSUE_INVOICE_FULL":
      return { inv: noInv, tax1: false, tax2: false };
    case "ISSUE_INVOICE_DEPOSIT":
      // ใช้เลขชุด INV เดียวกัน แต่เก็บคนละช่อง (ใบแจ้งหนี้มัดจำ 1 ใบ / ออเดอร์)
      return { inv: !order.depInvNo, tax1: false, tax2: false };
    case "PAY_BALANCE":
      return { inv: false, tax1: false, tax2: noTax2 };
    case "FULL_PAYMENT_LATER":
      return { inv: false, tax1: noTax1, tax2: false };
  }
}

/**
 * ประมวลผล action → { orderUpdate, revenuePayload, lineMsg } (บริสุทธิ์ ไม่มี side effect)
 * @param order  สถานะปัจจุบันของออเดอร์ (จาก DB)
 * @param items  รายการสินค้าปัจจุบัน (สำหรับ isFirstPayment → items บัญชี S4)
 * @param gen    เลข INV/TAX ที่ generate มาแล้ว (ตาม neededSerials)
 * @param contact ข้อมูลคู่ค้า
 * @param config บัญชีรับเงิน + กิจการ (app_settings)
 */
export function processOrder(
  order: OrderState,
  action: OrderAction,
  payload: ActionPayload,
  items: { name: string; qty: number; price: number }[],
  gen: GeneratedSerials,
  contact: ContactInfo,
  config: RevenueConfig,
): ProcessResult {
  const currentStatus = order.status;
  const outstandingBalance = Number(order.outstandingBalance) || 0;
  const update: OrderUpdate = { status: currentStatus };

  // chequeDetails (S2)
  if (payload.chequeDetails) {
    if (action === "DEPOSIT_AND_SEND") update.checkDetail1 = payload.chequeDetails;
    else update.checkDetail2 = payload.chequeDetails;
  }

  let dateField: "docDate1" | "docDate2" | null = null;

  if (action === "DEPOSIT_AND_SEND") {
    update.status = "รอคลังจัดส่ง";
    update.deposit = (Number(order.deposit) || 0) + Number(payload.amount);
    update.outstandingBalance = outstandingBalance - Number(payload.amount);
    update.paymentMethod = payload.method;
    if (!order.invNo && gen.invNo) update.invNo = gen.invNo;
    if (!order.taxNo1 && gen.taxNo1) update.taxNo1 = gen.taxNo1;
    update.dueDate = dueDateISO(payload.docDate!, payload.creditDays ?? 0);
    update.docToPrint = "invoice,tax-invoice-deposit";
    update.nextStatus = "ส่งของแล้วรอชำระยอดค้าง";
    dateField = "docDate1"; // dateCol 22
  } else if (action === "FULL_PAYMENT_AND_SEND") {
    update.status = "รอคลังจัดส่ง";
    update.outstandingBalance = 0;
    update.paymentMethod = payload.method;
    if (!order.taxNo1 && gen.taxNo1) update.taxNo1 = gen.taxNo1;
    update.docToPrint = "tax-invoice-receipt-do";
    update.nextStatus = "ปิดการขาย";
    dateField = currentStatus === "รอชำระเงิน (จ่ายเต็ม)" ? "docDate2" : "docDate1"; // 23 vs 22
  } else if (action === "SEND_TO_WH") {
    update.status = "รอคลังจัดส่ง";
    if (!order.invNo && gen.invNo) update.invNo = gen.invNo;
    update.dueDate = dueDateISO(payload.docDate!, payload.creditDays ?? 0);
    update.docToPrint = "invoice";
    update.nextStatus = "ส่งของแล้วรอชำระเงิน";
    dateField = "docDate1"; // 22
  } else if (action === "ISSUE_INVOICE_FULL") {
    update.status = "รอชำระเงิน (จ่ายเต็ม)";
    if (!order.invNo && gen.invNo) update.invNo = gen.invNo;
    update.docToPrint = "invoice";
    dateField = "docDate1"; // 22
  } else if (action === "ISSUE_INVOICE_DEPOSIT") {
    // D45 — วางบิลค่ามัดจำ: ยังไม่ได้รับเงิน → ไม่มี revenue, ไม่แตะ deposit/outstanding,
    // ไม่แตะ docDate1/2 (สงวนไว้ให้ใบแจ้งหนี้ + ใบกำกับภาษีตอนรับเงินจริง)
    update.status = STATUS_AWAIT_DEPOSIT;
    if (!order.depInvNo && gen.invNo) update.depInvNo = gen.invNo;
    update.depInvAmount = round2(Number(payload.amount) || 0);
    if (payload.docDate) {
      update.depInvDate = payload.docDate;
      update.depDueDate = dueDateISO(payload.docDate, payload.creditDays ?? 0);
    }
    update.docToPrint = "invoice-deposit";
    update.nextStatus = "รอคลังจัดส่ง";
  } else if (action === "PAY_BALANCE" || action === "FULL_PAYMENT_LATER") {
    update.status = "ปิดการขาย";
    update.paymentMethod = payload.method;
    update.outstandingBalance = 0;
    if (action === "PAY_BALANCE") {
      if (!order.taxNo2 && gen.taxNo2) update.taxNo2 = gen.taxNo2;
      update.docToPrint = "tax-invoice-balance"; // DECISION: แก้ bug เดิม (เดิมไม่ตั้ง)
    } else {
      if (!order.taxNo1 && gen.taxNo1) update.taxNo1 = gen.taxNo1;
      update.docToPrint = "tax-invoice-receipt"; // DECISION: แก้ bug เดิม (เดิมไม่ตั้ง)
    }
    dateField = "docDate2"; // 23
  }

  if (dateField && payload.docDate) update[dateField] = payload.docDate;

  const newStatus = update.status;

  // ── รับเงิน → payload บัญชี (S1 + S4 + S5) ──────────────────────────────────
  let isPayment = false;
  let isFirstPayment = false;
  let accNet = 0;
  if (action === "DEPOSIT_AND_SEND") {
    isPayment = true;
    isFirstPayment = true;
    accNet = Number(payload.amount) || 0;
  } else if (action === "FULL_PAYMENT_AND_SEND" || action === "FULL_PAYMENT_LATER") {
    isPayment = true;
    isFirstPayment = true;
    accNet = outstandingBalance;
  } else if (action === "PAY_BALANCE") {
    isPayment = true;
    isFirstPayment = false;
    accNet = outstandingBalance;
  }

  let revenue: RevenuePayload | null = null;
  let lineMsg: string | null = null;

  if (isPayment && accNet >= 0) {
    const accWhtRate = Number(order.whtPercent) || 0;
    // isVat มาจาก server (entities.is_vat) — ไม่จด VAT → vat = 0 และฐานคิดจาก (1 − wht)
    const entityIsVat = config.isVat !== false;
    const { preVat: accPreVat, vat: accVat, wht: accWht } = reverseVatWht(accNet, accWhtRate, false, entityIsVat);

    let accBase = 0;
    let accDiscount = 0;
    if (action === "FULL_PAYMENT_AND_SEND" || action === "FULL_PAYMENT_LATER") {
      accBase = Number(order.subTotal) || 0;
      accDiscount = Number(order.discount) || 0;
    } else {
      accBase = accPreVat;
      accDiscount = 0;
    }

    const accItems: AccItem[] = isFirstPayment
      ? items.map((it) => toAccItem(it.name, Number(it.qty), Number(it.price), entityIsVat))
      : [];

    const docNo = taxDocNo(
      { taxNo2: update.taxNo2, taxNo1: update.taxNo1, invNo: update.invNo },
      { taxNo2: order.taxNo2, taxNo1: order.taxNo1, invNo: order.invNo },
    );

    const orderRefForKey = order.orderNo || order.quNo;
    const idempotencyKey = action === "PAY_BALANCE" ? `${orderRefForKey}-balance` : orderRefForKey;

    revenue = {
      idempotencyKey,
      accountName: config.accountName,
      entityId: config.entityId,
      category: order.category || "รายได้จากการขาย",
      contactName: order.customerName,
      contactId: contact.contactId || "",
      taxId: contact.taxId || "",
      branch: contact.branch || "สำนักงานใหญ่",
      address: contact.address || "",
      description: `อ้างอิง QU: ${order.quNo}${payload.method ? ` (${payload.method})` : ""}`,
      baseAmount: round2(accBase),
      discount: round2(accDiscount),
      amountAfterDiscount: round2(accPreVat),
      vatAmount: round2(accVat),
      whtRate: accWhtRate,
      whtAmount: round2(accWht),
      netAmount: accNet,
      taxInvoiceNo: docNo,
      taxInvoiceDate: payload.docDate || today(),
      items: accItems,
    };

    // LINE 2.2 — แจ้งรับชำระเงิน
    const actionLabel =
      action === "DEPOSIT_AND_SEND" ? "มัดจำ" : action === "PAY_BALANCE" ? "ชำระยอดค้าง" : "ชำระเต็ม";
    const amtFmt = accNet.toLocaleString("th-TH", { minimumFractionDigits: 0 });
    const orderRef = order.orderNo || order.quNo;
    const remainingBalance =
      update.outstandingBalance !== undefined ? update.outstandingBalance : outstandingBalance;
    lineMsg = `💰 รับชำระเงิน\n[${orderRef}] ${order.customerName || ""}\n${actionLabel} ฿${amtFmt}`;
    if (remainingBalance > 0) {
      lineMsg += `\nคงค้าง ฿${remainingBalance.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`;
    }
  }

  return { newStatus, update, revenue, lineMsg };
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
