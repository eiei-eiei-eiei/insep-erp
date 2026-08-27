import { describe, it, expect } from "vitest";
import {
  WORKSPACE_TABS,
  SETTINGS_TABS,
  PRODUCTION_TABS,
  tabsFor,
  labelFromSlug,
  slugFromLabel,
  navSubItems,
} from "./tabs";
import { WORKSPACES } from "./workspaces";

/**
 * ทะเบียนแท็บเป็นแหล่งเดียวที่ทั้ง "แถบแท็บในหน้า" และ "ดร็อปดาวน์บนแถบเมนู" ใช้
 * → เทสชุดนี้กันไม่ให้สองที่เพี้ยนกันเงียบ ๆ
 */

describe("โครงของทะเบียนแท็บ", () => {
  it("ครบทุก workspace ที่มีเมนู (ไม่ใช่แค่บางอัน)", () => {
    expect(Object.keys(WORKSPACE_TABS).sort()).toEqual(WORKSPACES.map((w) => w.key).sort());
  });

  it("slug ห้ามซ้ำใน workspace เดียวกัน — ซ้ำ = ?tab= ชี้ได้สองแท็บ", () => {
    for (const [key, tabs] of Object.entries(WORKSPACE_TABS)) {
      const slugs = tabs.map((t) => t.slug);
      expect(new Set(slugs).size, `slug ซ้ำใน ${key}`).toBe(slugs.length);
    }
  });

  it("label ห้ามซ้ำ — App component ใช้ label เป็นคีย์ของ state", () => {
    for (const [key, tabs] of Object.entries(WORKSPACE_TABS)) {
      const labels = tabs.map((t) => t.label);
      expect(new Set(labels).size, `label ซ้ำใน ${key}`).toBe(labels.length);
    }
  });

  it("★ slug ต้องเป็น ASCII ล้วน — ใช้ภาษาไทยจะโดน percent-encode จนก๊อปลิงก์ไม่ไหว", () => {
    for (const tabs of Object.values(WORKSPACE_TABS)) {
      for (const t of tabs) expect(t.slug).toMatch(/^[a-z0-9-]+$/);
    }
    for (const t of SETTINGS_TABS) expect(t.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("แท็บรายงานสรรพสามิตอยู่ในผลิต (ยุบ workspace รายงานราชการแล้ว — D62)", () => {
    expect(PRODUCTION_TABS.map((t) => t.slug)).toContain("excise");
    expect(labelFromSlug("production", "excise")).toBe("รายงานสรรพสามิต");
  });
});

describe("labelFromSlug / slugFromLabel — ต้องแปลงกลับไปกลับมาได้", () => {
  it("ทุกแท็บแปลงไป-กลับแล้วได้ค่าเดิม", () => {
    for (const [key, tabs] of Object.entries(WORKSPACE_TABS)) {
      for (const t of tabs) {
        expect(labelFromSlug(key, t.slug)).toBe(t.label);
        expect(slugFromLabel(key, t.label)).toBe(t.slug);
      }
    }
  });

  it("slug ที่ไม่รู้จัก/ว่าง = null เพื่อให้หน้าตกกลับไปแท็บปริยาย (URL มั่ว ๆ ต้องไม่ทำให้หน้าว่าง)", () => {
    expect(labelFromSlug("production", "ไม่มีจริง")).toBeNull();
    expect(labelFromSlug("production", null)).toBeNull();
    expect(labelFromSlug("ไม่มี workspace นี้", "excise")).toBeNull();
  });

  it("label ที่ไม่รู้จัก = สตริงว่าง (จะได้ไม่เขียน ?tab= เปล่า ๆ ลง URL)", () => {
    expect(slugFromLabel("production", "แท็บผี")).toBe("");
  });
});

describe("tabsFor — กรองตามความสามารถของบทบาท", () => {
  it("main เห็นครบ 5 แท็บ", () => {
    expect(tabsFor("sales", "main").map((t) => t.slug)).toEqual([
      "create",
      "orders",
      "warehouse",
      "sync",
      "manage",
    ]);
  });

  it("sales_manager เห็นครบเหมือน main (ขาย+คลังเป็นบทบาทเดียวกันแล้ว)", () => {
    expect(tabsFor("sales", "sales_manager").map((t) => t.slug)).toEqual([
      "create",
      "orders",
      "warehouse",
      "sync",
      "manage",
    ]);
  });

  it("🔴 sales ทำงานได้ครบ แต่ไม่เห็นแท็บจัดการข้อมูล (= ตั้งค่าของหน้าขาย)", () => {
    expect(tabsFor("sales", "sales").map((t) => t.slug)).toEqual([
      "create",
      "orders",
      "warehouse",
      "sync",
    ]);
  });

  it("viewer เห็นแค่แท็บที่ไม่ต้องเขียนอะไร", () => {
    expect(tabsFor("sales", "viewer").map((t) => t.slug)).toEqual(["orders"]);
  });

  it("🔴 แท็บตั้งค่าของแต่ละโดเมนต้องมี config ถึงจะเห็น", () => {
    expect(tabsFor("accounting", "accounting").map((t) => t.slug)).not.toContain("settings");
    expect(tabsFor("accounting", "accounting_manager").map((t) => t.slug)).toContain("settings");
    expect(tabsFor("payroll", "payroll").map((t) => t.slug)).not.toContain("config");
    expect(tabsFor("payroll", "payroll_manager").map((t) => t.slug)).toContain("config");
    expect(tabsFor("payroll", "finance_manager").map((t) => t.slug)).toContain("config");
  });

  it("🔴 viewer ไม่เห็นแท็บตั้งค่า/จัดการข้อมูลของโดเมนไหนเลย (ดูอย่างเดียว)", () => {
    expect(tabsFor("production", "viewer").map((t) => t.slug)).not.toContain("master");
    expect(tabsFor("accounting", "viewer").map((t) => t.slug)).not.toContain("settings");
  });

  it("main เห็นครบทุกแท็บของผลิตและบัญชี", () => {
    expect(tabsFor("production", "main")).toHaveLength(PRODUCTION_TABS.length);
    expect(tabsFor("accounting", "main")).toHaveLength(WORKSPACE_TABS.accounting.length);
  });
});

describe("navSubItems — รายการในดร็อปดาวน์", () => {
  it("workspace ปกติได้ href แบบ ?tab=", () => {
    const items = navSubItems("production", "main");
    expect(items[0].href).toBe("/production?tab=board");
    expect(items).toHaveLength(PRODUCTION_TABS.length);
  });

  it("ตั้งค่าได้ route จริง ไม่ใช่ ?tab=", () => {
    const items = navSubItems("settings", "main");
    expect(items.map((i) => i.href)).toEqual([
      "/settings/company",
      "/settings/branding",
      "/settings/notify",
      "/settings/users",
      "/settings/history",
      "/settings/data",
    ]);
  });

  it("กรองสิทธิ์ก่อนทำลิงก์ — ไม่ยื่นลิงก์เข้าแท็บที่กดเข้าไม่ได้", () => {
    expect(navSubItems("sales", "viewer")).toEqual([
      { label: "จัดการออเดอร์", href: "/sales?tab=orders" },
    ]);
  });

  it("workspace ที่ไม่มีในทะเบียน = ไม่มีรายการ (ไม่ throw)", () => {
    expect(navSubItems("ไม่มีจริง", "main")).toEqual([]);
  });
});

// ── D78: ซ่อนแท็บของเส้นทางที่โรงนี้ไม่ได้ทำ (ตัดสินจากสินค้าจริง) ────────────────────
describe("tabsFor — กรองตามประเภทสุราที่มีสินค้าจริง", () => {
  const slugs = (p?: string[]) => tabsFor("production", "main", p).map((t) => t.slug);

  it("มีแต่สุรากลั่น → ไม่เห็นแท็บรินน้ำสุราแช่", () => {
    const s = slugs(["สุรากลั่น"]);
    expect(s).toContain("distill");
    expect(s).toContain("dilute");
    expect(s).not.toContain("draw");
  });
  it("มีแต่สุราแช่ → ไม่เห็นแท็บกลั่น/ปรุง", () => {
    const s = slugs(["สุราแช่"]);
    expect(s).toContain("draw");
    expect(s).not.toContain("distill");
    expect(s).not.toContain("dilute");
  });
  it("มีทั้งสองประเภท → เห็นครบ", () => {
    const s = slugs(["สุรากลั่น", "สุราแช่"]);
    expect(s).toContain("distill");
    expect(s).toContain("draw");
  });
  it("ยังไม่มีสินค้า (เซ็ตว่าง/ไม่ส่งมา) → เห็นครบ ไม่ใช่หายทั้งแท็บ", () => {
    expect(slugs([])).toContain("draw");
    expect(slugs([])).toContain("distill");
    expect(slugs(undefined)).toContain("draw");
  });
  it("แท็บที่ไม่ผูกประเภท (สต็อก/รายงาน) ไม่เคยถูกซ่อน", () => {
    for (const p of [["สุรากลั่น"], ["สุราแช่"], []]) {
      expect(slugs(p)).toContain("stock");
      expect(slugs(p)).toContain("excise");
      expect(slugs(p)).toContain("ferment");
    }
  });
  it("navSubItems ส่งต่อการกรองไปที่ดร็อปดาวน์แถบเมนูด้วย (ไม่งั้นลิงก์ไปแท็บที่ถูกซ่อน)", () => {
    const hrefs = navSubItems("production", "main", ["สุรากลั่น"]).map((i) => i.href);
    expect(hrefs).not.toContain("/production?tab=draw");
    expect(navSubItems("production", "main", ["สุราแช่"]).map((i) => i.href)).toContain("/production?tab=draw");
  });
});
