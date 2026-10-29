import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { revenueAccountFor, cashSettingText, CASH_METHOD } from "./cashAccount";
import { processOrder, type OrderState, type RevenueConfig } from "./orders";

/**
 * golden S14 — บัญชีรับเงินสดของแอปขาย (D142)
 */

const BANK = "กสิกร ออมทรัพย์";
const CASH = "เงินสดในมือ";

describe("S14 revenueAccountFor", () => {
  it("เงินสด + ตั้งบัญชีเงินสด → บัญชีเงินสด", () => {
    expect(revenueAccountFor(CASH_METHOD, { accountName: BANK, cashAccountName: CASH })).toBe(CASH);
  });
  it("วิธีอื่นทุกวิธี → บัญชีหลัก", () => {
    for (const m of ["โอนเงิน", "บัตรเครดิต", "เช็ค", ""]) {
      expect(revenueAccountFor(m, { accountName: BANK, cashAccountName: CASH }), m).toBe(BANK);
    }
    expect(revenueAccountFor(undefined, { accountName: BANK, cashAccountName: CASH })).toBe(BANK);
  });
  it("🚨 ไม่ตั้งบัญชีเงินสด = พฤติกรรมเดิม (เงินสดลงบัญชีหลัก)", () => {
    expect(revenueAccountFor(CASH_METHOD, { accountName: BANK })).toBe(BANK);
    expect(revenueAccountFor(CASH_METHOD, { accountName: BANK, cashAccountName: "" })).toBe(BANK);
    expect(revenueAccountFor(CASH_METHOD, { accountName: BANK, cashAccountName: "   " })).toBe(BANK);
  });
  it("ช่องว่างรอบคำว่าเงินสดไม่ทำให้หลุด", () => {
    expect(revenueAccountFor(" เงินสด ", { accountName: BANK, cashAccountName: CASH })).toBe(CASH);
  });
});

describe("S14 processOrder ใช้บัญชีตามวิธีของการรับเงินครั้งนั้น", () => {
  const contact = { taxId: "0105512345671", branch: "สำนักงานใหญ่", address: "กทม." };
  const items = [{ name: "เหล้า", qty: 2, price: 500 }];
  const config: RevenueConfig = { accountName: BANK, entityId: "EID01", cashAccountName: CASH };
  const order: OrderState = {
    quNo: "QU261029-001",
    orderNo: "ORD261029-001",
    status: "รอคอนเฟิร์ม",
    deposit: 0,
    outstandingBalance: 1070,
    subTotal: 1000,
    discount: 0,
    whtPercent: 0,
    category: "รายได้ค่าสินค้า",
    customerName: "ทดสอบ",
    invNo: "",
    taxNo1: "",
    taxNo2: "",
  };

  it("มัดจำเงินสด → บัญชีเงินสด · ยอดค้างโอน → บัญชีหลัก", () => {
    const dep = processOrder(order, "DEPOSIT_AND_SEND", { amount: 535, method: CASH_METHOD, docDate: "2026-10-29" },
      items, { invNo: "INV1", taxNo1: "TAX1" }, contact, config);
    expect(dep.revenue!.accountName).toBe(CASH);

    const after: OrderState = { ...order, status: "ส่งของแล้วรอชำระยอดค้าง", deposit: 535, outstandingBalance: 535, invNo: "INV1", taxNo1: "TAX1" };
    const bal = processOrder(after, "PAY_BALANCE", { method: "โอนเงิน", docDate: "2026-11-05" },
      items, { taxNo2: "TAX2" }, contact, config);
    expect(bal.revenue!.accountName).toBe(BANK);
  });

  it("จ่ายเต็มด้วยเงินสด → บัญชีเงินสด · ยอดเงินไม่ขยับ", () => {
    const r = processOrder(order, "FULL_PAYMENT_AND_SEND", { method: CASH_METHOD, docDate: "2026-10-29" },
      items, { taxNo1: "TAX1" }, contact, config);
    expect(r.revenue!.accountName).toBe(CASH);
    expect(r.revenue!.netAmount).toBe(1070);
    expect(r.revenue!.vatAmount).toBe(70);
  });

  it("🚨 ไม่ตั้งบัญชีเงินสด → เงินสดลงบัญชีหลักเหมือนก่อน D142", () => {
    const r = processOrder(order, "FULL_PAYMENT_AND_SEND", { method: CASH_METHOD, docDate: "2026-10-29" },
      items, { taxNo1: "TAX1" }, contact, { accountName: BANK, entityId: "EID01" });
    expect(r.revenue!.accountName).toBe(BANK);
  });

  it("🚨 orders.ts ต้องตัดสินบัญชีผ่าน revenueAccountFor เท่านั้น (ไม่หยิบ config.accountName ตรง)", () => {
    const src = readFileSync("lib/sales/orders.ts", "utf8");
    expect(src).toMatch(/accountName:\s*revenueAccountFor\(payload\.method,\s*config\)/);
    expect(src).not.toMatch(/accountName:\s*config\.accountName/);
  });
});

describe("S14 ประโยคใต้ช่องตั้งค่า", () => {
  it("ไม่ได้ตั้ง → บอกว่าเงินสดลงบัญชีหลัก + เตือนเรื่องสเตทเม้นต์", () => {
    expect(cashSettingText(BANK, "")).toMatch(/ลงบัญชี "กสิกร ออมทรัพย์" เหมือนเงินโอน/);
    expect(cashSettingText(BANK, "")).toMatch(/สเตทเม้นต์/);
  });
  it("ตั้งเป็นบัญชีเดียวกับบัญชีหลัก = เหมือนไม่ได้ตั้ง (ไม่บอกว่าแยกแล้ว)", () => {
    expect(cashSettingText(BANK, BANK)).toBe(cashSettingText(BANK, ""));
  });
  it("ตั้งแล้ว → บอกบัญชีเงินสด + บอกว่าตอนฝากต้องบันทึกโอน", () => {
    const t = cashSettingText(BANK, CASH);
    expect(t).toMatch(/รับเงินสดลงบัญชี "เงินสดในมือ"/);
    expect(t).toMatch(/โอนเงินระหว่างบัญชี/);
  });
  it("ยังไม่เลือกอะไรเลย → ไม่มีชื่อบัญชีว่างในประโยค", () => {
    expect(cashSettingText("", "")).not.toMatch(/""/);
  });
});
