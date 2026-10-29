import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, type Tenant } from "./harness";

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
