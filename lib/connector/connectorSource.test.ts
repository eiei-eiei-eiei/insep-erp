/**
 * C4 — Claude connector: ล็อกกติกาที่ TypeScript มองไม่เห็น (อ่านซอร์สจริงมาตรวจ · แพตเทิร์น D85/D90)
 * 🪤 ตรวจโค้ดจริง ไม่ใช่คำในคอมเมนต์ — ตัดคอมเมนต์ทิ้งก่อน (D92/D95)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

const ENDPOINT = ["app/api/mcp/route.ts", "app/api/mcp/oauth-protected-resource/route.ts", "lib/connector/session.ts", "lib/connector/tools.ts", "lib/connector/bill.ts"];

/**
 * คอลัมน์ของ `tenants` ตามที่ migration สร้าง/ลบจริง (create table ใน 0025 + alter add/drop ทุกไฟล์ตามลำดับ)
 * 🔴 D141: connector อ่าน `tenants.brand_name` ซึ่งถูกลบไปตั้งแต่ 0030 (แบรนด์ย้ายไป app_settings · D47)
 *    ⇒ ทุกคำขอจาก Claude ได้ 403 · build/lint/test ผ่านหมดเพราะ select เป็นแค่ข้อความ
 */
function tenantColumns(): Set<string> {
  const dir = path.join(ROOT, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const cols = new Set<string>();
  for (const f of files) {
    const s = readFileSync(path.join(dir, f), "utf8").replace(/--[^\n]*/g, " ");
    const create = /create table (?:if not exists )?(?:public\.)?tenants \(([\s\S]*?)\n\);/i.exec(s);
    if (create) for (const m of create[1].matchAll(/^\s*([a-z_]+)\s+[a-z]/gim)) cols.add(m[1]);
    for (const m of s.matchAll(/alter table (?:public\.)?tenants (add|drop) column (?:if (?:not )?exists )?([a-z_]+)/gi)) {
      if (m[1].toLowerCase() === "add") cols.add(m[2]);
      else cols.delete(m[2]);
    }
  }
  return cols;
}

describe("C4 — 🔴 อ่านเฉพาะคอลัมน์ของ tenants ที่มีอยู่จริง", () => {
  const cols = tenantColumns();
  it("ตัวอ่าน migration เจอคอลัมน์หลัก และรู้ว่า brand_name ถูกลบแล้ว (กันเทสผ่านเพราะอ่านไม่เจออะไร)", () => {
    for (const c of ["id", "slug", "name", "modules_enabled", "is_active", "is_platform"]) expect(cols.has(c), c).toBe(true);
    expect(cols.has("brand_name")).toBe(false);
  });
  it.each(["lib/connector/session.ts", "lib/connector/tools.ts", "app/(auth)/oauth/consent/page.tsx", "lib/platform/connector-db.ts"])(
    "%s",
    (f) => {
      const s = code(f);
      for (const m of s.matchAll(/from\("tenants"\)\s*\.select\("([^"]+)"/g)) {
        for (const c of m[1].split(",").map((x) => x.trim())) expect(cols.has(c), `${f}: tenants.${c} ไม่มีอยู่จริง`).toBe(true);
      }
    },
  );
});

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

  /** ตัวเนื้อของเครื่องมือหนึ่งตัว (ตั้งแต่ชื่อ ถึงเครื่องมือถัดไป) */
  const toolBody = (s: string, name: string) => {
    const a = s.indexOf(`"${name}",`);
    const b = s.slice(a + 1).search(/\n  (server\.registerTool|registerAppTool|registerAppResource)\(/);
    return b < 0 ? s.slice(a) : s.slice(a, a + 1 + b);
  };

  it("🚨 save_bill: ตรวจ tenant_slug และตรวจบิลใหม่ (evaluate → checkBill) ก่อนเรียก fn_save_transaction", () => {
    const s = code("lib/connector/tools.ts");
    const save = toolBody(s, "save_bill");
    const slug = save.indexOf("slugOk(me, tenant_slug)");
    const check = save.indexOf("evaluate(");
    const rpc = save.indexOf('rpc("fn_save_transaction"');
    expect(slug).toBeGreaterThan(0);
    expect(slug).toBeLessThan(check);
    expect(check).toBeLessThan(rpc);
    expect(s).toMatch(/async function evaluate[\s\S]*?checkBill\(d, c\)/);
  });

  it("save_bill ส่ง payload จาก checkBill เท่านั้น (ไม่ส่งค่าจาก Claude ตรง ๆ)", () => {
    const s = code("lib/connector/tools.ts");
    expect(s).toMatch(/rpc\("fn_save_transaction", \{ p: payload\.p, p_items: payload\.items \}\)/);
    expect(s.match(/rpc\("fn_save_transaction"/g)?.length).toBe(1);
  });

  it("🚨 save_bill เรียกได้จากการ์ดทางเดียว (Claude บันทึกเองไม่ได้ · รอบ 3)", () => {
    const save = toolBody(code("lib/connector/tools.ts"), "save_bill");
    expect(save).toMatch(/visibility: \["app"\]/);
  });

  it("🚨 คู่ค้าใหม่ถูกเพิ่มหลังด่านทุกตัวผ่าน (บิลซ้ำ/ยอดไม่ตรง = ไม่มีคู่ค้างอกค้าง)", () => {
    const save = toolBody(code("lib/connector/tools.ts"), "save_bill");
    expect(save.indexOf("createContact(")).toBeGreaterThan(save.indexOf("findDuplicates("));
    expect(save.indexOf("createContact(")).toBeLessThan(save.indexOf('rpc("fn_save_transaction"'));
  });

  it("🚨 รอบ 4: เพิ่มคู่ค้าได้จากการ์ดทางเดียว — create_contact เป็น app-only · edit_bill ไม่รับ new_contact แล้ว", () => {
    const s = code("lib/connector/tools.ts");
    expect(toolBody(s, "create_contact")).toMatch(/visibility: \["app"\]/);
    expect(toolBody(s, "recalc_contact")).toMatch(/visibility: \["app"\]/);
    expect(toolBody(s, "add_contact")).not.toMatch(/createContact\(/);
    expect(toolBody(s, "edit_bill")).not.toMatch(/new_contact/);
    expect(s.slice(s.indexOf("async function editBill"))).not.toMatch(/createContact\(/);
    // createContact ถูกเรียกแค่ 2 ที่: ตอนบันทึกบิลจากการ์ด · ตอนกดเพิ่มในการ์ดคู่ค้า
    expect(s.match(/await createContact\(/g)?.length).toBe(2);
  });

  it("🐛 รอบ 4: การ์ดคู่ค้าต้องรับการพิมพ์ก่อนด่าน 'ไม่มีข้อมูลบิล' (เคยแก้ช่องแล้วไม่ตรวจซ้ำ + กดเพิ่มด้วยค่าเดิม)", () => {
    const s = code("lib/connector/card/billCard.ts");
    const h = s.slice(s.indexOf('root.addEventListener("input"'));
    expect(h.indexOf("if (cdata) return contactInput(el);")).toBeGreaterThan(0);
    expect(h.indexOf("if (cdata) return contactInput(el);")).toBeLessThan(h.indexOf("if (!data) return;"));
  });

  it("รอบ 5: หมวดสินค้ารายแถว — การ์ดแสดง+แก้ได้ทุกแถว · edit_bill แก้ได้ · ไม่บังคับ (ไม่เข้า jobsRequired)", () => {
    const card = code("lib/connector/card/billCard.ts");
    expect(card.slice(card.indexOf("function itemsEditHtml"))).toMatch(/catSelect\(d, it, i\)/);
    expect(card).toMatch(/function tagLine/);
    const s = code("lib/connector/tools.ts");
    expect(toolBody(s, "edit_bill")).toMatch(/item_categories:/);
    expect(s).toMatch(/item_categories: itemCats/);
    expect(code("lib/connector/bill.ts")).not.toMatch(/jobsRequired[^\n]*category/);
  });

  it("🚨 edit_bill ไม่แตะยอดเงิน — ส่งค่าเดิมกลับ และแก้ได้เฉพาะบิลที่ source = claude", () => {
    const s = code("lib/connector/tools.ts");
    const fn = s.slice(s.indexOf("async function editBill"));
    expect(fn).toMatch(/tx\.source !== "claude"/);
    expect(fn).not.toMatch(/p\.(base_amount|amount_after_discount|vat_amount|wht_amount|net_amount|discount)\s*=/);
    expect(fn).not.toMatch(/items\[i\]\.(quantity|ex_vat|in_vat|total_price|discount_baht|item_name)\s*=/);
  });

  it("รอบ 7: คู่ค้าใหม่ร้านเดียวกันหลายใบ — บอก Claude ไม่ต้องแยกรอบ · save_bill บอกว่าผูกตัวเดิม · ด่านซ้ำยังอยู่ตอนบันทึก", () => {
    const s = code("lib/connector/tools.ts");
    expect(s).toMatch(/Do NOT split the bills into rounds/);
    const save = toolBody(s, "save_bill");
    expect(save).toMatch(/status: "linked" as const/);
    // ด่านซ้ำตอนบันทึก = evaluate → resolveContact (ถามทะเบียนใหม่ทุกครั้ง) ก่อน createContact
    expect(save.indexOf("evaluate(")).toBeLessThan(save.indexOf("createContact("));
    expect(s).toContain('q.ilike("name", ilikeExact(row.name))');
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
