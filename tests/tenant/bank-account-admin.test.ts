import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, admin, type Tenant } from "./harness";

/**
 * D125 (migration 0089) — เปลี่ยนชื่อ/ลบ/ดูการใช้งานบัญชีเงิน
 *   · เปลี่ยนชื่อต้องตามไปแก้ทุกที่ที่อ้างชื่อเดิม (บิล · ขาลงบัญชีเงินเดือน · app_settings)
 *   · ลบได้เฉพาะบัญชีที่ไม่มีอะไรอ้างถึง
 *   · ต้องมี acct.config และต้องเห็นทุกกิจการ
 */

let A: Tenant;
let asMain: SupabaseClient;
let asClerk: SupabaseClient;
let asRestricted: SupabaseClient;
const OLD = "บัญชีเดิมทดสอบ";
const NEW = "บัญชีชื่อใหม่ทดสอบ";
const UNUSED = "บัญชีว่างทดสอบ";
const SETTING_ONLY = "บัญชีค่าตั้งทดสอบ";
let txId = "";

const must = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("bankadm");
  const db = admin();
  must("บัญชี", (await db.from("bank_accounts").insert([
    { tenant_id: A.tenantId, account_id: "T-ACC-OLD", account_name: OLD, entity_ids: [], opening_balance: 0 },
    { tenant_id: A.tenantId, account_id: "T-ACC-UNUSED", account_name: UNUSED, entity_ids: [], opening_balance: 0 },
    { tenant_id: A.tenantId, account_id: "T-ACC-SET", account_name: SETTING_ONLY, entity_ids: [], opening_balance: 0 },
  ])).error);
  must("ค่าตั้ง", (await db.from("app_settings").insert([
    { tenant_id: A.tenantId, kind: "sales_revenue_account", value: OLD },
    { tenant_id: A.tenantId, kind: "bar_cash_account", value: SETTING_ONLY },
  ])).error);
  must("ขาลงบัญชี", (await db.from("pay_post_legs").insert({
    tenant_id: A.tenantId, code: "tnet", name: "ทดสอบสุทธิ", amount_source: "net", category: "เงินเดือน", account_name: OLD,
  })).error);

  asMain = await signIn(A);
  const { data, error } = await asMain.rpc("fn_save_transaction", {
    p: {
      transaction_date: "2026-10-05", type: "รายจ่าย", account_name: OLD, category: "ค่าบริการ",
      contact_name: "ร้านทดสอบ", description: "ทดสอบบัญชี", base_amount: 100, discount: 0,
      amount_after_discount: 100, vat_amount: 0, wht_rate: 0, wht_amount: 0, net_amount: 100,
      tax_invoice_no: "", tax_invoice_date: null, entity_id: A.entityId, ap_ar_status: null,
    },
    p_items: [{ item_name: "ค่าบริการทดสอบ", quantity: 1, in_vat: 100, ex_vat: 100, total_price: 100 }],
  });
  must("บิล", error);
  txId = (data as { tx_id: string }).tx_id;

  asClerk = (await seedUser(A, "accounting")).client;
  const r = await seedUser(A, "finance_manager");
  must("จำกัดกิจการ", (await db.from("profiles").update({ allowed_entity_ids: [A.entityId] }).eq("id", r.userId)).error);
  asRestricted = r.client;
}, 180_000);

afterAll(async () => {
  await asMain?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("fn_bank_account_usage", () => {
  it("นับบิล/ขาเงินเดือน/ค่าตั้งของแต่ละบัญชี", async () => {
    const { data, error } = await asMain.rpc("fn_bank_account_usage");
    expect(error).toBeNull();
    const by = new Map((data as { account_name: string }[]).map((r) => [r.account_name, r]));
    expect(by.get(OLD)).toMatchObject({ tx_count: 1, leg_count: 1, setting_kinds: ["sales_revenue_account"] });
    expect(by.get(UNUSED)).toMatchObject({ tx_count: 0, pay_count: 0, leg_count: 0, setting_kinds: [] });
  });
  it("พนักงานบัญชี (ไม่มี acct.config) เรียกไม่ได้", async () => {
    const { error } = await asClerk.rpc("fn_bank_account_usage");
    expect(error?.message).toMatch(/สิทธิ์ตั้งค่าบัญชี/);
  });
});

describe("fn_rename_bank_account", () => {
  it("ไม่มีสิทธิ์ / ถูกจำกัดกิจการ = ปฏิเสธ และไม่มีอะไรขยับ", async () => {
    expect((await asClerk.rpc("fn_rename_bank_account", { p_old: OLD, p_new: NEW })).error?.message).toMatch(/สิทธิ์/);
    expect((await asRestricted.rpc("fn_rename_bank_account", { p_old: OLD, p_new: NEW })).error?.message).toMatch(/จำกัด/);
    const { data } = await admin().from("transactions").select("account_name").eq("tenant_id", A.tenantId).eq("tx_id", txId).single();
    expect(data?.account_name).toBe(OLD);
  });
  it("ชื่อซ้ำบัญชีที่มีอยู่ = ปฏิเสธ", async () => {
    expect((await asMain.rpc("fn_rename_bank_account", { p_old: OLD, p_new: UNUSED })).error?.message).toMatch(/อยู่แล้ว/);
  });
  it("🚩 เปลี่ยนชื่อแล้วบิล · ขาเงินเดือน · ค่าตั้ง ตามไปหมด", async () => {
    const { data, error } = await asMain.rpc("fn_rename_bank_account", { p_old: OLD, p_new: `  ${NEW} ` });
    expect(error).toBeNull();
    expect(data).toMatchObject({ changed: true, tx: 1, legs: 1, settings: 1 });
    const db = admin();
    const tx = await db.from("transactions").select("account_name").eq("tenant_id", A.tenantId).eq("tx_id", txId).single();
    expect(tx.data?.account_name).toBe(NEW);
    const leg = await db.from("pay_post_legs").select("account_name").eq("tenant_id", A.tenantId).eq("code", "tnet").single();
    expect(leg.data?.account_name).toBe(NEW);
    const s = await db.from("app_settings").select("value").eq("tenant_id", A.tenantId).eq("kind", "sales_revenue_account");
    expect((s.data ?? []).map((r) => r.value)).toEqual([NEW]);
    const acc = await db.from("bank_accounts").select("account_name").eq("tenant_id", A.tenantId).eq("account_id", "T-ACC-OLD").single();
    expect(acc.data?.account_name).toBe(NEW);
    // ★ ไม่มีอะไรค้างชื่อเดิม
    const left = await db.from("transactions").select("tx_id").eq("tenant_id", A.tenantId).eq("account_name", OLD);
    expect(left.data).toEqual([]);
  });
});

describe("fn_delete_bank_account", () => {
  it("มีบิลอยู่ = ลบไม่ได้ (ให้ปิดใช้แทน)", async () => {
    expect((await asMain.rpc("fn_delete_bank_account", { p_name: NEW })).error?.message).toMatch(/ปิดใช้/);
  });
  it("ถูกตั้งค่าใช้อยู่ = ลบไม่ได้", async () => {
    expect((await asMain.rpc("fn_delete_bank_account", { p_name: SETTING_ONLY })).error?.message).toMatch(/ตั้งค่าใช้อยู่/);
  });
  it("ถูกจำกัดกิจการ = ลบไม่ได้", async () => {
    expect((await asRestricted.rpc("fn_delete_bank_account", { p_name: UNUSED })).error?.message).toMatch(/จำกัด/);
  });
  it("ไม่มีอะไรอ้างถึง = ลบได้", async () => {
    const { error } = await asMain.rpc("fn_delete_bank_account", { p_name: UNUSED });
    expect(error).toBeNull();
    const { data } = await admin().from("bank_accounts").select("account_id").eq("tenant_id", A.tenantId).eq("account_name", UNUSED);
    expect(data).toEqual([]);
  });
});

describe("active", () => {
  it("ปิดใช้/เปิดใช้ผ่าน update ปกติ (RLS acct.config) · พนักงานบัญชีทำไม่ได้", async () => {
    const off = await asMain.from("bank_accounts").update({ active: false }).eq("account_id", "T-ACC-OLD").select("active");
    expect(off.data?.[0]?.active).toBe(false);
    const clerk = await asClerk.from("bank_accounts").update({ active: true }).eq("account_id", "T-ACC-OLD").select("active");
    expect(clerk.data ?? []).toEqual([]);
  });
});
