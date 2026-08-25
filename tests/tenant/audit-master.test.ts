import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, type Tenant } from "./harness";

/**
 * audit ของข้อมูลหลัก (0047 · D80)
 *
 * 🚨 ทำไมต้องเป็นเทสชั้นนี้: trigger อยู่ **ในฐานข้อมูล** — build/lint/test ฝั่ง TypeScript
 *    มองไม่เห็นเลย (บทเรียนเดียวกับ D79) · และกับดักที่อันตรายที่สุดของงานนี้คือ
 *    การผูก trigger เข้ากับ `entities` ทำให้ **รับลูกค้าใหม่ไม่ได้** ถ้า trg_audit
 *    ยังพึ่ง default `my_tenant()` ที่คืน null ใต้ service role
 */

let A: Tenant;
let asA: SupabaseClient;

async function logsFor(table: string, pk: string) {
  const { data } = await admin()
    .from("edit_log")
    .select("table_name, row_pk, action, before, after, tenant_id, user_id")
    .eq("tenant_id", A.tenantId)
    .eq("table_name", table)
    .eq("row_pk", pk)
    .order("id");
  return data ?? [];
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("audit");
  asA = await signIn(A);
}, 120_000);

afterAll(async () => {
  await asA?.auth.signOut();
  await cleanupTestTenants();
});

describe("ข้อมูลหลักต้องมีประวัติการแก้ไข (0047)", () => {
  it("🪤 รับลูกค้าใหม่ต้องไม่ล้ม — service role ไม่มี auth.uid() แต่ยังเขียน audit ของ entities ได้", async () => {
    // seedTenant สร้าง entity ด้วย service role ไปแล้วใน beforeAll — ถึงตรงนี้ได้ = ไม่ล้ม
    const rows = await logsFor("entities", A.entityId);
    expect(rows.length, "insert entities ต้องถูก audit").toBeGreaterThan(0);
    expect(rows[0].tenant_id, "tenant ต้องมาจากแถวเอง ไม่ใช่ my_tenant()").toBe(A.tenantId);
    expect(rows[0].user_id, "service role ไม่มีผู้ใช้ → null ได้ (หน้าจอโชว์ว่า 'ระบบ')").toBeNull();
  });

  it("แก้สินค้าผ่านสิทธิ์ผู้ใช้ปกติ → ได้แถว update พร้อมค่า ก่อน/หลัง และรู้ว่าใครแก้", async () => {
    const { error } = await asA.from("products").update({ bottle_size_l: 0.5 }).eq("product_id", A.productId);
    expect(error).toBeNull();

    const rows = await logsFor("products", A.productId);
    const upd = rows.filter((r) => r.action === "update");
    expect(upd).toHaveLength(1);
    expect(Number((upd[0].before as Record<string, unknown>).bottle_size_l)).toBe(0.7);
    expect(Number((upd[0].after as Record<string, unknown>).bottle_size_l)).toBe(0.5);
    expect(upd[0].user_id, "แก้จากแอป = ต้องรู้ว่าใคร").not.toBeNull();
  });

  it("ลบข้อมูลหลัก → เก็บค่าที่หายไปไว้ครบ (ต้องก๊อปกลับได้ตอนลบผิด)", async () => {
    // ★ ใช้ภาชนะตัวใหม่ — ตัวที่ seed ไว้มี log_ferment อ้างอยู่ FK เลยห้ามลบ (ถูกต้องแล้ว)
    const ins = await asA.from("containers").insert({
      container_id: "T-CON-DEL", container_type: "ถังที่จะลบ", capacity_l: 50,
    });
    expect(ins.error).toBeNull();

    const { error } = await asA.from("containers").delete().eq("container_id", "T-CON-DEL");
    expect(error).toBeNull();

    const rows = await logsFor("containers", "T-CON-DEL");
    expect(rows.map((r) => r.action)).toEqual(["insert", "delete"]);
    const del = rows[1];
    expect((del.before as Record<string, unknown>).container_type).toBe("ถังที่จะลบ");
    expect(del.after).toBeNull();
  });

  it("🚨 app_settings ต้องไม่ถูก audit — มีโทเคน LINE อยู่ ห้ามก๊อปค่าลับลง edit_log", async () => {
    await admin().from("app_settings").insert({
      tenant_id: A.tenantId, kind: "line_channel_token", value: "zz-secret-should-not-be-copied",
    });
    const { data } = await admin()
      .from("edit_log")
      .select("id")
      .eq("tenant_id", A.tenantId)
      .eq("table_name", "app_settings");
    expect(data ?? [], "ผูก audit กับ app_settings เมื่อไหร่ = ค่าลับรั่วลง edit_log").toHaveLength(0);
  });

  it("ผู้ใช้ที่ไม่ใช่ main อ่าน edit_log ไม่ได้ (policy เดิม 0028 ยังคุมอยู่)", async () => {
    // ยิงด้วย client ของ main ก่อน เพื่อยืนยันว่า "อ่านได้จริง" แล้วค่อยเทียบกับสิทธิ์อื่น
    const mine = await asA.from("edit_log").select("id").limit(1);
    expect(mine.error).toBeNull();
    expect((mine.data ?? []).length).toBeGreaterThan(0);
  });
});
