import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, type Tenant } from "./harness";

/**
 * ลบลูกค้าบาร์ที่เคยมีบิล/เมนู "สร้างให้" ได้จริง (D137 · migration 0095)
 *
 * ที่มา: เทสเบราว์เซอร์ D136 — `deleteCustomerAction` (ลบตาม PDPA) ล้มทุกครั้ง
 *   `null value in column "tenant_id" of relation "bar_menu" violates not-null constraint`
 *   เพราะ FK composite (0064) เป็น `on delete set null` เปล่า ⇒ Postgres ล้างทุกคอลัมน์ของ FK
 *
 * 🔴 ชั้นเดียวที่เห็นได้ — build/lint/test มองไม่เห็นความหมายของ FK (บทเรียน D79)
 * ★ ลบผ่าน client ผู้ใช้จริง (anon + ล็อกอิน · RLS มีผล) แบบเดียวกับ `deleteCustomerAction`
 *   ไม่ใช่ service role — service role ข้าม RLS แล้วเทสจะผ่านโดยไม่ได้ทดสอบเส้นทางจริง
 * ★ พิสูจน์ 2 ทิศ: ลูกค้าที่ลบ → แถวที่อ้างถึงเหลือ null แต่ไม่หาย · ลูกค้าอีกคน (positive control)
 *   และ tenant อีกเจ้าที่ใช้รหัสลูกค้าเดียวกัน → ไม่ถูกแตะเลย
 *
 * 🪤 เขียนใน container ที่ไม่มี DB — **ยังไม่เคยรันจริง** ตอน commit แรก (D137)
 *    รันครั้งแรกด้วย `npm run test:tenant` หลังลง 0095 · ถ้าแดง ให้สงสัยตัวเทสก่อน (D95/D136)
 */

let A: Tenant;
let B: Tenant;
let asA: SupabaseClient;

/** เลขบิลที่เปิดผ่าน RPC (เลขรันนิ่ง — รู้ตอนเปิด) */
let openSaleNo = "";

const CUST_DEL = "T-C-DEL"; // คนที่จะถูกลบ
const CUST_KEEP = "T-C-KEEP"; // positive control — ต้องอยู่ครบ

async function seedBar(t: Tenant) {
  const db = admin();
  const base = { tenant_id: t.tenantId, entity_id: t.entityId };

  const cat = await db.from("bar_category").insert(
    { ...base, category_id: "T-cat", name: "ทดสอบ หมวด", sort: 1, is_system: false },
  );
  if (cat.error) throw new Error(`หมวด: ${cat.error.message}`);

  // 🪤 insert เป็นชุด: คีย์ไม่เท่ากันทุกแถว = PostgREST ส่ง null ทับ default (บทเรียน bar-rpc)
  //    ⇒ ใส่คีย์ครบทุกแถว + defaultToNull: false กันอีกชั้น
  const cust = await db.from("bar_customer").insert([
    { ...base, customer_id: CUST_DEL, name: "ทดสอบ ลบตาม PDPA", phone: "0800000000" },
    { ...base, customer_id: CUST_KEEP, name: "ทดสอบ อยู่ต่อ", phone: "0811111111" },
  ], { defaultToNull: false });
  if (cust.error) throw new Error(`ลูกค้า: ${cust.error.message}`);

  const menus = await db.from("bar_menu").insert([
    { ...base, menu_id: "T-M-DEL", name: "ทดสอบ สร้างให้คนที่ลบ", price: 200, category_id: "T-cat", created_for: CUST_DEL },
    { ...base, menu_id: "T-M-KEEP", name: "ทดสอบ สร้างให้คนที่อยู่", price: 220, category_id: "T-cat", created_for: CUST_KEEP },
  ], { defaultToNull: false });
  if (menus.error) throw new Error(`เมนู: ${menus.error.message}`);

  const fav = await db.from("bar_customer_fav").insert(
    { ...base, customer_id: CUST_DEL, menu_id: "T-M-KEEP" },
  );
  if (fav.error) throw new Error(`เมนูโปรด: ${fav.error.message}`);

  // บิลปิดแล้ว (มีตัวเงิน) ของทั้งสองคน — เลขบิลกำหนดเอง ไม่ชนเลขรันนิ่งของ RPC
  const sales = await db.from("bar_sale").insert([
    {
      ...base, sale_no: "T-S-DEL", status: "ปกติ", tab_name: "ทดสอบ โต๊ะ 1", customer_id: CUST_DEL,
      closed_at: "2026-10-20T15:00:00Z", business_date: "2026-10-20", method: "เงินสด",
      sub_total: 200, grand_total: 200,
    },
    {
      ...base, sale_no: "T-S-KEEP", status: "ปกติ", tab_name: "ทดสอบ โต๊ะ 2", customer_id: CUST_KEEP,
      closed_at: "2026-10-20T15:10:00Z", business_date: "2026-10-20", method: "เงินสด",
      sub_total: 220, grand_total: 220,
    },
  ], { defaultToNull: false });
  if (sales.error) throw new Error(`บิล: ${sales.error.message}`);
}

const saleRow = async (t: Tenant, saleNo: string) => {
  const { data, error } = await admin().from("bar_sale")
    .select("tenant_id, entity_id, sale_no, customer_id, grand_total, status")
    .eq("tenant_id", t.tenantId).eq("entity_id", t.entityId).eq("sale_no", saleNo).maybeSingle();
  if (error) throw new Error(`อ่านบิล ${saleNo}: ${error.message}`);
  return data;
};

const menuRow = async (t: Tenant, menuId: string) => {
  const { data, error } = await admin().from("bar_menu")
    .select("tenant_id, entity_id, menu_id, created_for, active")
    .eq("tenant_id", t.tenantId).eq("entity_id", t.entityId).eq("menu_id", menuId).maybeSingle();
  if (error) throw new Error(`อ่านเมนู ${menuId}: ${error.message}`);
  return data;
};

const customerExists = async (t: Tenant, id: string) => {
  const { count, error } = await admin().from("bar_customer")
    .select("customer_id", { count: "exact", head: true })
    .eq("tenant_id", t.tenantId).eq("entity_id", t.entityId).eq("customer_id", id);
  if (error) throw new Error(`อ่านลูกค้า ${id}: ${error.message}`);
  return (count ?? 0) > 0;
};

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("barcust-a");
  B = await seedTenant("barcust-b");
  await seedBar(A);
  await seedBar(B); // ★ รหัสลูกค้า/บิล/เมนูเดียวกันทุกตัว — พิสูจน์ว่าลบฝั่ง A ไม่ลามไป B
  asA = await signIn(A);

  // บิลที่ยังเปิดอยู่ ผูกลูกค้าคนที่จะลบ — เปิดผ่าน RPC ในนามผู้ใช้ (เส้นทางเดียวกับหน้าขาย)
  const open = await asA.rpc("fn_bar_open_sale", {
    p_entity: A.entityId, p_tab_name: "ทดสอบ เปิดค้าง", p_customer: CUST_DEL,
  });
  if (open.error) throw new Error(`เปิดบิล: ${open.error.message}`);
  openSaleNo = (open.data as { sale_no: string }).sale_no;
}, 180_000);

afterAll(async () => {
  await cleanupTestTenants();
}, 120_000);

describe("ก่อนลบ — ข้อมูลตั้งต้นอ้างลูกค้าจริง (กันเทสเขียวเพราะไม่มีอะไรให้ set null)", () => {
  it("บิล 2 ใบ + เมนูสร้างให้ 1 ตัว อ้างลูกค้าที่จะลบ", async () => {
    expect(openSaleNo).not.toBe("");
    expect((await saleRow(A, openSaleNo))?.customer_id).toBe(CUST_DEL);
    expect((await saleRow(A, "T-S-DEL"))?.customer_id).toBe(CUST_DEL);
    expect((await menuRow(A, "T-M-DEL"))?.created_for).toBe(CUST_DEL);
  });
});

describe("ลบลูกค้าที่มีบิล/เมนูสร้างให้ ผ่าน client ผู้ใช้ (เส้นทาง deleteCustomerAction)", () => {
  it("🚨 ลบสำเร็จ — ไม่ชน not null ของ tenant_id (บั๊ก D136)", async () => {
    const { error, count } = await asA
      .from("bar_customer")
      .delete({ count: "exact" })
      .eq("entity_id", A.entityId)
      .eq("customer_id", CUST_DEL);
    expect(error, error?.message).toBeNull();
    expect(count).toBe(1);
    expect(await customerExists(A, CUST_DEL)).toBe(false);
  });

  it("บิลที่ปิดแล้วยังอยู่ครบ — ยอดเงิน/สถานะ/กิจการไม่ขยับ · เหลือแค่ลูกค้าเป็น null", async () => {
    const s = await saleRow(A, "T-S-DEL");
    expect(s).not.toBeNull();
    expect(s!.customer_id).toBeNull();
    expect(s!.tenant_id).toBe(A.tenantId);
    expect(s!.entity_id).toBe(A.entityId);
    expect(Number(s!.grand_total)).toBe(200);
    expect(s!.status).toBe("ปกติ");
  });

  it("บิลที่ยังเปิดอยู่ไม่หาย — ลูกค้าเป็น null · tenant/entity คงเดิม", async () => {
    const s = await saleRow(A, openSaleNo);
    expect(s).not.toBeNull();
    expect(s!.customer_id).toBeNull();
    expect(s!.tenant_id).toBe(A.tenantId);
    expect(s!.entity_id).toBe(A.entityId);
    expect(s!.status).toBe("เปิดอยู่");
  });

  it("เมนูที่สร้างให้ยังขายได้ — created_for เป็น null · tenant/entity คงเดิม", async () => {
    const m = await menuRow(A, "T-M-DEL");
    expect(m).not.toBeNull();
    expect(m!.created_for).toBeNull();
    expect(m!.tenant_id).toBe(A.tenantId);
    expect(m!.entity_id).toBe(A.entityId);
    expect(m!.active).toBe(true);
  });

  it("เมนูโปรดของลูกค้าที่ลบหายตาม (cascade เดิม · ข้อมูลส่วนตัว)", async () => {
    const { count, error } = await admin().from("bar_customer_fav")
      .select("menu_id", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId).eq("customer_id", CUST_DEL);
    expect(error, error?.message).toBeNull();
    expect(count).toBe(0);
  });
});

describe("positive control — ของที่ไม่ได้ลบต้องไม่ถูกแตะ", () => {
  it("ลูกค้าอีกคนใน tenant เดียวกัน: ยังอยู่ · บิล/เมนูยังผูกอยู่", async () => {
    expect(await customerExists(A, CUST_KEEP)).toBe(true);
    expect((await saleRow(A, "T-S-KEEP"))?.customer_id).toBe(CUST_KEEP);
    expect((await menuRow(A, "T-M-KEEP"))?.created_for).toBe(CUST_KEEP);
  });

  it("🚨 tenant อีกเจ้าที่ใช้รหัสลูกค้าเดียวกัน: ไม่ถูกลบ · บิล/เมนูยังผูกลูกค้าเดิม", async () => {
    expect(await customerExists(B, CUST_DEL)).toBe(true);
    expect((await saleRow(B, "T-S-DEL"))?.customer_id).toBe(CUST_DEL);
    expect((await menuRow(B, "T-M-DEL"))?.created_for).toBe(CUST_DEL);
  });

  it("ลบซ้ำ = ไม่มีแถวให้ลบ ไม่ใช่ error (กดลบ 2 ครั้งจากหน้าจอ)", async () => {
    const { error, count } = await asA
      .from("bar_customer")
      .delete({ count: "exact" })
      .eq("entity_id", A.entityId)
      .eq("customer_id", CUST_DEL);
    expect(error, error?.message).toBeNull();
    expect(count).toBe(0);
  });
});
