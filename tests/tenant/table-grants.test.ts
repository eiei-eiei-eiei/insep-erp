import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, anonClient, type Tenant } from "./harness";
import { auditTableGrants, PLATFORM_ONLY_TABLES, type GrantRow } from "../../lib/shared/tableGrants";

/**
 * grant ระดับตาราง (D118 · migration 0085) — ถามสิทธิ์จริงจาก DB
 *
 * 🔴 ทำไมต้องอยู่ชั้นนี้: ไฟล์ SQL บอกได้แค่ว่า "เขียน grant แล้ว" แต่ไม่บอกว่า DB มีสิทธิ์นั้นจริง
 *    (บทเรียน D99: revoke from public รันผ่านแต่ไม่มีผล) · และตั้งแต่ 2026-10-30 Supabase
 *    ไม่แจก grant ให้ตารางใหม่แล้ว ⇒ ต้องถาม pg_class ที่มีผลจริง
 * ★ วนจาก pg_class → ตารางที่สร้างในอนาคตถูกครอบอัตโนมัติ (ไม่อยู่ในรายชื่อ = ฟ้อง)
 */

let rows: GrantRow[] = [];
let A: Tenant;
let asA: SupabaseClient;

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("tgA");
  asA = await signIn(A);
  const { data, error } = await admin().rpc("fn_audit_table_grants");
  if (error) throw new Error(`fn_audit_table_grants: ${error.message} (ลง 0085 แล้วหรือยัง?)`);
  rows = (data ?? []) as GrantRow[];
}, 180_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("D118 · grant ตาราง (DB จริง)", () => {
  it("ได้ข้อมูลจริง — กันเทสผ่านเพราะลิสต์ว่าง", () => {
    expect(rows.filter((r) => r.kind === "table").length).toBeGreaterThanOrEqual(60);
    expect(rows.filter((r) => r.kind === "sequence").length).toBeGreaterThan(20);
  });

  it("🚨 ผ่านทุกกฎ: ตารางแอปมีสิทธิ์ครบ · ตารางแพลตฟอร์มปิด · RLS เปิดทุกตาราง · sequence มี usage", () => {
    expect(auditTableGrants(rows)).toEqual([]);
  });

  it("🚨 fn_audit_table_grants เองต้องปิดจาก anon/authenticated", async () => {
    expect((await anonClient().rpc("fn_audit_table_grants")).error).not.toBeNull();
    expect((await asA.rpc("fn_audit_table_grants")).error).not.toBeNull();
  });

  it("พิสูจน์อีกทาง: ผู้ใช้ที่ล็อกอินอ่านตารางแอปได้ แต่ตารางแพลตฟอร์มได้แถวว่าง/error", async () => {
    const own = await asA.from("entities").select("entity_id");
    expect(own.error).toBeNull();
    expect((own.data ?? []).length).toBeGreaterThan(0);
    for (const t of PLATFORM_ONLY_TABLES) {
      const r = await asA.from(t).select("*").limit(1);
      expect(r.error !== null || (r.data ?? []).length === 0, t).toBe(true);
    }
  });
});
