import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, admin, anonClient, type Tenant } from "./harness";

/**
 * D141 · migration 0097 — Claude connector: ใครใช้ได้ (connector_users + connector_allowed())
 *
 * 🔴 ชั้นเดียวที่เห็น plpgsql/RLS จริง (D79) — endpoint /api/mcp ถาม connector_allowed() ทุกคำขอ
 *    และเปิด OAuth ไว้ทั้งก้อนลูกค้า ⇒ ถ้าฟังก์ชันนี้ตอบ true ผิด = ผู้ใช้ลูกค้าคนไหนก็บันทึกบิลผ่าน Claude ได้
 * ★ พิสูจน์ 2 ทิศทุกข้อ (ไม่ใช่ปิดหมดแล้วผ่าน): ก่อนอนุญาต false → อนุญาตแล้ว true → ถอน false
 */

let A: Tenant;
let acc: { client: SupabaseClient; userId: string };
let other: { client: SupabaseClient; userId: string };

const allowed = async (c: SupabaseClient) => {
  const r = await c.rpc("connector_allowed");
  expect(r.error, "connector_allowed ต้องเรียกได้จาก authenticated").toBeNull();
  return r.data as boolean;
};

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("conn");
  acc = await seedUser(A, "accounting");
  other = await seedUser(A, "accounting_manager");
}, 180_000);

afterAll(async () => {
  await admin().from("connector_users").delete().in("user_id", [acc?.userId, other?.userId].filter(Boolean));
  await cleanupTestTenants(); // connector_users หายตาม auth user (on delete cascade) อีกชั้น
});

describe("D141 — connector_allowed()", () => {
  it("ยังไม่อนุญาต = false · อนุญาตแล้ว = true · ถอน = false (มีผลทันที)", async () => {
    expect(await allowed(acc.client)).toBe(false);
    expect((await admin().from("connector_users").insert({ user_id: acc.userId, note: "ทดสอบ" })).error).toBeNull();
    expect(await allowed(acc.client)).toBe(true);
    // คนอื่นใน tenant เดียวกันยังไม่ได้ — สิทธิ์เป็นรายคน ไม่ใช่ราย tenant
    expect(await allowed(other.client)).toBe(false);
    await admin().from("connector_users").delete().eq("user_id", acc.userId);
    expect(await allowed(acc.client)).toBe(false);
  });

  it("🚨 ลูกค้าถูกระงับ = false (การระงับบังคับที่ layout ไม่ใช่ RLS — connector ไม่ผ่าน layout · D59)", async () => {
    const db = admin();
    await db.from("connector_users").upsert({ user_id: acc.userId });
    expect(await allowed(acc.client)).toBe(true);
    await db.from("tenants").update({ is_active: false }).eq("id", A.tenantId);
    try {
      expect(await allowed(acc.client)).toBe(false);
    } finally {
      await db.from("tenants").update({ is_active: true }).eq("id", A.tenantId);
    }
    expect(await allowed(acc.client)).toBe(true);
  });

  it("ยังใช้รหัสชั่วคราว (must_change_password) = false", async () => {
    const db = admin();
    await db.from("connector_users").upsert({ user_id: acc.userId });
    await db.from("profiles").update({ must_change_password: true }).eq("id", acc.userId);
    try {
      expect(await allowed(acc.client)).toBe(false);
    } finally {
      await db.from("profiles").update({ must_change_password: false }).eq("id", acc.userId);
    }
  });

  it("anon เรียกไม่ได้ (revoke from public, anon · D99)", async () => {
    const r = await anonClient().rpc("connector_allowed");
    expect(r.error, "anon ต้องถูกปฏิเสธ").not.toBeNull();
  });
});

describe("D141 — connector_users เป็นตารางแพลตฟอร์ม (ลูกค้าให้สิทธิ์ตัวเองไม่ได้)", () => {
  it("ผู้ใช้ลูกค้าอ่านไม่เห็น ทั้งที่มีแถวอยู่จริง", async () => {
    await admin().from("connector_users").upsert({ user_id: acc.userId });
    const { data } = await acc.client.from("connector_users").select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("🚨 ผู้ใช้ลูกค้าเพิ่มชื่อตัวเองไม่ได้", async () => {
    const { error } = await other.client.from("connector_users").insert({ user_id: other.userId });
    expect(error, "เขียนได้ = ให้สิทธิ์ตัวเองใช้ connector").not.toBeNull();
    expect(await allowed(other.client)).toBe(false);
  });

  it("ผู้ใช้ลูกค้าลบสิทธิ์ของคนอื่นไม่ได้", async () => {
    await other.client.from("connector_users").delete().eq("user_id", acc.userId);
    const { count } = await admin().from("connector_users").select("*", { count: "exact", head: true }).eq("user_id", acc.userId);
    expect(count).toBe(1);
  });
});

describe("D141 — บิลจาก Claude", () => {
  it("fn_save_transaction เก็บ source = 'claude' ตามที่ส่ง (ไม่ต้องแก้ RPC)", async () => {
    const { data, error } = await acc.client.rpc("fn_save_transaction", {
      p: {
        transaction_date: "2026-10-28", type: "รายจ่าย", category: "ทดสอบ connector", contact_name: "ร้านทดสอบ",
        description: "ทดสอบ connector", base_amount: 100, discount: 0, amount_after_discount: 100, vat_amount: 0,
        wht_rate: 0, wht_amount: 0, net_amount: 100, entity_id: A.entityId, ap_ar_status: "AP", source: "claude",
      },
      p_items: [{ item_name: "ของทดสอบ", quantity: 1, in_vat: 107, ex_vat: 100, total_price: 100 }],
    });
    expect(error).toBeNull();
    const txId = (data as { tx_id: string }).tx_id;
    const { data: row } = await admin().from("transactions").select("source").eq("tenant_id", A.tenantId).eq("tx_id", txId).single();
    expect(row?.source).toBe("claude");
  });
});
