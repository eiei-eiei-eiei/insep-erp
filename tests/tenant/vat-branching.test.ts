import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, type Tenant } from "./harness";

/**
 * เทสว่า **ฐานข้อมูล** บล็อกกิจการที่ไม่จด VAT จริง (4.3 · migration 0036)
 *
 * 🚨 ทำไมต้องเทสที่ชั้น DB ไม่ใช่แค่เทสฟังก์ชัน:
 *    ผู้ไม่จด VAT ออกใบกำกับภาษี = ผิดกฎหมาย (ม.86/13) และ anon key เป็นค่าสาธารณะ
 *    → ถ้ากันแค่ในหน้าเว็บ ใครก็ยิง PostgREST ตรงข้ามด่านได้
 *    เทสชุดนี้จึงยิงด้วย client ของผู้ใช้จริง ไม่ได้เรียกฟังก์ชัน TypeScript
 *
 * โครง: tenant เดียว 2 กิจการ — EID01 จด VAT · EIDNV ไม่จด VAT
 *       (ตรงกับของจริงของเจ้าของระบบ: EID01 บริษัท จด VAT + EID02 บุคคลธรรมดา ไม่จด)
 */

let A: Tenant;
let asA: SupabaseClient;
const NOVAT = "EIDNV";

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("vat");
  // กิจการที่ไม่จด VAT — สร้างด้วย service role (RLS ห้ามลูกค้า insert entities เอง)
  const { error } = await admin().from("entities").insert({
    tenant_id: A.tenantId, entity_id: NOVAT, name: "กิจการไม่จด VAT ทดสอบ", is_vat: false,
  });
  if (error) throw new Error(`สร้างกิจการไม่จด VAT: ${error.message}`);
  asA = await signIn(A);
}, 180_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

// ── 1. บันทึกรายการที่มี VAT ให้กิจการไม่จด VAT ──────────────────────────────
describe("รายการบัญชีที่มี VAT", () => {
  it("★ กิจการไม่จด VAT: insert transactions ที่มี vat_amount > 0 ต้องถูกปฏิเสธ", async () => {
    const { error } = await asA.from("transactions").insert({
      tenant_id: A.tenantId, entity_id: NOVAT, tx_id: "TR-VAT-BLOCK-01",
      transaction_date: "2026-08-14", type: "รายรับ", account_name: "บัญชีทดสอบ",
      net_amount: 107, vat_amount: 7, status: "ปกติ",
    });
    expect(error, "ยิงตรงผ่าน API แล้วบันทึก VAT ได้ = กันแค่หน้าจอ ไม่ได้กันจริง").not.toBeNull();
    expect(error!.message).toMatch(/ไม่ได้จดทะเบียน VAT/);
  });

  it("กิจการไม่จด VAT: บันทึกรายการที่ไม่มี VAT ได้ปกติ", async () => {
    const { error } = await asA.from("transactions").insert({
      tenant_id: A.tenantId, entity_id: NOVAT, tx_id: "TR-VAT-OK-01",
      transaction_date: "2026-08-14", type: "รายรับ", account_name: "บัญชีทดสอบ",
      net_amount: 100, vat_amount: 0, status: "ปกติ",
    });
    expect(error, error?.message).toBeNull();
  });

  it("positive control — กิจการที่จด VAT บันทึก VAT ได้ตามปกติ (กันเทสหลอกตัวเอง)", async () => {
    const { error } = await asA.from("transactions").insert({
      tenant_id: A.tenantId, entity_id: A.entityId, tx_id: "TR-VAT-OK-02",
      transaction_date: "2026-08-14", type: "รายรับ", account_name: "บัญชีทดสอบ",
      net_amount: 107, vat_amount: 7, status: "ปกติ",
    });
    expect(error, error?.message).toBeNull();
  });
});

// ── 2. ออกใบกำกับภาษี ────────────────────────────────────────────────────────
describe("เลขใบกำกับภาษี (ม.86/13)", () => {
  it("★★ กิจการไม่จด VAT: ตั้ง tax_no1 ตอน insert ออเดอร์ ต้องถูกปฏิเสธ", async () => {
    const { error } = await asA.from("sales_orders").insert({
      tenant_id: A.tenantId, entity_id: NOVAT, qu_no: "QU-NOVAT-001", order_no: "ORD-NOVAT-001",
      customer_id: A.contactId, customer_name: "ลูกค้าทดสอบ",
      status: "รอคอนเฟิร์ม", grand_total: 100, outstanding_balance: 100,
      tax_no1: "TAX-แอบออก-001",
    });
    expect(error, "ผู้ไม่จด VAT ออกใบกำกับภาษีได้ = ผิดกฎหมาย ม.86/13").not.toBeNull();
    expect(error!.message).toMatch(/ออกใบกำกับภาษีไม่ได้/);
  });

  it("★★ กิจการไม่จด VAT: อัปเดตใส่ tax_no2 ทีหลัง ก็ต้องถูกปฏิเสธ", async () => {
    const ins = await asA.from("sales_orders").insert({
      tenant_id: A.tenantId, entity_id: NOVAT, qu_no: "QU-NOVAT-002", order_no: "ORD-NOVAT-002",
      customer_id: A.contactId, customer_name: "ลูกค้าทดสอบ",
      status: "รอคอนเฟิร์ม", grand_total: 100, outstanding_balance: 100,
    });
    expect(ins.error, ins.error?.message).toBeNull(); // ออเดอร์ปกติสร้างได้

    const { error } = await asA.from("sales_orders")
      .update({ tax_no2: "TAX-แอบออก-002" }).eq("qu_no", "QU-NOVAT-002");
    expect(error, "แทรกเลขใบกำกับทีหลังได้ = ด่านรั่ว").not.toBeNull();
  });

  it("กิจการไม่จด VAT: เลขใบแจ้งหนี้ (inv_no) ออกได้ปกติ — ผู้ไม่จด VAT ออกได้", async () => {
    const { error } = await asA.from("sales_orders")
      .update({ inv_no: "INV-NOVAT-002", status: "รอคลังจัดส่ง" }).eq("qu_no", "QU-NOVAT-002");
    expect(error, error?.message).toBeNull();
  });

  it("★ อัปเดตออเดอร์เดิมที่ไม่ได้แตะเลขภาษี ต้องไม่โดนบล็อก (กัน trigger ดักกว้างเกิน)", async () => {
    const { error } = await asA.from("sales_orders")
      .update({ status: "ปิดการขาย" }).eq("qu_no", "QU-NOVAT-002");
    expect(error, "แก้สถานะออเดอร์ไม่ได้ = ลูกค้าใช้งานไม่ได้เลย").toBeNull();
  });

  it("positive control — กิจการที่จด VAT ออกเลขใบกำกับได้ตามปกติ", async () => {
    const { error } = await asA.from("sales_orders").insert({
      tenant_id: A.tenantId, entity_id: A.entityId, qu_no: "QU-VAT-001", order_no: "ORD-VAT-001",
      customer_id: A.contactId, customer_name: "ลูกค้าทดสอบ",
      status: "รอคอนเฟิร์ม", grand_total: 107, outstanding_balance: 107,
      tax_no1: "TAX-ถูกต้อง-001",
    });
    expect(error, error?.message).toBeNull();
  });
});
