import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * D161 เฟส 4 — ตัวจัดรูปวันที่ "รูปแบบตายตัว" เรียกได้เฉพาะไฟล์ที่ตั้งใจ
 *
 * ตัวพวกนี้**ไม่ตามค่าตั้งของลูกค้าโดยเจตนา** เพราะใช้กับ:
 *   · ฟอร์มราชการ — รูปแบบวันที่บนแบบเป็นของกรม (50ทวิ · ภพ.30/ภงด. · ภส. · ภงด.1/สปส.)
 *   · ข้อความ LINE — ส่งออกนอกแอป ไม่มี context ของหน้าจอ
 *   · ข้อความที่**เก็บลง DB** (คำอธิบายบิลจ่ายภาษี) — ค่าที่บันทึกแล้วต้องไม่เปลี่ยนตามค่าตั้งวันหลัง
 *
 * 🪤 เรียกจากหน้าจอได้ถูกต้องทุกประการ build/lint/test ผ่านหมด — แค่**ไม่ตามค่าตั้ง** ซึ่งเงียบสนิท
 *    (ตระกูลเดียวกับ D79/D85/D90 — โค้ดถูกทุกบรรทัดแค่ผิดที่)
 * ⇒ ใช้ที่ใหม่ = เทสแดง → ต้องตัดสินใจเองว่าใช่ฟอร์มราชการ/LINE/ข้อความที่เก็บจริงไหม
 *    ถ้าใช่ เติมไฟล์ลงลิสต์ · ถ้าเป็นหน้าจอหรือเอกสารการค้า ใช้ `useDateFmt()` / `CompanyInfo.dateFormat` แทน
 * ★ ลิสต์ต้อง**ตรงเป๊ะ** (เลิกใช้ที่ไหนก็ต้องลบออกจากลิสต์) — กันลิสต์บวมจนไม่มีใครอ่าน
 */
export const LEGACY_FORMATTER_FILES: Record<string, string[]> = {
  // 50ทวิ (dateText บนแบบ) — ตัวนิยามอยู่ format.ts
  formatDateThai: ["lib/accounting/wht.ts", "lib/shared/format.ts"],
  // LINE เตือนยื่นภาษี/งบเดือน + คำอธิบายบิลจ่ายภาษีที่เก็บลง DB
  formatMonthThai: ["lib/accounting/taxFiling.ts", "lib/accounting/taxPay.ts", "lib/production/exciseReminder.ts", "lib/shared/format.ts"],
  // LINE ทั้งหมด (ภาษี · งบเดือนสรรพสามิต · บาร์ค้างลงบัญชี)
  thaiDay: [
    "lib/accounting/taxFiling.ts", "lib/accounting/taxPay.ts", "lib/bar/posting.ts", "lib/bar/reminder.ts",
    "lib/production/exciseReminder.ts", "lib/shared/period.ts",
  ],
  // ภส. (หมายเหตุบนบัญชีผลิต + ล็อตกลั่นซ้ำ)
  fmtIsoDMY: ["lib/production/redistill.ts", "lib/production/reports.ts"],
  // ภพ.30 / ภงด.
  formatDateBE: ["lib/accounting/calc.ts"],
  // ภงด.1 / สปส.1-10 / ภงด.1ก (แท็บเอกสารยื่นใช้ป้ายเดียวกับที่พิมพ์ลงแบบ)
  thaiMonthYear: ["app/(app)/payroll/_components/FilingTab.tsx", "lib/payroll/filingHtml.ts"],
};

function sources(p: string): string[] {
  return readdirSync(p).flatMap((f) => {
    const full = join(p, f);
    if (statSync(full).isDirectory()) return f === "node_modules" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [full.replace(/\\/g, "/")] : [];
  });
}

/** โค้ดล้วน (ตัดบรรทัดคอมเมนต์) — คำอธิบายที่เอ่ยชื่อฟังก์ชันไม่นับเป็นการใช้ */
function codeOnly(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("D161 เฟส 4 — ตัวจัดรูปตายตัว (ราชการ/LINE) อยู่เฉพาะไฟล์ที่ตั้งใจ", () => {
  const files = [...sources("app"), ...sources("lib")].map((f) => ({ f, code: codeOnly(readFileSync(f, "utf8")) }));

  for (const [name, allowed] of Object.entries(LEGACY_FORMATTER_FILES)) {
    it(name, () => {
      const re = new RegExp(`\\b${name}\\b`);
      const used = files.filter((x) => re.test(x.code)).map((x) => x.f).sort();
      expect(used).toEqual([...allowed].sort());
    });
  }

  it("ตัวที่ลบไปแล้วต้องไม่กลับมา", () => {
    for (const gone of ["formatThaiDate", "receiveDateText"]) {
      const re = new RegExp(`\\b${gone}\\b`);
      expect(files.filter((x) => re.test(x.code)).map((x) => x.f), gone).toEqual([]);
    }
  });
});
