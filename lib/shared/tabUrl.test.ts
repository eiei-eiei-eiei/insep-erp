import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { WORKSPACE_TABS, labelFromSlug, slugFromLabel } from "./tabs";

/**
 * D166 — แท็บต้องเปลี่ยนตาม URL (ดร็อปดาวน์แถบบน · ปุ่มย้อนกลับ)
 *
 * `useTabUrl` ส่ง **ชื่อแท็บ** (label) กลับให้แอป แต่บาร์กับขายเก็บแท็บเป็น **slug**
 * แล้วเช็ค `allowed.includes(ชื่อ)` ตรง ๆ → ไม่ผ่านทุกครั้ง ⇒ URL เปลี่ยนแต่จอค้างแท็บเดิม
 * (มีมาตั้งแต่ D96 บาร์ · และขายตั้งแต่ย้ายแท็บเข้าทะเบียนกลาง · คอมเมนต์ในโค้ดเขียนว่า "ไม่ต้องแปลงชื่อ")
 * 🪤 build/lint/test มองไม่เห็น — TS เห็นเป็น string ทั้งคู่
 *
 * กติกา: ในการเรียก useTabUrl แต่ละที่ **ต้องแปลงข้างเดียว พอดี**
 *   · state เป็นชื่อ → toSlug ใช้ slugFromLabel · setter ใช้ชื่อตรง ๆ
 *   · state เป็น slug → setter ใช้ slugFromLabel · toSlug ใช้ค่าตรง ๆ
 */

const APPS: Record<string, string> = {
  accounting: "app/(app)/accounting/_components/AccountingApp.tsx",
  production: "app/(app)/production/_components/ProductionApp.tsx",
  sales: "app/(app)/sales/_components/SalesApp.tsx",
  payroll: "app/(app)/payroll/_components/PayrollApp.tsx",
  bar: "app/(app)/bar/_components/BarApp.tsx",
};

/** ตัดการเรียก useTabUrl(...) ออกมา (นับวงเล็บ) → แยก 4 อาร์กิวเมนต์ระดับบนสุด */
function tabUrlArgs(src: string): string[] {
  const start = src.indexOf("useTabUrl(");
  expect(start, "หา useTabUrl( ไม่เจอ").toBeGreaterThan(-1);
  const args: string[] = [];
  let depth = 0, cur = "";
  for (let i = start + "useTabUrl(".length; i < src.length; i++) {
    const ch = src[i];
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) {
      if (depth === 0) { args.push(cur.trim()); break; }
      depth--;
    }
    if (ch === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  return args.filter((a, i) => a !== "" || i < args.length - 1); // comma ปิดท้าย (trailing comma)
}

describe("D166 useTabUrl — แปลงชื่อ↔slug ข้างเดียวพอดี", () => {
  for (const [key, file] of Object.entries(APPS)) {
    it(`${key}: setter กับ toSlug แปลงข้างเดียว`, () => {
      const args = tabUrlArgs(readFileSync(file, "utf8"));
      expect(args).toHaveLength(4);
      expect(args[0]).toBe(`"${key}"`);
      const setterConverts = args[2].includes(`slugFromLabel("${key}"`);
      const toSlugConverts = args[3].includes(`slugFromLabel("${key}"`);
      // ตรงกันทั้งคู่ = แปลง 2 รอบ หรือไม่แปลงเลย (บาร์/ขายเดิม) → แท็บไม่ตาม URL
      expect(setterConverts !== toSlugConverts, `${file}\nsetter: ${args[2]}\ntoSlug: ${args[3]}`).toBe(true);
    });
  }

  it("ทุก workspace ที่มีแท็บถูกตรวจครบ", () => {
    expect(Object.keys(APPS).sort()).toEqual(Object.keys(WORKSPACE_TABS).sort());
  });

  it("ชื่อ ↔ slug ไปกลับได้ครบทุกแท็บ (ไม่มีชื่อ/slug ซ้ำในแอปเดียวกัน)", () => {
    for (const [key, tabs] of Object.entries(WORKSPACE_TABS)) {
      for (const t of tabs) {
        expect(labelFromSlug(key, t.slug)).toBe(t.label);
        expect(slugFromLabel(key, t.label)).toBe(t.slug);
      }
    }
  });

  it("hook บอกชัดว่า setter ได้ชื่อแท็บ", () => {
    const src = readFileSync("app/(app)/_components/useTabUrl.ts", "utf8");
    expect(src).toContain("setTabByLabel: (label: string) => void");
    expect(src).toMatch(/const label = labelFromSlug\(workspaceKey, urlSlug\);\s*if \(label\) setTab\(label\);/);
  });
});
