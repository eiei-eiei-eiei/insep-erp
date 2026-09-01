import { describe, it, expect } from "vitest";
import fs from "node:fs";

/**
 * D90 — ยกเลิกออเดอร์แล้วคู่ จ่าย/รับ ต้องไม่ไปโผล่บนฟอร์มสรรพสามิต
 *
 * เทสนี้ **อ่านซอร์ส/SQL จริงมาตรวจ** (ชั้นเดียวกับ `tenantTables.test.ts` · `rolesSql.test.ts`)
 * เพราะกติกานี้กระจายอยู่ 2 ฝั่งที่ TypeScript มองไม่ทะลุถึงกัน:
 *   ① `fn_cancel_order` (SQL) ตัดสินและแช่ค่าไว้ที่ `excise_hidden`
 *   ② `excise-data.ts` (TS) เชื่อค่าที่แช่ไว้แล้วกรองออก
 * หลุดฝั่งใดฝั่งหนึ่ง **ไม่มี error ทั้งคู่** — ฟอร์มก็แค่ผิดเงียบ ๆ
 */

const EXCISE = "app/(app)/production/excise-data.ts";
const PROD = "app/(app)/production/data.ts";
const MIG = "supabase/migrations/20260901000057_excise_hide_cancelled.sql";

describe("D90 — ฝั่งฟอร์ม ภส. ต้องกรองแถวที่ถูกซ่อน", () => {
  const src = fs.readFileSync(EXCISE, "utf8");

  it("ทุกจุดที่อ่าน log_product ในฟอร์ม ภส. ต้องผ่าน exciseLogProduct()", () => {
    const raw = src.split(/\r?\n/).filter((l) => l.includes('from("log_product")') && !l.includes("function exciseLogProduct"));
    // บรรทัดที่เหลือต้องอยู่ในตัว helper เท่านั้น (helper มีบรรทัดเดียว)
    expect(raw.length, `มีจุดอ่าน log_product ที่ไม่ผ่าน helper:\n${raw.join("\n")}`).toBe(1);
    expect(src).toContain("exciseLogProduct(supabase)");
  });

  it("helper ต้องกรอง excise_hidden จริง", () => {
    expect(src).toMatch(/exciseLogProduct[\s\S]{0,400}excise_hidden/);
    expect(src).toContain('.eq("excise_hidden", false)');
  });
});

describe("🚨 D90 — ขอบเขตต้องอยู่แค่ 'ฟอร์ม' ห้ามลามไปสต็อก", () => {
  it("production/data.ts (สต็อก/ประวัติในแอป) ต้อง **ไม่** กรอง excise_hidden", () => {
    const prod = fs.readFileSync(PROD, "utf8");
    expect(
      prod.includes("excise_hidden"),
      "หน้าสต็อก/ประวัติต้องเห็นตามจริง — ของออกจากโรงจริงแล้วกลับมาจริง " +
        "ถ้ากรองด้วย ยอดในแอปจะไม่ตรงกับ stock_product ที่ trigger คิดจากทุกแถว",
    ).toBe(false);
  });

  it("migration ต้องไม่แตะ trigger ของ stock_product", () => {
    const sql = fs.readFileSync(MIG, "utf8");
    expect(sql).not.toMatch(/trg_update_stock_product|apply_stock_delta|log_product_stock/);
  });
});

describe("D90 — กติกาใน fn_cancel_order (อ่านจาก SQL จริง)", () => {
  const sql = fs.readFileSync(MIG, "utf8");

  it("เพิ่มคอลัมน์ครบ 2 ตัว และ default ของ excise_hidden ต้องเป็น false", () => {
    expect(sql).toMatch(/alter table log_product add column if not exists ref_no text/);
    expect(sql).toMatch(/excise_hidden boolean not null default false/);
  });

  it("🚨 ซ่อนเฉพาะตอนยังไม่เคยออกรายงาน — ไม่ใช่ซ่อนทุกกรณี", () => {
    expect(sql).toContain("if not v_reported then");
    expect(sql).toMatch(/update log_product set excise_hidden = true/);
    // ต้องดูทั้งเดือนที่ขายและเดือนที่ยกเลิก
    expect(sql).toContain("v_sale_month");
    expect(sql).toContain("v_now_month");
  });

  it("ตัดสินจาก report_runs ของตระกูลฟอร์ม ภส. เท่านั้น (ไม่ปนกับ ภพ.30/ภงด.)", () => {
    expect(sql).toMatch(/report_key like 'phor\\_so\\_%'/);
  });

  it("🚨 ห้าม backfill excise_hidden ย้อนหลัง — ฟอร์มเดือนเก่าอาจยื่นไปแล้ว", () => {
    const backfills = sql.match(/update log_product\s+set excise_hidden/g) ?? [];
    // มีได้จุดเดียวคือใน fn_cancel_order · ห้ามมี update ระดับ migration ตอนติดตั้ง
    expect(backfills.length).toBe(1);
    expect(sql).toMatch(/ไม่ backfill excise_hidden ย้อนหลัง/);
  });

  it("RPC ทั้งสองตัวต้องเขียน ref_no ลงคอลัมน์ (ไม่ให้รายงานไปแกะจากหมายเหตุ)", () => {
    const inserts = sql.match(/insert into log_product\([^)]*ref_no[^)]*\)/g) ?? [];
    expect(inserts.length, "ต้องมีทั้งฝั่งขาย (fn_confirm_fulfillment) และฝั่งคืน (fn_cancel_order)").toBe(2);
  });
});
