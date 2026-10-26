import { describe, it, expect } from "vitest";
import { withAuthTimeout, isAuthRequest, AUTH_FETCH_TIMEOUT_MS } from "./authFetch";
import { isSessionCookie } from "./sessionCookie";
import { SLOW_LOAD_MS, SLOW_LOAD_TEXT } from "../shared/slowLoad";

/** fetch ปลอมที่ไม่ตอบจนกว่าจะถูกยกเลิก (= ฝั่ง Auth เงียบ) */
const silent: typeof fetch = (_i, init) =>
  new Promise((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
  });

describe("D135 — เพดานเวลาคำขอไป Supabase Auth", () => {
  it("คำขอ Auth ที่ไม่ตอบ ถูกตัดตามเพดาน (ไม่รอตลอดกาล)", async () => {
    const f = withAuthTimeout(silent, 30);
    const t0 = Date.now();
    await expect(f("https://x.supabase.co/auth/v1/token?grant_type=refresh_token")).rejects.toThrow(/ไม่ตอบภายใน/);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("★ คำขอข้อมูล (PostgREST/Storage) ไม่ถูกตัด — รายงานใหญ่ใช้เวลานานได้โดยชอบธรรม", async () => {
    let gotSignal: AbortSignal | undefined | null = null;
    const spy: typeof fetch = async (_i, init) => {
      gotSignal = init?.signal;
      return new Response("[]");
    };
    await withAuthTimeout(spy, 30)("https://x.supabase.co/rest/v1/transactions?select=*");
    expect(gotSignal).toBeUndefined();
    expect(isAuthRequest("https://x.supabase.co/storage/v1/object/sign/pdf-templates/a.pdf")).toBe(false);
    expect(isAuthRequest(new URL("https://x.supabase.co/auth/v1/user"))).toBe(true);
    expect(isAuthRequest(new Request("https://x.supabase.co/auth/v1/logout"))).toBe(true);
  });

  it("คำขอ Auth ที่ตอบทัน ผ่านตามปกติ", async () => {
    const ok: typeof fetch = async () => new Response("{}", { status: 200 });
    const r = await withAuthTimeout(ok, 1000)("https://x.supabase.co/auth/v1/user");
    expect(r.status).toBe(200);
  });

  it("signal ของผู้เรียกยังยกเลิกได้เหมือนเดิม", async () => {
    const ctrl = new AbortController();
    const p = withAuthTimeout(silent, 60_000)("https://x.supabase.co/auth/v1/user", { signal: ctrl.signal });
    ctrl.abort(new Error("ผู้เรียกยกเลิก"));
    await expect(p).rejects.toThrow("ผู้เรียกยกเลิก");
  });

  it("เพดานปริยาย 10 วิ — ยาวพอให้ฝั่ง Auth ที่ช้าตอบทัน", () => {
    expect(AUTH_FETCH_TIMEOUT_MS).toBe(10_000);
  });
});

describe("D135 — ออกจากระบบลบเฉพาะคุกกี้เซสชัน", () => {
  it("จับคุกกี้เซสชันของ Supabase ครบทุกรูป", () => {
    for (const n of [
      "sb-abcdefghij-auth-token",
      "sb-abcdefghij-auth-token.0",
      "sb-abcdefghij-auth-token.1",
      "sb-abcdefghij-auth-token-code-verifier",
      "sb-127-auth-token",
    ])
      expect(isSessionCookie(n), n).toBe(true);
  });
  it("🚨 ไม่แตะคุกกี้อื่นของแอป (โหมดสว่าง/มืด ฯลฯ)", () => {
    for (const n of ["theme", "mode", "sb-x-other", "my-sb-abc-auth-token", "sb-abc-auth-tokenx"])
      expect(isSessionCookie(n), n).toBe(false);
  });
  it("signOut ลบคุกกี้เองหลังเรียก Supabase เสมอ (ฝั่ง Auth ล้ม = Supabase ไม่ลบให้)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("app/(app)/actions.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function signOut"), src.indexOf("redirect(\"/login\")"));
    expect(fn).toMatch(/try\s*\{\s*await supabase\.auth\.signOut\(\)/);
    expect(fn).toMatch(/isSessionCookie\(c\.name\)\)\s*store\.delete\(c\.name\)/);
  });
});

describe("D135 — ป้าย 'โหลดนานกว่าปกติ' บนโครงหน้า", () => {
  it("รอนานกว่าหน้าที่หนักสุดตอนนี้ (2-4 วิ) มาก — ไม่ขึ้นเตือนมั่วตอนโหลดปกติ", () => {
    expect(SLOW_LOAD_MS).toBeGreaterThanOrEqual(10_000);
  });
  it("ประโยคบอกทั้ง 2 ทางออก ตรงกับชื่อปุ่ม", () => {
    expect(SLOW_LOAD_TEXT.body).toContain(`“${SLOW_LOAD_TEXT.signOut}”`);
    expect(SLOW_LOAD_TEXT.body).toContain(`“${SLOW_LOAD_TEXT.reload}”`);
  });
  it("🚩 โครงหน้าทุกโดเมนวางป้าย (loading.tsx → WorkspaceSkeleton → SlowLoadNotice)", async () => {
    const fs = await import("node:fs");
    expect(fs.readFileSync("app/(app)/_components/WorkspaceSkeleton.tsx", "utf8")).toContain("<SlowLoadNotice />");
    for (const d of ["accounting", "production", "sales", "payroll"])
      expect(fs.readFileSync(`app/(app)/${d}/loading.tsx`, "utf8"), d).toContain("<WorkspaceSkeleton />");
  });
});
