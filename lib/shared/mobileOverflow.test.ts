import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * D165 — ไม่ให้หน้าไหนกว้างเกินจอมือถือ (อ่านซอร์สตรวจ)
 *
 * เหตุ: ผู้ใช้เปิดแอปบนมือถือแล้วหน้าเกินจอ เลื่อนไปทางขวาไม่ได้ ต้องหมุนจอแนวนอน
 *   · globals.css เคยตั้ง `overflow-x: hidden` ที่ html/body → ของที่ล้นถูกตัดทิ้งเงียบ ๆ (+ sticky ทั้งแอปไม่ติด)
 *   · `grid` ที่ไม่บอกความกว้างคอลัมน์ / ใช้ `1fr` เปล่า → คอลัมน์ขยายตามของข้างใน
 *     กรอบเลื่อน overflow-x-auto ที่อยู่ข้างในเลยไม่ทำงาน (ตัวแก้งวดในใบเสนอราคาดันหน้าเป็น 450px บนจอ 360px)
 *   · ตารางที่ไม่มีกรอบเลื่อน
 *   · ชื่อแบรนด์ยาวบนแถบบนดันปุ่มออกจากระบบตกจอทุกหน้า
 * 🪤 build/lint/test มองไม่เห็นเรื่องนี้เลย — โค้ดถูกทุกบรรทัด แค่กว้างเกิน
 */

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
const SRC = [...walk("app"), ...walk("lib")];
const read = (p: string) => readFileSync(p, "utf8");
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("D165 กันหน้าเกินจอมือถือ", () => {
  it("globals.css ไม่ซ่อนส่วนที่ล้นทั้งหน้า (overflow-x: hidden / max-width: 100vw ที่ html/body)", () => {
    const css = noComments(read("app/globals.css"));
    const rootRules = [...css.matchAll(/(^|\})\s*([^{}]*)\{([^{}]*)\}/g)]
      .filter(([, , sel]) => /(^|,)\s*(html|body)\s*(,|$)/.test(sel.trim()));
    for (const [, , sel, body] of rootRules) {
      expect(body, `กฎของ ${sel.trim()}`).not.toMatch(/overflow(-x)?\s*:\s*(hidden|clip)/);
      expect(body, `กฎของ ${sel.trim()}`).not.toMatch(/max-width\s*:\s*100vw/);
    }
    expect(rootRules.length).toBeGreaterThan(0); // ยังเจอกฎ body อยู่ (เทสไม่ได้ผ่านเพราะหาอะไรไม่เจอ)
  });

  it("ทุกตารางมีกรอบเลื่อนแนวนอนห่อ (overflow-x-auto / overflow-auto / overflow-y-auto / TableWrap)", () => {
    const bad: string[] = [];
    let tables = 0;
    for (const f of SRC) {
      const lines = read(f).split(/\r?\n/);
      lines.forEach((l, i) => {
        if (!/<table\b/.test(l) || /^\s*(\*|\/\/)/.test(l)) return; // ข้ามตัวอย่างในคอมเมนต์ (TableWrap)
        tables++;
        const above = lines.slice(Math.max(0, i - 8), i + 1).join("\n");
        // overflow-y-auto ก็นับ — แกนหนึ่งไม่ใช่ visible แล้วอีกแกนกลายเป็น auto ตาม (CSS Overflow 3)
        if (!/overflow-x-auto|overflow-auto|overflow-y-auto|overflow-x-scroll|<TableWrap\b/.test(above)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(tables).toBeGreaterThan(50);
    expect(bad, "ตารางที่ไม่มีกรอบเลื่อน — บนจอแคบจะดันทั้งหน้าให้กว้างเกินจอ").toEqual([]);
  });

  it("grid-cols-[…] ที่ใช้ fr ต้องเป็น minmax(0,…fr) — 1fr เปล่าขยายตามของข้างในจนกรอบเลื่อนไม่ทำงาน", () => {
    const bad: string[] = [];
    for (const f of SRC) {
      for (const m of read(f).matchAll(/grid-cols-\[([^\]]*)\]/g)) {
        const bare = m[1].split("_").filter((t) => /^\d*(\.\d+)?fr$/.test(t));
        if (bare.length) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("layout หน้าที่เป็น grid หลายคอลัมน์บนจอใหญ่ ต้องบอก grid-cols-1 บนจอเล็กด้วย (ไม่งั้นคอลัมน์โดยนัยขยายตามเนื้อหา)", () => {
    const bad: string[] = [];
    for (const f of SRC) {
      for (const m of read(f).matchAll(/className=["`{]([^"`}]*\b(?:sm|md|lg|xl|2xl):grid-cols-[^"`}]*)/g)) {
        const cls = m[1].split(/\s+/);
        if (!cls.includes("grid")) continue;
        if (cls.some((c) => /^grid-cols-/.test(c))) continue;
        // ฟอร์ม/การ์ดเล็กที่ไม่มีตารางหรือกรอบเลื่อนข้างในไม่ต้องตรวจ — ตรวจเฉพาะ layout ระดับหน้า (gap-4 ขึ้นไป + คอลัมน์ความกว้างตายตัว)
        if (cls.some((c) => /^(sm|md|lg|xl|2xl):grid-cols-\[/.test(c))) bad.push(`${f}: ${m[1].slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("แถบบน: ชื่อแบรนด์ยอมย่อ (min-w-0 + truncate) ปุ่มฝั่งขวาไม่ยอมหด (shrink-0)", () => {
    const src = read("app/(app)/_components/nav.tsx");
    expect(src).toMatch(/<Link href="\/" title=\{branding\.name\} className="[^"]*\bmin-w-0\b/);
    expect(src).toMatch(/<span className="truncate[^"]*">\{branding\.name\}<\/span>/);
    expect(src).toMatch(/className="ml-auto flex shrink-0 items-center/);
    expect(src).not.toMatch(/<Link href="\/" className="flex shrink-0/); // แบบเดิมที่ดันปุ่มตกจอ
  });
});
