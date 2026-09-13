import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * ── ยามกันคลาสสีที่ไม่มีอยู่จริง (D96) ──────────────────────────────────────
 *
 * 🐛 **บั๊กที่ทำให้ต้องมีไฟล์นี้**: โมดูลบาร์เขียน `bg-surface` / `bg-surface-2`
 *    ไว้ **54 จุด** ทั้งที่ token จริงชื่อ `card` / `raised`
 *    ⇒ Tailwind ไม่รู้จักชื่อนี้จึง **ไม่สร้าง CSS อะไรเลย ไม่เตือน ไม่ error**
 *    ผลลัพธ์บนจอ: `background-color: rgba(0,0,0,0)` = **พื้นหลังโปร่งใส**
 *
 *    อาการที่ผู้ใช้เห็น: ป๊อปอัพ "เมนูใหม่" / "เพิ่มวัตถุดิบ" **อ่านไม่ออก**
 *    เพราะตัวหนังสือของหน้าที่อยู่ข้างหลังทะลุขึ้นมาซ้อน
 *
 * 🚩 `npm run build` · `lint` · `test` **ผ่านหมด 100%** — ไม่มีชั้นไหนเห็นเลย
 *    (ตระกูลเดียวกับ `text-danger` ที่เจอตอนสร้างโมดูล และกับดัก D84
 *     "ชื่อที่พิมพ์ผิดแล้วไม่มีอะไรฟ้อง")
 *
 * ★ วิธีตรวจ: อ่าน `--color-*` จาก `app/globals.css` มาเป็นรายชื่อ token จริง
 *   แล้วไล่อ่านซอร์ส `.tsx` ทุกไฟล์ หา utility class ที่ "ควรจะเป็นสี"
 *   ถ้าชื่อไม่อยู่ในทั้ง token จริงและรายการคำของ Tailwind เอง = ฟ้อง
 *   (ชั้นเดียวกับ `tenantTables.test.ts` D79 / `rolesSql.test.ts` D85 —
 *    กติกาที่ TypeScript มองไม่ทะลุ ต้องอ่านข้อความมาตรวจเอง)
 */

const ROOT = process.cwd();
const CSS = path.join(ROOT, "app/globals.css");

/** ชื่อ token ที่ประกาศไว้จริง เช่น card · raised · ink · warn-bg */
function declaredTokens(): Set<string> {
  const css = fs.readFileSync(CSS, "utf8");
  const out = new Set<string>();
  for (const m of css.matchAll(/--color-([a-z0-9-]+)\s*:/g)) out.add(m[1]);
  return out;
}

/**
 * คำที่เป็นของ Tailwind เอง ไม่ใช่ token สีของเรา
 * 🚨 **ห้ามเติมชื่อสีดิบ** (`slate-800`, `red-500`) ลงลิสต์นี้เด็ดขาด —
 *    `CLAUDE.md` ห้ามเขียนคลาสสีดิบใน component และเทสข้อล่างคอยจับอยู่
 */
const TAILWIND_WORDS = new Set([
  // สีพิเศษของ CSS/Tailwind ที่ใช้ได้
  "white", "black", "transparent", "current", "inherit", "none",
  // ขนาด/ทิศทางของ text-*  (ชนกับ prefix เดียวกัน)
  "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl",
  "left", "right", "center", "justify", "start", "end", "wrap", "nowrap", "balance", "pretty",
  "ellipsis", "clip",
  // ขอบ/เส้น
  "t", "b", "l", "r", "x", "y", "s", "e",
  "solid", "dashed", "dotted", "double", "hidden", "collapse", "separate",
  "0", "2", "4", "8",
  // เงา
  "md", "inner",
]);

/** ไฟล์ .tsx ทั้งหมดใต้ app/ และ lib/ */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next") continue;
        walk(p);
      } else if (e.name.endsWith(".tsx")) out.push(p);
    }
  };
  walk(path.join(ROOT, "app"));
  walk(path.join(ROOT, "lib"));
  return out;
}

/** prefix ที่ตามด้วย "ชื่อสี" — ตัด shadow/ring ที่มีคำขนาดปนเยอะออกไปแล้ว */
const RE = /\b(bg|text|border|divide|fill|stroke|outline|ring|decoration|accent|caret)-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g;

describe("คลาสสีในซอร์สต้องมี token รองรับจริง (D96)", () => {
  const tokens = declaredTokens();
  const files = sourceFiles();

  it("globals.css ประกาศ token หลักครบ (กันไฟล์ถูกย้าย/เปลี่ยนรูปแบบแล้วเทสนี้กลายเป็นเทสเปล่า)", () => {
    // 🪤 ถ้า regex อ่านไม่เจออะไรเลย เทสข้างล่างจะ "ผ่าน" โดยไม่ได้ตรวจอะไร
    //    ซึ่งอันตรายกว่าไม่มีเทส (บทเรียน D92) → ยึดหมุดด้วยชื่อที่ต้องมีแน่ ๆ
    for (const t of ["card", "raised", "ink", "muted", "faint", "line", "brand", "warn-bg"]) {
      expect(tokens.has(t), `globals.css ต้องมี --color-${t}`).toBe(true);
    }
    expect(files.length).toBeGreaterThan(30);
  });

  it("ไม่มีคลาสสีที่ไม่มี token รองรับ (bg-surface = โปร่งใสเงียบ ๆ)", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const line of src.split("\n")) {
        // ★ ข้ามคอมเมนต์ — `lib/shared/ui.tsx` ยกตัวอย่างคลาสต้องห้ามไว้สอนคน
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        for (const m of line.matchAll(RE)) {
          const [full, , name] = m;
          if (tokens.has(name)) continue;
          if (TAILWIND_WORDS.has(name)) continue;
          // ค่าตัวเลขล้วน · และรูปแบบ "ด้าน-ความหนา" เช่น border-b-2 / border-t-2
          if (/^\d+(\.\d+)?$/.test(name)) continue;
          if (/^[tblrxyse]-\d+$/.test(name)) continue;
          bad.push(`${path.relative(ROOT, f)} → ${full}`);
        }
      }
    }
    expect(bad, `คลาสสีที่ไม่มี token รองรับ:\n${bad.join("\n")}`).toEqual([]);
  });

  it("ไม่มีคลาสสีดิบของ Tailwind ใน component (CLAUDE.md ห้าม)", () => {
    const PALETTE =
      /\b(?:bg|text|border|ring|fill|stroke|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const line of src.split("\n")) {
        // ★ ข้ามบรรทัดคอมเมนต์ — `lib/shared/ui.tsx` ยกตัวอย่างคลาสต้องห้ามไว้สอนคน
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        const hit = line.match(PALETTE);
        if (hit) bad.push(`${path.relative(ROOT, f)} → ${hit[0]}`);
      }
    }
    expect(bad, `คลาสสีดิบ (ต้องใช้ token แทน — docs/DESIGN_SYSTEM.md):\n${bad.join("\n")}`).toEqual([]);
  });
});
