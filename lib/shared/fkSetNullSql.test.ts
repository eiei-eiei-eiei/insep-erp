import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * D137 — FK แบบ composite ที่มี `tenant_id` ห้ามใช้ `on delete set null` โดยไม่ระบุคอลัมน์
 *
 * ที่มา: 0064 เขียน `foreign key (tenant_id, entity_id, customer_id) references bar_customer
 *   ... on delete set null` ⇒ Postgres ตั้ง null **ทุกคอลัมน์ของ FK** รวม tenant_id/entity_id
 *   ⇒ ชน not null ⇒ ลบลูกค้าบาร์ที่เคยมีบิลไม่ได้ (PDPA) · เจอตอนเทสเบราว์เซอร์ D136
 *   แก้ใน 0095 เป็น `on delete set null (customer_id)` (Postgres 15+)
 *
 * 🪤 build/lint/test มองไม่เห็นเลย — SQL ถูกไวยากรณ์ทุกตัว แค่ความหมายผิด
 *    ⇒ อ่านไฟล์ migration เป็นข้อความ (ชั้นเดียวกับ tenantTables.test.ts / rolesSql.test.ts)
 * ★ ไล่ทุกไฟล์ตามลำดับ · FK ที่ถูกสร้างใหม่ในไฟล์หลัง (ตาราง+คอลัมน์ชุดเดียวกัน) ทับของเดิม
 *   ⇒ ตรวจ "สภาพล่าสุด" ไม่ใช่ทุกบรรทัดในประวัติ (0064 ยังมีของผิดอยู่และต้องอยู่ต่อ)
 */
const ROOT = path.resolve(__dirname, "../..");
const DIR = path.join(ROOT, "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

type Fk = {
  file: string;
  table: string;
  cols: string[];
  ref: string;
  /** null = ไม่มี on delete (= no action) */
  onDelete: string | null;
  /** คอลัมน์ใน `set null (...)` · null = ไม่ระบุ (ตั้ง null ทุกคอลัมน์) */
  setNullCols: string[] | null;
};

/** ตัดคอมเมนต์ `--` แล้วยุบช่องว่าง (คำในคอมเมนต์ห้ามถูกนับเป็นโค้ด · บทเรียน D92/D95) */
const clean = (sql: string) =>
  sql.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n").replace(/\s+/g, " ").toLowerCase();

const splitCols = (s: string) => s.split(",").map((c) => c.trim()).filter(Boolean);

const FK_RE =
  /foreign key \(([^)]+)\) references ([a-z_.]+) ?\(([^)]+)\)((?: on (?:delete|update) (?:set null(?: \([^)]*\))?|set default(?: \([^)]*\))?|cascade|restrict|no action))*)/g;

/** FK ทั้งหมดของไฟล์หนึ่ง — ผูกกับตารางจากหัวคำสั่ง `create table X` / `alter table X` */
function parseFile(file: string): Fk[] {
  const code = clean(readFileSync(path.join(DIR, file), "utf8"));
  const out: Fk[] = [];
  for (const stmt of code.split(";")) {
    const head = /(?:create table (?:if not exists )?|alter table (?:if exists )?(?:only )?)(?:public\.)?([a-z_]+)/.exec(stmt);
    if (!head) continue;
    for (const m of stmt.matchAll(FK_RE)) {
      const actions = m[4] ?? "";
      const del = / on delete (set null(?: \([^)]*\))?|set default(?: \([^)]*\))?|cascade|restrict|no action)/.exec(actions);
      const sn = del && /^set null(?: \(([^)]*)\))?$/.exec(del[1]);
      out.push({
        file,
        table: head[1],
        cols: splitCols(m[1]),
        ref: m[2].replace(/^public\./, ""),
        onDelete: del ? del[1] : null,
        setNullCols: sn ? (sn[1] ? splitCols(sn[1]) : null) : null,
      });
    }
  }
  return out;
}

const ALL = FILES.flatMap(parseFile);
const keyOf = (f: Fk) => `${f.table}(${f.cols.join(",")})→${f.ref}`;

/** สภาพล่าสุด: ไฟล์หลังทับไฟล์ก่อน ด้วยตาราง+คอลัมน์+ตารางปลายทางชุดเดียวกัน */
const LATEST = new Map<string, Fk>();
for (const f of ALL) LATEST.set(keyOf(f), f);

const isBareCompositeSetNull = (f: Fk) =>
  f.cols.length > 1 && f.cols.includes("tenant_id") &&
  f.onDelete?.startsWith("set null") === true && f.setNullCols === null;

describe("FK composite + on delete set null (D137 · 0095)", () => {
  it("ตัวอ่านไฟล์เจอ FK จริง (กันเทสเขียวเพราะ regex ไม่เจออะไรเลย)", () => {
    expect(ALL.length).toBeGreaterThan(30);
    // composite ที่มี tenant_id ต้องมีหลายตัว (ผ่าตัด PK 0027 · ตารางบาร์ 0064)
    expect(ALL.filter((f) => f.cols.length > 1 && f.cols.includes("tenant_id")).length).toBeGreaterThan(15);
  });

  it("positive control: 0064 มี set null เปล่าบน composite 2 ตัวพอดี (ตัวตรวจจับของผิดได้จริง)", () => {
    const bad = parseFile("20260910000064_bar_schema.sql").filter(isBareCompositeSetNull).map(keyOf).sort();
    expect(bad).toEqual([
      "bar_menu(tenant_id,entity_id,created_for)→bar_customer",
      "bar_sale(tenant_id,entity_id,customer_id)→bar_customer",
    ]);
  });

  it("🚨 สภาพล่าสุด: ไม่มี FK composite ที่มี tenant_id แล้ว `on delete set null` โดยไม่ระบุคอลัมน์", () => {
    const bad = [...LATEST.values()].filter(isBareCompositeSetNull).map((f) => `${keyOf(f)} (${f.file})`);
    expect(bad, `ต้องระบุคอลัมน์: on delete set null (<คอลัมน์ลูกค้า>)\n${bad.join("\n")}`).toEqual([]);
  });

  it("🚨 set null (คอลัมน์) ต้องเป็นคอลัมน์ของ FK และห้ามมี tenant_id/entity_id", () => {
    const bad = [...LATEST.values()]
      .filter((f) => f.setNullCols !== null)
      .filter((f) =>
        f.setNullCols!.length === 0 ||
        f.setNullCols!.some((c) => !f.cols.includes(c) || c === "tenant_id" || c === "entity_id"))
      .map((f) => `${keyOf(f)} set null (${f.setNullCols!.join(",")})`);
    expect(bad).toEqual([]);
  });

  it("FK ลูกค้าบาร์ 2 ตัว — สภาพล่าสุดมาจาก 0095 และตั้ง null เฉพาะช่องลูกค้า", () => {
    const menu = LATEST.get("bar_menu(tenant_id,entity_id,created_for)→bar_customer");
    const sale = LATEST.get("bar_sale(tenant_id,entity_id,customer_id)→bar_customer");
    expect(menu?.file).toBe("20261026000095_bar_customer_fk_setnull.sql");
    expect(sale?.file).toBe("20261026000095_bar_customer_fk_setnull.sql");
    expect(menu?.setNullCols).toEqual(["created_for"]);
    expect(sale?.setNullCols).toEqual(["customer_id"]);
  });

  it("0095 หาชื่อ FK เดิมจาก pg_constraint (ไม่เดาชื่อ) และล้มเสียงดังถ้าเจอไม่ใช่ 1 ตัว", () => {
    const code = clean(readFileSync(path.join(DIR, "20261026000095_bar_customer_fk_setnull.sql"), "utf8"));
    expect(code).toContain("from pg_constraint c");
    expect(code).toMatch(/c\.confrelid = 'public\.bar_customer'::regclass/);
    expect(code).toMatch(/if coalesce\(array_length\(v_names, 1\), 0\) <> 1 then raise exception/);
    // drop ต้องมาก่อน add (ชื่อใหม่อาจไม่ชน แต่ FK 2 ตัวบนคอลัมน์เดียวกัน = ลบลูกค้ายังล้มเหมือนเดิม)
    const iDrop = code.indexOf("drop constraint");
    const iAdd = code.indexOf("add constraint bar_menu_created_for_fkey");
    expect(iDrop).toBeGreaterThan(-1);
    expect(iAdd).toBeGreaterThan(iDrop);
    // ห้าม drop ด้วยชื่อที่พิมพ์ตายตัว
    expect(code).not.toMatch(/drop constraint (?:if exists )?bar_(?:menu|sale)_/);
  });
});
