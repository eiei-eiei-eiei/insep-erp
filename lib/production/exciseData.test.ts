import { describe, it, expect } from "vitest";
import fs from "node:fs";

/**
 * D186 — ตัวเลือกข้อมูลของฟอร์ม ภส. ต้อง ① แบ่งหน้า ② กรองกิจการ
 *
 * อ่านซอร์สจริงมาตรวจ (ตระกูล exciseHidden.test.ts) เพราะทั้งสองเรื่อง "ผิดแล้วไม่มี error":
 *   ① ไม่แบ่งหน้า → PostgREST คืนแค่ 1,000 แถวแรก ฟอร์มขาดแถว/ยอดยกมาผิดเงียบ ๆ
 *   ② ไม่กรองกิจการ → เลือกกิจการแล้วเปลี่ยนแค่หัวฟอร์ม ตัวเลขเป็นของทุกกิจการรวมกัน
 * 🪤 ตรวจ **โค้ดหลังตัดคอมเมนต์** (บทเรียน D92/D95 — เทสที่ผ่านเพราะเจอคำในคอมเมนต์ = ไม่ได้พิสูจน์อะไร)
 */

const SRC = fs.readFileSync("app/(app)/production/excise-data.ts", "utf8");
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

/** ตัวฟังก์ชันตั้งแต่ชื่อถึงฟังก์ชันถัดไป */
function fnBody(name: string): string {
  const a = code.indexOf(`function ${name}`);
  if (a < 0) throw new Error(`ไม่พบ ${name}`);
  const b = code.indexOf("\nfunction ", a + 10);
  const c = code.indexOf("\nexport ", a + 10);
  const end = [b, c].filter((x) => x > 0).sort((x, y) => x - y)[0];
  return code.slice(a, end);
}

const LOG_TABLES = ["log_material", "log_ferment", "log_distill", "log_dilute", "log_ferment_draw", "log_product"];

describe("D186 — ฟอร์ม ภส. อ่านข้อมูลผ่านตัวช่วยที่แบ่งหน้า + กรองกิจการเท่านั้น", () => {
  it("ไม่มี .from(\"…\") ตรง ๆ นอกจาก entities และ log_product ในตัวช่วยของมัน", () => {
    const literal = [...code.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    const bad = literal.filter((t) => t !== "entities" && t !== "log_product");
    expect(bad, `อ่านตรงโดยไม่ผ่านตัวช่วย: ${bad.join(", ")}`).toEqual([]);
    expect(literal.filter((t) => t === "log_product").length).toBe(1);
    expect(fnBody("exciseLogProduct")).toContain('.from("log_product")');
  });

  it("ตัวช่วยทุกตัวแบ่งหน้า (fetchAllRows + range + เรียงคงที่)", () => {
    for (const fn of ["readLog", "readMaster", "exciseLogProduct"]) {
      const b = fnBody(fn);
      expect(b, fn).toContain("fetchAllRows");
      expect(b, fn).toContain(".range(from, to)");
      expect(b, fn).toMatch(/\.order\(/);
      expect(b, fn).toContain('count: "exact"');
    }
  });

  it("บันทึก (log_*) กรองกิจการ · ทะเบียนไม่กรอง", () => {
    expect(fnBody("readLog")).toContain('.eq("entity_id", entityId)');
    expect(fnBody("exciseLogProduct")).toContain('.eq("entity_id", entityId)');
    expect(fnBody("exciseLogProduct")).toContain('.eq("excise_hidden", false)'); // D90 ยังอยู่
    expect(fnBody("readMaster")).not.toContain("entity_id");
  });

  it("ทุกจุดที่เรียก readLog ส่ง entityId ของฟอร์ม และอ่านครบ 5 ตาราง log (+ log_product ผ่านตัวช่วย)", () => {
    const calls = [...code.matchAll(/readLog<\w+>\(\s*supabase,\s*"([a-z_]+)",\s*"[^"]*",\s*(\w+),/g)];
    const all = [...code.matchAll(/readLog<\w+>\(/g)];
    expect(calls.length, "มีการเรียก readLog ที่รูปแบบไม่ตรง (อาจไม่ได้ส่ง entityId)").toBe(all.length);
    for (const c of calls) expect(c[2], c[1]).toBe("entityId");
    const tables = new Set(calls.map((c) => c[1]));
    // positive control — กันเทสผ่านเพราะไม่มีอะไรให้ตรวจ
    for (const t of LOG_TABLES.filter((t) => t !== "log_product")) expect(tables.has(t), t).toBe(true);
    expect(code).toContain("exciseLogProduct(supabase, entityId)");
  });
});
