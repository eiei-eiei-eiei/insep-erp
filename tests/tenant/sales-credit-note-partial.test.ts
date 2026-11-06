import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, admin, type Tenant } from "./harness";
import { partialTotals, CANCEL_AFTER_PARTIAL_TEXT, type PartialInput, type PartialCtx, type CnBill } from "../../lib/sales/creditNote";

/**
 * D160 · 0107 — ใบลดหนี้บางส่วน (คืนบางรายการ / ลดราคา) · ยิงฐานข้อมูลจริง
 *
 * 🔴 ด่านอยู่ใน plpgsql (fn_sales_credit_note) — build/lint/test มองไม่เห็น (D79)
 * ★ ยอดที่ส่งเข้า RPC คิดด้วย partialTotals() ตัวเดียวกับที่ server action ใช้ → พิสูจน์ว่าสองฝั่งตรงกัน
 * ★ positive control ทุกด่าน: ยอดที่ถูกผ่านจริง ยอดที่เกินถูกปฏิเสธ
 *
 * ออเดอร์ตัวอย่าง: A 2 × 535 + B 1 × 1,070 = 2,140 (รวม VAT) · ใบกำกับ 1 ใบ ก่อน VAT 2,000 · VAT 140
 *   A ผูกเมนูสินค้าทั่วไป (คลัง) · B ผูกเมนูสุรา (ฟอร์ม ภส.)
 */

let A: Tenant;
let asA: SupabaseClient;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
const QU = "CNP-1";
const WH = "T-WH-CNP";
let itemA = 0;
let itemB = 0;
let billTx = "";

async function ctx(): Promise<PartialCtx> {
  const b = await admin().from("transactions").select("tx_id, transaction_date, tax_invoice_no, tax_invoice_date, amount_after_discount, vat_amount, net_amount, wht_amount")
    .eq("tenant_id", A.tenantId).eq("tx_id", billTx).single();
  const bills: CnBill[] = [{
    txId: b.data!.tx_id, date: b.data!.transaction_date, taxInvoiceNo: b.data!.tax_invoice_no, taxInvoiceDate: b.data!.tax_invoice_date,
    preVat: Number(b.data!.amount_after_discount), vat: Number(b.data!.vat_amount), net: Number(b.data!.net_amount), wht: Number(b.data!.wht_amount),
  }];
  const prior = await admin().from("sales_credit_notes").select("diff_value, vat_amount, total_amount, wht_amount, items").eq("tenant_id", A.tenantId).eq("qu_no", QU);
  return {
    bills,
    prior: (prior.data ?? []).map((r) => ({
      pre: Number(r.diff_value), vat: Number(r.vat_amount), total: Number(r.total_amount), wht: Number(r.wht_amount),
      items: ((r.items as { id: number; qty: number }[] | null) ?? []).map((x) => ({ id: Number(x.id), qty: Number(x.qty) })),
    })),
    items: [{ id: itemA, name: "T-สินค้าA", qty: 2, price: 535 }, { id: itemB, name: "T-สุราB", qty: 1, price: 1070 }],
    grandTotal: 2140,
    whtPercent: 0,
  };
}

async function payload(input: PartialInput, restock = false, o: Record<string, unknown> = {}) {
  const t = partialTotals(input, await ctx());
  if (typeof t === "string") throw new Error(`partialTotals: ${t}`);
  return {
    kind: input.mode, reason: input.mode === "return" ? "return" : "price_error", detail: "", date: today,
    refund_account: "", reason_text: "ทดสอบ", restock,
    items: t.lines.map((l) => ({ id: l.id, qty: l.qty })),
    pre: t.diff, vat: t.vat, total: t.total, wht: t.wht, refund: t.refund, ...o,
  };
}
const issue = (p: Record<string, unknown>, c: SupabaseClient = asA) => c.rpc("fn_sales_credit_note", { p_qu_no: QU, p_cn: p });

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("cnp");
  asA = await signIn(A);
  const db = admin();
  const base = { tenant_id: A.tenantId, entity_id: A.entityId };
  const must = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };
  // sale_menu.product_id มี FK ไป products → สินค้าทั่วไปก็ต้องมีแถวในทะเบียนสินค้า
  must("product A", (await db.from("products").insert({ ...base, product_id: WH, name: "T-สินค้าA" })).error);
  must("warehouse", (await db.from("warehouse_stock").insert({ ...base, item_code: WH, item_name: "T-สินค้าA", unit: "ชิ้น", qty: 5 })).error);
  must("menu A", (await db.from("sale_menu").insert({ ...base, menu_name: "T-สินค้าA", price: 535, category: "อื่นๆ", product_id: WH })).error);
  must("menu B", (await db.from("sale_menu").insert({ ...base, menu_name: "T-สุราB", price: 1070, category: "สุรา", product_id: A.productId })).error);
  must("order", (await db.from("sales_orders").insert({
    ...base, qu_no: QU, order_no: `ORD-${QU}`, customer_id: A.contactId, customer_name: "ลูกค้าทดสอบ",
    status: "รอคอนเฟิร์ม", grand_total: 2140, outstanding_balance: 2140,
  })).error);
  const its = await db.from("sales_order_items").insert([
    { tenant_id: A.tenantId, qu_no: QU, item_name: "T-สินค้าA", qty: 2, price: 535 },
    { tenant_id: A.tenantId, qu_no: QU, item_name: "T-สุราB", qty: 1, price: 1070 },
  ]).select("id, item_name");
  must("items", its.error);
  itemA = Number(its.data!.find((r) => r.item_name === "T-สินค้าA")!.id);
  itemB = Number(its.data!.find((r) => r.item_name === "T-สุราB")!.id);
  must("order open", (await db.from("sales_orders").insert({
    ...base, qu_no: "CNP-OPEN", order_no: "ORD-CNP-OPEN", customer_id: A.contactId, customer_name: "ลูกค้าทดสอบ",
    status: "รอคอนเฟิร์ม", grand_total: 1070, outstanding_balance: 1070,
  })).error);

  const { data, error } = await asA.rpc("fn_apply_order_action", {
    p_qu_no: QU, p_update: { status: "ปิดการขาย", paymentMethod: "โอนเงิน" },
    p_revenue: {
      idempotencyKey: `ORD-${QU}`, accountName: "", entityId: A.entityId, category: "รายได้ค่าสินค้า",
      contactName: "ลูกค้าทดสอบ", contactId: "", taxId: "", branch: "สำนักงานใหญ่", address: "",
      description: `อ้างอิง QU: ${QU}`, baseAmount: 2000, discount: 0, amountAfterDiscount: 2000, vatAmount: 140,
      whtRate: 0, whtAmount: 0, netAmount: 2140, taxInvoiceNo: `TAX-${QU}`, taxInvoiceDate: today, items: [],
      paymentLabel: "ชำระเต็ม", paymentMethod: "โอนเงิน", chequeDetail: "",
    },
  });
  if (error) throw new Error(`รับเงิน: ${error.message}`);
  billTx = (data as { tx_id: string }).tx_id;
}, 120_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("D160 ด่าน", () => {
  it("ออเดอร์ที่ยังไม่ปิดการขาย → ปฏิเสธ", async () => {
    const { error } = await asA.rpc("fn_sales_credit_note", { p_qu_no: "CNP-OPEN", p_cn: { kind: "discount", reason: "price_error", date: today, pre: 1, vat: 0.07, total: 1.07, wht: 0, refund: 1.07 } });
    expect(error?.message).toContain("ปิดการขาย");
  });
  it("ฝ่ายขาย (ไม่ใช่หัวหน้า) → ไม่มีสิทธิ์", async () => {
    const sales = (await seedUser(A, "sales")).client;
    const { error } = await issue(await payload({ mode: "discount", gross: 107 }), sales);
    expect(error?.message).toContain("ไม่มีสิทธิ์");
    await sales.auth.signOut().catch(() => {});
  });
  it("ยอดที่ไม่สอดคล้อง (ก่อน VAT + VAT ≠ รวม) → ปฏิเสธ", async () => {
    const { error } = await issue(await payload({ mode: "discount", gross: 107 }, false, { total: 999 }));
    expect(error?.message).toContain("สอดคล้อง");
  });
  it("คืนเกินจำนวนที่ขาย → ปฏิเสธ (ส่งตรง ไม่ผ่าน lib)", async () => {
    const p = await payload({ mode: "return", qtys: { [itemA]: 1 } });
    const { error } = await issue({ ...p, items: [{ id: itemA, qty: 3 }] });
    expect(error?.message).toContain("คืนได้ไม่เกิน");
  });
  it("🔴 รายการเดียวกันซ้ำ 2 บรรทัด (หลบด่านจำนวน) → ปฏิเสธ", async () => {
    const p = await payload({ mode: "return", qtys: { [itemA]: 2 } });
    const { error } = await issue({ ...p, items: [{ id: itemA, qty: 2 }, { id: itemA, qty: 2 }] });
    expect(error?.message).toContain("ซ้ำกัน");
  });
});

describe("D160 คืนสินค้า + ลดราคา จนครบยอด", () => {
  let cn1 = "";
  it("✅ คืน A 1 ชิ้น + คืนเข้าสต็อก: บิลเดิมไม่ขยับ · บิลลดหนี้ 500/35/535 · คลัง 5 → 6", async () => {
    const { data, error } = await issue(await payload({ mode: "return", qtys: { [itemA]: 1 } }, true));
    expect(error, error?.message).toBeNull();
    cn1 = (data as { cn_no: string }).cn_no;
    const cn = await admin().from("sales_credit_notes").select("*").eq("tenant_id", A.tenantId).eq("cn_no", cn1).single();
    expect(cn.data).toMatchObject({ kind: "return", restocked: true });
    expect([Number(cn.data!.original_value), Number(cn.data!.correct_value), Number(cn.data!.diff_value), Number(cn.data!.vat_amount), Number(cn.data!.total_amount)])
      .toEqual([2000, 1500, 500, 35, 535]);
    const t = await admin().from("transactions").select("type, status, amount_after_discount, vat_amount, net_amount, ap_ar_status").eq("tenant_id", A.tenantId).eq("tx_id", cn.data!.tx_id).single();
    expect(t.data).toMatchObject({ type: "ลดหนี้ขาย", status: "ปกติ", ap_ar_status: "AP" });
    expect([Number(t.data!.amount_after_discount), Number(t.data!.vat_amount), Number(t.data!.net_amount)]).toEqual([500, 35, 535]);
    const bill = await admin().from("transactions").select("status, net_amount").eq("tenant_id", A.tenantId).eq("tx_id", billTx).single();
    expect(bill.data).toMatchObject({ status: "ปกติ" });
    expect(Number(bill.data!.net_amount)).toBe(2140);
    const wh = await admin().from("warehouse_stock").select("qty").eq("tenant_id", A.tenantId).eq("entity_id", A.entityId).eq("item_code", WH).single();
    expect(Number(wh.data!.qty)).toBe(6);
    const mv = await admin().from("stock_moves").select("action, qty").eq("tenant_id", A.tenantId).eq("ref_no", cn1);
    expect(mv.data).toEqual([expect.objectContaining({ action: "IN" })]);
  });

  it("คืน B (สุรา) ไม่ติ๊กคืนสต็อก → ไม่มีแถว log_product ของใบนี้", async () => {
    const { data, error } = await issue(await payload({ mode: "return", qtys: { [itemB]: 1 } }, false));
    expect(error, error?.message).toBeNull();
    const no = (data as { cn_no: string }).cn_no;
    const lp = await admin().from("log_product").select("id").eq("tenant_id", A.tenantId).eq("ref_no", no);
    expect(lp.data ?? []).toEqual([]);
    const cn = await admin().from("sales_credit_notes").select("restocked, correct_value").eq("tenant_id", A.tenantId).eq("cn_no", no).single();
    expect(cn.data!.restocked).toBe(false);
    expect(Number(cn.data!.correct_value)).toBe(500); // ที่เหลือก่อนใบนี้ 1,500 − 1,000
  });

  it("🔴 คืน A ซ้ำเกินที่เหลือ (เหลือ 1) → ปฏิเสธ", async () => {
    const p = await payload({ mode: "return", qtys: { [itemA]: 1 } });
    const { error } = await issue({ ...p, items: [{ id: itemA, qty: 2 }] });
    expect(error?.message).toContain("คืนได้ไม่เกิน");
  });

  it("🔴 ลดราคาเกินยอดที่เหลือ → ปฏิเสธ (ส่งตรง ไม่ผ่าน lib)", async () => {
    const { error } = await issue({ kind: "discount", reason: "price_error", detail: "", date: today, refund_account: "", reason_text: "x", items: [],
      pre: 600, vat: 42, total: 642, wht: 0, refund: 642 });
    expect(error?.message).toContain("ไม่เกินยอดที่เหลือ");
  });

  it("🚨 ยกเลิกทั้งออเดอร์หลังมีใบลดหนี้บางส่วน → ปฏิเสธ", async () => {
    const { error } = await asA.rpc("fn_cancel_order", { p_qu_no: QU });
    expect(error?.message).toBe(CANCEL_AFTER_PARTIAL_TEXT);
    const so = await admin().from("sales_orders").select("status").eq("tenant_id", A.tenantId).eq("qu_no", QU).single();
    expect(so.data?.status).toBe("ปิดการขาย");
  });

  it("✅ ลดราคาส่วนที่เหลือพอดี (535) → ผ่าน · รวมทุกใบ = บิลเดิมเป๊ะ · ใบถัดไปถูกปฏิเสธ", async () => {
    const { error } = await issue(await payload({ mode: "discount", gross: 535 }));
    expect(error, error?.message).toBeNull();
    const all = await admin().from("sales_credit_notes").select("diff_value, vat_amount, total_amount").eq("tenant_id", A.tenantId).eq("qu_no", QU);
    const sum = (k: "diff_value" | "vat_amount" | "total_amount") => Math.round((all.data ?? []).reduce((s, r) => s + Number(r[k]), 0) * 100) / 100;
    expect([sum("diff_value"), sum("vat_amount"), sum("total_amount")]).toEqual([2000, 140, 2140]);
    const { error: e2 } = await issue({ kind: "discount", reason: "price_error", detail: "", date: today, refund_account: "", reason_text: "x", items: [],
      pre: 1, vat: 0.07, total: 1.07, wht: 0, refund: 1.07 });
    expect(e2?.message).toContain("ไม่เกินยอดที่เหลือ");
  });
});
