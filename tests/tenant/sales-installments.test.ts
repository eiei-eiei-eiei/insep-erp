import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, admin, type Tenant } from "./harness";

/**
 * D145 · 0101 — แผนงวด sales_installments
 *
 * 🔴 กติกาอยู่ใน plpgsql (fn_sales_set_plan · fn_apply_order_action) — ชั้นนี้ชั้นเดียวที่พิสูจน์ว่า
 *    รับตามลำดับ · ล็อกงวด · ผลรวมต้องเท่ายอดค้าง · ส่วนต่างไปงวดสุดท้าย · ยกเลิกออเดอร์ย้อนทุกงวด
 * ★ ยอดเป็นบาทที่ส่งเข้า fn_sales_set_plan คิดแบบเดียวกับ planAmounts() (งวดสุดท้ายรับเศษ)
 */

let A: Tenant;
let asA: SupabaseClient;
const QU = "QU-INST-1";
const ORD = "ORD-INST-1";
const NET = 1000;
let outstanding = NET;

async function order(qu: string, ord: string) {
  const r = await admin().from("sales_orders").insert({
    tenant_id: A.tenantId, entity_id: A.entityId, qu_no: qu, order_no: ord,
    customer_id: A.contactId, customer_name: "ลูกค้าทดสอบ",
    status: "รอคอนเฟิร์ม", grand_total: NET, net_payable: NET, outstanding_balance: NET,
  });
  if (r.error) throw new Error(`สร้างออเดอร์ ${qu}: ${r.error.message}`);
}

const row = (label: string, percent: number, amount: number, ship = false) =>
  ({ label, percent, amount, due_date: null, ship_point: ship });

async function plan(qu = QU) {
  const { data, error } = await admin().from("sales_installments")
    .select("seq, label, amount, inv_no, ship_point").eq("tenant_id", A.tenantId).eq("qu_no", qu).order("seq");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));
}

/** รับเงินของงวด — p_update คิดยอดค้างแบบเดียวกับ processOrder */
async function recv(seq: number, amount: number, doc: string, qu = QU, ord = ORD) {
  const res = await asA.rpc("fn_apply_order_action", {
    p_qu_no: qu,
    p_update: { status: "กำลังผ่อนชำระ", outstandingBalance: outstanding - amount, deposit: NET - outstanding + amount },
    p_revenue: {
      idempotencyKey: `${ord}-i${seq}`, accountName: "", entityId: "EID01", category: "รายได้ค่าสินค้า",
      contactName: "ลูกค้าทดสอบ", contactId: "", taxId: "", branch: "สำนักงานใหญ่", address: "",
      description: `อ้างอิง QU: ${qu} (โอนเงิน)`, baseAmount: amount, discount: 0, amountAfterDiscount: amount,
      vatAmount: 0, whtRate: 0, whtAmount: 0, netAmount: amount, taxInvoiceNo: doc, taxInvoiceDate: "2026-10-30",
      items: [], paymentLabel: `งวดที่ ${seq}`, paymentMethod: "โอนเงิน", chequeDetail: "", installmentSeq: seq,
    },
  });
  if (!res.error) outstanding -= amount;
  return res;
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("inst");
  asA = await signIn(A);
  await order(QU, ORD);
}, 120_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("ตั้งแผนงวด", () => {
  it("50/20/30 → 3 งวด ยอดตรง", async () => {
    const { error } = await asA.rpc("fn_sales_set_plan", {
      p_qu_no: QU, p_rows: [row("มัดจำ", 50, 500), row("เริ่มบรรจุ", 20, 200), row("ส่งของ", 30, 300, true)],
    });
    expect(error).toBeNull();
    expect((await plan()).map((r) => [r.seq, r.amount, r.ship_point])).toEqual([[1, 500, false], [2, 200, false], [3, 300, true]]);
  });
  it("ผลรวมไม่เท่ายอดค้าง → ปฏิเสธ แผนเดิมไม่หาย", async () => {
    const { error } = await asA.rpc("fn_sales_set_plan", { p_qu_no: QU, p_rows: [row("ก", 50, 500), row("ข", 40, 400)] });
    expect(error?.message).toContain("ต้องเท่ากันพอดี");
    expect(await plan()).toHaveLength(3);
  });
  it("จุดส่งของได้งวดเดียว", async () => {
    const { error } = await asA.rpc("fn_sales_set_plan", {
      p_qu_no: QU, p_rows: [row("ก", 50, 500, true), row("ข", 50, 500, true)],
    });
    expect(error?.message).toContain("จุดส่งของเลือกได้งวดเดียว");
  });
});

describe("รับเงินรายงวด", () => {
  it("🚨 รับงวด 2 ก่อนงวด 1 ไม่ได้ · ไม่มีบิลเกิด", async () => {
    const { error } = await recv(2, 200, "TAX-I-X");
    expect(error?.message).toContain("ต้องรับงวดที่ 1 ก่อน");
    const tx = await admin().from("transactions").select("tx_id").eq("tenant_id", A.tenantId).eq("idempotency_key", `${ORD}-i2`);
    expect(tx.data ?? []).toHaveLength(0);
  });
  it("รับงวด 1 → แถวการรับเงินผูกงวด", async () => {
    const { error } = await recv(1, 500, "TAX-I-1");
    expect(error).toBeNull();
    const p = await admin().from("sales_payments").select("seq, installment_seq, amount, doc_no")
      .eq("tenant_id", A.tenantId).eq("qu_no", QU);
    expect(p.data).toEqual([{ seq: 1, installment_seq: 1, amount: 500, doc_no: "TAX-I-1" }]);
  });
});

describe("ปรับงวดหลังรับงวดแรก (3 แบบที่ผู้ใช้ยกมา)", () => {
  it("รวบ 20+30 เป็น 50 → งวด 2 เดียว 500 · งวด 1 ไม่ถูกแตะ", async () => {
    const { error } = await asA.rpc("fn_sales_set_plan", { p_qu_no: QU, p_rows: [row("ส่วนที่เหลือ", 50, 500)] });
    expect(error).toBeNull();
    expect((await plan()).map((r) => [r.seq, r.label, r.amount])).toEqual([[1, "มัดจำ", 500], [2, "ส่วนที่เหลือ", 500]]);
  });
  it("สลับเป็น 30/20", async () => {
    const { error } = await asA.rpc("fn_sales_set_plan", { p_qu_no: QU, p_rows: [row("ก", 30, 300), row("ข", 20, 200)] });
    expect(error).toBeNull();
    expect((await plan()).map((r) => r.amount)).toEqual([500, 300, 200]);
  });
  it("แตก 20/20/10", async () => {
    const { error } = await asA.rpc("fn_sales_set_plan", {
      p_qu_no: QU, p_rows: [row("ก", 20, 200), row("ข", 20, 200), row("ค", 10, 100, true)],
    });
    expect(error).toBeNull();
    expect((await plan()).map((r) => r.amount)).toEqual([500, 200, 200, 100]);
  });
  it("🚨 ส่งงวดที่รวมเกินยอดค้าง (นับงวดที่รับแล้วซ้ำ) → ปฏิเสธ", async () => {
    const { error } = await asA.rpc("fn_sales_set_plan", { p_qu_no: QU, p_rows: [row("ก", 100, 1000)] });
    expect(error?.message).toContain("ต้องเท่ากันพอดี");
  });
});

describe("ใบแจ้งหนี้รายงวด", () => {
  it("ออกได้เฉพาะงวดถัดไป", async () => {
    const bad = await asA.rpc("fn_sales_installment_invoice", {
      p_qu_no: QU, p_seq: 3, p_inv_no: "INV-I-3", p_inv_date: "2026-10-30", p_due_date: null,
    });
    expect(bad.error?.message).toContain("เฉพาะงวดถัดไป (งวดที่ 2)");
    const ok = await asA.rpc("fn_sales_installment_invoice", {
      p_qu_no: QU, p_seq: 2, p_inv_no: "INV-I-2", p_inv_date: "2026-10-30", p_due_date: "2026-11-15",
    });
    expect(ok.error).toBeNull();
  });
  it("เลขใบแจ้งหนี้รายงวด + ใบเสร็จรายงวด นับเป็นเลขที่ใช้แล้ว (กันออกเลขซ้ำ)", async () => {
    // ★ ถามผ่าน fn_doc_manual_check ตัวที่หน้าจอใช้จริง — fn_doc_no_taken รับ p_tenant จึงปิดจากผู้ใช้ (D99)
    for (const no of ["INV-I-2", "TAX-I-1"]) {
      const { data, error } = await asA.rpc("fn_doc_manual_check", { p_type: "sales_inv", p_no: no });
      expect(error, no).toBeNull();
      expect(data, no).toBe(true);
    }
    // positive control: เลขที่ไม่มีใครใช้ต้องตอบ false (กันเทสผ่านเพราะตอบ true ทุกเลข)
    const free = await asA.rpc("fn_doc_manual_check", { p_type: "sales_inv", p_no: "INV-I-FREE-9" });
    expect(free.data).toBe(false);
  });
  it("งวดที่ออกใบแจ้งหนี้แล้วล็อก — ปรับงวดต้องคงยอด 200 ไว้ ส่งมาแค่ส่วนหลัง", async () => {
    const { error } = await asA.rpc("fn_sales_set_plan", { p_qu_no: QU, p_rows: [row("ที่เหลือ", 30, 300)] });
    expect(error).toBeNull();
    expect((await plan()).map((r) => [r.seq, r.amount, r.inv_no])).toEqual([[1, 500, null], [2, 200, "INV-I-2"], [3, 300, null]]);
  });
  it("🚨 พนักงานขายยกเลิกใบแจ้งหนี้รายงวดไม่ได้", async () => {
    const { client } = await seedUser(A, "sales");
    const { error } = await client.rpc("fn_sales_void_installment_invoice", { p_qu_no: QU, p_seq: 2 });
    expect(error?.message).toContain("หัวหน้าฝ่ายขาย");
  });
});

describe("รับไม่เท่ายอดงวด", () => {
  it("งวด 2 รับ 190 (แผน 200) → งวด 2 = 190 · ส่วนต่าง 10 ไปงวดสุดท้าย", async () => {
    const { error } = await recv(2, 190, "TAX-I-2");
    expect(error).toBeNull();
    expect((await plan()).map((r) => r.amount)).toEqual([500, 190, 310]);
  });
  it("🚨 งวดสุดท้ายต้องรับเต็ม", async () => {
    const { error } = await recv(3, 300, "TAX-I-3X");
    expect(error?.message).toContain("งวดสุดท้ายต้องรับเต็มยอดค้าง");
    expect((await plan()).map((r) => r.amount)).toEqual([500, 190, 310]);
  });
});

describe("ออเดอร์แบบเดิม + ยกเลิก", () => {
  it("ออเดอร์ที่รับเงินแบบเดิมไปแล้ว ตั้งแผนงวดไม่ได้", async () => {
    await order("QU-INST-OLD", "ORD-INST-OLD");
    const pay = await asA.rpc("fn_apply_order_action", {
      p_qu_no: "QU-INST-OLD", p_update: { status: "รอคลังจัดส่ง" },
      p_revenue: {
        idempotencyKey: "ORD-INST-OLD", entityId: "EID01", category: "รายได้ค่าสินค้า", contactName: "ทดสอบ",
        description: "อ้างอิง QU: QU-INST-OLD (โอนเงิน)", netAmount: 500, amountAfterDiscount: 500,
        taxInvoiceNo: "TAX-OLD", taxInvoiceDate: "2026-10-30", items: [], paymentLabel: "มัดจำ", paymentMethod: "โอนเงิน",
      },
    });
    expect(pay.error).toBeNull();
    const { error } = await asA.rpc("fn_sales_set_plan", { p_qu_no: "QU-INST-OLD", p_rows: [row("ก", 50, 500)] });
    expect(error?.message).toContain("รับเงินแบบเดิม");
  });
  it("ยกเลิกออเดอร์ → บิลของทุกงวดเป็นยกเลิก", async () => {
    const { data, error } = await asA.rpc("fn_cancel_order", { p_qu_no: QU });
    expect(error).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);
    const tx = await admin().from("transactions").select("idempotency_key, status")
      .eq("tenant_id", A.tenantId).in("idempotency_key", [`${ORD}-i1`, `${ORD}-i2`]).order("idempotency_key");
    expect(tx.data).toEqual([
      { idempotency_key: `${ORD}-i1`, status: "ยกเลิก" },
      { idempotency_key: `${ORD}-i2`, status: "ยกเลิก" },
    ]);
  });
  it("🚨 ออเดอร์ที่ยกเลิกแล้วปรับงวดไม่ได้", async () => {
    const { error } = await asA.rpc("fn_sales_set_plan", { p_qu_no: QU, p_rows: [] });
    expect(error?.message).toContain("ยกเลิก");
  });
});

// ── D146 · 0102 — ใบแจ้งหนี้งวดแรกล็อกการแก้ใบเสนอราคา ─────────────────────────
describe("ใบแจ้งหนี้งวดแรก ↔ สถานะออเดอร์ (D146)", () => {
  const Q2 = "QU-INST-2";
  async function status() {
    const r = await admin().from("sales_orders").select("status").eq("tenant_id", A.tenantId).eq("qu_no", Q2).single();
    return r.data?.status;
  }
  beforeAll(async () => {
    await order(Q2, "ORD-INST-2");
    const { error } = await asA.rpc("fn_sales_set_plan", { p_qu_no: Q2, p_rows: [row("มัดจำ", 50, 500, true), row("ที่เหลือ", 50, 500)] });
    if (error) throw new Error(error.message);
  });
  it("ออกใบแจ้งหนี้งวดแรก → รอชำระมัดจำ · แก้ใบเสนอราคาไม่ได้ (DB บล็อก)", async () => {
    const r = await asA.rpc("fn_sales_installment_invoice", {
      p_qu_no: Q2, p_seq: 1, p_inv_no: "INV-I2-1", p_inv_date: "2026-10-30", p_due_date: null,
    });
    expect(r.error).toBeNull();
    expect(await status()).toBe("รอชำระมัดจำ");
    const upd = await asA.rpc("fn_update_quotation", { p_qu_no: Q2, p: { grand_total: 2000, net_payable: 2000 }, p_items: [] });
    expect((upd.data as { ok: boolean })?.ok ?? false).toBe(false);
  });
  it("ยกเลิกใบแจ้งหนี้จนไม่เหลือ + ยังไม่รับเงิน → กลับรอคอนเฟิร์ม (แก้ใบเสนอราคาได้อีก)", async () => {
    const r = await asA.rpc("fn_sales_void_installment_invoice", { p_qu_no: Q2, p_seq: 1 });
    expect(r.error).toBeNull();
    expect(await status()).toBe("รอคอนเฟิร์ม");
  });
});
