import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, type Tenant } from "./harness";

/**
 * D158 — integration_log อ่านได้เฉพาะโดเมนของรายการ (migration 0105) · ยิงฐานข้อมูลจริง
 *
 * 🔴 เดิมทุกบทบาทอ่านได้ทุกแถว ⇒ payload `POST_PAYROLL` (ชื่อ+เงินเดือนรายคน) รั่วไปฝ่ายขาย/viewer/บาร์
 * 🚨 ล็อกอินเป็นคนนั้นจริงผ่าน anon key · "อ่านไม่ได้" ใน RLS = ลิสต์ว่าง → assert ชุด action ที่เห็นจริง
 * ★ positive control ทุกข้อ: main เห็นครบ 6 แถว · เจ้าของโดเมนเห็นแถวของตัวเอง
 *   (ไม่งั้นเทสผ่านเพราะไม่มีข้อมูล ไม่ใช่เพราะสิทธิ์ถูก — บทเรียน D85)
 */

let T: Tenant;
let asMain: SupabaseClient;
const as: Record<string, SupabaseClient> = {};

const ROWS = [
  { action: "POST_PAYROLL", payload: { emp: "พนักงานทดสอบ", net: 15000 } },
  { action: "RECEIVE_REVENUE", payload: { net: 1070 } },
  { action: "PAY_TAX", payload: { vat: 70 } },
  { action: "EXCISE_REMINDER", payload: {} },
  { action: "BAR_POST_REMINDER", payload: {} },
  { action: "SOMETHING_NEW", payload: {} },
];
const ROLES = ["viewer", "sales", "sales_manager", "accounting", "finance_manager", "payroll", "bar"];

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  T = await seedTenant("ilog");
  asMain = await signIn(T);
  const { error } = await admin().from("integration_log").insert(
    ROWS.map((r, i) => ({ tenant_id: T.tenantId, action: r.action, idempotency_key: `zz-ilog-${i}`, status: "ok", message: "ทดสอบ", payload: r.payload })),
  );
  expect(error, error?.message).toBeNull();
  for (const r of ROLES) as[r] = (await seedUser(T, r)).client;
}, 300_000);

afterAll(async () => {
  for (const c of [asMain, ...Object.values(as)]) await c?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

async function seen(c: SupabaseClient): Promise<string[]> {
  const { data, error } = await c.from("integration_log").select("action").like("idempotency_key", "zz-ilog-%");
  expect(error, error?.message).toBeNull();
  return (data ?? []).map((r) => r.action as string).sort();
}

describe("D158 integration_log ตามโดเมน", () => {
  it("main เห็นครบทุกแถว (positive control)", async () => {
    expect(await seen(asMain)).toEqual(ROWS.map((r) => r.action).sort());
  });

  it.each([
    ["viewer", ["EXCISE_REMINDER", "PAY_TAX", "RECEIVE_REVENUE", "BAR_POST_REMINDER"]],
    ["sales", ["RECEIVE_REVENUE"]],
    ["sales_manager", ["RECEIVE_REVENUE"]],
    ["accounting", ["PAY_TAX"]],
    ["finance_manager", ["PAY_TAX", "POST_PAYROLL"]],
    ["payroll", ["POST_PAYROLL"]],
    ["bar", ["BAR_POST_REMINDER"]],
  ])("%s เห็นเฉพาะ %j", async (role, expected) => {
    expect(await seen(as[role])).toEqual([...expected].sort());
  });

  it("🔴 เงินเดือน: ฝ่ายขาย · บัญชี · viewer · บาร์ อ่าน payload POST_PAYROLL ไม่ได้", async () => {
    for (const r of ["sales", "sales_manager", "accounting", "viewer", "bar"]) {
      const { data } = await as[r].from("integration_log").select("payload").eq("action", "POST_PAYROLL");
      expect(data ?? [], r).toEqual([]);
    }
  });

  it("action ที่ไม่รู้จักเห็นได้เฉพาะ main", async () => {
    for (const r of ROLES) expect(await seen(as[r]), r).not.toContain("SOMETHING_NEW");
  });

  it("ยังเขียนตรงไม่ได้ทุกบทบาท (ไม่มี policy เขียน · คงเดิม)", async () => {
    for (const c of [asMain, as.payroll]) {
      const { error } = await c.from("integration_log").insert({ tenant_id: T.tenantId, action: "PAY_TAX", idempotency_key: "zz-ilog-w", status: "ok" });
      expect(error).not.toBeNull();
    }
  });
});
