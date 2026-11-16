import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { touchTitleOf } from "./touchTitle";

/** จอสัมผัส (D173 เฟส 3) — ปุ่มใหญ่พอให้แตะ + ข้อความใน title มองเห็นได้ */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const n = (tag: string, title: string | null = null, extra: { disabled?: boolean; role?: string } = {}) => ({ tag, title, ...extra });

describe("touchTitleOf — แตะแล้วควรโชว์ title ไหม", () => {
  it("ป้ายธรรมดาที่มี title → โชว์", () => {
    expect(touchTitleOf([n("SPAN", "ลบไม่ได้เพราะมีบิลใช้อยู่"), n("TD"), n("TR")])).toBe("ลบไม่ได้เพราะมีบิลใช้อยู่");
  });

  it("title อยู่ที่ตัวครอบ → โชว์ของตัวครอบ", () => {
    expect(touchTitleOf([n("B"), n("DIV", "เปลี่ยนหน่วยได้ที่ส่วนวัตถุดิบ")])).toBe("เปลี่ยนหน่วยได้ที่ส่วนวัตถุดิบ");
  });

  it("🚨 ปุ่มที่กดได้ ไม่ยุ่ง แม้ตัวมันหรือตัวครอบจะมี title", () => {
    expect(touchTitleOf([n("BUTTON", "แก้ไข")])).toBeNull();
    expect(touchTitleOf([n("SPAN"), n("BUTTON"), n("DIV", "คำอธิบายของกล่อง")])).toBeNull();
    expect(touchTitleOf([n("DIV", null, { role: "button" }), n("DIV", "x")])).toBeNull();
  });

  it("ลิงก์ · ช่องกรอก · label ไม่ยุ่ง", () => {
    for (const tag of ["A", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"]) {
      expect(touchTitleOf([n(tag, "t")])).toBeNull();
    }
  });

  it("ปุ่ม disabled ที่มี title → โชว์ (ถ้าเบราว์เซอร์ส่ง click มา)", () => {
    expect(touchTitleOf([n("BUTTON", "ต้องเลือกลูกค้าก่อน", { disabled: true })])).toBe("ต้องเลือกลูกค้าก่อน");
  });

  it("ไม่มี title เลย / title ว่าง → ไม่โชว์", () => {
    expect(touchTitleOf([n("SPAN"), n("DIV", "  ")])).toBeNull();
    expect(touchTitleOf([])).toBeNull();
  });
});

describe("กติกาจอสัมผัสที่ล็อกจากซอร์ส", () => {
  const css = read("app/globals.css");
  const block = css.slice(css.indexOf("@media (pointer: coarse)"));

  it("ปุ่มบนจอสัมผัสสูง/กว้างอย่างน้อย 32px — เฉพาะ pointer: coarse", () => {
    const rule = block.slice(0, block.indexOf("}") + 1);
    expect(rule).toContain("button:not([data-help])");
    expect(rule).toContain("min-height: 2rem");
    expect(rule).toContain("min-width: 2rem");
  });

  it("กฎอยู่ใน @layer base (คลาส Tailwind ต้องทับได้ — นอก layer จะชนะ min-h-[44px] ของ RowBtn)", () => {
    const before = css.slice(0, css.indexOf("@media (pointer: coarse)"));
    const lastLayer = before.lastIndexOf("@layer base");
    expect(lastLayer).toBeGreaterThan(-1);
    // ระหว่าง @layer base กับ @media ต้องไม่มีปีกกาปิดของ layer
    expect(before.slice(lastLayer)).not.toContain("}");
  });

  it("ไม่ขยายพื้นที่แตะด้วย ::after แบบ global (ล้นกรอบ overflow-x-auto → เลื่อนขึ้นลงได้)", () => {
    expect(css).not.toMatch(/button[^{]*::after\s*\{/);
  });

  it("TouchTitles ทำงานเฉพาะ pointer: coarse และถูกติดตั้งใน layout ของแอป", () => {
    const src = read("lib/shared/touchTitle.tsx");
    expect(src).toContain('matchMedia?.("(pointer: coarse)")');
    expect(read("app/(app)/layout.tsx")).toContain("<TouchTitles />");
  });
});
