import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, type Tenant } from "./harness";

/**
 * D123 (migration 0088) — กดชำระบิลค้างแล้ว:
 *   · เขียน settled_on = วันที่ชำระ (ยอดเงิน/ภงด.3/53 ใช้วันนี้)
 *   · 🚨 ไม่แตะ transaction_date (เดือนภาษี ภพ.30 ของบิลต้องคงเดิม — ไม่งั้นนับซ้ำ/ย้ายเดือน)
 *   · ไม่ส่งวันที่ = วันที่ไทย ไม่ใช่ UTC (D100)
 */

let A: Tenant;
let asMain: SupabaseClient;
const ACC = "บัญชีชำระทดสอบ";

async function saveAr(c: SupabaseClient, date: string) {
  const { data, error } = await c.rpc("fn_save_transaction", {
    p: {
      transaction_date: date, type: "รายรับ", account_name: null, category: "ขายสินค้า",
      contact_name: "ลูกค้าทดสอบ", description: "ทดสอบค้างรับ", base_amount: 1000, discount: 0,
      amount_after_discount: 1000, vat_amount: 70, wht_rate: 0, wht_amount: 0, net_amount: 1070,
      tax_invoice_no: "INV-T-1", tax_invoice_date: date, entity_id: A.entityId, ap_ar_status: "AR",
    },
    p_items: [{ item_name: "สินค้าทดสอบ", quantity: 1, in_vat: 1070, ex_vat: 1000, total_price: 1000 }],
  });
  if (error) throw new Error(`บันทึกบิลค้างรับ: ${error.message}`);
  return (data as { tx_id: string }).tx_id;
}
const row = async (txId: string) =>
  (await asMain.from("transactions").select("*").eq("tx_id", txId).single()).data as Record<string, unknown>;

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("settle");
  const { error } = await admin().from("bank_accounts").insert({
    tenant_id: A.tenantId, account_id: "T-ACC-SETTLE", account_name: ACC, entity_ids: [A.entityId], opening_balance: 0,
  });
  if (error) throw new Error(`บัญชี: ${error.message}`);
  asMain = await signIn(A);
});
afterAll(async () => { await cleanupTestTenants(); });

describe("fn_settle_apar — วันที่เคลีย (D123)", () => {
  it("ชำระคนละเดือน: settled_on/payment_date = วันที่ชำระ · วันที่รายการคงเดิม", async () => {
    const txId = await saveAr(asMain, "2026-10-10");
    const before = await row(txId);
    expect(before.ap_ar_status).toBe("AR");
    expect(before.settled_on).toBeNull();

    const { data, error } = await asMain.rpc("fn_settle_apar", { p_tx_id: txId, p_account_name: ACC, p_payment_date: "2026-11-10" });
    expect(error).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);

    const after = await row(txId);
    expect(after.transaction_date).toBe("2026-10-10");
    expect(after.settled_on).toBe("2026-11-10");
    expect(after.payment_date).toBe("2026-11-10");
    expect(after.ap_ar_status).toBeNull();
    expect(after.account_name).toBe(ACC);
  });

  it("ไม่ส่งวันที่ = วันนี้ตามเวลาไทย", async () => {
    const txId = await saveAr(asMain, "2026-10-11");
    await asMain.rpc("fn_settle_apar", { p_tx_id: txId, p_account_name: ACC });
    const th = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    expect((await row(txId)).settled_on).toBe(th);
  });

  it("ชำระซ้ำบิลที่ไม่ค้างแล้ว = ปฏิเสธ (settled_on ไม่ถูกเขียนทับ)", async () => {
    const txId = await saveAr(asMain, "2026-10-12");
    await asMain.rpc("fn_settle_apar", { p_tx_id: txId, p_account_name: ACC, p_payment_date: "2026-11-01" });
    const { data } = await asMain.rpc("fn_settle_apar", { p_tx_id: txId, p_account_name: ACC, p_payment_date: "2026-12-01" });
    expect((data as { ok: boolean }).ok).toBe(false);
    expect((await row(txId)).settled_on).toBe("2026-11-01");
  });

  it("บิลปกติที่ไม่เคยค้าง ไม่มี settled_on (ยอดเงินคงใช้วันที่รายการ)", async () => {
    const { data, error } = await asMain.rpc("fn_save_transaction", {
      p: {
        transaction_date: "2026-10-13", type: "รายรับ", account_name: ACC, category: "ขายสินค้า",
        contact_name: "ลูกค้าทดสอบ", description: "ทดสอบเงินสด", base_amount: 100, discount: 0,
        amount_after_discount: 100, vat_amount: 7, wht_rate: 0, wht_amount: 0, net_amount: 107,
        entity_id: A.entityId,
      },
      p_items: [{ item_name: "สินค้าทดสอบ", quantity: 1, in_vat: 107, ex_vat: 100, total_price: 100 }],
    });
    expect(error).toBeNull();
    expect((await row((data as { tx_id: string }).tx_id)).settled_on).toBeNull();
  });
});
