import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, admin, type Tenant } from "./harness";

/**
 * D132 ย้ายบิลไปกิจการอื่นจากหน้าแก้ไขบิล (migration 0094) — ยิง fn_edit_transaction ด้วย client จริง
 *
 * โครง: tenant เดียว 3 กิจการ · EID01 (จด VAT) · EIDB (จด VAT) · EIDN (ไม่จด VAT)
 * 🚨 ทุกข้อที่บล็อกมี positive control (บิลเดียวกันแก้ช่องอื่นได้ / ย้ายไปที่อื่นได้)
 *    และตรวจด้วย admin ว่าแถวใน DB ไม่ขยับจริง (ไม่ใช่แค่ดู ok:false)
 */

let A: Tenant;
let asMain: SupabaseClient;
let asStaff: SupabaseClient;
const B = "EIDB";
const N = "EIDN";
const ACC = "บัญชีทดสอบย้ายกิจการ";
const TX = {
  ui: "TR-MOVE-UI-0001",
  vat: "TR-MOVE-VAT-0001",
  sales: "TR-MOVE-SALES-0001",
  wht: "TR-MOVE-WHT-0001",
  adv: "TR-MOVE-ADV-0001",
  staff: "TR-MOVE-STAFF-0001",
};

const must = (w: string, e: { message: string } | null) => { if (e) throw new Error(`${w}: ${e.message}`); };

/** payload แบบที่หน้าแก้บิลส่งจริง (ยอดเงินคำนวณฝั่ง client แล้ว) */
function payload(over: Record<string, unknown> = {}) {
  return {
    transaction_date: "2026-10-10", type: "รายจ่าย", account_name: ACC, category: "ค่าใช้จ่ายทดสอบ",
    contact_name: "คู่ค้าทดสอบ", description: "ทดสอบย้ายกิจการ",
    base_amount: 100, discount: 0, amount_after_discount: 100, vat_amount: 0, wht_rate: 0, wht_amount: 0, net_amount: 100,
    tax_invoice_no: "", tax_invoice_date: "", entity_id: "",
    ...over,
  };
}
const items = [{ item_name: "ของทดสอบ", quantity: 1, ex_vat: 100, in_vat: 107, total_price: 100 }];

async function edit(c: SupabaseClient, txId: string, over: Record<string, unknown> = {}) {
  return c.rpc("fn_edit_transaction", { p_tx_id: txId, p: payload(over), p_items: items });
}
async function entityOf(txId: string): Promise<string> {
  const { data, error } = await admin().from("transactions").select("entity_id")
    .eq("tenant_id", A.tenantId).eq("tx_id", txId).single();
  must("อ่านบิล", error);
  return data!.entity_id as string;
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("move");
  const db = admin();
  const T = A.tenantId;
  must("กิจการ", (await db.from("entities").insert([
    { tenant_id: T, entity_id: B, name: "กิจการบีทดสอบ", is_vat: true },
    { tenant_id: T, entity_id: N, name: "กิจการไม่จดทดสอบ", is_vat: false },
  ])).error);
  must("บัญชี", (await db.from("bank_accounts").insert(
    { tenant_id: T, account_id: "T-B-MOVE", account_name: ACC, entity_ids: [], opening_balance: 0 },
  )).error);
  const tx = (id: string, over: Record<string, unknown> = {}) => ({
    tenant_id: T, entity_id: A.entityId, tx_id: id, transaction_date: "2026-10-10", type: "รายจ่าย",
    account_name: ACC, net_amount: 100, amount_after_discount: 100, base_amount: 100, status: "ปกติ", ...over,
  });
  must("บิล", (await db.from("transactions").insert([
    tx(TX.ui),
    tx(TX.vat, { vat_amount: 7, net_amount: 107 }),
    tx(TX.sales, { type: "รายรับ", source: "sales", idempotency_key: "T-MOVE-ORD-1" }),
    tx(TX.wht, { wht_rate: 3, wht_amount: 3, net_amount: 97 }),
    // service role ผ่าน trigger advance_guard ได้ (0086)
    tx(TX.adv, { type: "สำรองจ่าย", advance_for_entity: B, advance_status: "รอเบิกคืน" }),
    tx(TX.staff),
  ])).error);
  must("50ทวิ", (await db.from("wht_certificates").insert({
    tenant_id: T, entity_id: A.entityId, doc_no: "T-MOVE-6901", issue_date: "2026-10-10",
    contact_name: "คู่ค้าทดสอบ", wht_amount: 3, tx_ids: [TX.wht],
  })).error);

  asMain = await signIn(A);
  const staff = await seedUser(A, "finance_manager");
  must("จำกัดกิจการ", (await db.from("profiles").update({ allowed_entity_ids: [A.entityId] }).eq("id", staff.userId)).error);
  asStaff = staff.client;
}, 180_000);

afterAll(async () => {
  await asMain?.auth.signOut().catch(() => {});
  await asStaff?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("ย้ายได้", () => {
  it("★ บิลที่คีย์เอง ย้ายไปกิจการอื่นได้ รายการสินค้ายังอยู่ครบ", async () => {
    const { data, error } = await edit(asMain, TX.ui, { entity_id: B });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });
    expect(await entityOf(TX.ui)).toBe(B);
    const { count } = await admin().from("transaction_items").select("*", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId).eq("tx_id", TX.ui);
    expect(count).toBe(1);
  });

  it("ไม่ส่งกิจการ = คงกิจการเดิม (พฤติกรรมเดิมของ 0019)", async () => {
    const { data } = await edit(asMain, TX.ui, { entity_id: "", description: "แก้รายละเอียดอย่างเดียว" });
    expect(data).toMatchObject({ ok: true });
    expect(await entityOf(TX.ui)).toBe(B);
  });

  it("กิจการที่ไม่มีอยู่จริง = ตอบภาษาไทย ไม่ใช่ FK error ดิบ", async () => {
    const { data, error } = await edit(asMain, TX.ui, { entity_id: "EIDZZZ" });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false });
    expect(String((data as { error: string }).error)).toContain("ไม่พบกิจการ");
    expect(await entityOf(TX.ui)).toBe(B);
  });
});

describe("ย้ายไม่ได้ — แถวใน DB ต้องไม่ขยับ", () => {
  it("🚨 บิลจากแอปขาย ย้ายไม่ได้ · แต่แก้รายละเอียดได้เหมือนเดิม (positive control)", async () => {
    const r = await edit(asMain, TX.sales, { type: "รายรับ", entity_id: B });
    expect(r.data).toMatchObject({ ok: false });
    expect(await entityOf(TX.sales)).toBe(A.entityId);
    const ok = await edit(asMain, TX.sales, { type: "รายรับ", entity_id: "", description: "แก้ได้" });
    expect(ok.data).toMatchObject({ ok: true });
  });

  it("🚨 ออก 50ทวิ แล้ว ย้ายไม่ได้ และบอกเลขใบ", async () => {
    const { data } = await edit(asMain, TX.wht, { entity_id: B, wht_rate: 3, wht_amount: 3, net_amount: 97 });
    expect(data).toMatchObject({ ok: false });
    expect(String((data as { error: string }).error)).toContain("T-MOVE-6901");
    expect(await entityOf(TX.wht)).toBe(A.entityId);
  });

  it("🚨 บิลสำรองจ่ายย้ายไปเป็นของกิจการที่ซื้อให้ไม่ได้ · ย้ายไปกิจการอื่นได้", async () => {
    const bad = await edit(asMain, TX.adv, { type: "สำรองจ่าย", entity_id: B });
    expect(bad.data).toMatchObject({ ok: false });
    expect(String((bad.data as { error: string }).error)).toContain("สำรองจ่ายให้");
    expect(await entityOf(TX.adv)).toBe(A.entityId);
    const ok = await edit(asMain, TX.adv, { type: "สำรองจ่าย", entity_id: N });
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ ok: true });
    expect(await entityOf(TX.adv)).toBe(N);
  });

  it("🚨 บิลมี VAT ย้ายไปกิจการไม่จด VAT ไม่ได้ (trigger 0036) · ย้ายไปกิจการที่จดได้", async () => {
    const bad = await edit(asMain, TX.vat, { entity_id: N, vat_amount: 7, net_amount: 107 });
    expect(bad.error).not.toBeNull();
    expect(await entityOf(TX.vat)).toBe(A.entityId);
    const ok = await edit(asMain, TX.vat, { entity_id: B, vat_amount: 7, net_amount: 107 });
    expect(ok.data).toMatchObject({ ok: true });
    expect(await entityOf(TX.vat)).toBe(B);
  });

  it("🚨 ผู้ใช้ที่ถูกจำกัดกิจการ ย้ายบิลไปกิจการที่ตัวเองไม่มีสิทธิ์ไม่ได้ (RLS) · แก้ช่องอื่นได้", async () => {
    const bad = await edit(asStaff, TX.staff, { entity_id: B });
    expect(bad.error).not.toBeNull();
    expect(await entityOf(TX.staff)).toBe(A.entityId);
    const ok = await edit(asStaff, TX.staff, { entity_id: "", description: "staff แก้ได้" });
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ ok: true });
  });
});
