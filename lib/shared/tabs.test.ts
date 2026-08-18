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

describe("tabsFor — ฝั่งขายกรองตาม role", () => {
  it("main เห็นครบ 5 แท็บ", () => {
    expect(tabsFor("sales", "main").map((t) => t.slug)).toEqual([
      "create",
      "orders",
      "warehouse",
      "sync",
      "manage",
    ]);
  });

  it("sale ไม่เห็นคลังและจัดการข้อมูล", () => {
    expect(tabsFor("sales", "sale").map((t) => t.slug)).toEqual(["create", "orders", "sync"]);
  });

  it("warehouse เห็นแค่คลัง · viewer เห็นแค่ออเดอร์ (ตรงกับของเดิมก่อนย้ายมาทะเบียน)", () => {
    expect(tabsFor("sales", "warehouse").map((t) => t.slug)).toEqual(["warehouse"]);
    expect(tabsFor("sales", "viewer").map((t) => t.slug)).toEqual(["orders"]);
  });

  it("ผลิต/บัญชีไม่กรอง role — เห็นครบทุกแท็บ (สิทธิ์คุมที่ระดับ workspace อยู่แล้ว)", () => {
    expect(tabsFor("production", "viewer")).toHaveLength(PRODUCTION_TABS.length);
    expect(tabsFor("accounting", "viewer")).toHaveLength(WORKSPACE_TABS.accounting.length);
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
      "/settings/data",
    ]);
  });

  it("ฝั่งขายกรอง role ก่อนทำลิงก์ — คลังไม่ได้ลิงก์เข้าแท็บที่กดเข้าไม่ได้", () => {
    expect(navSubItems("sales", "warehouse")).toEqual([
      { label: "คลังจัดส่ง", href: "/sales?tab=warehouse" },
    ]);
  });

  it("workspace ที่ไม่มีในทะเบียน = ไม่มีรายการ (ไม่ throw)", () => {
    expect(navSubItems("ไม่มีจริง", "main")).toEqual([]);
  });
});
