import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROLES, CAPS, ROLE_CAPS, type Role, type Cap } from "./roles";

/**
 * 🚨 ตารางสิทธิ์มี **2 ฝั่ง** ที่ต้องตรงกันเสมอ
 *    · `ROLE_CAPS` ใน roles.ts → คุมว่าหน้าจอโชว์อะไร
 *    · `has_cap()` ใน migration → **ตัวจริงที่บังคับสิทธิ์** (RLS + RPC เรียกตัวนี้)
 *
 * หลุดจากกันเมื่อไหร่ อาการจะเป็นอย่างใดอย่างหนึ่ง และ**ทั้งคู่ไม่มี error ให้เห็น**:
 *    · TS ใจกว้างกว่า DB → ผู้ใช้เห็นเมนู กดเข้าไปแล้วหน้าว่างเปล่า/บันทึกไม่ได้
 *    · DB ใจกว้างกว่า TS → **มีสิทธิ์เกินที่ตั้งใจ** โดยไม่มีใครรู้ (อันตรายกว่า)
 *
 * เทสนี้อ่าน SQL เป็น **ข้อความ** มาเทียบ — ชั้นเดียวกับ `tenantTables.test.ts` (D79)
 * ที่จับได้ว่ารายชื่อตารางใน `fn_mig_truncate` ไม่ตรงกับฝั่ง TypeScript
 */
const ROOT = path.resolve(__dirname, "../..");

/** ไฟล์ migration ล่าสุดที่นิยาม has_cap — ตัวที่มีผลจริงใน DB */
function latestHasCapSql(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  const hit = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => readFileSync(path.join(dir, f), "utf8").includes("function has_cap("));
  expect(hit, "ไม่พบ migration ที่นิยาม has_cap()").toBeTruthy();
  return readFileSync(path.join(dir, hit!), "utf8");
}

/** ตัดเฉพาะตัวฟังก์ชัน has_cap ออกมา */
function hasCapBody(): string {
  const sql = latestHasCapSql();
  const i = sql.indexOf("create or replace function has_cap(");
  const j = sql.indexOf("$$;", i + 40);
  expect(j).toBeGreaterThan(i);
  return sql.slice(i, j);
}

/** อ่าน `when '<role>' then cap in ('a','b')` ออกมาเป็น map */
function capsFromSql(): Record<string, string[] | "ALL"> {
  const body = hasCapBody();
  const out: Record<string, string[] | "ALL"> = {};
  const re = /when\s+'([a-z_]+)'\s+then\s+(true|cap in \(([^)]*)\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = m[2] === "true" ? "ALL" : [...m[3].matchAll(/'([a-z.]+)'/g)].map((x) => x[1]);
  }
  return out;
}

const sqlCaps = capsFromSql();
const sorted = (a: readonly string[]) => [...a].sort();

describe("has_cap() ใน SQL ต้องตรงกับ ROLE_CAPS ใน TypeScript", () => {
  it("อ่านฟังก์ชันจาก migration ออกมาได้จริง (ไม่ใช่ regex ที่ไม่แมตช์อะไรเลยแล้วผ่านฟรี)", () => {
    expect(Object.keys(sqlCaps).length).toBeGreaterThanOrEqual(ROLES.length);
  });

  it.each(ROLES)("%s ได้สิทธิ์เท่ากันทั้งสองฝั่ง", (role: Role) => {
    const inSql = sqlCaps[role];
    expect(inSql, `has_cap() ไม่รู้จักบทบาท "${role}"`).toBeDefined();
    if (inSql === "ALL") {
      expect(sorted(ROLE_CAPS[role]), `${role} เป็น true ใน SQL แปลว่าต้องได้ครบทุก cap`)
        .toEqual(sorted(CAPS));
    } else {
      expect(sorted(inSql)).toEqual(sorted(ROLE_CAPS[role]));
    }
  });

  it("ทุก cap ที่ SQL อ้างถึง มีอยู่จริงในรายการ CAPS (กันพิมพ์ชื่อ cap ผิดใน SQL)", () => {
    for (const [role, caps] of Object.entries(sqlCaps)) {
      if (caps === "ALL") continue;
      for (const c of caps) {
        expect(CAPS, `บทบาท ${role} ใน SQL อ้าง cap "${c}" ที่ไม่มีอยู่จริง`).toContain(c as Cap);
      }
    }
  });

  it("★ SQL ต้องรองรับค่าเก่า sale/warehouse ไว้ด้วย — ช่วง deploy โค้ดใหม่กับ DB เก่าคาบเกี่ยวกัน", () => {
    expect(sqlCaps["sale"]).toBeDefined();
    expect(sqlCaps["warehouse"]).toBeDefined();
  });

  it("🚨 ไม่มีสิทธิ์ = ปิด ไม่ใช่เปิด (ต้องมี else false ปิดท้าย)", () => {
    expect(hasCapBody()).toMatch(/else\s+false/);
  });
});

describe("CHECK constraint ของ profiles.role ต้องมีครบ 9 บทบาท", () => {
  it("รายชื่อใน check ตรงกับ ROLES", () => {
    const sql = latestHasCapSql();
    const i = sql.indexOf("add constraint profiles_role_check");
    expect(i, "ไม่พบ constraint profiles_role_check").toBeGreaterThan(-1);
    const block = sql.slice(i, sql.indexOf(";", i));
    const names = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(sorted(names)).toEqual(sorted(ROLES));
  });

  it("🪤 ต้อง drop constraint ก่อน update — ไม่งั้น backfill sale→sales ติด check ตัวเก่า", () => {
    const sql = latestHasCapSql();
    const drop = sql.indexOf("drop constraint if exists profiles_role_check");
    const upd = sql.indexOf("update profiles set role = 'sales'");
    const add = sql.indexOf("add constraint profiles_role_check");
    expect(drop).toBeGreaterThan(-1);
    expect(upd).toBeGreaterThan(drop);
    expect(add).toBeGreaterThan(upd);
  });
});

describe("ไม่มี my_role() หลงเหลือเป็นตัวตัดสินสิทธิ์", () => {
  it("🚨 migration ที่มี has_cap แล้ว ต้องไม่ใช้ my_role() ตัดสินอะไรอีก", () => {
    const sql = latestHasCapSql();
    // อนุญาตให้พูดถึงในคอมเมนต์ได้ แต่ห้ามมีการเรียกใช้จริง
    const codeOnly = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(codeOnly).not.toMatch(/my_role\(\)/);
  });
});

/**
 * 🔴 D85 — `for all` ครอบ SELECT ด้วย และ policy แบบ permissive ถูก **OR กัน**
 *
 * `wht_sel` เขียนถูกแล้วว่าฝ่ายเงินเดือนเห็นเฉพาะแถวที่ `emp_id` ไม่ว่าง
 * แต่ `wht_w` (for all) ไม่มีเงื่อนไขนั้น → `pay.write` เปิดอ่านทุกแถวทับไปเลย
 * = เห็นว่ากิจการจ่ายค่าบริการให้คู่ค้ารายไหนเท่าไหร่
 *
 * 🪤 **เขียน policy อ่านให้แคบไม่พอ** ถ้ายังมี policy for all ที่กว้างกว่าบนตารางเดียวกัน
 */
describe("wht_certificates — เงื่อนไข emp_id ต้องอยู่ครบทั้งฝั่งอ่านและฝั่งเขียน", () => {
  /** ไฟล์ migration ล่าสุดที่นิยาม policy ชื่อนี้ */
  function latestPolicy(name: string): string {
    const dir = path.join(ROOT, "supabase/migrations");
    const hit = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .reverse()
      .find((f) => readFileSync(path.join(dir, f), "utf8").includes(`create policy ${name} on`));
    expect(hit, `ไม่พบ migration ที่นิยาม policy ${name}`).toBeTruthy();
    const sql = readFileSync(path.join(dir, hit!), "utf8");
    const i = sql.indexOf(`create policy ${name} on`);
    return sql.slice(i, sql.indexOf(";", i));
  }

  it("🚨 policy ฝั่งเขียน (for all) ต้องมีเงื่อนไข emp_id ด้วย ไม่งั้นรั่วทางอ่าน", () => {
    expect(latestPolicy("wht_w")).toContain("emp_id is not null");
  });

  it("policy ฝั่งอ่านก็ต้องมี", () => {
    expect(latestPolicy("wht_sel")).toContain("emp_id is not null");
  });
});
