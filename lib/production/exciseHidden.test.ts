import { describe, it, expect } from "vitest";
import fs from "node:fs";

/**
 * D90 + D91 — ยกเลิกออเดอร์แล้วคู่ จ่าย/รับ ต้องไม่ไปโผล่บนฟอร์มสรรพสามิต
 *
 * เทสนี้ **อ่านซอร์ส/SQL จริงมาตรวจ** (ชั้นเดียวกับ `tenantTables.test.ts` · `rolesSql.test.ts`)
 * เพราะกติกานี้กระจายอยู่ 2 ฝั่งที่ TypeScript มองไม่ทะลุถึงกัน:
 *   ① `fn_cancel_order` (SQL) ตัดสินและแช่ค่าไว้ที่ `excise_hidden`
 *   ② `excise-data.ts` (TS) เชื่อค่าที่แช่ไว้แล้วกรองออก
 * หลุดฝั่งใดฝั่งหนึ่ง **ไม่มี error ทั้งคู่** — ฟอร์มก็แค่ผิดเงียบ ๆ
 *
 * 🚩 D91 เปลี่ยน *ที่มาของคำตอบ*: จาก "เคยออกรายงานไหม" (`report_runs` = เช็กลิสต์ ผิดตาราง)
 *    เป็น "เดือนนี้ปิดบัญชีสรรพสามิตหรือยัง" (`excise_month_close` ที่ผู้ใช้ประกาศเอง)
 *    → เทสที่ล็อกกติกาเดิมไว้จึงถูกแก้พร้อมกัน (เป็นเทสที่ล็อก*กฎที่เปลี่ยนไปจริง*)
 */

const EXCISE = "app/(app)/production/excise-data.ts";
const PROD = "app/(app)/production/data.ts";
const MIG90 = "supabase/migrations/20260901000057_excise_hide_cancelled.sql";
const MIG91 = "supabase/migrations/20260901000058_excise_month_close.sql";

const read = (f: string) => fs.readFileSync(f, "utf8");

/** ตัดเอาเฉพาะตัวฟังก์ชันออกมา — กันไม่ให้ assertion ไปโดนฟังก์ชันอื่นในไฟล์เดียวกัน */
function body(sql: string, name: string): string {
  const a = sql.indexOf(`create or replace function ${name}(`);
  if (a < 0) throw new Error(`ไม่พบ ${name}`);
  const b = sql.indexOf("\nend $", a);
  return sql.slice(a, b < 0 ? undefined : b);
}

describe("D90 — ฝั่งฟอร์ม ภส. ต้องกรองแถวที่ถูกซ่อน", () => {
  const src = read(EXCISE);

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
    const prod = read(PROD);
    expect(
      prod.includes("excise_hidden"),
      "หน้าสต็อก/ประวัติต้องเห็นตามจริง — ของออกจากโรงจริงแล้วกลับมาจริง " +
        "ถ้ากรองด้วย ยอดในแอปจะไม่ตรงกับ stock_product ที่ trigger คิดจากทุกแถว",
    ).toBe(false);
  });

  it("migration ทั้ง 2 ตัวต้องไม่แตะ trigger ของ stock_product", () => {
    for (const f of [MIG90, MIG91]) {
      expect(read(f), f).not.toMatch(/trg_update_stock_product|apply_stock_delta|log_product_stock/);
    }
  });
});

describe("D90 — คอลัมน์ + ref_no (อ่านจาก SQL จริง)", () => {
  const sql = read(MIG90);

  it("เพิ่มคอลัมน์ครบ 2 ตัว และ default ของ excise_hidden ต้องเป็น false", () => {
    expect(sql).toMatch(/alter table log_product add column if not exists ref_no text/);
    expect(sql).toMatch(/excise_hidden boolean not null default false/);
  });

  it("🚨 ห้าม backfill excise_hidden ย้อนหลัง — ฟอร์มเดือนเก่าอาจยื่นไปแล้ว", () => {
    expect(sql).toMatch(/ไม่ backfill excise_hidden ย้อนหลัง/);
    // มี update ได้จุดเดียวคือใน fn_cancel_order · ห้ามมี update ระดับ migration ตอนติดตั้ง
    expect((sql.match(/update log_product\s+set excise_hidden/g) ?? []).length).toBe(1);
  });

  it("RPC ทั้งสองตัวต้องเขียน ref_no ลงคอลัมน์ (ไม่ให้รายงานไปแกะจากหมายเหตุ)", () => {
    const inserts = sql.match(/insert into log_product\([^)]*ref_no[^)]*\)/g) ?? [];
    expect(inserts.length, "ต้องมีทั้งฝั่งขาย (fn_confirm_fulfillment) และฝั่งคืน (fn_cancel_order)").toBe(2);
  });
});

describe("D91 — ตัวล็อกคือ 'ปิดเดือน' ไม่ใช่ 'เคยกดพิมพ์'", () => {
  const sql = read(MIG91);
  const cancel = body(sql, "fn_cancel_order");
  const recompute = body(sql, "fn_excise_recompute_hidden");

  it("🚨 fn_cancel_order ต้องไม่ query report_runs อีกต่อไป (นั่นคือเช็กลิสต์ ไม่ใช่ตัวล็อก)", () => {
    expect(
      /from\s+report_runs/.test(cancel),
      "report_runs มีแถวทุกครั้งที่พิมพ์บัญชีประจำวันให้เจ้าหน้าที่ตรวจ → " +
        "ใช้เป็นตัวล็อก = ยกเลิกบิลแล้วแก้ฟอร์มไม่ได้ตลอดกาล (ต้นเรื่องของ D91)",
    ).toBe(false);
  });

  it("🚨 คำถามต้องอยู่ที่เดียว — ทั้ง cancel และ recompute เรียก fn_excise_months_open", () => {
    expect(cancel).toContain("fn_excise_months_open(");
    expect(recompute).toContain("fn_excise_months_open(");
    // และตัวคำถามต้องไล่เดือนจาก **แถวจริง** ไม่ใช่ current_date (ผิดตอนคำนวณใหม่ทีหลัง)
    const pred = body(sql, "fn_excise_months_open");
    expect(pred).toContain("to_char(lp.doc_date, 'YYYY-MM')");
    expect(pred).not.toContain("current_date");
  });

  it("🚨 recompute ต้องเซ็ตได้ทั้ง true และ false (เดือนที่ปิดใหม่ต้องดันแถวกลับมาแสดงได้)", () => {
    expect(recompute).toMatch(/update log_product set excise_hidden = v_want/);
    expect(recompute).toContain("p_dry");
  });

  it("🚨 ห้าม backfill ตอนติดตั้ง — update excise_hidden มีได้เฉพาะใน RPC", () => {
    const all = sql.match(/update log_product set excise_hidden/g) ?? [];
    expect(all.length, "1 ใน fn_cancel_order + 1 ใน fn_excise_recompute_hidden เท่านั้น").toBe(2);
    expect(sql).toMatch(/ไม่ backfill อะไรทั้งสิ้น/);
  });

  it("ปิด/ถอนปิด/คำนวณใหม่ ต้องเป็นระดับหัวหน้า (prod.config) — ดูอย่างเดียวใช้ prod.read", () => {
    for (const fn of ["fn_excise_close_month", "fn_excise_reopen_month"]) {
      expect(body(sql, fn), fn).toContain("has_cap('prod.config')");
    }
    expect(recompute).toContain("has_cap('prod.config')");
    expect(recompute).toContain("has_cap('prod.read')"); // เส้นทาง dry-run
  });

  it("🚨 definer ต้องเช็คขอบเขตกิจการเอง (bypass RLS — บทเรียน 0028→0029)", () => {
    for (const fn of ["fn_excise_close_month", "fn_excise_reopen_month"]) {
      expect(body(sql, fn), fn).toContain("my_entities()");
    }
  });

  it("กันปิดซ้อนด้วย partial unique index (แพตเทิร์นเดียวกับ tax_payments ของ D88)", () => {
    expect(sql).toMatch(/create unique index[\s\S]{0,120}excise_month_close[\s\S]{0,120}where reopened_at is null/);
  });

  it("🚨 ถอนปิดต้องคำนวณใหม่ให้เลย — ไม่ใช่ให้ผู้ใช้ไปกดอีกปุ่ม", () => {
    expect(body(sql, "fn_excise_reopen_month")).toContain("fn_excise_recompute_hidden(");
  });

  it("🚨 ปิดเดือนต้อง **ไม่** คำนวณใหม่ (คู่ที่ซ่อนไว้ตอนเดือนเปิด ต้องซ่อนต่อ)", () => {
    expect(
      body(sql, "fn_excise_close_month").includes("fn_excise_recompute_hidden("),
      "ถ้าปิดเดือนแล้วไปคำนวณใหม่ คู่ที่ซ่อนไว้จะโผล่กลับมาบนฟอร์มที่กำลังจะยื่น",
    ).toBe(false);
  });

  it("ตารางใหม่ต้องไม่มี policy สำหรับเขียน (เขียนผ่าน RPC เท่านั้น — บทเรียน D85/0052)", () => {
    const pol = sql.match(/create policy[\s\S]*?on excise_month_close[^;]*;/g) ?? [];
    expect(pol.length).toBe(1);
    expect(pol[0]).toContain("for select");
  });

  it("fn_mig_truncate ต้องลบ excise_month_close **ก่อน** entities (FK — บทเรียน D82/0050)", () => {
    const t = body(sql, "fn_mig_truncate");
    const i = t.indexOf("'excise_month_close'");
    const j = t.indexOf("'entities'");
    expect(i, "ตกตารางใหม่ = ลบ/รีเซ็ตลูกค้าไม่ได้เลย").toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });
});

describe("D91b — ตัวเลขที่ไม่มีทิศทาง ห้ามเอาไปแต่งประโยคที่มีทิศทาง (0059)", () => {
  const sql = read("supabase/migrations/20260901000059_recompute_direction.sql");

  it("dry-run ต้องคืน to_hide / to_show แยกกัน ไม่ใช่แค่ changed", () => {
    expect(sql).toMatch(/'to_hide', v_to_hide/);
    expect(sql).toMatch(/'to_show', v_to_show/);
    expect(sql).toMatch(/if v_want then v_to_hide := v_to_hide \+ 1; else v_to_show := v_to_show \+ 1; end if;/);
  });

  it("ถอนปิดเดือนต้องส่งทิศทางต่อออกไปด้วย (ไม่งั้นข้อความหลังถอนก็ยังไร้ทิศทาง)", () => {
    const reopen = body(sql, "fn_excise_reopen_month");
    expect(reopen).toContain("'to_hide'");
    expect(reopen).toContain("'to_show'");
  });

  it("🚨 หน้าจอต้องไม่เหลือทางเดาทิศทางเอาเอง — ไม่มี pendingHide แล้ว", () => {
    const tab = read("app/(app)/production/_components/ExciseTab.tsx");
    expect(tab).not.toContain("pendingHide");
    expect(tab).toContain("pendingRecomputeText");
  });

  it("signature ไม่เปลี่ยน → create or replace ทับได้ ไม่เกิด overload (D69)", () => {
    for (const f of ["fn_excise_recompute_hidden(p_entity text, p_month text, p_dry boolean)",
                     "fn_excise_reopen_month(p_entity text, p_month text, p_note text)"]) {
      expect(sql, f).toContain(f);
    }
    expect(sql).not.toMatch(/drop function/);
  });
});
