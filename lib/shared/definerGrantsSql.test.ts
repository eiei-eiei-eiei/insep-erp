import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MUST_CLOSED_DEFINERS } from "./definerPolicy";

/**
 * ชั้นเสริมของ D99 — อ่านไฟล์ migration (ชั้นที่พิสูจน์จริงคือ tests/tenant/definer-grants.test.ts
 * ซึ่งถามสิทธิ์จาก pg_proc) · ชั้นนี้มีไว้จับให้ได้ **ก่อน** ลง DB:
 *
 *   1. revoke แบบ `from public` อย่างเดียว — รันผ่านแต่ไม่มีผลบน Supabase
 *      (revoke ทุกบรรทัดก่อน 0073 เป็นแบบนี้ และรอดสายตามาเพราะมันไม่ error)
 *   2. ฟังก์ชันที่ต้องปิด ถูกนิยามใหม่ในไฟล์ที่ใหม่กว่าบรรทัด revoke ล่าสุด
 *      (drop + create ใหม่ = ได้ default privileges คืน → ต้อง revoke ซ้ำในไฟล์นั้น · D69)
 *
 * 🪤 ตรวจโค้ดจริง ไม่ใช่คำในไฟล์ — ตัดคอมเมนต์ทิ้งก่อน และแยก "นิยาม" (`create ... function`)
 *    ออกจาก "มีคำว่า function X" (บรรทัด revoke ก็มีคำนั้น · กับดักที่ 0073 เจอ)
 */

const DIR = path.resolve(__dirname, "../../supabase/migrations");
/** 0073 คือไฟล์แรกที่รู้ว่า revoke from public ไม่พอ — ไฟล์เก่ากว่านี้ห้ามแก้ (ลง DB แล้ว) */
const FIRST_AWARE = "20260928000073";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
/** ตัด body ของฟังก์ชัน ($tag$ … $tag$) ทิ้งด้วย — เหลือแต่คำสั่งระดับไฟล์ */
const topLevel = (s: string) => stripComments(s).replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, " ");
const sqlOf = (f: string) => topLevel(readFileSync(path.join(DIR, f), "utf8"));

type Revoke = { file: string; fn: string; roles: string[] };

function revokesIn(f: string): Revoke[] {
  const out: Revoke[] = [];
  for (const m of sqlOf(f).matchAll(/revoke\s+execute\s+on\s+function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([^)]*\)\s+from\s+([^;]+);/gi)) {
    out.push({ file: f, fn: m[1].toLowerCase(), roles: m[2].split(",").map((r) => r.trim().toLowerCase()) });
  }
  return out;
}

const defines = (f: string, fn: string) =>
  new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${fn}\\s*\\(`, "i").test(sqlOf(f));

describe("D99 · revoke ต้องมีผลจริงบน Supabase (ชั้นเสริม — อ่านไฟล์)", () => {
  it("ตัวอ่านไฟล์เจอ revoke ของ 0073 จริง — กันเทสผ่านเพราะ regex ไม่เจออะไรเลย", () => {
    const r = files.filter((f) => f >= FIRST_AWARE).flatMap(revokesIn);
    expect(r.map((x) => x.fn)).toEqual(expect.arrayContaining(["fn_mig_set_triggers", "bar_apply_move"]));
  });

  it("🚨 ตั้งแต่ 0073: ทุก revoke execute ต้องครอบ anon ด้วย (from public อย่างเดียว = ไม่มีผล)", () => {
    const bad = files
      .filter((f) => f >= FIRST_AWARE)
      .flatMap(revokesIn)
      .filter((r) => !r.roles.includes("anon"))
      .map((r) => `${r.file}: ${r.fn} from ${r.roles.join(", ")}`);
    expect(bad).toEqual([]);
  });

  it.each(MUST_CLOSED_DEFINERS)(
    "🚨 %s: revoke (anon + authenticated) ต้องอยู่ในไฟล์เดียวกับหรือใหม่กว่าการนิยามล่าสุด",
    (fn) => {
      const lastDef = [...files].reverse().find((f) => defines(f, fn));
      expect(lastDef, `ไม่พบไฟล์ที่นิยาม ${fn}`).toBeTruthy();
      const lastRevoke = [...files]
        .reverse()
        .flatMap(revokesIn)
        .find((r) => r.fn === fn && r.roles.includes("anon") && r.roles.includes("authenticated"));
      expect(lastRevoke, `${fn} ไม่เคยถูก revoke จาก anon + authenticated`).toBeTruthy();
      expect(
        lastRevoke!.file >= lastDef!,
        `${fn} ถูกนิยามใหม่ใน ${lastDef} หลัง revoke ล่าสุด (${lastRevoke!.file}) — ต้อง revoke ซ้ำ`,
      ).toBe(true);
    },
  );

  it("🔴 0074 พลิก trg_update_stock_product เป็น definer ก่อน revoke apply_stock_delta (ลำดับในไฟล์)", () => {
    const f = files.find((x) => x.startsWith("20260928000074"));
    expect(f).toBeTruthy();
    const sql = sqlOf(f!);
    const flip = sql.search(/alter\s+function\s+trg_update_stock_product\s*\(\s*\)\s+security\s+definer/i);
    const rev = sql.search(/revoke\s+execute\s+on\s+function\s+apply_stock_delta/i);
    expect(flip).toBeGreaterThan(-1);
    expect(rev).toBeGreaterThan(flip);
  });

  it("🚨 fn_audit_definer_grants ถูก revoke ในไฟล์เดียวกับที่สร้าง", () => {
    const def = files.filter((f) => defines(f, "fn_audit_definer_grants"));
    expect(def.length).toBeGreaterThan(0);
    for (const f of def) {
      const r = revokesIn(f).find((x) => x.fn === "fn_audit_definer_grants");
      expect(r?.roles, f).toEqual(expect.arrayContaining(["public", "anon", "authenticated"]));
    }
  });
});
