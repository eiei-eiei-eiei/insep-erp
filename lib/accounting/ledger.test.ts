import { describe, it, expect } from "vitest";
import { txEffect, accountBalances, accountStatement, type LedgerTx, type AccountMeta } from "./ledger";

const TAX = new Set(["กสิกร"]);

const accounts: AccountMeta[] = [
  { accountName: "กสิกร", openingBalance: 1000, entityIds: ["EID99"] },
  { accountName: "เงินสด", openingBalance: 0, entityIds: [] }, // ว่าง = เห็นทุกกิจการ
  { accountName: "SCB", openingBalance: 500, entityIds: ["EID01"] }, // ไม่เห็นใน EID99
];

const txs: LedgerTx[] = [
  { tx_id: "T1", transaction_date: "2026-06-10", type: "รายรับ", account_name: "กสิกร", category: "ขาย", contact_name: "A", description: "", net_amount: 1000, transfer_id: null, status: "ปกติ", ap_ar_status: null },
  { tx_id: "T2", transaction_date: "2026-07-05", type: "รายจ่าย", account_name: "กสิกร", category: "ซื้อ", contact_name: "B", description: "", net_amount: 200, transfer_id: null, status: "ปกติ", ap_ar_status: null },
  { tx_id: "T3", transaction_date: "2026-07-06", type: "โอนระหว่างบัญชี", account_name: "กสิกร", category: "โอน", contact_name: "", description: "โอนออก", net_amount: -300, transfer_id: "TRF1", status: "ปกติ", ap_ar_status: null },
  { tx_id: "T4", transaction_date: "2026-07-06", type: "โอนระหว่างบัญชี", account_name: "เงินสด", category: "โอน", contact_name: "", description: "รับโอน", net_amount: 300, transfer_id: "TRF1", status: "ปกติ", ap_ar_status: null },
  { tx_id: "T5", transaction_date: "2026-07-08", type: "รายรับ", account_name: "เงินสด", category: "ขาย", contact_name: "C", description: "", net_amount: 50, transfer_id: null, status: "ปกติ", ap_ar_status: null },
  { tx_id: "T6", transaction_date: "2026-08-01", type: "รายรับ", account_name: "กสิกร", category: "ขาย", contact_name: "A", description: "", net_amount: 9999, transfer_id: null, status: "ปกติ", ap_ar_status: null },
  { tx_id: "T7", transaction_date: "2026-07-09", type: "รายรับ", account_name: "กสิกร", category: "ขาย", contact_name: "A", description: "", net_amount: 5000, transfer_id: null, status: "ปกติ", ap_ar_status: "AR" },
  { tx_id: "T8", transaction_date: "2026-07-10", type: "รายรับ", account_name: "กสิกร", category: "ขาย", contact_name: "A", description: "", net_amount: 400, transfer_id: null, status: "ยกเลิก", ap_ar_status: null },
];

describe("A7 — txEffect", () => {
  it("รายรับ/รายจ่าย/โอน", () => {
    expect(txEffect("รายรับ", 100)).toEqual({ debit: 0, credit: 100, effect: 100 });
    expect(txEffect("รายจ่าย", 100)).toEqual({ debit: 100, credit: 0, effect: -100 });
    expect(txEffect("โอนระหว่างบัญชี", 100)).toEqual({ debit: 0, credit: 100, effect: 100 });
    expect(txEffect("โอนระหว่างบัญชี", -100)).toEqual({ debit: 100, credit: 0, effect: -100 });
    expect(txEffect("เช็คราคา", 100)).toEqual({ debit: 0, credit: 0, effect: 0 });
  });
  it("บันทึกภาษี (ภาษีซื้อนำเข้า) ไม่กระทบยอดบัญชี (D29)", () => {
    expect(txEffect("บันทึกภาษี", 10700)).toEqual({ debit: 0, credit: 0, effect: 0 });
  });
});

describe("A8 — accountBalances", () => {
  const r = accountBalances("2026-07", txs, accounts, "EID99", TAX);
  it("ยอด = opening + in − out, ข้าม future/AP/ยกเลิก", () => {
    const k = r.balances.find((b) => b.accountType === "กสิกร")!;
    expect(k).toMatchObject({ openingBalance: 1000, totalIn: 1000, totalOut: 500, balance: 1500, isTaxAccount: true, shared: false });
    const cash = r.balances.find((b) => b.accountType === "เงินสด")!;
    expect(cash).toMatchObject({ totalIn: 350, totalOut: 0, balance: 350, isTaxAccount: false });
  });
  it("filter บัญชีตามกิจการ (SCB ของ EID01 ไม่แสดง)", () => {
    expect(r.balances.map((b) => b.accountType)).not.toContain("SCB");
  });
  it("grandTotal", () => {
    expect(r.grandTotal).toBe(1850);
  });
});

describe("A8 — accountStatement", () => {
  const s = accountStatement("กสิกร", "2026-07", txs, 1000);
  it("opening รวมรายการก่อนเดือน", () => {
    expect(s.openingBalance).toBe(2000); // 1000 meta + 1000 (T1 มิ.ย.)
  });
  it("รายการในเดือน + running balance", () => {
    expect(s.rows.map((r) => r.txId)).toEqual(["T2", "T3"]);
    expect(s.rows.map((r) => r.runningBalance)).toEqual([1800, 1500]);
    expect(s.rows[0]).toMatchObject({ debit: 200, credit: 0 });
    expect(s.rows[1]).toMatchObject({ debit: 300, credit: 0, transferId: "TRF1" });
  });
  it("closingBalance", () => {
    expect(s.closingBalance).toBe(1500);
  });
});

describe("A23 — บิลค้างที่เคลียแล้ว เงินเข้า/ออกตามวันที่เคลีย (D123)", () => {
  // ตั้งค้างรับ 10/10 แล้วกดชำระเข้า กสิกร วันที่ 10/11
  const paid: LedgerTx = { tx_id: "S1", transaction_date: "2026-10-10", type: "รายรับ", account_name: "กสิกร", category: "ขาย", contact_name: "A", description: "", net_amount: 700, transfer_id: null, status: "ปกติ", ap_ar_status: null, settled_on: "2026-11-10" };
  const meta: AccountMeta[] = [{ accountName: "กสิกร", openingBalance: 0, entityIds: [] }];
  const bal = (p: string, xs: LedgerTx[]) => accountBalances(p, xs, meta, "ALL", TAX).balances.find((b) => b.accountType === "กสิกร")!.balance;

  it("ยอดสิ้นเดือน ต.ค. ยังไม่รวม · สิ้นเดือน พ.ย. รวม", () => {
    expect(bal("2026-10", [paid])).toBe(0);
    expect(bal("2026-11", [paid])).toBe(700);
  });
  it("statement: ขึ้นในเดือนที่จ่าย ลงวันที่จ่าย", () => {
    expect(accountStatement("กสิกร", "2026-10", [paid], 0).rows).toHaveLength(0);
    const nov = accountStatement("กสิกร", "2026-11", [paid], 0);
    expect(nov.rows.map((r) => r.date)).toEqual(["2026-11-10"]);
    expect(nov.closingBalance).toBe(700);
  });
  it("ไม่มี settled_on = วันที่รายการเหมือนเดิมทุกตัวอักษร", () => {
    expect(bal("2026-10", [{ ...paid, settled_on: null }])).toBe(700);
  });
});
