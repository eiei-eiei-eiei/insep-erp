import { describe, it, expect } from "vitest";
import fs from "node:fs";

/**
 * D89 — กันบั๊ก "query พังแล้วเห็นเป็นลิสต์ว่าง" กลับมาเงียบ ๆ
 *
 * ชั้นอ่านเคยเขียน `const { data } = await q` แล้วทิ้ง `error` ทั้ง 82 จุด →
 * รายงานที่ยื่นราชการขาดแถว · เลขเอกสารออกซ้ำ · จ่ายภาษีซ้ำ โดยไม่มีอะไรฟ้อง
 *
 * เทสนี้ **อ่านซอร์สจริงมาตรวจ** (ชั้นเดียวกับ `tenantTables.test.ts` / `rolesSql.test.ts`)
 * เพราะ TypeScript มองไม่เห็นความต่างระหว่าง "ทิ้ง error" กับ "ตั้งใจไม่สนใจ error"
 *
 * 🪤 ถ้าเทสนี้แดงเพราะเพิ่ม query ใหม่ — ทางแก้คือห่อด้วย `mustRead()` ไม่ใช่เติมเข้า ALLOW
 *    เติมเข้า ALLOW ได้เฉพาะจุดที่ **ตั้งใจให้ทนพัง** และต้องเขียนเหตุผลกำกับ
 */

/** ไฟล์ชั้นอ่านที่ผ่านการไล่แล้วใน D89 (Tier 1+2) */
const GUARDED = [
  "app/(app)/accounting/data.ts",
  "app/(app)/sales/data.ts",
  "app/(app)/production/excise-data.ts",
];

/**
 * จุดที่ยอมให้ทิ้ง `error` ได้ — ต้องมีเหตุผลชัดเจนทุกบรรทัด
 * (ระบุเป็นชิ้นส่วนของบรรทัดที่พบในไฟล์)
 */
const ALLOW: { frag: string; why: string }[] = [
  {
    frag: "const { data, error, count }",
    why: "ส่งต่อให้ fetchAllRows ซึ่ง throw ให้อยู่แล้ว (lib/shared/paginate)",
  },
  {
    frag: 'const { data: p } = await supabase',
    why: "อ่าน profiles.role — fail-closed เป็น viewer โดยตั้งใจ (lib/shared/guard.ts:25 หลักเดียวกัน)",
  },
  {
    frag: "const { data: p } = await supabase\n",
    why: "เหมือนข้างบน (เขียนคร่อมหลายบรรทัด)",
  },
];

describe("D89 — ชั้นอ่านต้องไม่ทิ้ง error", () => {
  for (const file of GUARDED) {
    it(`${file} ไม่มี query ที่ทิ้ง error`, () => {
      const src = fs.readFileSync(file, "utf8");
      const offenders = src
        .split(/\r?\n/)
        .map((line, i) => ({ line: line.trim(), no: i + 1 }))
        .filter((l) => /const \{\s*data\b/.test(l.line))
        .filter((l) => !ALLOW.some((a) => l.line.includes(a.frag.split("\n")[0])));

      expect(
        offenders.map((o) => `${file}:${o.no} → ${o.line}`),
        "พบ query ที่ยังทิ้ง error — ห่อด้วย mustRead() แทน (อ่านไม่ได้ ≠ ไม่มีข้อมูล)",
      ).toEqual([]);
    });
  }

  it("🚩 ไฟล์ที่ไล่แล้วต้องเรียก mustRead จริง (กันเทสผ่านเพราะไม่มี query เลย)", () => {
    for (const file of GUARDED) {
      const src = fs.readFileSync(file, "utf8");
      expect(src, `${file} ไม่ได้ใช้ mustRead เลย — น่าจะถูกรื้อทิ้งโดยไม่ตั้งใจ`).toContain("mustRead");
    }
  });

  it("🚨 จุดที่ตั้งใจให้ทนพังต้องยังอยู่ครบ — ห้ามเผลอทำให้หน้าลูกหนี้-เจ้าหนี้ throw", () => {
    const src = fs.readFileSync("app/(app)/accounting/data.ts", "utf8");
    // ลูกค้าที่ไม่ได้ซื้อโมดูลขายอ่าน sales_orders ไม่ได้ตาม RLS —
    // ถ้าเปลี่ยนเป็น mustRead จะทำให้หน้าลูกหนี้-เจ้าหนี้พังทั้งหน้าสำหรับคนที่ซื้อแค่บัญชี
    expect(src, "การ์ดยอดค้างออเดอร์ขายต้องยัง degrade ได้").toContain("if (!so.error)");
  });
});
