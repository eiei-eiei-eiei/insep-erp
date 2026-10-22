import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, admin, type Tenant } from "./harness";

/**
 * D120 จำกัดผู้ใช้ให้เห็นเฉพาะบางกิจการ (migration 0087) — ยิงด้วย client ของผู้ใช้จริง
 *
 * โครง: tenant เดียว 2 กิจการ · EID01 = บริษัท · EIDP = ส่วนตัว (ข้อมูลที่ต้องซ่อน)
 *   staff = finance_manager (บัญชี + เงินเดือน + ตั้งค่าทั้งสองหน้า) ถูกจำกัดให้เห็นแค่ EID01
 * 🚨 ทุกข้อพิสูจน์ 2 ทิศ: ของ EID01 ทำได้ (positive control) · ของ EIDP ทำไม่ได้
 *    "อ่านไม่ได้" ในโลก RLS = ได้ลิสต์ว่าง ไม่ใช่ error → assert จำนวนแถว (บทเรียน D85)
 */

let A: Tenant;
let asMain: SupabaseClient;
let asStaff: SupabaseClient;
const P = "EIDP";
const TX_C = "TR-ENT-C-0001";
const TX_P = "TR-ENT-P-0001";
const PER_C = "PR-ENT-C-01";
const PER_P = "PR-ENT-P-01";

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("ent");
  const db = admin();
  const must = (w: string, e: { message: string } | null) => { if (e) throw new Error(`${w}: ${e.message}`); };
  const T = A.tenantId;
  must("กิจการส่วนตัว", (await db.from("entities").insert({ tenant_id: T, entity_id: P, name: "ส่วนตัวทดสอบ", is_vat: true })).error);
  must("บัญชี", (await db.from("bank_accounts").insert([
    { tenant_id: T, account_id: "T-B-C", account_name: "บัญชีบริษัทจำกัด", entity_ids: [A.entityId], opening_balance: 100 },
    { tenant_id: T, account_id: "T-B-P", account_name: "บัญชีส่วนตัวลับ", entity_ids: [P], opening_balance: 999999 },
    { tenant_id: T, account_id: "T-B-S", account_name: "บัญชีใช้ร่วม", entity_ids: [], opening_balance: 0 },
  ])).error);
  const tx = (id: string, ent: string) => ({
    tenant_id: T, entity_id: ent, tx_id: id, transaction_date: "2026-09-10", type: "รายจ่าย",
    account_name: ent === P ? "บัญชีส่วนตัวลับ" : "บัญชีบริษัทจำกัด", net_amount: 107, vat_amount: 7,
    amount_after_discount: 100, status: "ปกติ",
  });
  must("บิล", (await db.from("transactions").insert([tx(TX_C, A.entityId), tx(TX_P, P)])).error);
  must("รายการ", (await db.from("transaction_items").insert([
    { tenant_id: T, item_id: `${TX_C}-01`, tx_id: TX_C, item_name: "ของบริษัท", quantity: 1, ex_vat: 100, total_price: 100 },
    { tenant_id: T, item_id: `${TX_P}-01`, tx_id: TX_P, item_name: "ของส่วนตัว", quantity: 1, ex_vat: 100, total_price: 100 },
  ])).error);
  must("สรุปภาษี", (await db.from("tax_summaries").insert([
    { tenant_id: T, entity_id: A.entityId, report_month: "2026-09", total_purchase_vat: 7 },
    { tenant_id: T, entity_id: P, report_month: "2026-09", total_purchase_vat: 7 },
  ])).error);
  must("report_runs", (await db.from("report_runs").insert([
    { tenant_id: T, entity_id: A.entityId, month: "2026-09", report_key: "pnd_3_53" },
    { tenant_id: T, entity_id: P, month: "2026-09", report_key: "pnd_3_53" },
  ])).error);
  must("พนักงาน", (await db.from("employees").insert([
    { tenant_id: T, entity_id: A.entityId, emp_id: "T-EMP-C", name: "พนักงานบริษัท" },
    { tenant_id: T, entity_id: P, emp_id: "T-EMP-P", name: "คนสวนส่วนตัว" },
  ])).error);
  must("งวด", (await db.from("payroll_periods").insert([
    { tenant_id: T, entity_id: A.entityId, period_id: PER_C, year: 2026, month: 9, work_days_std: 22 },
    { tenant_id: T, entity_id: P, period_id: PER_P, year: 2026, month: 9, work_days_std: 22 },
  ])).error);
  must("บรรทัดงวด", (await db.from("payroll_items").insert([
    { tenant_id: T, period_id: PER_C, emp_id: "T-EMP-C", emp_name: "พนักงานบริษัท", net: 15000 },
    { tenant_id: T, period_id: PER_P, emp_id: "T-EMP-P", emp_name: "คนสวนส่วนตัว", net: 9000 },
  ])).error);

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

describe("บัญชีธนาคาร", () => {
  it("★ staff เห็นบัญชีบริษัท + บัญชีใช้ร่วม แต่ไม่เห็นบัญชีส่วนตัว", async () => {
    const { data } = await asStaff.from("bank_accounts").select("account_name").order("account_name");
    expect((data ?? []).map((r) => r.account_name).sort()).toEqual(["บัญชีบริษัทจำกัด", "บัญชีใช้ร่วม"].sort());
  });
  it("positive control: main เห็นครบ 3 บัญชี", async () => {
    const { data } = await asMain.from("bank_accounts").select("account_name");
    expect(data).toHaveLength(3);
  });
  it("staff แก้ยอดยกมาของบัญชีส่วนตัวไม่ได้ (update ไม่โดนแถวไหน)", async () => {
    const { data } = await asStaff.from("bank_accounts").update({ opening_balance: 1 }).eq("account_id", "T-B-P").select("account_id");
    expect(data ?? []).toHaveLength(0);
    const { data: still } = await admin().from("bank_accounts").select("opening_balance").eq("tenant_id", A.tenantId).eq("account_id", "T-B-P").single();
    expect(Number(still!.opening_balance)).toBe(999999);
  });
  it("🪤 staff เพิ่มบัญชีที่ผูกกิจการส่วนตัวด้วยไม่ได้ (with check ใช้ <@)", async () => {
    const { error } = await asStaff.from("bank_accounts").insert({
      tenant_id: A.tenantId, account_id: "T-B-X", account_name: "แอบผูกสองกิจการ", entity_ids: [A.entityId, P],
    });
    expect(error).not.toBeNull();
  });
  it("positive control: แถวเดียวกันแต่ผูกเฉพาะ EID01 เพิ่มได้ (ข้อบนแดงเพราะกิจการ ไม่ใช่เพราะอย่างอื่น)", async () => {
    const { error } = await asStaff.from("bank_accounts").insert({
      tenant_id: A.tenantId, account_id: "T-B-Y", account_name: "ผูกแค่บริษัท", entity_ids: [A.entityId],
    });
    expect(error, error?.message).toBeNull();
  });
});

describe("ฝั่งเขียนของตารางลูก", () => {
  it("🚨 staff ลบรายการสินค้าของบิลส่วนตัวไม่ได้ (ti_w เดิมไม่กรองกิจการ)", async () => {
    await asStaff.from("transaction_items").delete().eq("tx_id", TX_P);
    const { data } = await admin().from("transaction_items").select("item_id").eq("tenant_id", A.tenantId).eq("tx_id", TX_P);
    expect(data, "รายการของบิลที่มองไม่เห็นถูกลบ = รูยังอยู่").toHaveLength(1);
  });
  it("positive control: staff แก้รายการของบิลบริษัทได้", async () => {
    const { data } = await asStaff.from("transaction_items").update({ item_name: "ของบริษัท (แก้)" }).eq("tx_id", TX_C).select("item_id");
    expect(data).toHaveLength(1);
  });
  it("staff เขียนสรุปภาษีของกิจการส่วนตัวไม่ได้", async () => {
    const { error } = await asStaff.from("tax_summaries").insert({ tenant_id: A.tenantId, entity_id: P, report_month: "2026-10" });
    expect(error).not.toBeNull();
    const ok = await asStaff.from("tax_summaries").insert({ tenant_id: A.tenantId, entity_id: A.entityId, report_month: "2026-10" });
    expect(ok.error, ok.error?.message).toBeNull();
  });
  it("staff ออก 50ทวิ ในนามกิจการส่วนตัวไม่ได้", async () => {
    const { error } = await asStaff.from("wht_certificates").insert({
      tenant_id: A.tenantId, entity_id: P, doc_no: "T-ENT-9001", contact_name: "ใครก็ได้", tx_ids: [], issue_date: "2026-09-30",
    });
    expect(error).not.toBeNull();
    const ok = await asStaff.from("wht_certificates").insert({
      tenant_id: A.tenantId, entity_id: A.entityId, doc_no: "T-ENT-9002", contact_name: "ใครก็ได้", tx_ids: [], issue_date: "2026-09-30",
    });
    expect(ok.error, `positive control: ${ok.error?.message}`).toBeNull();
  });
  it("report_runs: staff เห็นเฉพาะของบริษัท", async () => {
    const { data } = await asStaff.from("report_runs").select("entity_id");
    expect((data ?? []).map((r) => r.entity_id)).toEqual([A.entityId]);
  });
});

describe("เงินเดือน", () => {
  it("★ staff เห็นบรรทัดงวดของบริษัทเท่านั้น (payroll_items เดิมอ่านข้ามกิจการได้)", async () => {
    const { data } = await asStaff.from("payroll_items").select("emp_name");
    expect((data ?? []).map((r) => r.emp_name)).toEqual(["พนักงานบริษัท"]);
  });
  it("positive control: main เห็น 2 บรรทัด", async () => {
    const { data } = await asMain.from("payroll_items").select("emp_name");
    expect(data).toHaveLength(2);
  });
  it("🚨 staff ลงบัญชีงวดของกิจการส่วนตัวผ่าน RPC definer ไม่ได้", async () => {
    const { error } = await asStaff.rpc("fn_post_payroll", { p_period_id: PER_P, p_kind: "net", p_date: "2026-09-30", p_payload: { lines: [] } });
    expect(error?.message ?? "").toMatch(/ไม่มีสิทธิ์ในกิจการ/);
  });
  it("staff ถอนการลงบัญชีงวดของกิจการส่วนตัวไม่ได้", async () => {
    const { error } = await asStaff.rpc("fn_unpost_payroll", { p_period_id: PER_P, p_kind: "net" });
    expect(error?.message ?? "").toMatch(/ไม่มีสิทธิ์ในกิจการ/);
  });
});

describe("RPC ภาษี", () => {
  it("🚨 staff บันทึกจ่าย ภพ.30 ของกิจการส่วนตัวไม่ได้", async () => {
    const { error } = await asStaff.rpc("fn_pay_tax", {
      p_kind: "vat", p_period: "2026-09", p_entity: P, p_date: "2026-10-10", p_amount: 7,
      p_surcharge: 0, p_payload: { account_name: "บัญชีใช้ร่วม" },
    });
    expect(error?.message ?? "").toMatch(/ไม่มีสิทธิ์ในกิจการ/);
  });
  it("staff ถอนการจ่ายของกิจการส่วนตัวไม่ได้", async () => {
    const { error } = await asStaff.rpc("fn_unpay_tax", { p_kind: "vat", p_period: "2026-09", p_entity: P });
    expect(error?.message ?? "").toMatch(/ไม่มีสิทธิ์ในกิจการ/);
  });
  it("positive control: ด่านกิจการไม่ไปบล็อกกิจการของตัวเอง (ไปติดด่านถัดไปแทน)", async () => {
    const { error } = await asStaff.rpc("fn_unpay_tax", { p_kind: "vat", p_period: "2026-09", p_entity: A.entityId });
    expect(error?.message ?? "").not.toMatch(/ไม่มีสิทธิ์ในกิจการ/);
  });
  it("fn_wht_doc_nos ไม่คืนเลขของกิจการส่วนตัว", async () => {
    await admin().from("wht_certificates").insert({ tenant_id: A.tenantId, entity_id: P, doc_no: "T-ENT-8001", contact_name: "x", tx_ids: [], issue_date: "2026-09-30" });
    const { data } = await asStaff.rpc("fn_wht_doc_nos", { p_entity_id: P });
    expect(data ?? []).toHaveLength(0);
    const { data: m } = await asMain.rpc("fn_wht_doc_nos", { p_entity_id: P });
    expect((m ?? []).length, "positive control: main ได้เลข").toBeGreaterThan(0);
  });
});

describe("ของที่กรองอยู่แล้วตั้งแต่ก่อน (กันถอยหลัง)", () => {
  it("บิล/กิจการ/พนักงาน: staff เห็นแค่ของบริษัท", async () => {
    const [tx, ent, emp] = await Promise.all([
      asStaff.from("transactions").select("tx_id").in("tx_id", [TX_C, TX_P]),
      asStaff.from("entities").select("entity_id"),
      asStaff.from("employees").select("emp_id"),
    ]);
    expect((tx.data ?? []).map((r) => r.tx_id)).toEqual([TX_C]);
    expect((ent.data ?? []).map((r) => r.entity_id)).toEqual([A.entityId]);
    expect((emp.data ?? []).map((r) => r.emp_id)).toEqual(["T-EMP-C"]);
  });
  it("staff แก้ allowed_entity_ids ของตัวเองคืนไม่ได้ (profiles_write ต้อง admin)", async () => {
    const { data: me } = await asStaff.auth.getUser();
    const { data } = await asStaff.from("profiles").update({ allowed_entity_ids: null }).eq("id", me.user!.id).select("id");
    expect(data ?? []).toHaveLength(0);
  });
});
