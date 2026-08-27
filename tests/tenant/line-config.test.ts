import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, anonClient, type Tenant } from "./harness";
import { usernameToEmail } from "../../lib/shared/auth-domain";

/**
 * เทสช่องโหว่ "แจ้งเตือน LINE รั่วข้ามลูกค้า" (0033 · NEXT_STEPS 4.0.1b)
 *
 * ของเดิม lib/line.ts อ่านโทเคน/กลุ่มจาก env ของ Vercel project → ลูกค้าทุกเจ้าใน deployment
 * เดียวกันยิงเข้ากลุ่ม LINE กลุ่มเดียวกันหมด · ย้ายมาเก็บใน app_settings ต่อ tenant แล้ว
 *
 * ที่ต้องพิสูจน์ 2 แกน:
 *   1. ข้ามลูกค้า — B อ่านค่าของ A ไม่ได้ (RLS tenant เดิมคุมอยู่แล้ว แต่ต้องมีเทสยืนยัน)
 *   2. ★ ในลูกค้าเดียวกัน — พนักงานที่ไม่ใช่ main อ่าน "โทเคน" ไม่ได้ แต่ยังต้องอ่าน brand_* ได้
 *      (ถ้าพลาดข้อหลัง = พนักงานเข้าแอปไม่ได้ทั้งระบบ เพราะ layout ใช้ brand_* วาดแถบเมนู)
 */

const SECRET_KINDS = ["line_channel_token", "line_group_id"];

let A: Tenant;
let B: Tenant;
let asA: SupabaseClient;
let asB: SupabaseClient;
let asSaleOfA: SupabaseClient;

/** สร้างผู้ใช้เพิ่มใน tenant ที่กำหนด แล้วล็อกอินคืนเป็น client (harness สร้างให้แต่ role main) */
async function addUser(t: Tenant, username: string, role: string): Promise<SupabaseClient> {
  const db = admin();
  const password = "Rong-Test-9f3Kq2Lm";
  const { data: u, error } = await db.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    user_metadata: {
      username,
      display_name: username,
      tenant_id: t.tenantId,
      skip_password_change: true, // ล็อกอินผ่าน API ไม่ผ่านหน้าจอ
    },
  });
  if (error) throw new Error(`สร้างผู้ใช้ ${username}: ${error.message}`);
  const { error: rErr } = await db.from("profiles").update({ role }).eq("id", u!.user!.id);
  if (rErr) throw new Error(`ตั้ง role ${role}: ${rErr.message}`);

  const c = anonClient();
  const { error: sErr } = await c.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (sErr) throw new Error(`ล็อกอิน ${username}: ${sErr.message}`);
  return c;
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("linea");
  B = await seedTenant("lineb");
  asA = await signIn(A);
  asB = await signIn(B);
  // D85: role 'sale' ยุบเป็น 'sales' แล้ว (CHECK ของ profiles ไม่รับค่าเดิมอีก)
  asSaleOfA = await addUser(A, `sale-${A.slug}`, "sales");

  // main ของ A ตั้งค่า LINE ของตัวเอง (ผ่าน RLS ปกติ ไม่ใช่ service role — เหมือนที่ UI ทำ)
  const { error } = await asA.from("app_settings").insert([
    { kind: "line_channel_token", value: "TOKEN-ของ-A-ห้ามหลุด" },
    { kind: "line_group_id", value: "Cgroup-A" },
  ]);
  if (error) throw new Error(`ตั้งค่า LINE ของ A: ${error.message}`);
}, 180_000);

afterAll(async () => {
  for (const c of [asA, asB, asSaleOfA]) await c?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

// ── แกน 1: ข้ามลูกค้า ───────────────────────────────────────────────────────
describe("โทเคน LINE ไม่รั่วข้ามลูกค้า", () => {
  it("main ของ B อ่านค่า LINE ของ A ไม่เห็นเลย", async () => {
    const { data } = await asB.from("app_settings").select("kind, value").in("kind", SECRET_KINDS);
    expect(data ?? []).toHaveLength(0);
  });

  it("B ตั้งค่าของตัวเองได้ โดยไม่ชนกับของ A (คีย์ซ้ำข้าม tenant ได้)", async () => {
    const { error } = await asB.from("app_settings").insert([
      { kind: "line_channel_token", value: "TOKEN-ของ-B" },
      { kind: "line_group_id", value: "Cgroup-B" },
    ]);
    expect(error, error?.message).toBeNull();

    const { data } = await asB.from("app_settings").select("value").eq("kind", "line_group_id");
    expect(data).toHaveLength(1);
    expect(data![0].value).toBe("Cgroup-B"); // ★ ไม่ใช่ Cgroup-A
  });
});

// ── แกน 2: ในลูกค้าเดียวกัน — พนักงานอ่านความลับไม่ได้ ───────────────────────
describe("พนักงานที่ไม่ใช่ main อ่านโทเคนไม่ได้ (policy app_settings_sel — 0033)", () => {
  it("★ role sale อ่าน kind ลับไม่เห็น แม้อยู่กิจการเดียวกับเจ้าของ", async () => {
    const { data } = await asSaleOfA.from("app_settings").select("kind, value").in("kind", SECRET_KINDS);
    expect(data ?? [], "ซ่อนที่ UI ไม่พอ — ต้องกันที่ RLS เพราะ anon key เป็นค่าสาธารณะ").toHaveLength(0);
  });

  it("★★ role sale ต้องยังอ่าน brand_* ได้ — ไม่งั้นเข้าแอปไม่ได้ทั้งระบบ", async () => {
    const { data, error } = await asSaleOfA
      .from("app_settings").select("kind, value").in("kind", ["brand_name", "brand_color"]);
    expect(error, error?.message).toBeNull();
    expect(data?.length, "layout ใช้ brand_* วาดแถบเมนูให้ทุก role").toBeGreaterThan(0);
  });

  it("role sale เขียนค่าตั้งค่าไม่ได้ (policy เขียนเดิม main-only)", async () => {
    const { error } = await asSaleOfA
      .from("app_settings").insert({ kind: "line_group_id", value: "Cgroup-แอบตั้ง" });
    expect(error, "พนักงานต้องตั้งค่าแจ้งเตือนเองไม่ได้").not.toBeNull();
  });
});

// ── positive control: กันเทสผ่านเพราะ "อ่านไม่ได้ทุกอย่าง" ────────────────────
describe("positive control", () => {
  it("main ของ A ยังอ่านค่า LINE ของตัวเองได้ครบ", async () => {
    const { data, error } = await asA.from("app_settings").select("kind, value").in("kind", SECRET_KINDS);
    expect(error, error?.message).toBeNull();
    expect(data).toHaveLength(2);
    const get = (k: string) => data!.find((r) => r.kind === k)?.value;
    expect(get("line_channel_token")).toBe("TOKEN-ของ-A-ห้ามหลุด");
    expect(get("line_group_id")).toBe("Cgroup-A");
  });
});
