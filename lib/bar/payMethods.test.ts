import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PAY_METHODS, CASH_METHOD, wantsQr, accountForMethod } from "./payMethods";

describe("B21 — วิธีรับเงินของบาร์ (D116)", () => {
  it("เหลือ 2 ปุ่ม · ไม่มีบัตรเครดิต · โอนกับ QR รวมกัน", () => {
    expect([...PAY_METHODS]).toEqual(["เงินสด", "โอน/QR"]);
  });
  it("โชว์ QR เฉพาะโอน/QR (+ ป้ายเก่า)", () => {
    expect(wantsQr("โอน/QR")).toBe(true);
    expect(wantsQr("QR")).toBe(true);
    expect(wantsQr("โอนเงิน")).toBe(true);
    expect(wantsQr("เงินสด")).toBe(false);
  });
  it("🚨 เงินสด → บัญชีเงินสดเมื่อตั้ง · ไม่ตั้ง = บัญชีหลัก · วิธีอื่น/ป้ายเก่า = บัญชีหลัก", () => {
    expect(accountForMethod("เงินสด", "ธนาคาร", "เงินสดในร้าน")).toBe("เงินสดในร้าน");
    expect(accountForMethod("เงินสด", "ธนาคาร", "  ")).toBe("ธนาคาร");
    expect(accountForMethod("โอน/QR", "ธนาคาร", "เงินสดในร้าน")).toBe("ธนาคาร");
    expect(accountForMethod("บัตรเครดิต", "ธนาคาร", "เงินสดในร้าน")).toBe("ธนาคาร");
  });
  it("🚨 SQL ตัวจริงใช้คำว่าเงินสดตัวเดียวกัน และอ่าน bar_cash_account (หลุดกัน = หน้าจอบอกผิดบัญชี)", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const file = readdirSync(dir).filter((f) => f.includes("_bar_cash_account")).sort().pop()!;
    const sql = readFileSync(join(dir, file), "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function fn_bar_post_day"));
    expect(fn).toContain(`v_rec.m = '${CASH_METHOD}'`);
    expect(fn).toContain("kind = 'bar_cash_account'");
  });
});
