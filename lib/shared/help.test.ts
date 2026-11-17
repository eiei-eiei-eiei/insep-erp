import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HELP_GAP, HELP_MARGIN, helpPlace } from "./helpPlace";

/**
 * ปุ่มคำอธิบาย ⓘ (D173 เฟส 2a)
 *
 * 2 ชั้น: (1) ตำแหน่งกล่อง — ฟังก์ชันล้วน (2) อ่านซอร์สของคอมโพเนนต์
 * ชั้นที่ 2 มีเพราะ vitest ของ repo นี้รันใน node ไม่มี DOM — กติกาที่ผู้ใช้เจอบนจอ
 * (กดในกล่องแล้วไม่ปิด · อยู่ใน label แล้วไม่ไปโฟกัสช่อง · ไม่ถูกตารางตัด) จึงล็อกจากซอร์ส
 */

const VIEW = { width: 360, height: 640 };
const POP = { width: 288, height: 120 };
const btn = (left: number, top: number) => ({ left, top, width: 20, height: 20 });

describe("helpPlace — ตำแหน่งกล่องคำอธิบาย", () => {
  it("ที่พอ → ใต้ปุ่ม ชิดซ้ายของปุ่ม", () => {
    const r = helpPlace(btn(20, 100), POP, VIEW);
    expect(r).toEqual({ left: 20, top: 100 + 20 + HELP_GAP, above: false });
  });

  it("ปุ่มอยู่ชิดขวา → เลื่อนกล่องเข้ามา ไม่ล้นขอบขวา", () => {
    const r = helpPlace(btn(330, 100), POP, VIEW);
    expect(r.left).toBe(VIEW.width - POP.width - HELP_MARGIN);
    expect(r.left + POP.width).toBeLessThanOrEqual(VIEW.width - HELP_MARGIN);
  });

  it("ปุ่มอยู่ชิดซ้ายสุด → ห่างขอบซ้ายอย่างน้อย margin", () => {
    expect(helpPlace(btn(0, 100), POP, VIEW).left).toBe(HELP_MARGIN);
  });

  it("ใต้ปุ่มไม่พอ และข้างบนมีที่มากกว่า → เปิดเหนือปุ่ม", () => {
    const r = helpPlace(btn(20, 600), POP, VIEW);
    expect(r.above).toBe(true);
    expect(r.top).toBe(600 - HELP_GAP - POP.height);
  });

  it("ใต้ปุ่มไม่พอ แต่ข้างบนยิ่งน้อยกว่า → อยู่ใต้ แล้วดันขึ้นให้อยู่ในจอ", () => {
    const tall = { width: 288, height: 500 };
    const r = helpPlace(btn(20, 200), tall, VIEW);
    expect(r.above).toBe(false);
    expect(r.top + tall.height).toBeLessThanOrEqual(VIEW.height - HELP_MARGIN);
  });

  it("กล่องใหญ่กว่าจอ → ชิดขอบบน-ซ้าย ไม่ติดลบ", () => {
    const r = helpPlace(btn(100, 300), { width: 400, height: 900 }, VIEW);
    expect(r.left).toBe(HELP_MARGIN);
    expect(r.top).toBe(HELP_MARGIN);
  });

  it("ไล่ปุ่มทั่วจอ 320–1280px: กล่องไม่ล้นขอบซ้าย/ขวาเลยสักจุด", () => {
    for (const w of [320, 360, 375, 768, 1280]) {
      const view = { width: w, height: 700 };
      const pop = { width: Math.min(288, w - 16), height: 100 };
      for (let x = 0; x <= w - 20; x += 7) {
        for (const y of [0, 300, 680]) {
          const r = helpPlace(btn(x, y), pop, view);
          expect(r.left).toBeGreaterThanOrEqual(HELP_MARGIN);
          expect(r.left + pop.width).toBeLessThanOrEqual(w - HELP_MARGIN);
          expect(r.top).toBeGreaterThanOrEqual(HELP_MARGIN);
          expect(r.top + pop.height).toBeLessThanOrEqual(view.height - HELP_MARGIN);
        }
      }
    }
  });
});

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("Help — กติกาที่ล็อกจากซอร์ส", () => {
  const src = read("lib/shared/help.tsx");

  it("เป็น <button type=button> มีชื่อให้โปรแกรมอ่านจอ + บอกสถานะเปิด", () => {
    expect(src).toContain('type="button"');
    expect(src).toContain("aria-label={name}");
    expect(src).toContain("aria-expanded={open}");
  });

  it("กล่องเป็น fixed + วางด้วย helpPlace (ไม่ถูกกรอบ overflow ตัด · ไม่ดันหน้ากว้างเกินจอ)", () => {
    expect(src).toContain("helpPlace(");
    expect(src).toMatch(/className=\{`fixed /);
    expect(src).toContain("max-w-[calc(100vw-16px)]");
    expect(src).not.toMatch(/className=\{`absolute /);
  });

  it("อยู่ใน <label> ได้ — กดปุ่มแล้วไม่ไปโฟกัสช่องกรอก", () => {
    const click = src.slice(src.indexOf("onClick={(e) => {"), src.indexOf("onKeyDown"));
    expect(click).toContain("e.preventDefault()");
    expect(click).toContain("btnRef.current?.focus()");
  });

  it("Esc ปิดกล่อง และไม่ไหลไปปิดป๊อปอัพที่ครอบอยู่", () => {
    const key = src.slice(src.indexOf("onKeyDown"), src.indexOf("onBlur"));
    expect(key).toContain('"Escape"');
    expect(key).toContain("e.stopPropagation()");
    // ชั้นที่ 2: Modal ข้าม Esc เมื่อปุ่มที่โฟกัสอยู่ aria-expanded
    expect(read("lib/shared/modal.tsx")).toContain('getAttribute?.("aria-expanded") === "true"');
  });

  it("กดที่อื่น / Tab ออก / เลื่อนจอ / ย่อขยายจอ = ปิด · กดในกล่องเอง = ไม่ปิด", () => {
    expect(src).toContain('"pointerdown"');
    expect(src).toContain('"scroll"');
    expect(src).toContain('"resize"');
    expect(src).toContain("onBlur={() => setOpen(false)}");
    expect(src).toContain("onMouseDown={(e) => e.preventDefault()}");
  });

  it("ปุ่มเล็ก 20px แต่พื้นที่แตะขยายด้วย ::before (จอสัมผัส)", () => {
    expect(src).toContain("before:-inset-2");
  });

  it("Field / Card รับ help แล้ววาดด้วย <Help> ตัวเดียวกัน", () => {
    const ui = read("lib/shared/ui.tsx");
    expect(ui).toContain('export { Help, type HelpProps } from "./help"');
    expect(ui.match(/\{help && <Help>\{help\}<\/Help>\}/g)?.length).toBe(2);
  });

  it("ไม่มีใครเขียนปุ่ม ⓘ เองนอกตัวกลาง", () => {
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(p);
        } else if (e.name.endsWith(".tsx") && !p.endsWith(path.join("lib", "shared", "help.tsx"))) {
          const s = fs.readFileSync(p, "utf8");
          if (s.includes("data-help=") || s.includes("ⓘ</button>")) bad.push(p);
        }
      }
    };
    walk(path.join(process.cwd(), "app"));
    walk(path.join(process.cwd(), "lib"));
    expect(bad).toEqual([]);
  });
});
