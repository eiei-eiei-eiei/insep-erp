/**
 * A25 (D125) — กติกาบัญชีเงิน + ล็อกว่ารายชื่อ kind ฝั่ง TS ตรงกับ SQL (0089)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  ACCOUNT_SETTING_KINDS,
  accountsFor,
  activeAccountNames,
  accountNameError,
  usageText,
  deleteBlockReason,
  deactivateWarn,
  renameDoneText,
  renameWarnText,
  type AccountUsage,
} from "./bankAccounts";

const accs = [
  { account_name: "กสิกร", entity_ids: ["EID01"], active: true },
  { account_name: "เงินสด", entity_ids: [], active: null },
  { account_name: "SCB เก่า", entity_ids: ["EID01"], active: false },
  { account_name: "บัญชี EID02", entity_ids: ["EID02"] },
];
const U = (o: Partial<AccountUsage> = {}): AccountUsage => ({ txCount: 0, payCount: 0, legCount: 0, settingKinds: [], ...o });

describe("A25 — ช่องเลือกบัญชี", () => {
  it("กรองกิจการ + ตัดบัญชีที่ปิดใช้ · ค่าว่าง (ก่อน 0089) = ใช้อยู่", () => {
    expect(accountsFor(accs, "EID01").map((a) => a.account_name)).toEqual(["กสิกร", "เงินสด"]);
    expect(accountsFor(accs, "ALL").map((a) => a.account_name)).toEqual(["กสิกร", "เงินสด", "บัญชี EID02"]);
  });
  it("🪤 บัญชีที่ปิดใช้แต่เป็นค่าของบิลที่เปิดมาแก้ ต้องยังอยู่ในช่อง (ไม่งั้นบิลหลุดบัญชีตอนบันทึก)", () => {
    expect(accountsFor(accs, "EID01", "SCB เก่า").map((a) => a.account_name)).toContain("SCB เก่า");
    expect(activeAccountNames(accs, "SCB เก่า")).toContain("SCB เก่า");
    expect(activeAccountNames(accs)).not.toContain("SCB เก่า");
  });
});

describe("A25 — ชื่อบัญชี", () => {
  const names = accs.map((a) => a.account_name);
  it("ว่าง/ซ้ำ ไม่ผ่าน · ชื่อเดิมของตัวเองผ่าน", () => {
    expect(accountNameError("  ", names)).toMatch(/กรอก/);
    expect(accountNameError("กสิกร ", names)).toMatch(/มีบัญชีชื่อ/);
    expect(accountNameError("กสิกร", names, "กสิกร")).toBeNull();
    expect(accountNameError("กรุงไทย", names)).toBeNull();
  });
});

describe("A25 — ลบ/ปิดใช้", () => {
  it("ลบได้เฉพาะบัญชีที่ไม่มีอะไรอ้างถึง", () => {
    expect(deleteBlockReason(U())).toBeNull();
    expect(deleteBlockReason(U({ txCount: 3 }))).toMatch(/ปิดใช้ แทน/);
    expect(deleteBlockReason(U({ payCount: 1 }))).toMatch(/ปิดใช้ แทน/);
    expect(deleteBlockReason(U({ legCount: 1 }))).toMatch(/เงินเดือน/);
    expect(deleteBlockReason(U({ settingKinds: ["sales_revenue_account"] }))).toMatch(/บัญชีรับรายได้ขาย/);
    expect(deleteBlockReason(undefined)).not.toBeNull();
  });
  it("ปิดใช้: เตือนยอดคงเหลือ + ค่าตั้งที่ยังชี้มา · ยอด 0 ไม่เตือน", () => {
    expect(deactivateWarn(U(), 0)).toBeNull();
    expect(deactivateWarn(U(), 1500)).toMatch(/1,500\.00/);
    expect(deactivateWarn(U({ settingKinds: ["bar_cash_account"] }), 0)).toMatch(/บัญชีเงินสดบาร์/);
  });
  it("ข้อความบนแถว", () => {
    expect(usageText(U())).toBe("ยังไม่มีรายการ");
    expect(usageText(U({ txCount: 1200, payCount: 2, settingKinds: ["sales_revenue_account"] })))
      .toBe("ใช้ใน 1,202 รายการ · บัญชีรับรายได้ขาย");
    expect(renameDoneText({ tx: 10, payments: 1, legs: 0, settings: 2 })).toBe("เปลี่ยนชื่อแล้ว — แก้ตามในบิล 11 รายการ · ค่าตั้ง 2 จุด");
    // 🪤 เจอบนจอ: บัญชีที่ยังไม่มีบิล เคยขึ้น "แก้ตามในบิล 0 รายการ"
    expect(renameDoneText({ tx: 0, payments: 0, legs: 0, settings: 0 })).toBe("เปลี่ยนชื่อแล้ว");
    expect(renameWarnText("ก", U())).not.toMatch(/0 รายการ/);
    expect(renameWarnText("ก", U({ txCount: 3, settingKinds: ["bar_cash_account"] }))).toMatch(/ในบิล 3 รายการ และ ค่าตั้ง 1 จุด/);
  });
});

describe("A25 — รายชื่อ kind ต้องตรงกับ SQL", () => {
  it("🚨 ACCOUNT_SETTING_KINDS = fn_account_setting_kinds() ในไฟล์ migration ล่าสุดที่นิยาม", () => {
    const dir = "supabase/migrations";
    const f = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort().reverse()
      .find((x) => /function\s+fn_account_setting_kinds/.test(readFileSync(`${dir}/${x}`, "utf8")));
    expect(f).toBeTruthy();
    const src = readFileSync(`${dir}/${f}`, "utf8");
    const def = src.slice(src.search(/create or replace function fn_account_setting_kinds/));
    const arr = def.match(/array\[([\s\S]*?)\]/)?.[1] ?? "";
    const sqlKinds = [...arr.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(sqlKinds).toEqual([...ACCOUNT_SETTING_KINDS].sort());
  });
  it("ทุก kind อยู่ใน CHECK whitelist ของ app_settings.kind — กันชื่อสะกดผิด", () => {
    const dir = "supabase/migrations";
    const all = readdirSync(dir).filter((x) => x.endsWith(".sql")).map((x) => readFileSync(`${dir}/${x}`, "utf8")).join("\n");
    const wl = [...all.matchAll(/app_settings_kind_check[\s\S]*?\)\);/g)].map((m) => m[0]).join("\n");
    expect(wl.length).toBeGreaterThan(0); // กันเทสผ่านเพราะ regex ไม่เจออะไรเลย
    for (const k of ACCOUNT_SETTING_KINDS) expect(wl, k).toContain(`'${k}'`);
  });
});
