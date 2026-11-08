import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, admin, type Tenant } from "./harness";

/**
 * หัวหน้าบาร์ + แก้วันขาย/วิธีรับเงิน (D163 · migration 0109)
 *
 * 🔴 ชั้นเดียวที่เห็น has_cap()/RPC จริง (D79) — ยิงด้วย client ผู้ใช้จริง ไม่ใช่ service role
 * ★ ทุกข้อที่บล็อกตรวจด้วย admin ว่าแถวไม่ขยับจริง + มี positive control
 */

let A: Tenant;
let asMgr: SupabaseClient;
let asStaff: SupabaseClient;

const sale = async (no: string) => {
  const { data, error } = await admin().from("bar_sale").select("business_date, method, closed_at")
    .eq("tenant_id", A.tenantId).eq("entity_id", A.entityId).eq("sale_no", no).single();
  if (error) throw new Error(`อ่านบิล ${no}: ${error.message}`);
  return data as { business_date: string; method: string; closed_at: string };
};

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("baredit");
  const db = admin();
  const base = { tenant_id: A.tenantId, entity_id: A.entityId };
  const must = (w: string, e: { message: string } | null) => { if (e) throw new Error(`${w}: ${e.message}`); };

  must("ลูกค้า", (await db.from("bar_customer").insert({
    ...base, customer_id: "T-C1", name: "ทดสอบ ลูกค้า", first_seen: "2026-11-05", last_seen: "2026-11-05", visits: 1,
  }, { defaultToNull: false })).error);
  const closed = "2026-11-06T02:00:00Z";
  must("บิล", (await db.from("bar_sale").insert([
    { ...base, sale_no: "T-S-1", status: "ปกติ", tab_name: "ทดสอบ", closed_at: closed, business_date: "2026-11-05",
      method: "โอน/QR", sub_total: 100, grand_total: 100, customer_id: "T-C1" },
    { ...base, sale_no: "T-S-2", status: "ปกติ", tab_name: "ทดสอบ", closed_at: closed, business_date: "2026-11-03",
      method: "เงินสด", sub_total: 50, grand_total: 50, customer_id: null },
    { ...base, sale_no: "T-S-OPEN", status: "เปิดอยู่", tab_name: "ทดสอบ", closed_at: null, business_date: null,
      method: null, sub_total: 0, grand_total: 0, customer_id: null },
  ], { defaultToNull: false })).error);
  // วันที่ลงบัญชีแล้ว
  must("ลงบัญชี", (await db.from("bar_post").insert({ ...base, post_date: "2026-11-03" })).error);
  // บิลบัญชี 1 ใบ — ไม่มีแถวเลย "อ่านไม่ได้" จะผ่านฟรี (บทเรียน D85)
  must("บิลบัญชี", (await db.from("transactions").insert({
    ...base, tx_id: "T-TX-BAR", transaction_date: "2026-11-05", type: "รายจ่าย", account_name: "ทดสอบ",
    net_amount: 100, amount_after_discount: 100, base_amount: 100, status: "ปกติ",
  }, { defaultToNull: false })).error);

  asMgr = (await seedUser(A, "bar_manager")).client;
  asStaff = (await seedUser(A, "bar")).client;
}, 180_000);

afterAll(async () => {
  await cleanupTestTenants();
}, 120_000);

const edit = (c: SupabaseClient, no: string, date: string, method: string) =>
  c.rpc("fn_bar_edit_sale", { p_entity: A.entityId, p_sale_no: no, p_business_date: date, p_method: method });

describe("บทบาทหัวหน้าบาร์ (has_cap ใน DB จริง)", () => {
  it("หัวหน้าบาร์มี bar.config · ไม่มีอะไรนอกบาร์", async () => {
    for (const [cap, want] of [["bar.config", true], ["bar.write", true], ["acct.read", false], ["admin", false], ["sales.read", false]] as const) {
      const { data, error } = await asMgr.rpc("has_cap", { cap });
      expect(error).toBeNull();
      expect(data, cap).toBe(want);
    }
  });

  it("หัวหน้าบาร์อ่านบิลบัญชีไม่ได้ (RLS คืน 0 แถว ทั้งที่มีบิลอยู่จริง)", async () => {
    const { count } = await admin().from("transactions").select("tx_id", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId).eq("tx_id", "T-TX-BAR");
    expect(count).toBe(1); // positive control — มีแถวจริง
    const { data, error } = await asMgr.from("transactions").select("tx_id").eq("tx_id", "T-TX-BAR");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("fn_bar_edit_sale", () => {
  it("🔴 พนักงานบาร์แก้ไม่ได้ — แถวไม่ขยับ", async () => {
    const { error } = await edit(asStaff, "T-S-1", "2026-11-04", "โอน/QR");
    expect(error?.message).toMatch(/ไม่มีสิทธิ์/);
    expect((await sale("T-S-1")).business_date).toBe("2026-11-05");
  });

  it("หัวหน้าบาร์ย้ายวัน + เปลี่ยนวิธีรับเงินได้ · closed_at ไม่ขยับ · สถิติลูกค้าคิดใหม่", async () => {
    const before = await sale("T-S-1");
    const { data, error } = await edit(asMgr, "T-S-1", "2026-11-04", "เงินสด");
    expect(error).toBeNull();
    expect((data as { changed: boolean }).changed).toBe(true);
    const after = await sale("T-S-1");
    expect(after.business_date).toBe("2026-11-04");
    expect(after.method).toBe("เงินสด");
    expect(after.closed_at).toBe(before.closed_at);
    const { data: c } = await admin().from("bar_customer").select("first_seen, last_seen")
      .eq("tenant_id", A.tenantId).eq("customer_id", "T-C1").single();
    expect(c).toEqual({ first_seen: "2026-11-04", last_seen: "2026-11-04" });
  });

  it("🚨 ย้ายเข้าวันที่ลงบัญชีแล้ว = บล็อก", async () => {
    const { error } = await edit(asMgr, "T-S-1", "2026-11-03", "เงินสด");
    expect(error?.message).toMatch(/ลงบัญชีไปแล้ว/);
    expect((await sale("T-S-1")).business_date).toBe("2026-11-04");
  });

  it("🚨 บิลในวันที่ลงบัญชีแล้ว แก้แม้แค่วิธีรับเงินก็ไม่ได้", async () => {
    const { error } = await edit(asMgr, "T-S-2", "2026-11-03", "โอน/QR");
    expect(error?.message).toMatch(/ถอนการลงบัญชี/);
    expect((await sale("T-S-2")).method).toBe("เงินสด");
  });

  it("วันในอนาคต / บิลที่ยังเปิด / วิธีรับเงินแปลก = บล็อก", async () => {
    expect((await edit(asMgr, "T-S-1", "2099-01-01", "เงินสด")).error?.message).toMatch(/อนาคต/);
    expect((await edit(asMgr, "T-S-OPEN", "2026-11-04", "เงินสด")).error?.message).toMatch(/รับเงินแล้ว/);
    expect((await edit(asMgr, "T-S-1", "2026-11-04", "บัตรเครดิต")).error?.message).toMatch(/เงินสด หรือ โอน\/QR/);
  });

  it("ไม่เปลี่ยนอะไร = ok แต่ changed false", async () => {
    const { data, error } = await edit(asMgr, "T-S-1", "2026-11-04", "เงินสด");
    expect(error).toBeNull();
    expect((data as { changed: boolean }).changed).toBe(false);
  });

  it("ทุกการแก้ลง edit_log (trigger audit_bar_sale)", async () => {
    const { data } = await admin().from("edit_log").select("before, after")
      .eq("table_name", "bar_sale").order("created_at", { ascending: false }).limit(20);
    const hit = (data ?? []).find((r) =>
      (r.before as { business_date?: string })?.business_date === "2026-11-05" &&
      (r.after as { business_date?: string })?.business_date === "2026-11-04");
    expect(hit).toBeTruthy();
  });
});
