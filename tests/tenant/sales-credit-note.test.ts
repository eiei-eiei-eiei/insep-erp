import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, admin, type Tenant } from "./harness";

/**
 * D159 · 0106 — ใบลดหนี้ตอนยกเลิกออเดอร์ · ยิงฐานข้อมูลจริง
 *
 * 🔴 ตรรกะอยู่ใน plpgsql (fn_cancel_order) — build/lint/test มองไม่เห็น (D79) ชั้นนี้ชั้นเดียวที่พิสูจน์:
 *    · ใบกำกับเดือนก่อน/งวดที่ยื่นแล้ว → ยกเลิกแบบเดิมไม่ได้ (ไม่งั้นภาษีขายหายจากงวดเดิม)
 *    · ออกใบลดหนี้ → บิลเดิมคงปกติ · บิลใหม่ type ลดหนี้ขาย ยอดเท่าบิลเดิม · แถวใบลดหนี้ · เลข CN
 *    · ไม่มีใบกำกับที่มี VAT → ยกเลิกแบบเดิมได้ แต่ออกใบลดหนี้ไม่ได้
 * ★ positive control: เดือนนี้ + ยังไม่ยื่น → ยกเลิกแบบเดิมได้จริง (ไม่ใช่บล็อกทุกอย่างแล้วผ่าน)
 */

let A: Tenant;
let B: Tenant;
let asA: SupabaseClient;
let asB: SupabaseClient;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
const thisMonth = today.slice(0, 7);
const prevMonthDay = (() => {
  const [y, m] = thisMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 15));
  return d.toISOString().slice(0, 10);
})();

/** สร้างออเดอร์ + รับเงิน 1 ครั้ง (ใบกำกับ) แล้วย้ายวันที่บิลตามต้องการ */
async function orderWithBill(qu: string, opts: { vat: number; date: string; filed?: boolean }) {
  const ord = `ORD-${qu}`;
  const so = await admin().from("sales_orders").insert({
    tenant_id: A.tenantId, entity_id: A.entityId, qu_no: qu, order_no: ord,
    customer_id: A.contactId, customer_name: "ลูกค้าทดสอบ", status: "รอคอนเฟิร์ม", grand_total: 1070, outstanding_balance: 1070,
  });
  if (so.error) throw new Error(`สร้างออเดอร์ ${qu}: ${so.error.message}`);
  const pre = opts.vat > 0 ? 1000 : 1070;
  const { data, error } = await asA.rpc("fn_apply_order_action", {
    p_qu_no: qu, p_update: { status: "ปิดการขาย", paymentMethod: "โอนเงิน" },
    p_revenue: {
      idempotencyKey: ord, accountName: "", entityId: A.entityId, category: "รายได้ค่าสินค้า",
      contactName: "ลูกค้าทดสอบ", contactId: "", taxId: "", branch: "สำนักงานใหญ่", address: "",
      description: `อ้างอิง QU: ${qu}`, baseAmount: pre, discount: 0, amountAfterDiscount: pre, vatAmount: opts.vat,
      whtRate: 0, whtAmount: 0, netAmount: 1070, taxInvoiceNo: `TAX-${qu}`, taxInvoiceDate: opts.date, items: [],
      paymentLabel: "ชำระเต็ม", paymentMethod: "โอนเงิน", chequeDetail: "",
    },
  });
  if (error) throw new Error(`รับเงิน ${qu}: ${error.message}`);
  const txId = (data as { tx_id: string }).tx_id;
  await admin().from("transactions").update({ transaction_date: opts.date, tax_invoice_date: opts.date }).eq("tenant_id", A.tenantId).eq("tx_id", txId);
  if (opts.filed) {
    const f = await admin().from("tax_filings").insert({ tenant_id: A.tenantId, entity_id: A.entityId, kind: "vat", period: opts.date.slice(0, 7) });
    if (f.error) throw new Error(`ติ๊กยื่น: ${f.error.message}`);
  }
  return txId;
}
async function txRow(txId: string) {
  const { data } = await admin().from("transactions").select("status, type, amount_after_discount, vat_amount, net_amount, ap_ar_status, account_name, tax_invoice_no, transaction_date").eq("tenant_id", A.tenantId).eq("tx_id", txId).single();
  return data!;
}
const credit = (o: Record<string, string> = {}) => ({ reason: "return", detail: "", date: today, refund_account: "", reason_text: "รับคืนสินค้า", ...o });

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("cn");
  B = await seedTenant("cnb");
  asA = await signIn(A);
  asB = await signIn(B);
}, 120_000);

afterAll(async () => {
  for (const c of [asA, asB]) await c?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("D159 ใบกำกับเดือนก่อน → ต้องใบลดหนี้", () => {
  let bill: string;
  beforeAll(async () => { bill = await orderWithBill("CN-OLD", { vat: 70, date: prevMonthDay }); });

  it("🔴 ยกเลิกแบบเดิมถูกปฏิเสธ · บิลเดิมยังปกติ", async () => {
    const { error } = await asA.rpc("fn_cancel_order", { p_qu_no: "CN-OLD" });
    expect(error?.message).toContain("ต้องออกใบลดหนี้");
    expect((await txRow(bill)).status).toBe("ปกติ");
  });

  it("เหตุอื่นไม่พิมพ์อธิบาย / วันที่อนาคต → ปฏิเสธ", async () => {
    expect((await asA.rpc("fn_cancel_order", { p_qu_no: "CN-OLD", p_credit: credit({ reason: "other" }) })).error?.message).toContain("อธิบาย");
    expect((await asA.rpc("fn_cancel_order", { p_qu_no: "CN-OLD", p_credit: credit({ date: "2999-01-01" }) })).error?.message).toContain("อนาคต");
    expect((await asA.rpc("fn_cancel_order", { p_qu_no: "CN-OLD", p_credit: credit({ reason: "x" }) })).error?.message).toContain("เหตุ");
  });

  it("ออกใบลดหนี้: บิลเดิมคงปกติ · บิลลดหนี้ขายยอดเท่าบิลเดิม · ยังไม่คืน = ค้างจ่าย · ออเดอร์ยกเลิก", async () => {
    const { data, error } = await asA.rpc("fn_cancel_order", { p_qu_no: "CN-OLD", p_credit: credit() });
    expect(error, error?.message).toBeNull();
    const cnNo = (data as { cn_no: string }).cn_no;
    expect(cnNo).toMatch(/^CN/);
    expect((await txRow(bill)).status).toBe("ปกติ");

    const cn = await admin().from("sales_credit_notes").select("*").eq("tenant_id", A.tenantId).eq("qu_no", "CN-OLD").single();
    expect(cn.error).toBeNull();
    expect(cn.data).toMatchObject({ cn_no: cnNo, cn_date: today, reason: "return", reason_text: "รับคืนสินค้า" });
    expect(Number(cn.data!.original_value)).toBe(1000);
    expect(Number(cn.data!.correct_value)).toBe(0);
    expect(Number(cn.data!.vat_amount)).toBe(70);
    expect(Number(cn.data!.total_amount)).toBe(1070);
    expect((cn.data!.refs as { doc_no: string }[]).map((r) => r.doc_no)).toEqual(["TAX-CN-OLD"]);

    const t = await txRow(cn.data!.tx_id as string);
    expect(t).toMatchObject({ status: "ปกติ", type: "ลดหนี้ขาย", ap_ar_status: "AP", account_name: null, tax_invoice_no: cnNo, transaction_date: today });
    expect([Number(t.amount_after_discount), Number(t.vat_amount), Number(t.net_amount)]).toEqual([1000, 70, 1070]);

    const so = await admin().from("sales_orders").select("status").eq("tenant_id", A.tenantId).eq("qu_no", "CN-OLD").single();
    expect(so.data?.status).toBe("ยกเลิก");
  });
});

describe("D159 เดือนนี้", () => {
  it("✅ positive control: เดือนนี้ + ยังไม่ยื่น → ยกเลิกแบบเดิมได้ (บิลเดิมถูกยกเลิก)", async () => {
    const bill = await orderWithBill("CN-NEW", { vat: 70, date: today });
    const { error } = await asA.rpc("fn_cancel_order", { p_qu_no: "CN-NEW" });
    expect(error, error?.message).toBeNull();
    expect((await txRow(bill)).status).toBe("ยกเลิก");
  });
  it("🔴 เดือนนี้แต่ติ๊กยื่น ภพ.30 แล้ว → ยกเลิกแบบเดิมไม่ได้", async () => {
    const bill = await orderWithBill("CN-FILED", { vat: 70, date: today, filed: true });
    const { error } = await asA.rpc("fn_cancel_order", { p_qu_no: "CN-FILED" });
    expect(error?.message).toContain("ต้องออกใบลดหนี้");
    expect((await txRow(bill)).status).toBe("ปกติ");
  });
  it("คืนเงินจากบัญชีที่ไม่มีจริง → ปฏิเสธ", async () => {
    const { error } = await asA.rpc("fn_cancel_order", { p_qu_no: "CN-FILED", p_credit: credit({ refund_account: "ไม่มีบัญชีนี้" }) });
    expect(error?.message).toContain("ไม่พบบัญชี");
  });
});

describe("D159 ไม่มีใบกำกับที่มี VAT", () => {
  it("ออกใบลดหนี้ไม่ได้ · ยกเลิกแบบเดิมได้แม้เดือนก่อน", async () => {
    const bill = await orderWithBill("CN-NOVAT", { vat: 0, date: prevMonthDay });
    expect((await asA.rpc("fn_cancel_order", { p_qu_no: "CN-NOVAT", p_credit: credit() })).error?.message).toContain("ไม่มีใบกำกับ");
    const { error } = await asA.rpc("fn_cancel_order", { p_qu_no: "CN-NOVAT" });
    expect(error, error?.message).toBeNull();
    expect((await txRow(bill)).status).toBe("ยกเลิก");
  });
});

describe("D159 สิทธิ์", () => {
  it("ลูกค้าเจ้าอื่นมองไม่เห็นใบลดหนี้ · เขียนตรงไม่ได้", async () => {
    const own = await asA.from("sales_credit_notes").select("cn_no");
    expect((own.data ?? []).length).toBeGreaterThan(0);
    const other = await asB.from("sales_credit_notes").select("cn_no");
    expect(other.data ?? []).toEqual([]);
    const w = await asA.from("sales_credit_notes").insert({ cn_no: "CN-X", qu_no: "CN-OLD", entity_id: A.entityId, cn_date: today, reason: "return", reason_text: "x", refs: [], original_value: 1, correct_value: 0, diff_value: 1, vat_amount: 0, total_amount: 1, refund_amount: 1, tx_id: "x" });
    expect(w.error).not.toBeNull();
  });
  it("ฝ่ายขาย (ไม่ใช่หัวหน้า) ยกเลิก/ออกใบลดหนี้ไม่ได้", async () => {
    const sales = (await seedUser(A, "sales")).client;
    const { error } = await sales.rpc("fn_cancel_order", { p_qu_no: "CN-FILED", p_credit: credit() });
    expect(error?.message).toContain("ไม่มีสิทธิ์");
    await sales.auth.signOut().catch(() => {});
  });
});
