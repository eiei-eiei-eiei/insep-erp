import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, type Tenant } from "./harness";

/**
 * D179 ยอดที่ใช้คิดหัก ณ ที่จ่าย (migration 0112) — ยิง fn_save_transaction / fn_edit_transaction ด้วย client จริง
 *
 * 🚨 ตรรกะ "ไม่มี key = คงค่าเดิม" อยู่ใน plpgsql — build/lint/test มองไม่เห็น (D79) ชั้นนี้ชั้นเดียวที่จับได้
 *    connector edit_bill ส่งแถวเดิมกลับโดยไม่มีคอลัมน์ wht_base ⇒ ถ้าตีความเป็น null = ฐานหายเงียบ ๆ
 */

let A: Tenant;
let asMain: SupabaseClient;
const ACC = "บัญชีทดสอบฐานหัก";
const must = (w: string, e: { message: string } | null) => { if (e) throw new Error(`${w}: ${e.message}`); };

/** บิลค่าทำของ 10,000 + ค่าขนส่ง 500 · VAT 735 · หัก 3% เฉพาะค่าทำของ = 300 */
function payload(over: Record<string, unknown> = {}) {
  return {
    transaction_date: "2026-11-20", type: "รายจ่าย", account_name: ACC, category: "ค่าใช้จ่ายทดสอบ",
    contact_name: "ช่างทดสอบ", description: "ทดสอบ D179",
    base_amount: 10500, discount: 0, amount_after_discount: 10500, vat_amount: 735,
    wht_rate: 3, wht_amount: 300, wht_base: 10000, net_amount: 10935,
    tax_invoice_no: "", tax_invoice_date: "", entity_id: A.entityId,
    ...over,
  };
}
const items = [
  { item_name: "ค่าทำของ", quantity: 1, ex_vat: 10000, in_vat: 10700, total_price: 10000 },
  { item_name: "ค่าขนส่ง", quantity: 1, ex_vat: 500, in_vat: 535, total_price: 500 },
];

async function row(txId: string) {
  const { data, error } = await admin().from("transactions").select("wht_base, wht_amount, amount_after_discount")
    .eq("tenant_id", A.tenantId).eq("tx_id", txId).single();
  must("อ่านบิล", error);
  return { base: data!.wht_base == null ? null : Number(data!.wht_base), wht: Number(data!.wht_amount) };
}
async function save(over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await asMain.rpc("fn_save_transaction", { p: payload(over), p_items: items });
  must("บันทึก", error);
  return (data as { tx_id: string }).tx_id;
}
async function edit(txId: string, p: Record<string, unknown>) {
  const { data, error } = await asMain.rpc("fn_edit_transaction", { p_tx_id: txId, p, p_items: items });
  must("แก้", error);
  expect(data).toMatchObject({ ok: true });
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("whtbase");
  must("บัญชี", (await admin().from("bank_accounts").insert(
    { tenant_id: A.tenantId, account_id: "T-B-WHTBASE", account_name: ACC, entity_ids: [], opening_balance: 0 },
  )).error);
  asMain = await signIn(A);
}, 180_000);

afterAll(async () => {
  await asMain?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("fn_save_transaction", () => {
  it("★ เก็บยอดที่ใช้คิดหัก", async () => {
    expect(await row(await save())).toEqual({ base: 10000, wht: 300 });
  });
  it("ไม่ส่ง / ส่ง null = null (ตามยอดบิล · บิลเดิมทุกใบ)", async () => {
    const { wht_base: _drop, ...noKey } = payload();
    void _drop;
    const { data, error } = await asMain.rpc("fn_save_transaction", { p: { ...noKey, wht_amount: 315, net_amount: 10920 }, p_items: items });
    must("บันทึก", error);
    expect(await row((data as { tx_id: string }).tx_id)).toEqual({ base: null, wht: 315 });
    expect(await row(await save({ wht_base: null, wht_amount: 315, net_amount: 10920 }))).toEqual({ base: null, wht: 315 });
  });
  it("🪤 ไม่หัก ณ ที่จ่าย แต่มีฐานค้างมา = ไม่เก็บ", async () => {
    expect(await row(await save({ wht_rate: 0, wht_amount: 0, net_amount: 11235 }))).toEqual({ base: null, wht: 0 });
  });
  it("🚨 ฐานติดลบ = CHECK ปฏิเสธ (positive control: ข้อแรกบันทึกได้)", async () => {
    const { error } = await asMain.rpc("fn_save_transaction", { p: payload({ wht_base: -1 }), p_items: items });
    expect(error).not.toBeNull();
  });
});

describe("fn_edit_transaction", () => {
  it("🚨 payload ไม่มี key wht_base (connector edit_bill) = คงค่าเดิม", async () => {
    const id = await save();
    const { wht_base: _drop, ...noKey } = payload({ description: "แก้คำอธิบายอย่างเดียว" });
    void _drop;
    await edit(id, noKey);
    expect(await row(id)).toEqual({ base: 10000, wht: 300 });
  });
  it("ส่ง null = ล้าง (หน้าแก้บิล กด ใช้ยอดทั้งบิล)", async () => {
    const id = await save();
    await edit(id, payload({ wht_base: null, wht_amount: 315, net_amount: 10920 }));
    expect(await row(id)).toEqual({ base: null, wht: 315 });
  });
  it("ส่งค่าใหม่ = เปลี่ยน", async () => {
    const id = await save({ wht_base: null, wht_amount: 315, net_amount: 10920 });
    await edit(id, payload({ wht_base: 9000, wht_amount: 270, net_amount: 10965 }));
    expect(await row(id)).toEqual({ base: 9000, wht: 270 });
  });
  it("🪤 เลิกหัก ณ ที่จ่าย = ล้างฐานเสมอ แม้ payload ไม่มี key", async () => {
    const id = await save();
    const { wht_base: _drop, ...noKey } = payload({ wht_rate: 0, wht_amount: 0, net_amount: 11235 });
    void _drop;
    await edit(id, noKey);
    expect(await row(id)).toEqual({ base: null, wht: 0 });
  });
});
