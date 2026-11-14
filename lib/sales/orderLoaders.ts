import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderState } from "@/lib/sales/orders";
import type { SalesPayment } from "@/lib/sales/payments";
import type { Installment } from "@/lib/sales/installments";
import { mustRead } from "@/lib/shared/dbError";

/**
 * ตัวโหลดออเดอร์ที่รับ client จากผู้เรียก (D172)
 *
 * ★ ย้ายมาจาก `app/(app)/sales/data.ts` **คำต่อคำ** — ต่างแค่รับ `supabase` เป็นพารามิเตอร์
 *   ⇒ หน้าเว็บ (client จากคุกกี้) กับ Claude connector (client จาก token) ใช้ตัวเดียวกัน
 *   (บทเรียน D81: ตัวเลือกชุดข้อมูลสองชุด = ตัวเลขบนจอกับในแชทไม่ตรงกันโดยไม่มีอะไรฟ้อง)
 * 🚨 ไม่มี service role ในไฟล์นี้ — connector เรียกไฟล์นี้ (connectorRoute.test.ts อ่านซอร์สตรวจ)
 */
export type SalesDb = SupabaseClient;

type SoRow = Record<string, unknown>;

/** แถว sales_payments → SalesPayment (D143) */
export function mapPayment(r: Record<string, unknown>): SalesPayment {
  return {
    seq: Number(r.seq) || 0,
    label: (r.label as string) ?? "",
    amount: Number(r.amount) || 0,
    method: (r.method as string) ?? "",
    chequeDetail: (r.cheque_detail as string) ?? "",
    docDate: (r.doc_date as string) ?? "",
    docNo: (r.doc_no as string) ?? "",
    txId: (r.tx_id as string) ?? "",
    installmentSeq: r.installment_seq == null ? null : Number(r.installment_seq),
  };
}
export const PAYMENT_COLS = "qu_no, seq, label, amount, method, cheque_detail, doc_date, doc_no, tx_id, installment_seq";

/**
 * แผนงวด + การรับเงินรายงวด ของหลายออเดอร์ในคำขอเดียว (D147) — แหล่งเดียวของ getOrderPlan/getOrders/คิวคลัง
 * ★ ไม่ส่ง quNos = ทุกออเดอร์ของลูกค้ารายนี้ (RLS กรอง tenant)
 * ★ "รับแล้ว" = มีแถวการรับเงินของงวดที่บิลยังไม่ยกเลิก (กติกาเดียวกับ sales_installment_paid ใน 0101)
 */
export async function loadPlansFor(
  supabase: SalesDb,
  quNos?: string[],
): Promise<{ plans: Map<string, Installment[]>; payments: Map<string, SalesPayment[]> }> {
  const plans = new Map<string, Installment[]>();
  const payments = new Map<string, SalesPayment[]>();
  if (quNos && !quNos.length) return { plans, payments };
  let iq = supabase.from("sales_installments")
    .select("qu_no, seq, label, percent, amount, due_date, inv_no, inv_date, ship_point").order("seq");
  let pq = supabase.from("sales_payments").select(PAYMENT_COLS).not("installment_seq", "is", null).order("seq");
  if (quNos) { iq = iq.in("qu_no", quNos); pq = pq.in("qu_no", quNos); }
  const [inst, pays] = await Promise.all([iq, pq]);
  const rows = mustRead(inst, "แผนงวดของออเดอร์") ?? [];
  if (!rows.length) return { plans, payments };
  const payRows = mustRead(pays, "การรับเงินของออเดอร์") ?? [];
  const txIds = payRows.map((p) => p.tx_id as string).filter(Boolean);
  const voided = new Set<string>();
  if (txIds.length) {
    const tx = mustRead(
      await supabase.from("transactions").select("tx_id, status").in("tx_id", txIds),
      "บิลรายรับของงวด",
    );
    for (const t of tx ?? []) if (t.status === "ยกเลิก") voided.add(t.tx_id as string);
  }
  const paid = new Set<string>();
  for (const p of payRows) {
    if (p.tx_id && voided.has(p.tx_id as string)) continue;
    paid.add(`${p.qu_no}#${p.installment_seq}`);
    const arr = payments.get(p.qu_no as string) ?? [];
    arr.push(mapPayment(p as Record<string, unknown>));
    payments.set(p.qu_no as string, arr);
  }
  for (const r of rows) {
    const arr = plans.get(r.qu_no as string) ?? [];
    arr.push({
      seq: Number(r.seq),
      label: (r.label as string) ?? "",
      percent: r.percent == null ? null : Number(r.percent),
      amount: Number(r.amount) || 0,
      dueDate: (r.due_date as string) ?? "",
      invNo: (r.inv_no as string) ?? "",
      invDate: (r.inv_date as string) ?? "",
      shipPoint: !!r.ship_point,
      paid: paid.has(`${r.qu_no}#${r.seq}`),
    });
    plans.set(r.qu_no as string, arr);
  }
  return { plans, payments };
}

/** รายการสินค้าในออเดอร์ */
export async function orderItemsFor(supabase: SalesDb, quNo: string) {
  // 🚨 D89 — ว่าง = พิมพ์ใบกำกับภาษี/ใบเสร็จที่ไม่มีรายการสินค้าสักบรรทัด
  const data = mustRead(
    await supabase.from("sales_order_items").select("item_name, qty, price").eq("qu_no", quNo).order("id"),
    "รายการสินค้าในออเดอร์",
  );
  return (data ?? []).map((i) => ({ name: i.item_name as string, qty: Number(i.qty) || 0, price: Number(i.price) || 0 }));
}

/** สถานะออเดอร์ปัจจุบัน (สำหรับ processOrder ฝั่ง action) */
export async function orderStateFor(supabase: SalesDb, quNo: string): Promise<OrderState | null> {
  // 🚨 D89 — อ่านไม่ได้แล้วคืน null = ฝั่ง action อ่านว่า "ไม่พบออเดอร์" ทั้งที่มีอยู่
  //    (และถ้าคืนแถวว่างจะกลายเป็น "ยังไม่มีเลขเอกสาร" → ขอเลขใหม่ซ้ำของเดิม)
  const data = mustRead<SoRow | null>(
    await supabase
      .from("sales_orders")
      .select("qu_no, order_no, status, deposit, outstanding_balance, sub_total, discount, wht_percent, category, customer_name, customer_id, inv_no, tax_no1, tax_no2, dep_inv_no, rcpt_no1, rcpt_no2")
      .eq("qu_no", quNo)
      .maybeSingle(),
    "สถานะออเดอร์",
  );
  if (!data) return null;
  // D145 — แผนงวด (processOrder ตัดสินสถานะ/การส่งคลังจากธงจุดส่งของ + งวดที่รับแล้ว)
  const installments = (await loadPlansFor(supabase, [quNo])).plans.get(quNo) ?? [];
  return {
    installments,
    quNo: data.qu_no as string,
    orderNo: (data.order_no as string) ?? "",
    status: (data.status as string) ?? "",
    deposit: Number(data.deposit) || 0,
    outstandingBalance: Number(data.outstanding_balance) || 0,
    subTotal: Number(data.sub_total) || 0,
    discount: Number(data.discount) || 0,
    whtPercent: Number(data.wht_percent) || 0,
    category: (data.category as string) ?? "รายได้ค่าสินค้า",
    customerName: (data.customer_name as string) ?? "",
    invNo: (data.inv_no as string) ?? "",
    taxNo1: (data.tax_no1 as string) ?? "",
    taxNo2: (data.tax_no2 as string) ?? "",
    depInvNo: (data.dep_inv_no as string) ?? "",
    rcptNo1: (data.rcpt_no1 as string) ?? "",
    rcptNo2: (data.rcpt_no2 as string) ?? "",
  };
}

export async function customerIdFor(supabase: SalesDb, quNo: string): Promise<string | null> {
  const data = mustRead<SoRow | null>(
    await supabase.from("sales_orders").select("customer_id").eq("qu_no", quNo).maybeSingle(),
    "ลูกค้าของออเดอร์",
  );
  return (data?.customer_id as string) ?? null;
}

/** สต็อกรวม: สุรา (stock_product live) + ทั่วไป (warehouse_stock) — ย้ายจาก data.ts (D172) */
export async function warehouseStockFor(supabase: SalesDb) {
  const [stockP, prods, wh] = await Promise.all([
    supabase.from("stock_product").select("product_id, balance"),
    supabase.from("products").select("product_id, name"),
    supabase.from("warehouse_stock").select("item_code, item_name, unit, qty").order("item_code"),
  ]);
  const nameMap = new Map<string, string>();
  for (const p of mustRead(prods, "ทะเบียนสินค้า")) nameMap.set(p.product_id as string, p.name as string);
  // 🚨 D89 — สต็อกโชว์ 0 เพราะอ่านไม่ได้ = ตัดสินใจสั่งผลิต/รับออเดอร์ผิด
  const liquor = mustRead(stockP, "สต็อกสุรา").map((s) => ({
    itemCode: s.product_id as string,
    itemName: nameMap.get(s.product_id as string) ?? (s.product_id as string),
    category: "สุรา",
    unit: "ขวด",
    currentStock: Number(s.balance) || 0,
    isLive: true,
  }));
  const general = mustRead(wh, "สต็อกคลัง").map((s) => ({
    itemCode: s.item_code as string,
    itemName: (s.item_name as string) ?? (s.item_code as string),
    category: "ทั่วไป",
    unit: (s.unit as string) ?? "",
    currentStock: Number(s.qty) || 0,
    isLive: false,
  }));
  return [...liquor, ...general].sort((a, b) => (a.itemCode < b.itemCode ? -1 : 1));
}
