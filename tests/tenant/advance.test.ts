import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, admin, type Tenant } from "./harness";

/**
 * D119 สำรองจ่าย (migration 0086) — ชั้นเดียวที่เห็น plpgsql + trigger + CHECK (บทเรียน D79)
 *
 * โครง: tenant เดียว 2 กิจการ
 *   EID01 = บริษัท (จด VAT) — ฝั่งที่ "ถูกซื้อให้"
 *   EIDP  = ส่วนตัว (ไม่จด VAT) — ฝั่งที่จ่ายเงินแทน
 * ผู้ใช้: main (เห็นทุกกิจการ) + staff role accounting ที่ถูกจำกัดให้เห็นแค่ EID01
 */

let A: Tenant;
let asMain: SupabaseClient;
let asStaff: SupabaseClient;
const P = "EIDP";
const ACC_P = "บัญชีส่วนตัวทดสอบ";
const ACC_P2 = "เงินสดส่วนตัวทดสอบ";
const ACC_C = "บัญชีบริษัททดสอบ";

const ITEMS = [
  { item_name: "สายไฟทดสอบ", quantity: 10, in_vat: 1070, ex_vat: 1000, total_price: 10000 },
];

async function saveAdvance(c: SupabaseClient, over: Record<string, unknown> = {}) {
  const { data, error } = await c.rpc("fn_save_transaction", {
    p: {
      transaction_date: "2026-09-25", type: "สำรองจ่าย", account_name: ACC_P, category: "ค่าต้นทุนสินค้า",
      contact_name: "ร้านทดสอบ", description: "ทดสอบสำรองจ่าย", base_amount: 10000, discount: 0,
      amount_after_discount: 10000, vat_amount: 700, wht_rate: 0, wht_amount: 0, net_amount: 10700,
      tax_invoice_no: "IV-TEST-1", tax_invoice_date: "2026-09-25", entity_id: P, advance_for_entity: A.entityId,
      ...over,
    },
    p_items: ITEMS,
  });
  return { txId: (data as { tx_id?: string } | null)?.tx_id ?? "", error };
}

const row = async (c: SupabaseClient, txId: string) =>
  (await c.from("transactions").select("*").eq("tx_id", txId).maybeSingle()).data as Record<string, unknown> | null;

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("adv");
  const db = admin();
  const must = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };
  must("กิจการส่วนตัว", (await db.from("entities").insert({
    tenant_id: A.tenantId, entity_id: P, name: "ส่วนตัวทดสอบ", is_vat: false,
  })).error);
  must("บัญชี", (await db.from("bank_accounts").insert([
    { tenant_id: A.tenantId, account_id: "T-ACC-P", account_name: ACC_P, entity_ids: [P], opening_balance: 50000 },
    { tenant_id: A.tenantId, account_id: "T-ACC-P2", account_name: ACC_P2, entity_ids: [P], opening_balance: 0 },
    { tenant_id: A.tenantId, account_id: "T-ACC-C", account_name: ACC_C, entity_ids: [A.entityId], opening_balance: 100000 },
  ])).error);
  asMain = await signIn(A);
  const staff = await seedUser(A, "accounting");
  must("จำกัดกิจการ staff", (await db.from("profiles")
    .update({ allowed_entity_ids: [A.entityId] }).eq("id", staff.userId)).error);
  asStaff = staff.client;
}, 180_000);

afterAll(async () => {
  await asMain?.auth.signOut().catch(() => {});
  await asStaff?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("บันทึกสำรองจ่าย", () => {
  it("★ คนจ่ายไม่จด VAT บันทึกบิลที่มี VAT ให้บริษัทที่จด VAT ได้ (ด่าน VAT ดูกิจการที่ซื้อให้)", async () => {
    const { txId, error } = await saveAdvance(asMain);
    expect(error, error?.message).toBeNull();
    const r = await row(asMain, txId);
    expect(r).toMatchObject({ type: "สำรองจ่าย", entity_id: P, advance_for_entity: A.entityId, advance_status: "รอเบิกคืน" });
  });

  it("★ กลับทิศ: สำรองจ่ายที่มี VAT ให้กิจการที่ไม่จด VAT ต้องถูกบล็อก", async () => {
    const { error } = await saveAdvance(asMain, { entity_id: A.entityId, account_name: ACC_C, advance_for_entity: P });
    expect(error, "บันทึก VAT ให้กิจการไม่จด VAT ได้ = ใบกำกับจะไปโผล่ตอนเคลีย").not.toBeNull();
    expect(error!.message).toMatch(/ไม่ได้จดทะเบียน VAT/);
  });

  it("สำรองจ่ายให้กิจการตัวเอง / ตั้งค้าง / ไม่มีบัญชี ต้องถูกปฏิเสธ (CHECK)", async () => {
    expect((await saveAdvance(asMain, { advance_for_entity: P })).error).not.toBeNull();
    expect((await saveAdvance(asMain, { ap_ar_status: "AP" })).error).not.toBeNull();
    expect((await saveAdvance(asMain, { account_name: "" })).error).not.toBeNull();
  });

  it("ผู้ใช้สร้างรายการรับคืนสำรองจ่ายเองไม่ได้ (ต้องมาจากปุ่มเคลีย)", async () => {
    const { error } = await asMain.from("transactions").insert({
      tenant_id: A.tenantId, entity_id: P, tx_id: "TR-ADV-FAKE-1", transaction_date: "2026-09-25",
      type: "รับคืนสำรองจ่าย", account_name: ACC_P, net_amount: 999, status: "ปกติ",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/ปุ่มเคลีย/);
  });

  it("service role (restore/import) ผ่านด่านได้ — ไม่งั้นย้อนข้อมูลจากไฟล์สำรองไม่ได้", async () => {
    const { error } = await admin().from("transactions").insert({
      tenant_id: A.tenantId, entity_id: P, tx_id: "TR-ADV-RESTORE-1", transaction_date: "2026-01-01",
      type: "รับคืนสำรองจ่าย", account_name: ACC_P, net_amount: 1, status: "ยกเลิก", advance_clear_id: "ADV-RESTORE",
    });
    expect(error, error?.message).toBeNull();
  });

  it("★★ staff ที่เห็นแค่บริษัท มองไม่เห็นบิลสำรองจ่าย (บริษัทยังไม่รู้จนกว่าจะเคลีย)", async () => {
    const { txId } = await saveAdvance(asMain, { description: "ซ่อนจากบริษัท" });
    expect(await row(asMain, txId), "positive control: main ต้องเห็น").not.toBeNull();
    expect(await row(asStaff, txId)).toBeNull();
  });
});

describe("เคลีย → ถอน → เคลียใหม่", () => {
  let adv1 = "";
  let clearId = "";
  let billId = "";
  let refundId = "";

  beforeAll(async () => {
    adv1 = (await saveAdvance(asMain, { description: "รอบเคลีย" })).txId;
  });

  it("บัญชีจ่ายคืนต้องเป็นของกิจการที่ซื้อให้", async () => {
    const { data } = await asMain.rpc("fn_clear_advances", { p_tx_ids: [adv1], p_pay_account: ACC_P2, p_date: "2026-10-10" });
    expect(data).toMatchObject({ ok: false });
    expect((data as { error: string }).error).toMatch(/ไม่ใช่บัญชีของกิจการ/);
  });

  it("เคลียก่อนวันที่สำรองจ่ายไม่ได้", async () => {
    const { data } = await asMain.rpc("fn_clear_advances", { p_tx_ids: [adv1], p_pay_account: ACC_C, p_date: "2026-09-24" });
    expect(data).toMatchObject({ ok: false });
  });

  it("★ เคลียสำเร็จ: บิลรายจ่ายของบริษัทลงวันเคลีย + รับคืนเข้าบัญชีที่จ่ายออก", async () => {
    const { data, error } = await asMain.rpc("fn_clear_advances", { p_tx_ids: [adv1], p_pay_account: ACC_C, p_date: "2026-10-10" });
    expect(error, error?.message).toBeNull();
    const res = data as { ok: boolean; clear_id: string; bills: string[]; refund_tx: string; total: number };
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(res.total).toBe(10700);
    clearId = res.clear_id; billId = res.bills[0]; refundId = res.refund_tx;

    expect(await row(asMain, adv1)).toMatchObject({ advance_status: "เคลียแล้ว", advance_clear_id: clearId });
    expect(await row(asMain, billId)).toMatchObject({
      type: "รายจ่าย", entity_id: A.entityId, account_name: ACC_C, transaction_date: "2026-10-10",
      tax_invoice_date: "2026-09-25", vat_amount: 700, net_amount: 10700, advance_src_tx: adv1, status: "ปกติ",
    });
    expect(await row(asMain, refundId)).toMatchObject({
      type: "รับคืนสำรองจ่าย", entity_id: P, account_name: ACC_P, net_amount: 10700,
    });
    const items = (await asMain.from("transaction_items").select("item_name, quantity, ex_vat").eq("tx_id", billId)).data;
    expect(items).toEqual([{ item_name: "สายไฟทดสอบ", quantity: 10, ex_vat: 1000 }]);
  });

  it("staff เห็นบิลของบริษัทแล้ว แต่ยังไม่เห็นรายการรับคืนของฝั่งส่วนตัว", async () => {
    expect(await row(asStaff, billId)).not.toBeNull();
    expect(await row(asStaff, refundId)).toBeNull();
  });

  it("เคลียซ้ำใบเดิมไม่ได้", async () => {
    const { data } = await asMain.rpc("fn_clear_advances", { p_tx_ids: [adv1], p_pay_account: ACC_C, p_date: "2026-10-10" });
    expect(data).toMatchObject({ ok: false });
    expect((data as { error: string }).error).toMatch(/รอเบิกคืน/);
  });

  it("🚨 ยกเลิกบิลบริษัทใบเดียว / แก้บิลสำรองจ่ายที่เคลียแล้ว / แก้รายการรับคืน ตรง ๆ ไม่ได้", async () => {
    const v = await asMain.rpc("fn_void_transaction", { p_tx_id: billId });
    expect(v.error?.message ?? "").toMatch(/ถอนการเคลีย/);
    const e = await asMain.from("transactions").update({ description: "แก้" }).eq("tx_id", adv1);
    expect(e.error?.message ?? "").toMatch(/เคลียแล้ว/);
    const f = await asMain.from("transactions").update({ net_amount: 1 }).eq("tx_id", refundId);
    expect(f.error?.message ?? "").toMatch(/ถอนการเคลีย/);
    expect(await row(asMain, billId)).toMatchObject({ status: "ปกติ" });
  });

  it("แก้รายละเอียดบิลของบริษัทที่เกิดจากการเคลียได้ตามปกติ", async () => {
    const { error } = await asMain.from("transactions").update({ description: "แก้คำอธิบาย" }).eq("tx_id", billId);
    expect(error, error?.message).toBeNull();
  });

  it("ถอนการเคลียต้องเป็นระดับหัวหน้า (accounting ธรรมดาไม่มี acct.config)", async () => {
    const { data } = await asStaff.rpc("fn_unclear_advances", { p_clear_id: clearId });
    expect(data).toMatchObject({ ok: false });
    expect((data as { error: string }).error).toMatch(/สิทธิ์ไม่พอ/);
  });

  it("★ ถอนการเคลีย: บิลบริษัท + รับคืน ถูกยกเลิก · สำรองจ่ายกลับเป็นรอเบิกคืน", async () => {
    const { data, error } = await asMain.rpc("fn_unclear_advances", { p_clear_id: clearId });
    expect(error, error?.message).toBeNull();
    expect(data).toMatchObject({ ok: true, voided: 2, reopened: 1 });
    expect(await row(asMain, billId)).toMatchObject({ status: "ยกเลิก" });
    expect(await row(asMain, refundId)).toMatchObject({ status: "ยกเลิก" });
    expect(await row(asMain, adv1)).toMatchObject({ advance_status: "รอเบิกคืน", advance_clear_id: null });
  });

  it("ถอนซ้ำ = error ไทย ไม่ใช่ ok (บทเรียน D93)", async () => {
    const { data } = await asMain.rpc("fn_unclear_advances", { p_clear_id: clearId });
    expect(data).toMatchObject({ ok: false });
  });

  it("เคลียใหม่ได้หลังถอน (ได้เลขการเคลียใหม่)", async () => {
    const { data } = await asMain.rpc("fn_clear_advances", { p_tx_ids: [adv1], p_pay_account: ACC_C, p_date: "2026-10-12" });
    expect(data).toMatchObject({ ok: true });
    expect((data as { clear_id: string }).clear_id).not.toBe(clearId);
  });
});

describe("เคลียหลายใบ + ตัดเป็นส่วนตัว", () => {
  it("หลายใบจ่ายจากหลายบัญชี: ไม่ระบุบัญชีรับคืน = error ให้เลือก", async () => {
    const a = (await saveAdvance(asMain)).txId;
    const b = (await saveAdvance(asMain, { account_name: ACC_P2 })).txId;
    const { data } = await asMain.rpc("fn_clear_advances", { p_tx_ids: [a, b], p_pay_account: ACC_C, p_date: "2026-10-10" });
    expect(data).toMatchObject({ ok: false });
    expect((data as { error: string }).error).toMatch(/หลายบัญชี/);
    const ok = await asMain.rpc("fn_clear_advances", { p_tx_ids: [a, b], p_pay_account: ACC_C, p_refund_account: ACC_P, p_date: "2026-10-10" });
    expect(ok.data).toMatchObject({ ok: true, count: 2, total: 21400 });
    expect((ok.data as { bills: string[] }).bills).toHaveLength(2);
  });

  it("★ ตัดเป็นส่วนตัว: VAT รวมเป็นต้นทุน · เงินที่จ่ายจริงเท่าเดิม · ทำซ้ำไม่ได้", async () => {
    const { txId } = await saveAdvance(asMain, { description: "บริษัทไม่คืน" });
    const { data } = await asMain.rpc("fn_advance_to_personal", { p_tx_id: txId });
    expect(data).toMatchObject({ ok: true });
    expect(await row(asMain, txId)).toMatchObject({
      type: "รายจ่าย", entity_id: P, vat_amount: 0, amount_after_discount: 10700, net_amount: 10700,
      advance_status: "ตัดเป็นส่วนตัว",
    });
    const again = await asMain.rpc("fn_advance_to_personal", { p_tx_id: txId });
    expect(again.data).toMatchObject({ ok: false });
  });
});
