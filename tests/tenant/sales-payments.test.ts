import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, admin, type Tenant } from "./harness";

/**
 * D143 · 0099 — ตารางการรับเงิน sales_payments
 *
 * 🔴 ตรรกะอยู่ใน plpgsql (fn_apply_order_action) — build/lint/test มองไม่เห็น (D79) ชั้นนี้ชั้นเดียว
 * ที่พิสูจน์ได้ว่ารับเงินแล้วเกิดแถวจริง · กดซ้ำไม่ซ้ำ · ลูกค้าอื่นมองไม่เห็น · เขียนตรงไม่ได้
 */

let A: Tenant;
let B: Tenant;
let asA: SupabaseClient;
let asB: SupabaseClient;
const QU = "QU-PAY-1";
const ORD = "ORD-PAY-1";

function revenue(key: string, label: string, method: string, net: number, doc: string, cheque = "") {
  return {
    idempotencyKey: key, accountName: "", entityId: "EID01", category: "รายได้ค่าสินค้า",
    contactName: "ลูกค้าทดสอบ", contactId: "", taxId: "", branch: "สำนักงานใหญ่", address: "",
    description: `อ้างอิง QU: ${QU} (${method})`,
    baseAmount: net, discount: 0, amountAfterDiscount: net, vatAmount: 0, whtRate: 0, whtAmount: 0,
    netAmount: net, taxInvoiceNo: doc, taxInvoiceDate: "2026-10-30", items: [],
    paymentLabel: label, paymentMethod: method, chequeDetail: cheque,
  };
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("a");
  B = await seedTenant("b");
  asA = await signIn(A);
  asB = await signIn(B);
  const so = await admin().from("sales_orders").insert({
    tenant_id: A.tenantId, entity_id: A.entityId, qu_no: QU, order_no: ORD,
    customer_id: A.contactId, customer_name: "ลูกค้าทดสอบ",
    status: "รอคอนเฟิร์ม", grand_total: 1000, outstanding_balance: 1000,
  });
  if (so.error) throw new Error(`สร้างออเดอร์: ${so.error.message}`);
}, 120_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await asB?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

async function rows() {
  const { data, error } = await admin().from("sales_payments")
    .select("seq, label, amount, method, cheque_detail, doc_no, tx_id")
    .eq("tenant_id", A.tenantId).eq("qu_no", QU).order("seq");
  if (error) throw new Error(error.message);
  return data ?? [];
}

describe("รับเงินแล้วเกิดแถวของครั้งนั้น", () => {
  it("มัดจำด้วยเช็ค → แถวที่ 1 พร้อมวิธี/เช็ค/เลขเอกสาร/บิล", async () => {
    const { data, error } = await asA.rpc("fn_apply_order_action", {
      p_qu_no: QU, p_update: { status: "รอคลังจัดส่ง", paymentMethod: "เช็ค" },
      p_revenue: revenue(ORD, "มัดจำ", "เช็ค", 500, "TAX-P-1", "ธนาคารกสิกร เลขที่เช็ค : 77"),
    });
    expect(error).toBeNull();
    const txId = (data as { tx_id: string }).tx_id;
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ seq: 1, label: "มัดจำ", method: "เช็ค", doc_no: "TAX-P-1", tx_id: txId });
    expect(Number(r[0].amount)).toBe(500);
    expect(r[0].cheque_detail).toContain("77");
  });

  it("ยอดค้างด้วยโอน → แถวที่ 2 · แถวที่ 1 ยังเป็นเช็ค (ช่องเดิมของออเดอร์ถูกทับ แต่แถวไม่ถูก)", async () => {
    const { error } = await asA.rpc("fn_apply_order_action", {
      p_qu_no: QU, p_update: { status: "ปิดการขาย", paymentMethod: "โอนเงิน" },
      p_revenue: revenue(`${ORD}-balance`, "ชำระยอดค้าง", "โอนเงิน", 500, "TAX-P-2"),
    });
    expect(error).toBeNull();
    const r = await rows();
    expect(r.map((x) => [x.seq, x.label, x.method])).toEqual([[1, "มัดจำ", "เช็ค"], [2, "ชำระยอดค้าง", "โอนเงิน"]]);
    const so = await admin().from("sales_orders").select("payment_method").eq("tenant_id", A.tenantId).eq("qu_no", QU).single();
    expect(so.data?.payment_method).toBe("โอนเงิน"); // ★ ของเดิมยังเขียนเหมือนเดิม (เฟส 1)
  });

  it("กดซ้ำ key เดิม → duplicate · ไม่เกิดแถวซ้ำ", async () => {
    const { data, error } = await asA.rpc("fn_apply_order_action", {
      p_qu_no: QU, p_update: {}, p_revenue: revenue(`${ORD}-balance`, "ชำระยอดค้าง", "โอนเงิน", 500, "TAX-P-2"),
    });
    expect(error).toBeNull();
    expect((data as { duplicate: boolean }).duplicate).toBe(true);
    expect(await rows()).toHaveLength(2);
  });
});

describe("สิทธิ์", () => {
  it("เจ้าของอ่านแถวตัวเองได้ (positive control)", async () => {
    const { data, error } = await asA.from("sales_payments").select("seq").eq("qu_no", QU);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });
  it("ลูกค้าอื่นมองไม่เห็น", async () => {
    const { data } = await asB.from("sales_payments").select("seq").eq("qu_no", QU);
    expect(data ?? []).toHaveLength(0);
  });
  it("🚨 เขียนตรงผ่าน API ไม่ได้ (ไม่มี policy เขียน — ทางเดียวคือ RPC)", async () => {
    const ins = await asA.from("sales_payments").insert({
      qu_no: QU, seq: 9, label: "มัดจำ", amount: 1,
    });
    expect(ins.error).not.toBeNull();
    const upd = await asA.from("sales_payments").update({ method: "เงินสด" }).eq("qu_no", QU).select();
    expect(upd.data ?? []).toHaveLength(0);
    expect((await rows()).map((x) => x.method)).toEqual(["เช็ค", "โอนเงิน"]);
  });
});

// ── D144 · 0100 — แก้วิธีชำระ ────────────────────────────────────────────────
describe("แก้วิธีชำระ fn_sales_edit_payment (D144)", () => {
  const BANK = "ธนาคารทดสอบ D144";
  const CASH = "เงินสดทดสอบ D144";

  beforeAll(async () => {
    const r = await admin().from("bank_accounts").insert([
      { tenant_id: A.tenantId, account_id: "T-ACC-D144-B", account_name: BANK, entity_ids: [], opening_balance: 0 },
      { tenant_id: A.tenantId, account_id: "T-ACC-D144-C", account_name: CASH, entity_ids: [], opening_balance: 0 },
    ]);
    if (r.error) throw new Error(r.error.message);
  });

  async function tx(seq: number) {
    const p = (await rows()).find((x) => x.seq === seq)!;
    const t = await admin().from("transactions").select("account_name, description, net_amount, vat_amount, tax_invoice_no")
      .eq("tenant_id", A.tenantId).eq("tx_id", p.tx_id).single();
    return { pay: p, tx: t.data! };
  }

  it("เช็ค → เงินสด: แถว · บิล (บัญชี + วงเล็บคำอธิบาย) · ช่องเดิมของออเดอร์ เปลี่ยนพร้อมกัน · ยอดไม่ขยับ", async () => {
    const before = await tx(1);
    const { data, error } = await asA.rpc("fn_sales_edit_payment", {
      p_qu_no: QU, p_seq: 1, p_method: "เงินสด", p_cheque: null, p_account: CASH,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, from_method: "เช็ค", to_account: CASH, doc_no: "TAX-P-1" });
    const after = await tx(1);
    expect(after.pay.method).toBe("เงินสด");
    expect(after.pay.cheque_detail).toBeNull();
    expect(after.tx.account_name).toBe(CASH);
    expect(after.tx.description).toBe(`อ้างอิง QU: ${QU} (เงินสด)`);
    // 🚨 ตัวเลขภาษี/เลขเอกสารไม่ขยับ
    expect([after.tx.net_amount, after.tx.vat_amount, after.tx.tax_invoice_no])
      .toEqual([before.tx.net_amount, before.tx.vat_amount, before.tx.tax_invoice_no]);
    const so = await admin().from("sales_orders").select("payment_method, check_detail1")
      .eq("tenant_id", A.tenantId).eq("qu_no", QU).single();
    // ครั้งที่ 1 ไม่ใช่ครั้งล่าสุด → ช่องวิธีชำระของออเดอร์คงเป็นของครั้งที่ 2 · ช่องเช็คของมัดจำถูกล้าง
    expect(so.data).toMatchObject({ payment_method: "โอนเงิน", check_detail1: null });
  });

  it("ครั้งล่าสุด → ช่องวิธีชำระของออเดอร์ตามด้วย · ไม่ส่งบัญชี = บัญชีเดิม", async () => {
    const before = await tx(2);
    const { error } = await asA.rpc("fn_sales_edit_payment", {
      p_qu_no: QU, p_seq: 2, p_method: "เช็ค", p_cheque: "ธนาคารกรุงเทพ เลขที่เช็ค : 5 ลงวันที่ -", p_account: null,
    });
    expect(error).toBeNull();
    const after = await tx(2);
    expect(after.pay).toMatchObject({ method: "เช็ค", cheque_detail: "ธนาคารกรุงเทพ เลขที่เช็ค : 5 ลงวันที่ -" });
    expect(after.tx.account_name).toBe(before.tx.account_name);
    const so = await admin().from("sales_orders").select("payment_method, check_detail2")
      .eq("tenant_id", A.tenantId).eq("qu_no", QU).single();
    expect(so.data).toMatchObject({ payment_method: "เช็ค", check_detail2: "ธนาคารกรุงเทพ เลขที่เช็ค : 5 ลงวันที่ -" });
  });

  it("กันข้อมูลผิด: เช็คไม่มีรายละเอียด · วิธีนอกชุด · บัญชีที่ไม่มีจริง · ครั้งที่ไม่มี", async () => {
    const cases = [
      { p_seq: 1, p_method: "เช็ค", p_cheque: null, p_account: null, msg: "รายละเอียดเช็ค" },
      { p_seq: 1, p_method: "คริปโต", p_cheque: null, p_account: null, msg: "วิธีชำระไม่ถูกต้อง" },
      { p_seq: 1, p_method: "โอนเงิน", p_cheque: null, p_account: "บัญชีมั่ว", msg: "ไม่พบบัญชี" },
      { p_seq: 99, p_method: "โอนเงิน", p_cheque: null, p_account: null, msg: "ไม่พบการรับเงิน" },
    ];
    for (const c of cases) {
      const { error } = await asA.rpc("fn_sales_edit_payment", { p_qu_no: QU, ...c, msg: undefined });
      expect(error?.message, c.p_method).toContain(c.msg);
    }
  });

  it("🚨 พนักงานขาย (ไม่มี sales.config) แก้ไม่ได้", async () => {
    const { client } = await seedUser(A, "sales");
    const { error } = await client.rpc("fn_sales_edit_payment", {
      p_qu_no: QU, p_seq: 1, p_method: "โอนเงิน", p_cheque: null, p_account: null,
    });
    expect(error?.message).toContain("หัวหน้าฝ่ายขาย");
    expect((await rows()).find((x) => x.seq === 1)?.method).toBe("เงินสด");
  });

  it("🚨 ลูกค้าอื่นแก้ของ A ไม่ได้ (ไม่เห็นแถว)", async () => {
    const { error } = await asB.rpc("fn_sales_edit_payment", {
      p_qu_no: QU, p_seq: 1, p_method: "โอนเงิน", p_cheque: null, p_account: null,
    });
    expect(error?.message).toContain("ไม่พบการรับเงิน");
  });

  it("🚨 บิลที่ถูกยกเลิกแล้ว แก้ไม่ได้", async () => {
    const p = (await rows()).find((x) => x.seq === 1)!;
    await admin().from("transactions").update({ status: "ยกเลิก" }).eq("tenant_id", A.tenantId).eq("tx_id", p.tx_id);
    const { error } = await asA.rpc("fn_sales_edit_payment", {
      p_qu_no: QU, p_seq: 1, p_method: "โอนเงิน", p_cheque: null, p_account: null,
    });
    expect(error?.message).toContain("ถูกยกเลิกไปแล้ว");
  });
});
