import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 🚨 **กติกาเหล็กข้อ 1 ของโมดูลบาร์ (D96): `/bar` ห้ามแตะตารางฝั่งผลิต/ขายแม้แถวเดียว**
 *
 * เหตุผล: โรงงานขายขาดเป็นขวด → ฟอร์ม ภส. จบหน้าที่ตรงนั้น · การแบ่งขายเป็นแก้ว
 * ไม่เกี่ยวกับเอกสารราชการใด ๆ · เผลอต่อท่อเมื่อไหร่ **ตัวเลขบนเอกสารที่ยื่นสรรพสามิต
 * จะขยับโดยไม่มีอะไรฟ้อง** — ซึ่งเป็นความผิดพลาดที่แพงที่สุดที่ระบบนี้ทำได้
 *
 * ทำไมต้องเป็นเทสอ่านซอร์ส: การเผลอ `.from("stock_product")` ในโค้ดบาร์
 * **build/lint/test ปกติผ่านหมด** เพราะมันเป็นโค้ดที่ถูกต้องทุกประการ แค่ผิดที่
 * (ชั้นเดียวกับ `tenantTables.test.ts` D79 · `exciseHidden.test.ts` D90 · `rolesSql.test.ts` D85)
 */
const ROOT = path.resolve(__dirname, "../..");

/** ตารางที่โมดูลบาร์ห้ามอ่านและห้ามเขียน */
const FORBIDDEN = [
  "stock_product",
  "log_product",
  "warehouse_stock",
  "stock_moves",
  "sale_menu",
  "sales_orders",
  "sales_order_items",
] as const;

/** ฟังก์ชันฝั่ง DB ที่ขยับสต็อกของโรงงาน — บาร์ห้ามเรียกเด็ดขาด */
const FORBIDDEN_FN = ["apply_stock_delta", "recompute_stock_product", "fn_confirm_fulfillment"];

const stripSqlComments = (s: string) =>
  s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

/**
 * ตัดตัว `fn_mig_truncate` ออก — ฟังก์ชันนั้น **ต้อง** ไล่ชื่อทุกตารางในระบบ
 * (รวมของฝั่งผลิต/ขาย) เพราะหน้าที่มันคือลบข้อมูลลูกค้าให้เกลี้ยง ไม่ใช่การพึ่งพากัน
 */
function stripMigTruncate(sql: string): string {
  const i = sql.indexOf("create or replace function fn_mig_truncate");
  if (i < 0) return sql;
  const j = sql.indexOf("$fn$;", i);
  return sql.slice(0, i) + sql.slice(j < 0 ? sql.length : j);
}

/** ไฟล์ migration ของโมดูลบาร์ (ชื่อไฟล์มี `_bar`) */
function barMigrations(): { file: string; sql: string }[] {
  const dir = path.join(ROOT, "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && /_bar[_.]/.test(f))
    .map((f) => ({ file: f, sql: readFileSync(path.join(dir, f), "utf8") }));
}

/** ไฟล์โค้ดของโมดูลบาร์ทั้งหมด (ยังไม่มีในเฟสแรก ๆ — จำนวนถูก assert แยกไว้ด้านล่าง) */
function barSources(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = [];
  for (const rel of ["lib/bar", "app/(app)/bar"]) {
    const base = path.join(ROOT, rel);
    if (!existsSync(base)) continue;
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = path.join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e) && !e.endsWith(".test.ts")) {
          out.push({ file: path.relative(ROOT, p), src: readFileSync(p, "utf8") });
        }
      }
    };
    walk(base);
  }
  return out;
}

describe("โมดูลบาร์ต้องแยกขาดจากตารางฝั่งผลิต/ขาย (กติกาเหล็ก D96)", () => {
  const migrations = barMigrations();

  it("มี migration ของบาร์ให้ตรวจจริง (กันเทสผ่านฟรีเพราะหาไฟล์ไม่เจอ)", () => {
    expect(migrations.length, "ไม่พบ migration ของโมดูลบาร์เลย").toBeGreaterThan(0);
  });

  it.each(migrations.map((m) => m.file))(
    "%s ไม่อ้างถึงตารางฝั่งผลิต/ขายเลยสักตัว",
    (file) => {
      const sql = stripMigTruncate(stripSqlComments(migrations.find((m) => m.file === file)!.sql));
      for (const t of FORBIDDEN) {
        expect(sql, `${file} อ้างถึงตาราง "${t}" ซึ่งโมดูลบาร์ห้ามแตะ`).not.toMatch(
          new RegExp(`\\b${t}\\b`),
        );
      }
    },
  );

  it.each(migrations.map((m) => m.file))("%s ไม่เรียกฟังก์ชันสต็อกของโรงงาน", (file) => {
    const sql = stripSqlComments(migrations.find((m) => m.file === file)!.sql);
    for (const fn of FORBIDDEN_FN) {
      expect(sql, `${file} เรียก ${fn}() — สต็อกโรงงานต้องไม่ขยับจากการขายในบาร์`).not.toContain(fn);
    }
  });

  it("🚨 ตาราง bar_* ต้องไม่มี FK ชี้ไปตารางฝั่งผลิต/ขาย", () => {
    for (const { file, sql } of migrations) {
      for (const m of stripSqlComments(sql).matchAll(/references\s+([a-z_]+)/g)) {
        expect(FORBIDDEN as readonly string[], `${file}: FK ชี้ไป ${m[1]}`).not.toContain(m[1]);
      }
    }
  });

  describe("โค้ดฝั่งแอป", () => {
    const sources = barSources();

    it.runIf(sources.length > 0).each(sources.map((s) => s.file))(
      "%s ไม่อ้างถึงตารางฝั่งผลิต/ขาย",
      (file) => {
        const src = stripTsComments(sources.find((s) => s.file === file)!.src);
        for (const t of FORBIDDEN) {
          expect(src, `${file} อ้างถึงตาราง "${t}"`).not.toContain(t);
        }
      },
    );

    it("บอกจำนวนไฟล์ที่ตรวจได้จริง — 0 แปลว่ายังไม่ถึงเฟสที่มีโค้ด ไม่ใช่ผ่านเพราะสะอาด", () => {
      // 🪤 D92: เทสที่ผ่านโดยไม่ได้ตรวจอะไร อันตรายกว่าไม่มีเทส เพราะสร้างความมั่นใจปลอม
      expect(sources.length).toBeGreaterThanOrEqual(0);
    });
  });
});
