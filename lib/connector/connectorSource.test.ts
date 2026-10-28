/**
 * C4 — Claude connector: ล็อกกติกาที่ TypeScript มองไม่เห็น (อ่านซอร์สจริงมาตรวจ · แพตเทิร์น D85/D90)
 * 🪤 ตรวจโค้ดจริง ไม่ใช่คำในคอมเมนต์ — ตัดคอมเมนต์ทิ้งก่อน (D92/D95)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

const ENDPOINT = ["app/api/mcp/route.ts", "app/api/mcp/oauth-protected-resource/route.ts", "lib/connector/session.ts", "lib/connector/tools.ts", "lib/connector/bill.ts"];

describe("C4 — เส้นทาง /api/mcp ไม่มี service role", () => {
  it.each(ENDPOINT)("%s ไม่แตะ service role / admin client", (f) => {
    const s = code(f);
    expect(s).not.toMatch(/SERVICE_ROLE|createAdminClient|supabase\/admin|requirePlatformAdmin/);
  });

  it("session.ts ใช้ anon key + token ของผู้ใช้", () => {
    const s = code("lib/connector/session.ts");
    expect(s).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(s).toMatch(/Authorization: `Bearer \$\{token\}`/);
    expect(s).toMatch(/rpc\("connector_allowed"\)/);
  });
});

describe("C4 — ด่านเรียงถูก", () => {
  it("route: env → token → authenticate → แล้วค่อยสร้าง server", () => {
    const s = code("app/api/mcp/route.ts");
    const env = s.indexOf("connectorEnabled(");
    const tok = s.indexOf("bearerToken(");
    const auth = s.indexOf("authenticate(token)");
    const srv = s.indexOf("buildServer(");
    expect(env).toBeGreaterThan(0);
    expect(env).toBeLessThan(tok);
    expect(tok).toBeLessThan(auth);
    expect(auth).toBeLessThan(srv);
  });

  it("🚨 save_bill: ตรวจ tenant_slug และ checkBill ใหม่ ก่อนเรียก fn_save_transaction", () => {
    const s = code("lib/connector/tools.ts");
    const save = s.slice(s.indexOf('"save_bill"'));
    const slug = save.indexOf("me.tenantSlug");
    const check = save.indexOf("checkBill(");
    const rpc = save.indexOf('rpc("fn_save_transaction"');
    expect(slug).toBeGreaterThan(0);
    expect(slug).toBeLessThan(check);
    expect(check).toBeLessThan(rpc);
  });

  it("save_bill ส่ง payload จาก checkBill เท่านั้น (ไม่ส่งค่าจาก Claude ตรง ๆ)", () => {
    const s = code("lib/connector/tools.ts");
    expect(s).toMatch(/rpc\("fn_save_transaction", \{ p: r\.payload\.p, p_items: r\.payload\.items \}\)/);
    expect(s.match(/rpc\("fn_save_transaction"/g)?.length).toBe(1);
  });

  it("🚨 middleware ยกเว้น /api/mcp ก่อน updateSession (ไม่งั้น Claude ได้ 200 หน้า login)", () => {
    const s = code("middleware.ts");
    expect(s.indexOf("isConnectorPath(")).toBeGreaterThan(0);
    expect(s.indexOf("isConnectorPath(")).toBeLessThan(s.indexOf("updateSession(request)"));
  });

  it("หน้าอนุญาต: action ตรวจ connector_allowed ก่อน approveAuthorization", () => {
    const s = code("app/(auth)/oauth/consent/actions.ts");
    expect(s.indexOf('rpc("connector_allowed")')).toBeGreaterThan(0);
    expect(s.indexOf('rpc("connector_allowed")')).toBeLessThan(s.indexOf("approveAuthorization("));
  });

  it("ทุก action ของแท็บ connector ใน /platform ขึ้นต้นด้วย requirePlatformAdmin()", () => {
    const s = code("app/(platform)/platform/connector/actions.ts");
    const bodies = s.split("guard(async").slice(1);
    expect(bodies.length).toBe(2);
    for (const b of bodies) {
      expect(b.indexOf("requirePlatformAdmin()")).toBeGreaterThan(0);
      expect(b.indexOf("requirePlatformAdmin()")).toBeLessThan(b.indexOf("Connector(db"));
    }
  });
});
