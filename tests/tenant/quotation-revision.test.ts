import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, type Tenant } from "./harness";

/**
 * D168 · 0110 — ฉบับแก้ไขของใบเสนอราคา
 *
 * 🔴 การนับอยู่ใน plpgsql (fn_quotation_fingerprint · fn_quotation_close_revision) — ชั้นนี้ชั้นเดียวที่พิสูจน์ว่า
 *    นับเฉพาะเมื่อสิ่งที่พิมพ์บนใบเปลี่ยนจริง · แก้แค่แผนงวดก็นับ · บันทึกซ้ำโดยไม่เปลี่ยน = ไม่นับ
 * ★ ลำดับเรียกเหมือน updateQuotationAction: fn_update_quotation → (fn_sales_set_plan) → fn_quotation_close_revision
 */

let A: Tenant;
let asA: SupabaseClient;
const QU = "QU-REV-1";
const ORD = "ORD-REV-1";

const head = (net: number, remarks = "") => ({
  customer_name: "ลูกค้าทดสอบ", sub_total: net, sub_discount: net, grand_total: net, net_payable: net, remarks,
});
const items = (price: number) => [{ name: "สุราทดสอบ", qty: 2, price }];

async function rev() {
  const { data, error } = await admin().from("sales_orders")
    .select("qu_rev, qu_rev_on").eq("tenant_id", A.tenantId).eq("qu_no", QU).single();
  if (error) throw new Error(error.message);
  return { rev: Number(data.qu_rev), on: data.qu_rev_on as string | null };
}

/** แก้ใบเสนอราคา 1 รอบ (ตั้งแผนได้ถ้าส่งมา) แล้วปิดรอบ — คืนผลของตัวปิดรอบ */
async function edit(net: number, price: number, opts: { remarks?: string; plan?: unknown[] } = {}) {
  const u = await asA.rpc("fn_update_quotation", { p_qu_no: QU, p: head(net, opts.remarks), p_items: items(price) });
  expect(u.error).toBeNull();
  const ud = u.data as { ok: boolean; fp_before?: string };
  expect(ud.ok).toBe(true);
  expect(typeof ud.fp_before).toBe("string");
  if (opts.plan) {
    const p = await asA.rpc("fn_sales_set_plan", { p_qu_no: QU, p_rows: opts.plan });
    expect(p.error).toBeNull();
  }
  const c = await asA.rpc("fn_quotation_close_revision", { p_qu_no: QU, p_fp_before: ud.fp_before });
  expect(c.error).toBeNull();
  return c.data as { ok: boolean; rev: number; changed: boolean };
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("qurev");
  asA = await signIn(A);
  const r = await admin().from("sales_orders").insert({
    tenant_id: A.tenantId, entity_id: A.entityId, qu_no: QU, order_no: ORD,
    customer_id: A.contactId, customer_name: "ลูกค้าทดสอบ",
    status: "รอคอนเฟิร์ม", sub_total: 1000, sub_discount: 1000, grand_total: 1000, net_payable: 1000, outstanding_balance: 1000,
  });
  if (r.error) throw new Error(r.error.message);
  const it = await admin().from("sales_order_items").insert({ tenant_id: A.tenantId, qu_no: QU, item_name: "สุราทดสอบ", qty: 2, price: 500 });
  if (it.error) throw new Error(it.error.message);
}, 120_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("นับฉบับแก้ไข", () => {
  it("ฉบับแรก = 0 · ไม่มีวันที่", async () => {
    expect(await rev()).toEqual({ rev: 0, on: null });
  });
  it("บันทึกโดยไม่เปลี่ยนอะไร → ไม่นับ", async () => {
    const r = await edit(1000, 500);
    expect(r).toMatchObject({ ok: true, rev: 0, changed: false });
    expect((await rev()).rev).toBe(0);
  });
  it("ลดราคา → ฉบับแก้ไขครั้งที่ 1 + ลงวันที่", async () => {
    const r = await edit(900, 450);
    expect(r).toMatchObject({ ok: true, rev: 1, changed: true });
    const v = await rev();
    expect(v.rev).toBe(1);
    expect(v.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("แก้แค่หมายเหตุ → ครั้งที่ 2 (หมายเหตุพิมพ์บนใบ)", async () => {
    expect((await edit(900, 450, { remarks: "ส่งภายใน 7 วัน" })).rev).toBe(2);
  });
  it("แก้แค่เงื่อนไขงวด (บันทึกหลัง fn_update_quotation) → ยังนับ", async () => {
    const plan = [
      { label: "มัดจำ", percent: 50, amount: 450, due_date: null, ship_point: false },
      { label: "ส่งของ", percent: 50, amount: 450, due_date: null, ship_point: true },
    ];
    expect((await edit(900, 450, { remarks: "ส่งภายใน 7 วัน", plan })).rev).toBe(3);
    // ตั้งแผนเดิมซ้ำ = ไม่นับ
    expect((await edit(900, 450, { remarks: "ส่งภายใน 7 วัน", plan })).rev).toBe(3);
  });
  it("ไม่มีลายนิ้วมือก่อนแก้ (null) → ไม่นับ ไม่เดา", async () => {
    const c = await asA.rpc("fn_quotation_close_revision", { p_qu_no: QU, p_fp_before: null });
    expect(c.data).toMatchObject({ ok: true, rev: 3, changed: false });
  });
  it("เลข QU ที่ไม่มี → error ไทย ไม่ใช่ ok", async () => {
    const c = await asA.rpc("fn_quotation_close_revision", { p_qu_no: "QU-NONE", p_fp_before: "x" });
    expect(c.data).toMatchObject({ ok: false });
    expect((c.data as { error: string }).error).toContain("ไม่พบใบเสนอราคา");
  });
});
