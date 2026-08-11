import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, type Tenant } from "./harness";

/**
 * เทส "ลูกค้า 1 ราย มีหลายกิจการ" — มุมที่ isolation.test.ts ไม่ได้ครอบ
 *
 * isolation.test.ts พิสูจน์ว่า **ต่างลูกค้า** ใช้คีย์ซ้ำกันได้ (แกน tenant_id)
 * ไฟล์นี้พิสูจน์แกนที่สอง: **ลูกค้าเดียวกัน คนละกิจการ** (แกน entity_id) ซึ่งเป็นเคสจริง
 * ของเจ้าของระบบเอง (EID01 บริษัทจด VAT + EID02 บุคคลธรรมดา) และจะมีผลทันทีที่ทำขั้น 6
 *
 * ที่ต้องพิสูจน์ (ตาม 0027):
 *   1. upsert แบบไม่ระบุ onConflict ยังทำงานถูกกับ PK composite  ← app/(app)/production/master-actions.ts
 *   2. ของที่เป็น "ของโรงนั้น" (stock/เมนู/batch) แยกกันได้จริงต่อกิจการ
 *   3. master (products/materials/contacts) เป็นของ **ลูกค้า** ไม่ใช่ของกิจการ
 *      → คีย์เดียวชี้ได้แถวเดียวเสมอ ทำให้ `.eq(pk, id)` ในโค้ดปลอดภัย ไม่ลบข้ามกิจการ
 *   4. กติกาเหล็ก 1 batch = 1 แถว ยังบังคับอยู่ (แค่ขยายขอบเขตเป็นต่อโรง)
 */

let A: Tenant;
let asA: SupabaseClient;
const EID2 = "EID02";

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("ent");
  // กิจการที่ 2 ต้องสร้างด้วย service role — RLS ห้ามลูกค้า insert เข้า entities เอง
  // (NEXT_STEPS 4.2: จำนวนกิจการเป็น add-on ที่เจ้าของระบบเป็นคนเปิดให้)
  const { error } = await admin().from("entities").insert({
    tenant_id: A.tenantId, entity_id: EID2, name: "กิจการที่สองทดสอบ", is_vat: false,
  });
  if (error) throw new Error(`สร้างกิจการที่ 2: ${error.message}`);
  asA = await signIn(A);
}, 120_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

// ── 1. upsert ไม่ระบุ onConflict บน PK composite ────────────────────────────
// upsertMaster() ใน production/master-actions.ts เรียก .upsert(row) เฉย ๆ โดยไม่ส่ง tenant_id
// ไปกับ payload (ให้ DEFAULT my_tenant() เติมให้) — PK เปลี่ยนเป็น (tenant_id, product_id) แล้ว
// ถ้า PostgREST อนุมาน ON CONFLICT ผิด จะได้ duplicate key ตอนกดแก้ซ้ำ = แท็บจัดการข้อมูลพัง
describe("upsert master แบบไม่ระบุ onConflict (แท็บจัดการข้อมูล)", () => {
  const pid = "T-UPS-01";

  it("ครั้งแรก = insert ได้ โดยไม่ต้องส่ง tenant_id", async () => {
    const { error } = await asA.from("products").upsert({
      product_id: pid, name: "สุราทดสอบ upsert", degree: 40, bottle_size_l: 0.7,
    });
    expect(error, error?.message).toBeNull();
  });

  it("ครั้งที่สองด้วยคีย์เดิม = update ทับ ไม่ใช่ duplicate key", async () => {
    const { error } = await asA.from("products").upsert({
      product_id: pid, name: "สุราทดสอบ upsert (แก้แล้ว)", degree: 35, bottle_size_l: 0.7,
    });
    expect(error, error?.message).toBeNull();

    const { data } = await asA.from("products").select("name, degree").eq("product_id", pid);
    expect(data).toHaveLength(1);
    expect(data![0].name).toBe("สุราทดสอบ upsert (แก้แล้ว)");
    expect(Number(data![0].degree)).toBe(35);
  });
});

// ── 2. ของ "โรงนั้น" แยกกันได้จริงต่อกิจการ ─────────────────────────────────
describe("stock / เมนู / batch แยกต่อกิจการได้ (PK พ่วง entity_id)", () => {
  // stock_product เขียนตรงไม่ได้ (RLS ปิดไว้ — ยอดต้องมาจาก trigger บน log_product เท่านั้น)
  // → เทสผ่านทางเดียวกับที่แอปใช้จริง แล้วดูว่า trigger แยกยอดตามกิจการให้ถูกไหม
  it("stock_product: trigger แยกยอดคงเหลือของรหัสสินค้าเดียวกันตามกิจการ", async () => {
    const { error } = await asA.from("log_product").insert({
      tenant_id: A.tenantId, entity_id: EID2,
      doc_date: "2026-02-01", trans_type: "รับ", product_id: A.productId, amount: 7,
    });
    expect(error, error?.message).toBeNull();

    const { data } = await asA.from("stock_product")
      .select("entity_id, balance").eq("product_id", A.productId);
    expect(data).toHaveLength(2);
    const byEntity = Object.fromEntries(data!.map((r) => [r.entity_id, Number(r.balance)]));
    expect(byEntity[A.entityId]).toBe(50);   // มาจาก log_product 'รับ' 50 ที่ seed ไว้
    expect(byEntity[EID2]).toBe(7);          // ★ ไม่ไปบวกรวมกับยอดของ EID01
  });

  it("warehouse_stock: item_code เดียวกันอยู่ได้ทั้งสองกิจการ", async () => {
    const rows = [A.entityId, EID2].map((e) => ({
      tenant_id: A.tenantId, entity_id: e, item_code: "T-WH-01",
      item_name: "ลังทดสอบ", unit: "ใบ", qty: e === EID2 ? 3 : 9,
    }));
    const { error } = await asA.from("warehouse_stock").insert(rows);
    expect(error, error?.message).toBeNull();

    const { data } = await asA.from("warehouse_stock").select("entity_id, qty").eq("item_code", "T-WH-01");
    expect(data).toHaveLength(2);
  });

  it("sale_menu: ชื่อเมนูซ้ำข้ามกิจการได้ (unique ขยายเป็นต่อโรงแล้ว)", async () => {
    const { error } = await asA.from("sale_menu").insert({
      tenant_id: A.tenantId, entity_id: EID2,
      menu_name: "เมนูทดสอบ", price: 250, category: "สุรา", product_id: A.productId,
    });
    expect(error, error?.message).toBeNull();
  });
});

// ── 3. ★ กติกาเหล็ก: 1 batch = 1 แถว — ขยายขอบเขตเป็น "ต่อโรง" ไม่ใช่ยกเลิก ──
describe("กติกาเหล็ก 1 batch = 1 แถว (ฟอร์ม ภส.๐๗-๐๒/๑(๑) หักส่าต่อแถว)", () => {
  it("batch เดียวกันอยู่คนละกิจการได้", async () => {
    const { error } = await asA.from("log_distill").insert({
      tenant_id: A.tenantId, entity_id: EID2,
      distill_date: "2026-02-01", product_name: "สุราทดสอบ", batch: A.batch, vol: 80, abv: 38,
    });
    expect(error, error?.message).toBeNull();
  });

  it("★ batch ซ้ำ 'ในกิจการเดียวกัน' ยังต้องถูกปฏิเสธ — ซ้ำ = หักส่าซ้ำ = เลขยื่นราชการผิด", async () => {
    const { error } = await asA.from("log_distill").insert({
      tenant_id: A.tenantId, entity_id: EID2,
      distill_date: "2026-03-01", product_name: "สุราทดสอบ", batch: A.batch, vol: 10, abv: 40,
    });
    expect(error, "batch ซ้ำในกิจการเดียวกันต้อง insert ไม่ผ่าน").not.toBeNull();
  });
});

// ── 4. master เป็นของ "ลูกค้า" ไม่ใช่ของกิจการ ──────────────────────────────
// PK ของ products/materials/contacts = (tenant_id, คีย์) ไม่มี entity_id
// → รหัสสินค้าหนึ่งรหัสชี้ได้แถวเดียวต่อลูกค้า กิจการทุกโรงใช้ร่วมกัน
// นี่คือเหตุผลที่ `.eq(pk, id)` ใน master-actions.ts ปลอดภัย: ลบแล้วไม่โดนกิจการอื่นพลอยหาย
describe("master ใช้ร่วมทั้งลูกค้า (PK ไม่มี entity_id — 0027)", () => {
  it("รหัสสินค้าซ้ำในลูกค้าเดียวกันถูกปฏิเสธ แม้จะคนละกิจการ", async () => {
    const { error } = await asA.from("products").insert({
      tenant_id: A.tenantId, entity_id: EID2,
      product_id: A.productId, name: "สินค้าซ้ำรหัส", degree: 40, bottle_size_l: 0.7,
    });
    expect(error, "รหัสสินค้าต้องไม่ซ้ำภายในลูกค้ารายเดียวกัน").not.toBeNull();
  });

  it("ลบ master ด้วยรหัสอย่างเดียว (แบบที่โค้ดทำ) โดนแถวเดียวเสมอ", async () => {
    const pid = "T-DEL-01";
    await asA.from("products").insert({
      tenant_id: A.tenantId, entity_id: EID2, product_id: pid,
      name: "สินค้าลบทิ้ง", degree: 40, bottle_size_l: 0.7,
    });
    // stock_product ถูกสร้างอัตโนมัติหรือไม่ก็ตาม — ต้องเคลียร์ก่อนเพราะ FK
    await asA.from("stock_product").delete().eq("product_id", pid);

    const { error } = await asA.from("products").delete().eq("product_id", pid);
    expect(error, error?.message).toBeNull();

    // ของเดิมที่ใช้รหัสอื่นต้องยังอยู่ครบ — ไม่โดนลูกหลง
    const { data } = await asA.from("products").select("product_id").eq("product_id", A.productId);
    expect(data).toHaveLength(1);
  });
});
