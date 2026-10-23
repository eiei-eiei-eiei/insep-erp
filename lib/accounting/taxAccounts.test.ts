/**
 * A24 (D124) — รายงานภาษีไม่กรองด้วย "บัญชีในระบบภาษี" อีกแล้ว
 *
 * เดิม (D93) บิลที่ลงบัญชีนอกรายการ `app_settings` kind='tax_account' หลุดจาก ภพ.30 / ภงด. / แดชบอร์ด
 * 🚨 ภาษีขึ้นกับ **กิจการ + เอกสาร** ไม่ได้ขึ้นกับว่าเงินเข้า/ออกบัญชีไหน — บิลซื้อที่มีใบกำกับจริง
 *    จ่ายจากบัญชีเงินสดแล้วหายจาก ภพ.30 = ภาษีซื้อหายเงียบ ๆ
 *
 * เทสนี้อ่านซอร์สจริง: กติกาเดิมกระจาย 5 ที่ (แอป · cron · บาร์ · ยอดบัญชี · หน้าชำระ)
 * เผลอเอากลับมาที่เดียว = รายงานในแอปกับข้อความเตือนใน LINE นับคนละชุดโดยไม่มีอะไรฟ้อง
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8");
const FILES = [
  "lib/accounting/calc.ts",
  "lib/accounting/ledger.ts",
  "app/(app)/accounting/data.ts",
  "app/api/cron/tax-reminder/route.ts",
  "app/(app)/bar/data.ts",
  "app/(app)/bar/_components/BarSettingsTab.tsx",
  "app/(app)/accounting/_components/ApArTab.tsx",
  "app/(app)/accounting/_components/SettingsTab.tsx",
];

describe("A24 — ไม่มีตัวกรองบัญชีในรายงานภาษี (D124)", () => {
  it("ไม่มีไฟล์ไหนอ่าน kind='tax_account' หรือถามว่าบัญชีอยู่ในชุดภาษีไหม", () => {
    for (const f of FILES) {
      const s = src(f);
      expect(s, f).not.toMatch(/["']tax_account["']/);
      expect(s, f).not.toMatch(/taxAccounts\.has\(|effectiveTaxAccounts|countedInTax/);
    }
  });

  it("ตัว lib เดิมถูกลบแล้ว (ไม่มีใครเผลอ import กลับมา)", () => {
    expect(existsSync("lib/accounting/taxAccounts.ts")).toBe(false);
  });

  it("ฟังก์ชันรายงานไม่รับพารามิเตอร์ชุดบัญชีแล้ว", () => {
    const s = src("lib/accounting/calc.ts");
    expect(s).not.toMatch(/taxAccounts/);
    expect(src("lib/accounting/ledger.ts")).not.toMatch(/taxAccounts|isTaxAccount/);
  });
});
