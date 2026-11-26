import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { leaveGuard, pageTitle, unsavedDetail, formDiffers, type LeaveClick } from "./pageGuards";

/** D173 เฟส 5 — ชื่อแท็บเบราว์เซอร์ · เตือนยังไม่บันทึก · ล้อเมาส์ช่องตัวเลข · หัวตารางติดบน */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("pageTitle", () => {
  it("แท็บขึ้นก่อน โมดูลตาม แล้วชื่อแอป", () => {
    expect(pageTitle(["ค้นบิล", "บัญชี"])).toBe("ค้นบิล · บัญชี · PROOF");
  });
  it("ตัด ＋ นำหน้าชื่อแท็บ · ข้ามค่าว่าง · ไม่ซ้ำ", () => {
    expect(pageTitle(["＋ สร้างใบเสนอราคา", "ขาย"])).toBe("สร้างใบเสนอราคา · ขาย · PROOF");
    expect(pageTitle([null, "", "ตั้งค่า"])).toBe("ตั้งค่า · PROOF");
    expect(pageTitle(["ตั้งค่า", "ตั้งค่า"])).toBe("ตั้งค่า · PROOF");
    expect(pageTitle([])).toBe("PROOF");
  });
});

describe("leaveGuard — กดลิงก์ตอนยังไม่บันทึก", () => {
  const base: LeaveClick = { href: "/sales?tab=orders", origin: "http://x", pathname: "/accounting" };
  it("ไปหน้าอื่นในแอป → ถาม และคืนปลายทางครบ query", () => {
    expect(leaveGuard(base, true)).toBe("/sales?tab=orders");
    expect(leaveGuard({ ...base, href: "http://x/settings/users" }, true)).toBe("/settings/users");
  });
  it("ไม่มีอะไรค้าง → ไม่ถาม", () => {
    expect(leaveGuard(base, false)).toBeNull();
  });
  it("🚨 pathname เดิม (สลับ ?tab= / ?sec= / #) → ไม่ถาม — แท็บ mount ค้าง ของไม่หาย", () => {
    expect(leaveGuard({ ...base, href: "/accounting?tab=bills" }, true)).toBeNull();
    expect(leaveGuard({ ...base, href: "?tab=bills" }, true)).toBeNull();
    expect(leaveGuard({ ...base, href: "#top" }, true)).toBeNull();
  });
  it("เปิดแท็บใหม่ / ดาวน์โหลด / ออกนอกเว็บ → ไม่ถามที่นี่", () => {
    expect(leaveGuard({ ...base, modified: true }, true)).toBeNull();
    expect(leaveGuard({ ...base, target: "_blank" }, true)).toBeNull();
    expect(leaveGuard({ ...base, download: true }, true)).toBeNull();
    expect(leaveGuard({ ...base, href: "https://example.com/a" }, true)).toBeNull();
    expect(leaveGuard({ ...base, href: null }, true)).toBeNull();
  });
});

describe("unsavedDetail", () => {
  it("บอกชื่อของที่ค้าง ซ้ำนับครั้งเดียว", () => {
    expect(unsavedDetail(["บิลที่กำลังกรอก", "บิลที่กำลังกรอก", "ตะกร้า"])).toContain("บิลที่กำลังกรอก · ตะกร้า");
    expect(unsavedDetail([])).toContain("จะหาย");
  });
});

describe("ของกลางถูกต่อจริง", () => {
  it("PageGuards mount ใน layout ของแอป", () => {
    expect(read("app/(app)/layout.tsx")).toContain("<PageGuards />");
  });
  it("useTabUrl ตั้งชื่อแท็บเบราว์เซอร์จากแท็บ + โมดูล", () => {
    const src = read("app/(app)/_components/useTabUrl.ts");
    expect(src).toContain("usePageTitle(");
  });
  it("🚨 dirty ไม่ถูกตั้ง true ค้าง — useUnsaved ต้องรับนิพจน์ ไม่ใช่ค่าคงที่", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".tsx") && /useUnsaved\(\s*true\s*,/.test(fs.readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(path.join(process.cwd(), "app"));
    expect(hits).toEqual([]);
  });
  it("กันล้อเมาส์: ปล่อยโฟกัสช่อง type=number (ไม่ preventDefault — หน้าต้องเลื่อนได้)", () => {
    const src = read("lib/shared/pageGuardHost.tsx");
    const wheel = src.slice(src.indexOf("const onWheel"), src.indexOf("return <>{confirmNode}"));
    expect(wheel).toContain('el.type === "number"');
    expect(wheel).toContain("el.blur()");
    expect(wheel).not.toContain("preventDefault");
  });
  it("หัวตารางติดบน: เฉพาะจอกว้าง (จอมือถือไม่ซ้อนพื้นที่เลื่อน) และมีพื้นทึบ", () => {
    const css = read("app/globals.css");
    const i = css.indexOf("/* หัวตารางติดบน");
    expect(i).toBeGreaterThan(-1);
    const block = css.slice(i, i + 900);
    expect(block).toContain("min-width: 768px");
    expect(block).toContain("position: sticky");
    expect(block).toMatch(/background:\s*var\(--color-/);
  });
});

describe("formDiffers — การ์ดตั้งค่าที่เป็นฟอร์ม (D173 งานค้าง ข้อ 2)", () => {
  it("เท่าค่าที่บันทึกไว้ = ไม่เตือน", () => {
    expect(formDiffers({ a: "x", b: 1, c: true }, { a: "x", b: 1, c: true })).toBe(false);
  });
  it("แก้ช่องใดช่องหนึ่ง = เตือน", () => {
    expect(formDiffers({ a: "y", b: 1 }, { a: "x", b: 1 })).toBe(true);
    expect(formDiffers({ a: "x", b: 2 }, { a: "x", b: 1 })).toBe(true);
    expect(formDiffers({ a: "x", c: false }, { a: "x", c: true })).toBe(true);
  });
  it("เว้นวรรคหัวท้ายไม่นับ (server trim ตอนบันทึกอยู่แล้ว)", () => {
    expect(formDiffers({ a: " x  " }, { a: "x" })).toBe(false);
  });
  it("null/undefined เท่ากัน", () => {
    expect(formDiffers({ a: undefined as unknown as null }, { a: null })).toBe(false);
  });
});

describe("D173 งานค้าง ข้อ 1-2 — ฟอร์มที่ต้องมีตัวเตือนยังไม่บันทึก (อ่านซอร์ส)", () => {
  const FILES: [string, number][] = [
    ["app/(app)/payroll/_components/PeriodTab.tsx", 1],
    ["app/(app)/settings/_components/CompanyCard.tsx", 3], // บันทึกแยก 3 ปุ่ม = 3 ตัว
    ["app/(app)/settings/_components/BrandingCard.tsx", 1],
    ["app/(app)/settings/_components/LineCard.tsx", 1],
    ["app/(app)/bar/_components/BarSettingsTab.tsx", 1], // รวมผังบิล (บันทึกปุ่มเดียวกัน)
  ];
  for (const [f, n] of FILES) {
    it(`${f} เรียก useUnsaved ${n} ครั้ง`, () => {
      const code = fs.readFileSync(path.join(process.cwd(), f), "utf8")
        .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      expect((code.match(/\buseUnsaved\(/g) ?? []).length).toBe(n);
    });
  }
  it("🪤 LabCategoriesCard: useUnsaved อยู่ก่อน early return (ลำดับ hook)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/(app)/bar/_components/LabTab.tsx"), "utf8");
    const fn = src.slice(src.indexOf("export function LabCategoriesCard"));
    expect(fn.indexOf("useUnsaved(")).toBeGreaterThan(-1);
    expect(fn.indexOf("useUnsaved(")).toBeLessThan(fn.indexOf("if (!lab.data) return null;"));
  });
});
