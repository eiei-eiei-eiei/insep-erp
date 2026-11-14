import "server-only";
import { mapDbError } from "@/lib/shared/dbError";
import { bangkokDateISO } from "@/lib/shared/datetime";
import { actionPostsRevenue, docDateError, saleDateError, manualNoError } from "@/lib/sales/backdate";
import { quotationTotals, type CartItem } from "@/lib/sales/calc";
import { processOrder, neededSerials, type OrderAction, type ActionPayload, type GeneratedSerials } from "@/lib/sales/orders";
import { defaultRevenueCat } from "@/lib/sales/revenueCats";
import { legacyDepositError, planActionError, planError, receiveAmountError, shipNowError, type PlanRowInput } from "@/lib/sales/installments";
import { orderStateFor, customerIdFor, orderItemsFor, type SalesDb } from "@/lib/sales/orderLoaders";

/**
 * แกนของแอปขาย (D172) — สร้างใบเสนอราคา · ประมวลผล action ออเดอร์ (ขอเลขเอกสาร + ลงบัญชี) · ขายหน้าร้าน
 *
 * ★ ย้ายมาจาก `app/(app)/sales/actions.ts` **คำต่อคำ** — ต่างแค่รับ `supabase` จากผู้เรียก
 *   ⇒ หน้าเว็บ (คุกกี้) กับ Claude connector (token) ใช้เส้นทางเดียวกัน · ไม่มีสูตรเงิน/เลขเอกสารชุดที่สอง (D86)
 * 🚨 ไม่มี side effect ของหน้าเว็บในไฟล์นี้: ไม่ revalidatePath · ไม่ส่ง LINE (lib/line ใช้ service role
 *    ซึ่ง connector ห้ามแตะ) — ผู้เรียกตัดสินเองจาก `lineMsg`
 * 🚨 ไม่มี service role ในไฟล์นี้ (connectorRoute.test.ts อ่านซอร์สตรวจ)
 */

const failC = (error: string) => ({ ok: false as const, error });

/** ผลของการขายหน้าร้านที่หน้าจอ/connector ใช้ต่อ */
export type PosSaleResult = {
  quNo: string;
  orderNo: string;
  invNo: string;
  taxNo1: string;
  rcptNo1: string;
  docDate: string;
  summary: { name: string; remaining: number }[];
  warning: string;
};

// ── S8: สร้าง/แก้ ใบเสนอราคา ─────────────────────────────────────────────────
export type QuotationPayload = {
  customer: { id: string; name: string; address?: string; taxId?: string; branch?: string; creditTerm?: number };
  items: CartItem[];
  discount: number;
  isWhtRequired: boolean;
  whtPercent: number;
  isDepositRequired: boolean;
  depositPercent: number;
  saleName: string;
  category: string;
  remarks?: string;
  /**
   * D146 — แผนงวด (ว่าง/ไม่ส่ง = จ่ายครั้งเดียว) · มีแผน = ปิดเงื่อนไขมัดจำแบบเดิม (แผนงวดแทนที่)
   * ★ ใบเสนอราคาใหม่ทุกใบใช้แผนงวดแทนช่องติ๊กมัดจำ (ผู้ใช้ตัดสิน · มัดจำเดิม = แผน 2 งวด)
   */
  plan?: PlanRowInput[];
};

/** มีแผนงวด → เงื่อนไขมัดจำแบบเดิมต้องปิด (ไม่งั้นหน้าจัดการออเดอร์โชว์ปุ่มมัดจำแบบเดิมซ้อน) */
export function withPlan(input: QuotationPayload): QuotationPayload {
  return input.plan?.length ? { ...input, isDepositRequired: false, depositPercent: 0 } : input;
}
/** ตรวจแผนงวดของใบเสนอราคาก่อนบันทึก — ยังไม่มีเงินเข้า ⇒ ยอดที่ต้องแบ่ง = ยอดสุทธิทั้งใบ */
export function quotationPlanError(input: QuotationPayload, net: number, isVat: boolean): string | null {
  // D164 — งวดที่กรอกเป็นเงินคิดยอดชำระจาก VAT/หัก ณ ที่จ่ายของใบนี้
  const ctx = { isVat, whtPct: input.isWhtRequired ? Number(input.whtPercent) || 0 : 0 };
  return input.plan?.length ? planError(input.plan, net, net, false, ctx) : null;
}

export function buildQuotationDbPayload(input: QuotationPayload, isVat: boolean) {
  const t = quotationTotals(input, isVat);
  return {
    p: {
      customer_id: input.customer.id,
      customer_name: input.customer.name,
      sale_name: input.saleName,
      sub_total: t.subTotal,
      discount: t.discountEx, // เก็บส่วนลดในรูปก่อน VAT ให้บัญชี (base−discount = subDiscount)
      sub_discount: t.subDiscount,
      vat_amount: t.vatAmount,
      grand_total: t.grandTotal,
      net_payable: t.netPayable,
      wht_percent: input.isWhtRequired ? input.whtPercent : 0,
      wht_amount: t.whtAmount,
      remarks: input.remarks ?? "",
      category: input.category,
      // เงื่อนไขมัดจำ (0021) — เก็บไว้ให้กดแก้ใบเสนอราคาแล้ว prefill กลับมาครบ
      is_deposit: input.isDepositRequired,
      deposit_percent: input.isDepositRequired ? input.depositPercent : 0,
    },
    items: input.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    totals: t,
  };
}

/**
 * แกนการสร้างใบเสนอราคา — **ไม่ยิง LINE ไม่ revalidate** เพื่อให้ POS (D86) เอาไปใช้ต่อได้
 * โดยไม่ได้ข้อความแจ้งเตือน 3 ข้อความต่อการขาย 1 บิล
 */
export async function saveQuotationCore(
  supabase: SalesDb,
  input: QuotationPayload,
): Promise<
  | { ok: true; quNo: string; orderNo: string; quExpire: string; grandTotal: number; itemCount: number }
  | { ok: false; error: string }
> {
  const config = await loadRevenueConfig(supabase);
  const vat = await resolveSalesVat(supabase, config.entityId);
  if ("conflict" in vat) return { ok: false, error: vat.conflict };
  const { p, items, totals } = buildQuotationDbPayload(withPlan(input), vat.isVat);
  // D146 — แผนงวดผิดต้องรู้ก่อนสร้างใบเสนอราคา (ไม่งั้นได้ใบเสนอราคาที่ไม่มีแผนค้างไว้)
  const planErr = quotationPlanError(input, totals.netPayable, vat.isVat);
  if (planErr) return { ok: false, error: planErr };
  const { data, error } = await supabase.rpc("fn_save_quotation", { p, p_items: items });
  if (error) return { ok: false, error: mapDbError(error) };
  const res = data as { ok: boolean; qu_no: string; order_no: string; qu_expire: string };
  return {
    ok: true,
    quNo: res.qu_no,
    orderNo: res.order_no,
    quExpire: res.qu_expire,
    grandTotal: totals.grandTotal,
    itemCount: items.length,
  };
}

/**
 * สถานะ VAT ของกิจการที่ออกเอกสาร — **อ่านจาก DB ฝั่ง server เสมอ** (4.3)
 *
 * 🚨 ห้ามรับค่านี้จาก client เด็ดขาด — หน้าเว็บส่ง `isVat: true` มาเองได้
 *    = ผู้ไม่จด VAT ออกใบกำกับภาษี (ผิด ประมวลรัษฎากร ม.86/13)
 *    (ด่านสุดท้ายคือ trigger ใน 0036 แต่ไม่ควรปล่อยให้ไปตายที่นั่น — error จะอ่านไม่รู้เรื่อง)
 *
 * คืน `null` เมื่อกิจการที่ออกเอกสารกับกิจการที่รับรายได้ **มีสถานะ VAT ต่างกัน** →
 * ผู้เรียกต้องปฏิเสธ ไม่ใช่เดาข้างใดข้างหนึ่ง (จะได้ใบเสนอราคาคิด VAT แต่ลงบัญชีไม่มี VAT)
 */
export async function resolveSalesVat(
  supabase: SalesDb,
  revenueEntityId: string,
): Promise<{ isVat: boolean } | { conflict: string }> {
  const [{ data: st }, { data: ents }] = await Promise.all([
    supabase.from("app_settings").select("kind, value").in("kind", ["sales_doc_entity", "sales_revenue_entity"]),
    supabase.from("entities").select("entity_id, is_vat"),
  ]);
  const rows = ents ?? [];
  const vatOf = (id: string) => rows.find((e) => e.entity_id === id)?.is_vat;

  const docId =
    (st ?? []).find((r) => r.kind === "sales_doc_entity")?.value ||
    (st ?? []).find((r) => r.kind === "sales_revenue_entity")?.value ||
    revenueEntityId;

  const docVat = vatOf(docId);
  // ไม่พบกิจการ = ถือว่าจด VAT (พฤติกรรมเดิม) — อย่าบล็อกคนที่ยังไม่ได้ตั้งค่าให้ครบ
  const isVat = docVat !== false;

  if (revenueEntityId && revenueEntityId !== docId) {
    const revVat = vatOf(revenueEntityId);
    if (revVat !== undefined && revVat !== docVat) {
      return {
        conflict:
          `กิจการที่ออกเอกสาร (${docId}) กับกิจการที่รับรายได้ (${revenueEntityId}) ` +
          `มีสถานะ VAT ต่างกัน — ระบบไม่เดาให้ว่าจะคิด VAT หรือไม่ ` +
          `เพราะจะได้เอกสารกับบัญชีที่ตัวเลขไม่ตรงกัน · ไปแก้ที่ บัญชี → ตั้งค่า ให้ตรงกันก่อน`,
      };
    }
  }
  return { isVat };
}

export type SalesDocType = "sales_inv" | "sales_tax" | "sales_rcpt";
/**
 * ขอเลขเอกสาร 1 ใบ — รูปแบบตามที่ตั้งไว้ใน ตั้งค่า → เลขเอกสาร (D100) · เป็นเลขของ **วันที่บนเอกสาร**
 * 🚨 เดิมทิ้ง `error` → ออกเลขไม่ได้แล้วได้ `null` = เอกสารไม่มีเลขที่โดยไม่มีอะไรฟ้อง
 *    ตอนนี้ตัวออกเลขมีด่านสิทธิ์/รูปแบบที่ raise ได้จริง ต้องหยุดทั้งรายการแทน
 * ★ จุดเดียวในไฟล์ที่ขอเลข (docNumberingSql.test.ts ล็อก) — ใบแจ้งหนี้รายงวด (D145) ก็มาทางนี้
 */
export async function nextSalesDocNo(supabase: SalesDb, type: SalesDocType, docDate: string): Promise<string> {
  const { data, error } = await supabase.rpc("fn_next_doc_no", { p_type: type, p_entity: null, p_date: docDate });
  if (error || !data) throw new Error(error ? mapDbError(error) : "ออกเลขเอกสารไม่สำเร็จ");
  return data as string;
}

/** config รายรับขาย (บัญชี + กิจการ) จาก app_settings — go-live ต้องตั้งค่า */
export async function loadRevenueConfig(supabase: SalesDb) {
  const { data } = await supabase
    .from("app_settings")
    .select("kind, value")
    .in("kind", ["sales_revenue_account", "sales_revenue_entity", "sales_cash_account"]);
  const get = (k: string) => (data ?? []).find((r) => r.kind === k)?.value as string | undefined;
  return {
    accountName: get("sales_revenue_account") ?? "",
    entityId: get("sales_revenue_entity") ?? "",
    // D142 — ไม่ตั้ง = เงินสดลงบัญชีหลักเหมือนเดิม (revenueAccountFor ตัดสิน)
    cashAccountName: get("sales_cash_account") ?? "",
  };
}

// ── S2: ประมวลผล action ออเดอร์ (atomic + idempotent + LINE) ──────────────────
/**
 * แกนของ S2 — **แหล่งเดียว** ที่อ่าน config · ตรวจ VAT · ขอเลขเอกสาร · เรียก processOrder
 * แล้วยิง `fn_apply_order_action`
 *
 * 🚨 คืน `lineMsg` กลับไปให้ผู้เรียกตัดสินใจส่งเอง **ไม่ส่งในนี้** —
 *    หน้าขายหน้าร้าน (D86) ทำ 3 จังหวะรวด ถ้าแต่ละจังหวะยิง LINE เอง
 *    ลูกค้าจะได้ 3 ข้อความต่อการขาย 1 บิล
 */
export async function applyOrderActionCore(
  supabase: SalesDb,
  quNo: string,
  action: OrderAction,
  payload: ActionPayload,
): Promise<
  | { ok: true; newStatus: string; duplicate: boolean; lineMsg: string | null; invNo: string; taxNo1: string; taxNo2: string; rcptNo1: string; rcptNo2: string }
  | { ok: false; error: string }
> {
  const order = await orderStateFor(supabase, quNo);
  if (!order) return { ok: false, error: "ไม่พบออเดอร์นี้ในระบบ" };

  const config = await loadRevenueConfig(supabase);
  // ต้องมีกิจการรับรายได้ก่อน (RECEIVE_REVENUE ลง transactions ต้องมี entity_id ที่มีจริง)
  const needsRevenue = actionPostsRevenue(action); // แหล่งเดียวกับประโยคบนจอ (D100)
  if (needsRevenue && !config.entityId) {
    // 🪤 ของเดิมชี้ให้ไปเปิดไฟล์เอกสาร + บอกชื่อ kind ใน DB ทั้งที่ **ไม่มีหน้าจอให้ตั้งเลย**
    //    (D80) — ตอนนี้ตั้งได้จากในแอปแล้ว ข้อความต้องพาไปถึงที่
    return { ok: false, error: "ยังไม่ได้ตั้งกิจการที่รับรายได้จากการขาย — ไปที่ ตั้งค่า → กิจการ → การ์ด “กิจการและบัญชีที่รับรายได้จากการขาย”" };
  }

  // ── D145 — แบ่งชำระหลายงวด: ปุ่มต้องตรงกับชนิดออเดอร์ · รับตามลำดับ · ยอดงวดสุดท้ายต้องเต็ม ──
  //   (RPC ตรวจลำดับ/ยอดซ้ำอีกชั้น — ที่นี่เพื่อข้อความไทยที่ชัดก่อนขอเลขเอกสาร)
  const plan = order.installments ?? [];
  const planErr = planActionError(action, plan.length > 0);
  if (planErr) return { ok: false, error: planErr };
  // D170 — มัดจำแบบเดิมเลิกใช้กับออเดอร์ใหม่ (ออเดอร์ที่อยู่กลางโฟลว์เดิมแล้วทำต่อได้)
  const legacyErr = legacyDepositError(action, order.status);
  if (legacyErr) return { ok: false, error: legacyErr };
  if (action === "RECEIVE_INSTALLMENT") {
    const e = receiveAmountError(plan, Number(payload.installmentSeq), Number(payload.amount) || 0, order.outstandingBalance);
    if (e) return { ok: false, error: e };
  }
  if (action === "SHIP_PLAN") {
    const e = shipNowError(order.status);
    if (e) return { ok: false, error: e };
  }

  // ข้อมูลคู่ค้า (taxId/branch/address) จาก contacts
  const customerId = await customerIdFor(supabase, quNo);
  const [{ data: contactRow }, items] = await Promise.all([
    customerId
      ? supabase.from("contacts").select("tax_id, branch, address").eq("contact_id", customerId).maybeSingle()
      : Promise.resolve({ data: null }),
    orderItemsFor(supabase, quNo),
  ]);
  const contact = {
    taxId: (contactRow?.tax_id as string) ?? "",
    branch: (contactRow?.branch as string) ?? "",
    address: (contactRow?.address as string) ?? "",
    contactId: customerId ?? "", // multi-branch: ลงบัญชีด้วย contact_id ให้ ภพ.30/ภงด. ได้สาขาถูก (D42)
  };

  // generate เลข INV/TAX เฉพาะที่ needed (atomic ผ่าน counters)
  // 4.3 — กิจการไม่จด VAT ไม่มีสิทธิ์ได้เลขใบกำกับภาษี (ด่านสุดท้ายคือ trigger ใน 0036)
  const vat = await resolveSalesVat(supabase, config.entityId);
  if ('conflict' in vat) return { ok: false, error: vat.conflict };
  const need = neededSerials(action, order, vat.isVat, { seq: payload.installmentSeq, amount: payload.amount });
  const gen: GeneratedSerials = {};

  // ── D100 เฟส 3 — วันที่เอกสาร + เลขที่กรอกเอง ──────────────────────────────────
  // ★ วันที่เดียวใช้ทั้ง "เลขเอกสารของวันไหน" และ "ลงบัญชีวันไหน" (processOrder ใช้ docDate ตัวนี้)
  //   ไม่ส่งมา = วันนี้ตามเวลาไทย · 🪤 เดิม processOrder ตกไปใช้ today() ของ server ซึ่งเป็น UTC
  const dateErr = docDateError(payload.docDate);
  if (dateErr) return { ok: false, error: dateErr };
  const docDate = payload.docDate || bangkokDateISO();
  const manual = {
    inv: payload.manualNos?.inv?.trim() ?? "",
    pay: payload.manualNos?.pay?.trim() ?? "",
  };
  const wantPay = !!(need.tax1 || need.tax2 || need.rcpt1 || need.rcpt2);
  // 🚨 กรอกเลขให้ใบที่ไม่ได้ออกในครั้งนี้ = ห้ามเงียบ ๆ ทิ้งค่าที่ผู้ใช้พิมพ์ (บอกเหตุผลเสมอ · D92)
  if (manual.inv && !need.inv) return { ok: false, error: "ครั้งนี้ไม่ได้ออกใบแจ้งหนี้ใหม่ — ช่องเลขใบแจ้งหนี้ต้องว่าง" };
  if (manual.pay && !wantPay) return { ok: false, error: "ครั้งนี้ไม่ได้ออกใบกำกับภาษี/ใบเสร็จใหม่ — ช่องเลขต้องว่าง" };
  const payType = vat.isVat ? "sales_tax" : "sales_rcpt";

  /** ขอเลขเอกสาร 1 ใบ ของวันที่บนเอกสาร (ดู nextSalesDocNo) */
  const nextDoc = (type: SalesDocType) => nextSalesDocNo(supabase, type, docDate);
  /** เลขที่เขียนบนใบกระดาษไปแล้ว — ต้องยังไม่มีเอกสารใช้ (สิทธิ์ sales.config ตรวจใน RPC) */
  async function manualDoc(type: "sales_inv" | "sales_tax" | "sales_rcpt", no: string): Promise<string> {
    const bad = manualNoError(no);
    if (bad) throw new Error(bad);
    const { data, error } = await supabase.rpc("fn_doc_manual_check", { p_type: type, p_no: no });
    if (error) throw new Error(mapDbError(error));
    if (data === true) throw new Error(`เลข ${no} มีเอกสารใช้อยู่แล้ว — ตรวจเลขบนใบกระดาษอีกครั้ง`);
    return no;
  }
  try {
    // ★ ตรวจเลขที่กรอกเองให้ผ่านก่อน แล้วค่อยขอเลขอัตโนมัติ — ล้มที่เลขที่กรอก = ไม่กินเลขรันไปฟรี
    const manualInv = manual.inv ? await manualDoc("sales_inv", manual.inv) : "";
    const manualPay = manual.pay ? await manualDoc(payType, manual.pay) : "";
    if (need.inv) gen.invNo = manualInv || (await nextDoc("sales_inv"));
    if (need.tax1) gen.taxNo1 = manualPay || (await nextDoc("sales_tax"));
    if (need.tax2) gen.taxNo2 = manualPay || (await nextDoc("sales_tax"));
    // D89 → D100: กิจการไม่จด VAT ออกเลขชุด TAX ไม่ได้ (ม.86/13) · ใบเสร็จมีชุดของตัวเอง `RC`
    //   (เดิมยืมชุด INV — ใบเก่าที่ได้เลข INV ไปแล้วไม่ถูกแก้ และเลขนั้นไม่ถูกออกซ้ำ)
    if (need.rcpt1) gen.rcptNo1 = manualPay || (await nextDoc("sales_rcpt"));
    if (need.rcpt2) gen.rcptNo2 = manualPay || (await nextDoc("sales_rcpt"));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // ★ ส่ง isVat ที่อ่านจาก DB ฝั่ง server เข้าไปกับ config — payload บัญชีจะได้ vat = 0
  //   และฐานคิดจาก (1 − wht) เมื่อกิจการไม่จด VAT
  const result = processOrder(order, action, { ...payload, docDate }, items, gen, contact, { ...config, isVat: vat.isVat });

  const { data, error } = await supabase.rpc("fn_apply_order_action", {
    p_qu_no: quNo,
    p_update: result.update,
    p_revenue: result.revenue,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  const res = data as { ok: boolean; duplicate: boolean; tx_id?: string };

  return {
    ok: true,
    newStatus: result.newStatus,
    duplicate: res.duplicate,
    // ไม่ส่งซ้ำถ้าเป็น duplicate (เคยลงบัญชีไปแล้ว)
    lineMsg: res.duplicate ? null : result.lineMsg,
    // เลขที่เพิ่ง generate ถ้ามี ไม่งั้นใช้ของเดิมในใบ — ผู้เรียกเอาไปพิมพ์เอกสารต่อได้ทันที
    invNo: result.update.invNo || order.invNo || "",
    taxNo1: result.update.taxNo1 || order.taxNo1 || "",
    taxNo2: result.update.taxNo2 || order.taxNo2 || "",
    rcptNo1: result.update.rcptNo1 || order.rcptNo1 || "",
    rcptNo2: result.update.rcptNo2 || order.rcptNo2 || "",
  };
}

export type PosSalePayload = {
  /** ต้องเป็น contact จริงเสมอ — ที่อยู่/เลขภาษีบนใบกำกับอ่านจาก `contacts` ไม่ได้เก็บในออเดอร์ */
  customer: { id: string; name: string };
  items: CartItem[];
  /** ส่วนลดท้ายบิล (บาท รูปรวม VAT) — ช่องเดียวที่หน้าขายหน้าร้านให้กรอก */
  discount: number;
  method: string;
  /**
   * D100 เฟส 3 — วันที่ขาย (ลงย้อนหลังได้ · ไม่ส่ง = วันนี้) ใช้ทั้งเลขใบเสร็จ บัญชี และฟอร์ม ภส.
   * 🚨 ขายหน้าร้าน = ส่งของทันที ⇒ ล่วงหน้าไม่ได้ (กติกาเดียวกับวันที่ส่งของ)
   */
  docDate?: string;
  /** เลขใบกำกับภาษี/ใบเสร็จที่เขียนบนกระดาษไปแล้ว (ว่าง = ให้ระบบออก) */
  manualNo?: string;
};

/**
 * ขายหน้าร้าน 1 บิล = 3 จังหวะของโฟลว์เดิมต่อกัน
 *   ① `fn_save_quotation`  ② `FULL_PAYMENT_AND_SEND` (ลงบัญชี)  ③ `fn_confirm_fulfillment` (ตัดสต็อก)
 *
 * 🚨 **จงใจไม่เขียน RPC ก้อนเดียว** — จะต้องยกตรรกะเลขเอกสาร/ถอด VAT ไปไว้ใน SQL อีกชุด
 *    = สูตรเงินมี 2 ที่ ซึ่งเป็นกลไกเดียวกับที่ทำให้ D79 พังเงียบมาเป็นปี
 *
 * 🚨 ล้มกลางทาง = "สำเร็จบางส่วน" **ห้ามรายงานว่าสำเร็จ** — คืน `warning` ให้หน้าจอ
 *    ขึ้นสีเหลืองพร้อมบอกว่าออเดอร์ค้างอยู่ใบไหนและต้องไปกดต่อที่แท็บอะไร (บทเรียน D79)
 */
export async function posSaleCore(
  supabase: SalesDb,
  input: PosSalePayload,
  userName: string,
): Promise<{ ok: false; error: string } | { ok: true; data: PosSaleResult; lineMsg: string }> {
  if (!input.customer?.id) return failC("ยังไม่ได้เลือกลูกค้า");
  if (!input.items.length) return failC("ยังไม่ได้เลือกสินค้า");

  const today = bangkokDateISO(); // 🪤 server เป็น UTC — ใช้วันตามเวลาไทยเสมอ
  // ★ ตรวจวันก่อนสร้างอะไรทั้งนั้น — ล้มหลังสร้างออเดอร์ = ออเดอร์ค้างครึ่งทาง
  const dErr = saleDateError(input.docDate, today);
  if (dErr) return failC(dErr);
  if (input.manualNo?.trim()) {
    const bad = manualNoError(input.manualNo);
    if (bad) return failC(bad);
  }
  const docDate = input.docDate || today;

  // D148 — หมวดของบิลหน้าร้าน = ค่าปริยายจากหมวดหมู่รายรับของบัญชี (ยังไม่ตั้ง = รายได้ค่าสินค้า เหมือนเดิม)
  //  🚨 อ่านไม่ได้ต้องฟ้อง ไม่ใช่เดาค่าเริ่มต้น (D89) — ไม่งั้นบิลลงหมวดที่ไม่อยู่ในลิสต์เงียบ ๆ
  const cats = await supabase.from("app_settings").select("value, sort").eq("kind", "income_cat").order("sort");
  if (cats.error) return failC(mapDbError(cats.error));
  const category = defaultRevenueCat((cats.data ?? []).map((r) => String(r.value ?? "")));

  // ① สร้างออเดอร์ (ไม่ยิง LINE — บิลเดียวต้องได้ข้อความเดียว)
  const saved = await saveQuotationCore(supabase, {
    customer: input.customer,
    items: input.items,
    discount: input.discount,
    isWhtRequired: false, // ขาจรไม่หัก ณ ที่จ่าย
    whtPercent: 0,
    isDepositRequired: false, // จ่ายจบหน้าร้าน
    depositPercent: 0,
    saleName: userName,
    category,
    remarks: "ขายหน้าร้าน",
  });
  if (!saved.ok) return failC(saved.error);

  // ② รับเงินเต็มจำนวน + ลงบัญชี (ยอดมาจาก outstanding_balance ของใบที่เพิ่งสร้าง)
  const paid = await applyOrderActionCore(supabase, saved.quNo, "FULL_PAYMENT_AND_SEND", {
    method: input.method,
    docDate,
    manualNos: input.manualNo?.trim() ? { pay: input.manualNo.trim() } : undefined,
  });
  if (!paid.ok) {
    return failC(
      `${paid.error}\n\nออเดอร์ ${saved.quNo} ถูกสร้างไว้แล้วแต่ยังไม่ได้รับเงิน — ` +
        `ไปทำต่อที่แท็บ “จัดการออเดอร์” หรือให้หัวหน้ายกเลิกใบนี้`,
    );
  }

  // ③ ตัดสต็อก (คลังทั่วไป + สต็อกสุราที่เข้าฟอร์ม ภส.)
  const { data: fulfilData, error: fulfilErr } = await supabase.rpc("fn_confirm_fulfillment", {
    p_qu_no: saved.quNo,
    p_user: userName || "pos",
    p_date: docDate, // ★ ฟอร์ม ภส. วันเดียวกับใบเสร็จ (D100 เฟส 3)
  });
  const fulfil = fulfilData as
    | { ok: boolean; error?: string; summary?: { name: string; remaining: number }[] }
    | null;
  const stockErr = fulfilErr ? mapDbError(fulfilErr) : !fulfil?.ok ? (fulfil?.error ?? "ตัดสต็อกไม่สำเร็จ") : "";

  const summary = fulfil?.summary ?? [];
  const amountText = saved.grandTotal.toLocaleString("th-TH", { minimumFractionDigits: 0 });

  // LINE — **ข้อความเดียวต่อบิล** (ไม่ใช่ 3 ข้อความแบบที่ 3 จังหวะยิงกันเอง)
  let msg = `🧾 ขายหน้าร้าน\n[${saved.orderNo}] ${input.customer.name}\n${input.items.length} รายการ | ฿${amountText} (${input.method})`;
  if (stockErr) msg += `\n⚠️ ยังไม่ได้ตัดสต็อก — ${stockErr}`;
  else for (const s of summary) msg += `\n• ${s.name}: คงเหลือ ${Number(s.remaining).toLocaleString("th-TH", { minimumFractionDigits: 0 })}`;
  return {
    ok: true,
    lineMsg: msg,
    data: {
      quNo: saved.quNo,
      orderNo: saved.orderNo,
      invNo: paid.invNo,
      taxNo1: paid.taxNo1,
      rcptNo1: paid.rcptNo1,
      docDate,
      summary,
      // 🚨 ขายและลงบัญชีสำเร็จแล้วแต่สต็อกยังไม่ขยับ = ต้องขึ้นเหลือง ไม่ใช่เขียว
      warning: stockErr
        ? `บันทึกการขายและลงบัญชีเรียบร้อยแล้ว แต่ยังตัดสต็อกไม่สำเร็จ (${stockErr}) — ` +
          `ไปที่แท็บ “คลังจัดส่ง” แล้วกดยืนยันจัดส่งของออเดอร์ ${saved.orderNo}`
        : "",
    },
  };
}

