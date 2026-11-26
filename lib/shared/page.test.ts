/**
 * D184 — ตัวกลางของหน้า (หัวหน้าจอ · แถบแท็บ · ปุ่ม 3 ระดับ · โครงร่างตอนโหลด) — หน้าตัวอย่าง: บัญชี
 * ★ ล็อกกติกาที่ถ้าหลุดแล้วไม่มีอะไรฟ้อง (หน้าตาเพี้ยนเงียบ ๆ)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { BTN_TONE, BTN_SIZE } from "./page";

const src = readFileSync("lib/shared/page.tsx", "utf8");
const code = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("ปุ่ม 3 ระดับ (DESIGN_SYSTEM)", () => {
  it("มีแค่ 3 ระดับ — primary / secondary / danger", () => {
    expect(Object.keys(BTN_TONE).sort()).toEqual(["danger", "primary", "secondary"]);
    expect(Object.keys(BTN_SIZE).sort()).toEqual(["md", "sm"]);
  });
  it("ใช้ token เท่านั้น ไม่มีคลาสสีดิบ (CLAUDE.md)", () => {
    for (const cls of [...Object.values(BTN_TONE), ...Object.values(BTN_SIZE)]) {
      expect(cls).not.toMatch(/\b(?:bg|text|border)-(?:slate|gray|red|green|blue|amber|orange|white|black)-?\d*/);
    }
  });
  it("ปุ่มอันตรายเป็นเส้นขอบสีแดง ไม่ใช่พื้นแดงทึบ (แยกจาก primary ด้วยรูปทรง ไม่ใช่สีอย่างเดียว)", () => {
    expect(BTN_TONE.danger).toContain("text-crit");
    // hover:bg-crit-bg (พื้นจางตอนชี้) ได้ · พื้นแดงทึบ bg-crit ไม่ได้
    expect(BTN_TONE.danger.split(" ")).not.toContain("bg-crit");
  });
});

describe("โครงร่างตอนโหลด", () => {
  it("🪤 className (space-y/grid) อยู่ชั้นที่ครอบแถว ไม่ใช่ชั้น role=status (แถวซ้อนกัน — เจอบนจอแล้ว)", () => {
    expect(src).toMatch(/<div aria-hidden className=\{className\}>\{children\}<\/div>/);
  });
  it("โปรแกรมอ่านหน้าจอยังได้ยิน 'กำลังโหลด…' + เคารพการลดการเคลื่อนไหว", () => {
    expect(src).toContain('role="status"');
    expect(src).toMatch(/sr-only">กำลังโหลด/);
    expect(src).toContain("motion-safe:animate-pulse");
  });
});

describe("D184 ไล่ทั้งแอป — ทุกโมดูลใช้ตัวกลาง", () => {
  const APPS = ["accounting/_components/AccountingApp", "production/_components/ProductionApp", "sales/_components/SalesApp",
    "payroll/_components/PayrollApp", "bar/_components/BarApp"];
  it.each(APPS)("%s ใช้ PageHeader + ModuleTabs (ไม่เขียนแถบแท็บเอง)", (f) => {
    const s = code(`app/(app)/${f}.tsx`);
    expect(s).toContain("<PageHeader");
    expect(s).toContain("<ModuleTabs");
    expect(s).not.toMatch(/<h1/);
    expect(s).not.toMatch(/rounded-t-lg px-4 py-2/); // คลาสแถบแท็บที่เขียนเองแบบเดิม
  });
  it("ไม่เหลือ 'กำลังโหลด…' ตัวหนังสือเป็นที่ยึดทั้งก้อน (เหลือได้แค่ป้ายเล็ก ๆ ในบรรทัด)", () => {
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`;
        if (e.isDirectory()) walk(q);
        else if (q.endsWith(".tsx")) {
          const c = code(q);
          if (c.includes(">กำลังโหลด…</p>") || c.includes(">กำลังโหลด…</div>") || c.includes("<Empty>กำลังโหลด…</Empty>")) bad.push(q);
        }
      }
    };
    walk("app");
    expect(bad).toEqual([]);
  });
  it("SaveButton/RowBtn ใช้สีชุดเดียวกับ Button (แหล่งเดียว)", () => {
    const ui = readFileSync("lib/shared/ui.tsx", "utf8");
    expect(ui).toMatch(/BTN_TONE.primary/);
    expect(ui).toMatch(/red: BTN_TONE.danger/);
  });
});

describe("หน้าตัวอย่าง (บัญชี) ใช้ตัวกลางจริง", () => {
  it("หัวหน้าจอ + แถบแท็บ", () => {
    const s = code("app/(app)/accounting/_components/AccountingApp.tsx");
    expect(s).toContain("<PageHeader");
    expect(s).toContain("<ModuleTabs");
    expect(s).not.toMatch(/TABS\.map\(/); // แถบแท็บเขียนเองหายไปแล้ว
  });
  it("แท็บตัวอย่าง 3 แท็บไม่เหลือ 'กำลังโหลด…' ตัวหนังสือ", () => {
    for (const f of ["DashboardTab", "AccountsTab", "ApArTab"]) {
      expect(code(`app/(app)/accounting/_components/${f}.tsx`), f).not.toContain(">กำลังโหลด…<");
      expect(code(`app/(app)/accounting/_components/${f}.tsx`), f).not.toContain('"กำลังโหลด…"');
    }
  });
});
