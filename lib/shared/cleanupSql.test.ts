import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TENANT_TABLES } from "./tenantTables";

/**
 * D136 — `supabase/seed/cleanup_test.sql` ต้องลบเฉพาะ tenant ที่ระบุเสมอ
 *
 * ที่มา: รุ่นก่อนไม่มีตัวกรอง tenant เลยสักบรรทัด แต่ไกด์เทสสั่งให้รันใน SQL Editor
 *   (role postgres · ไม่มี RLS) บนก้อน proof-app ที่มีลูกค้าจริงอยู่ด้วย
 *   ⇒ จะลบค่าตั้ง `sales_revenue_*` / `pos_walkin_contact` / `bar_*` ของ**ทุกลูกค้า** โดยไม่มีอะไรฟ้อง
 *
 * ★ อ่านไฟล์เป็นข้อความ (ชั้นเดียวกับ tenantTables.test.ts) — ไม่มีทางอื่นที่จะตรวจ SQL ใน seed
 * 🪤 ตรวจ**ทุก** `from <ตาราง>` รวมใน subquery — subquery ที่ลืมกรองคือช่องที่ดึงแถวของลูกค้าอื่นเข้ามา
 */
const ROOT = path.resolve(__dirname, "../..");
const SQL = readFileSync(path.join(ROOT, "supabase/seed/cleanup_test.sql"), "utf8");

/** ตัดคอมเมนต์ `--` ทิ้ง (ไม่งั้นคำในคอมเมนต์จะถูกนับเป็นโค้ด · บทเรียน D92/D95) */
const code = SQL.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");

/** แตกเป็นคำสั่งตาม `;` — ภายในบล็อก do ไม่มี `;` ใน string literal */
const statements = code.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

const TENANT_FILTER = /\b(?:\w+\.)?tenant_id = v_tenant\b/;

describe("cleanup_test.sql — ลบเฉพาะ tenant ที่ระบุ (D136)", () => {
  it("ทั้งไฟล์อยู่ในบล็อก do เดียว และหา tenant จาก v_slug", () => {
    expect(code).toMatch(/do \$\$/);
    expect(code).toMatch(/select id, is_platform into v_tenant, v_plat from tenants where slug = v_slug/);
  });

  it("🚨 ค่าเริ่มต้นของ v_slug เป็นข้อความที่ไม่มีอยู่จริง (ลืมแก้ = error ไม่ลบอะไร)", () => {
    const m = /v_slug\s+text := '([^']*)'/.exec(code);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("<<");
    expect(code).toMatch(/if v_tenant is null then\s+raise exception/);
  });

  it("🚨 ห้ามใช้กับ tenant ของแพลตฟอร์ม", () => {
    expect(code).toMatch(/if v_plat then\s+raise exception/);
  });

  it("🚨 ทุก delete / update มีตัวกรอง tenant_id = v_tenant", () => {
    const writes = statements.filter((s) => /^(delete from|update) /.test(s));
    expect(writes.length).toBeGreaterThan(40);
    const missing = writes.filter((s) => !TENANT_FILTER.test(s));
    expect(missing, `คำสั่งที่ไม่กรอง tenant:\n${missing.join("\n")}`).toEqual([]);
  });

  it("🚨 ทุก `from <ตารางของแอป>` (รวม subquery) ตามด้วยการกรอง tenant ในคำสั่งเดียวกัน", () => {
    const tables = new Set<string>(TENANT_TABLES);
    const offenders: string[] = [];
    for (const s of statements) {
      // จำนวน `from/update <ตารางแอป>` ใน statement ต้องไม่มากกว่าจำนวนตัวกรอง tenant
      // ★ ไม่นับ join — ฝั่ง join ใช้เงื่อนไขคู่ตาราง (i.tenant_id = p.tenant_id) แทน
      const needed = [...s.matchAll(/\b(?:from|update) ([a-z_]+)/g)].filter((m) => tables.has(m[1])).length;
      const filters = [...s.matchAll(new RegExp(TENANT_FILTER.source, "g"))].length;
      if (filters < needed) offenders.push(s);
    }
    expect(offenders, `คำสั่งที่มี subquery ไม่กรอง tenant:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("ล้างการอ้างอิงลูกค้าบาร์ก่อนลบ (FK set null แบบ composite ชน not null)", () => {
    const iMenu = code.indexOf("update bar_menu set created_for = null");
    const iSale = code.indexOf("update bar_sale set customer_id = null");
    const iDel = code.indexOf("delete from bar_customer ");
    expect(iMenu).toBeGreaterThan(-1);
    expect(iSale).toBeGreaterThan(-1);
    expect(iDel).toBeGreaterThan(Math.max(iMenu, iSale));
  });
});
