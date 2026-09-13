import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { barReminderKey, barReminderMessage, BAR_POST_REMINDER_ACTION } from "./reminder";
import { unpostedDays } from "./posting";

/** golden **B13** — เตือนยอดบาร์ค้างลงบัญชีเข้า LINE (D96 เฟส E) */

const days = (...iso: string[]) =>
  unpostedDays(iso.map((d) => ({ businessDate: d, grandTotal: 500 })), [], "2030-01-01");

describe("barReminderMessage (golden B13)", () => {
  it("ไม่มีอะไรค้าง → null (เงียบ ไม่ส่ง 'ทุกอย่างเรียบร้อย')", () => {
    expect(barReminderMessage({ days: [], hasRevenueAccount: true })).toBeNull();
  });

  it("บอกจำนวนวัน + วันที่ค้าง + สิ่งที่ต้องไปกด", () => {
    const text = barReminderMessage({
      days: days("2026-09-10", "2026-09-12"),
      hasRevenueAccount: true,
    })!;
    expect(text).toContain("ยังไม่ได้ลงบัญชี 2 วัน");
    expect(text).toContain("10 ก.ย., 12 ก.ย.");
    expect(text).toContain("ลงบัญชีทั้งหมด");
  });

  /**
   * 🚨 ข้อนี้ยกมาจาก D88/D92 ทั้งดุ้น — ข้อความ LINE เข้ากลุ่มได้
   *    ยอดขายรายวันของบาร์เป็นเรื่องภายใน ห้ามหลุดไปในกลุ่ม
   */
  it("🚨 ห้ามมีตัวเลขเงินในข้อความเด็ดขาด", () => {
    const text = barReminderMessage({
      days: unpostedDays(
        [
          { businessDate: "2026-09-10", grandTotal: 12345.67 },
          { businessDate: "2026-09-11", grandTotal: 999 },
        ],
        [],
        "2030-01-01",
      ),
      hasRevenueAccount: true,
    })!;
    expect(text).not.toContain("12,345");
    expect(text).not.toContain("12345");
    expect(text).not.toContain("999");
    expect(text).not.toContain("บาท");
  });

  it("🚨 ยังไม่ได้ตั้งบัญชีรับเงิน → บอกให้ไป**ตั้งค่า** ไม่ใช่บอกให้ไปกดปุ่มที่กดไม่ได้", () => {
    const text = barReminderMessage({ days: days("2026-09-10"), hasRevenueAccount: false })!;
    expect(text).toContain("ตั้งค่าบาร์");
    expect(text).not.toContain("กด ลงบัญชีทั้งหมด");
  });

  it("ค้างเยอะ → ตัดรายชื่อ แล้วบอกว่าเหลืออีกกี่วัน", () => {
    const text = barReminderMessage({
      days: days("2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"),
      hasRevenueAccount: true,
    })!;
    expect(text).toContain("6 วัน");
    expect(text).toContain("และอีก 1 วัน");
  });

  it("มีหลายกิจการ → ใส่ชื่อกิจการกำกับ", () => {
    const text = barReminderMessage({
      days: days("2026-09-10"),
      hasRevenueAccount: true,
      entityName: "บาร์หน้าโรงกลั่น",
    })!;
    expect(text).toContain("(บาร์หน้าโรงกลั่น)");
  });
});

describe("คีย์กันส่งซ้ำ", () => {
  it("วันละครั้ง — ยิง cron ซ้ำในวันเดียวกันต้องได้คีย์เดิม", () => {
    expect(barReminderKey("2026-09-13")).toBe(barReminderKey("2026-09-13"));
    expect(barReminderKey("2026-09-13")).not.toBe(barReminderKey("2026-09-14"));
  });

  it("🚨 ชื่อ action ต้องไม่ชนกับงานเตือนอื่นใน integration_log", () => {
    expect(BAR_POST_REMINDER_ACTION).toBe("BAR_POST_REMINDER");
    expect(BAR_POST_REMINDER_ACTION).not.toBe("TAX_REMINDER");
    expect(BAR_POST_REMINDER_ACTION).not.toBe("EXCISE_REMINDER");
  });
});

/**
 * 🚨 **ข้อที่ D92 เขียนเตือนไว้เองแล้วยังเกือบพลาดซ้ำ**
 *    งานเตือนใหม่ที่เอาไปต่อท้ายลูปของงานเก่าจะถูก `continue` กลืนหายเงียบ ๆ
 *    และ TypeScript มองไม่เห็น → อ่านซอร์สของ cron มาตรวจว่าแยกกันจริง
 */
describe("🚩 cron ต้องเรียก barPart ด้วยธงโมดูลของตัวเอง (อ่านซอร์สจริง)", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/api/cron/tax-reminder/route.ts"),
    "utf8",
  );

  it("มีฟังก์ชัน barPart แยกต่างหาก ไม่ได้ยัดไว้ใน taxPart/excisePart", () => {
    expect(src).toContain("async function barPart(");
  });

  it("เรียก barPart โดยมี mods.includes(\"bar\") เป็นเงื่อนไข", () => {
    const call = src.split("\n").find((l) => l.includes("await barPart("));
    expect(call, "ไม่พบบรรทัดที่เรียก barPart — เทสนี้จะกลายเป็นเทสเปล่า").toBeTruthy();
    expect(call!).toContain('mods.includes("bar")');
  });

  it("🚨 ด่านคัด tenant ข้างบนต้องไม่ตัดลูกค้าที่ซื้อโมดูลบาร์ทิ้ง", () => {
    // เดิมเขียนว่า `if (!accounting && !production) continue;` → ลูกค้าบาร์ถูกข้ามตั้งแต่บรรทัดแรก
    const gate = src.split("\n").find((l) => l.includes("continue;") && l.includes("mods.includes"));
    expect(gate, "หาด่านคัดโมดูลไม่เจอ — เทสนี้จะกลายเป็นเทสเปล่า").toBeTruthy();
    expect(gate!).toContain('mods.includes("bar")');
  });

  it("ส่งก่อนแล้วค่อยจด — insert integration_log ต้องอยู่หลังการส่ง", () => {
    const fn = src.slice(src.indexOf("async function barPart("));
    const send = fn.indexOf("sendLineToTenant");
    const log = fn.indexOf("BAR_POST_REMINDER_ACTION,");
    expect(send).toBeGreaterThan(-1);
    expect(log).toBeGreaterThan(send);
  });
});
