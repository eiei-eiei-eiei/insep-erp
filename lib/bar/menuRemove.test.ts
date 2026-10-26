import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  menuRemoveState, menuDeleteConfirm, menuToggleDoneText, menuDeletedText, inactiveToggleLabel,
  MENU_USED_REASON, MENU_USAGE_LOADING, MENU_USAGE_UNKNOWN,
} from "./menuRemove";

/** golden B29 — ลบ/ปิดใช้เมนูบาร์ (D138 · 0096) */
const base = { name: "Negroni", active: true, used: false, canWrite: true, canConfig: true };

describe("B29 menuRemoveState — ปุ่มบนแถวเมนู", () => {
  it("ไม่เคยขาย + เจ้าของ = ลบได้ · ปิดใช้ได้", () => {
    const s = menuRemoveState(base);
    expect(s).toEqual({ showToggle: true, toggleLabel: "ปิดใช้", showDelete: true, deleteBlocked: null });
  });

  it("🚨 เคยขายแล้ว = ลบไม่ได้ (เทาพร้อมเหตุผล) แต่ยังปิดใช้ได้", () => {
    const s = menuRemoveState({ ...base, used: true });
    expect(s.showDelete).toBe(true);
    expect(s.deleteBlocked).toBe(MENU_USED_REASON);
    expect(s.deleteBlocked).toContain("ปิดใช้");
    expect(s.showToggle).toBe(true);
  });

  it("🚨 ยังไม่รู้ว่าเคยขายไหม ≠ ไม่เคยขาย (D89) — ลบไม่ได้จนกว่าจะรู้", () => {
    expect(menuRemoveState({ ...base, used: null }, true).deleteBlocked).toBe(MENU_USAGE_LOADING);
    expect(menuRemoveState({ ...base, used: null }, false).deleteBlocked).toBe(MENU_USAGE_UNKNOWN);
  });

  it("สิทธิ์: พนักงานบาร์ (bar.write) ปิดใช้ได้ ไม่เห็นปุ่มลบ · ผู้ดูอย่างเดียวไม่เห็นทั้งคู่", () => {
    const staff = menuRemoveState({ ...base, canConfig: false });
    expect(staff.showToggle).toBe(true);
    expect(staff.showDelete).toBe(false);
    const viewer = menuRemoveState({ ...base, canWrite: false, canConfig: false });
    expect(viewer.showToggle).toBe(false);
    expect(viewer.showDelete).toBe(false);
  });

  it("เมนูที่ปิดใช้อยู่ → ปุ่มเป็น เปิดใช้", () => {
    expect(menuRemoveState({ ...base, active: false }).toggleLabel).toBe("เปิดใช้");
  });
});

describe("B29 ประโยคบนจอ", () => {
  it("กล่องยืนยันลบบอกว่าสูตรหายด้วย (เฉพาะเมนูที่มีสูตร) และกู้คืนไม่ได้", () => {
    expect(menuDeleteConfirm("A", true).detail).toContain("สูตรของเมนูนี้จะถูกลบด้วย");
    expect(menuDeleteConfirm("A", false).detail).not.toContain("สูตรของเมนูนี้");
    expect(menuDeleteConfirm("A", false).detail).toContain("กู้คืนไม่ได้");
    expect(menuDeleteConfirm("A", false).confirmText).toBe("ลบเมนู");
  });

  it("ปิดใช้บอกว่าเปิดคืนได้ที่ไหน · เปิดใช้บอกว่ากลับขึ้นหน้าขาย", () => {
    expect(menuToggleDoneText("A", false)).toContain("แสดงเมนูที่ปิดใช้");
    expect(menuToggleDoneText("A", true)).toContain("กลับมาขึ้นหน้าขาย");
  });

  it("ลบแล้วบอกการ์ดห้องทดลองที่กลับเป็นกำลังลอง (มีเท่านั้น)", () => {
    expect(menuDeletedText("A", 0)).toBe('ลบเมนู "A" แล้ว');
    expect(menuDeletedText("A", 1)).toContain("กลับเป็น กำลังลอง");
  });

  it("ปุ่มดูเมนูที่ปิดใช้ — ไม่มีเลย = ไม่แสดง", () => {
    expect(inactiveToggleLabel(0, false)).toBeNull();
    expect(inactiveToggleLabel(2, false)).toBe("แสดงเมนูที่ปิดใช้ (2)");
    expect(inactiveToggleLabel(2, true)).toBe("ซ่อนเมนูที่ปิดใช้ (2)");
  });
});

// ── ชั้น SQL / ซอร์ส (ตรรกะที่ TS มองไม่เห็น · ชั้นเดียวกับ tenantTables.test.ts) ─────────
const ROOT = path.resolve(__dirname, "../..");
const MIG = readFileSync(path.join(ROOT, "supabase/migrations/20261027000096_bar_menu_remove.sql"), "utf8")
  .split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
const fnBody = (name: string) => {
  const i = MIG.indexOf(`function ${name}(`);
  expect(i, `หา ${name} ไม่เจอ`).toBeGreaterThan(-1);
  return MIG.slice(i, MIG.indexOf("$fn$;", i));
};

describe("B29 0096 — ด่านลบเมนูอยู่ใน DB", () => {
  it("🚨 bar_menu ไม่มี policy delete (ลบได้ทางเดียวคือ fn_bar_delete_menu)", () => {
    expect(MIG).toMatch(/drop policy if exists bar_menu_w on bar_menu/);
    expect(MIG).not.toMatch(/create policy \w+ on bar_menu for (all|delete)/);
    expect(MIG).toMatch(/create policy bar_menu_ins on bar_menu for insert/);
    expect(MIG).toMatch(/create policy bar_menu_upd on bar_menu for update/);
  });

  it("🚨 ลบ = bar.config และตรวจ 'เคยถูกใช้' ก่อน delete", () => {
    const b = fnBody("fn_bar_delete_menu");
    expect(b).toMatch(/bar_guard\(p_entity, 'bar\.config'\)/);
    const iCheck = b.indexOf("raise exception 'เมนู");
    const iDel = b.indexOf("delete from bar_menu");
    expect(iCheck).toBeGreaterThan(-1);
    expect(iDel).toBeGreaterThan(iCheck);
  });

  it("🚨 เงื่อนไข 'เคยถูกใช้' ของจอ (bar_menu_used_ids) ตรงกับของด่าน (fn_bar_delete_menu)", () => {
    for (const t of ["bar_sale_item", "bar_lab_use_line"]) {
      expect(fnBody("bar_menu_used_ids"), t).toContain(`from ${t}`);
      expect(fnBody("fn_bar_delete_menu"), t).toContain(`from ${t}`);
    }
    // ★ ตัวอ่านเป็น invoker (ผ่าน RLS ของผู้เรียก) — ไม่เพิ่ม definer ที่ต้องเปิดสิทธิ์
    expect(fnBody("bar_menu_used_ids")).toMatch(/security invoker/);
  });

  it("การ์ดห้องทดลองที่ชี้มาที่เมนูถูกพากลับเป็น กำลังลอง ก่อนลบ", () => {
    const b = fnBody("fn_bar_delete_menu");
    expect(b).toMatch(/update bar_lab_recipe set status = 'กำลังลอง', menu_id = null/);
  });

  it("🚨 ไม่มีโค้ดฝั่งแอปลบ bar_menu ตรง ๆ (ข้ามด่าน 'เคยขาย')", () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) {
          const src = readFileSync(p, "utf8");
          if (/from\(["']bar_menu["']\)[\s\S]{0,80}?\.delete\(/.test(src)) offenders.push(path.relative(ROOT, p));
        }
      }
    };
    walk(path.join(ROOT, "app"));
    walk(path.join(ROOT, "lib"));
    expect(offenders).toEqual([]);
  });
});
