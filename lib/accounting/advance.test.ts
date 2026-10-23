import { describe, it, expect } from "vitest";
import {
  groupPendingAdvances,
  clearSelectionProblem,
  defaultRefundAccount,
  monthsBetween,
  staleInvoices,
  staleInvoiceWarn,
  accountsOf,
  advanceTargets,
  toPersonalAmounts,
  advanceStatusLabel,
  type AdvanceRow,
} from "./advance";
import { accountBalances, accountStatement, txEffect, cashDirection, type LedgerTx } from "./ledger";
import { taxReport, whtReport, dashboardData, type Tx } from "./calc";

/**
 * A22 — สำรองจ่าย (D119 · migration 0086)
 * ตัวตัดสินจริงอยู่ใน SQL (fn_clear_advances) — เทสชุดนี้ล็อก 2 อย่าง:
 *  1) ทิศทางเงินของประเภทใหม่ใน ledger + ไม่หลุดเข้ารายงานภาษี/แดชบอร์ด
 *  2) ด่านก่อนกดบนหน้าจอ ตรงกับด่านใน SQL
 */

const adv = (p: Partial<AdvanceRow>): AdvanceRow => ({
  txId: "TR-1", date: "2026-09-25", payer: "EID02", target: "EID01", accountName: "กสิกร ส่วนตัว",
  contactName: "ร้าน ก", description: "", category: "ค่าต้นทุนสินค้า",
  netAmount: 10700, vatAmount: 700, taxInvoiceNo: "IV-1", taxInvoiceDate: "2026-09-25", ...p,
});

describe("A22 — ทิศทางเงินของประเภทใหม่", () => {
  it("สำรองจ่าย = เงินออก · รับคืนสำรองจ่าย = เงินเข้า", () => {
    expect(cashDirection("สำรองจ่าย")).toBe("out");
    expect(cashDirection("รับคืนสำรองจ่าย")).toBe("in");
    expect(txEffect("สำรองจ่าย", 10700)).toEqual({ debit: 10700, credit: 0, effect: -10700 });
    expect(txEffect("รับคืนสำรองจ่าย", 10700)).toEqual({ debit: 0, credit: 10700, effect: 10700 });
  });
  it("ประเภทเดิมไม่ขยับ (กันแก้ cashDirection แล้วกระทบของเก่า)", () => {
    expect(cashDirection("รายรับ")).toBe("in");
    expect(cashDirection("รายจ่าย")).toBe("out");
    expect(cashDirection("โอนระหว่างบัญชี")).toBe("signed");
    expect(cashDirection("เช็คราคา")).toBeNull();
    expect(cashDirection("บันทึกภาษี")).toBeNull();
  });
});

// ── ครบวง: สำรองจ่าย 25 ก.ย. → เคลีย 10 ต.ค. ────────────────────────────────
const L = (p: Partial<LedgerTx> & Pick<LedgerTx, "tx_id" | "type" | "account_name" | "net_amount" | "transaction_date">): LedgerTx => ({
  category: "", contact_name: "", description: "", transfer_id: null, status: "ปกติ", ap_ar_status: null, ...p,
});
const cycle: LedgerTx[] = [
  L({ tx_id: "A1", transaction_date: "2026-09-25", type: "สำรองจ่าย", account_name: "กสิกร ส่วนตัว", net_amount: 10700 }),
  // ผลของ fn_clear_advances
  L({ tx_id: "B1", transaction_date: "2026-10-10", type: "รายจ่าย", account_name: "กสิกร เอม", net_amount: 10700 }),
  L({ tx_id: "R1", transaction_date: "2026-10-10", type: "รับคืนสำรองจ่าย", account_name: "กสิกร ส่วนตัว", net_amount: 10700 }),
];
const accts = [
  { accountName: "กสิกร ส่วนตัว", openingBalance: 50000, entityIds: ["EID02"] },
  { accountName: "กสิกร เอม", openingBalance: 100000, entityIds: ["EID01"] },
];

describe("A22 — ยอดเงินครบวง", () => {
  it("สิ้น ก.ย. (ยังไม่เคลีย): บัญชีส่วนตัวลดแล้ว · บัญชีบริษัทยังไม่ขยับ", () => {
    const r = accountBalances("2026-09", cycle, accts, "ALL");
    expect(r.balances.find((b) => b.accountType === "กสิกร ส่วนตัว")!.balance).toBe(39300);
    expect(r.balances.find((b) => b.accountType === "กสิกร เอม")!.balance).toBe(100000);
  });
  it("สิ้น ต.ค. (เคลียแล้ว): ส่วนตัวกลับเท่าเดิม · บริษัทลด 10,700", () => {
    const r = accountBalances("2026-10", cycle, accts, "ALL");
    expect(r.balances.find((b) => b.accountType === "กสิกร ส่วนตัว")!.balance).toBe(50000);
    expect(r.balances.find((b) => b.accountType === "กสิกร เอม")!.balance).toBe(89300);
  });
  it("statement บัญชีส่วนตัว ต.ค. เห็นรายการรับคืนเป็นเงินเข้า", () => {
    const s = accountStatement("กสิกร ส่วนตัว", "2026-10", cycle, 50000);
    expect(s.openingBalance).toBe(39300);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ txId: "R1", credit: 10700, debit: 0 });
    expect(s.closingBalance).toBe(50000);
  });
});

// ── ไม่หลุดเข้ารายงานภาษี/แดชบอร์ดของใครเลยก่อนเคลีย ──────────────────────────
const T = (p: Partial<Tx>): Tx => ({
  tx_id: "X", transaction_date: "2026-09-25", type: "สำรองจ่าย", account_name: "กสิกร ส่วนตัว",
  category: "ค่าต้นทุนสินค้า", contact_name: "ร้าน ก", amount_after_discount: 10000, vat_amount: 700,
  wht_rate: 3, wht_amount: 300, net_amount: 10400, tax_invoice_no: "IV-1", tax_invoice_date: "2026-09-25",
  status: "ปกติ", entity_id: "EID02", ap_ar_status: null, ...p,
});

describe("A22 — สำรองจ่ายไม่เข้ารายงานของคนจ่าย", () => {
  const txs = [T({ tx_id: "A1" }), T({ tx_id: "R1", type: "รับคืนสำรองจ่าย", vat_amount: 0, wht_amount: 0 })];
  it("ภพ.30 ของคนจ่าย: ไม่มีภาษีซื้อจากบิลสำรองจ่าย", () => {
    const r = taxReport("2026-09", "EID02", 0, txs, {});
    expect(r.purchases).toHaveLength(0);
    expect(r.sales).toHaveLength(0);
  });
  it("ภงด.3/53 ของคนจ่าย: ไม่มีแถว", () => {
    const w = whtReport("2026-09", "EID02", txs, {});
    expect(w.pnd3).toHaveLength(0);
    expect(w.pnd53).toHaveLength(0);
  });
  it("แดชบอร์ดของคนจ่าย: รายรับ/รายจ่าย/VAT เป็น 0 และไม่มีคิวรอออก 50ทวิ", () => {
    const d = dashboardData("2026-09", "EID02", txs, new Set());
    expect(d.dash).toEqual({ income: 0, expense: 0, netIncome: 0, netExpense: 0, vatOut: 0, vatIn: 0 });
    expect(d.whtPending).toHaveLength(0);
  });
  it("positive control: บิลของบริษัทที่เกิดจากการเคลีย (รายจ่าย) เข้า ภพ.30 เดือนที่เคลีย", () => {
    const bill = T({ tx_id: "B1", type: "รายจ่าย", entity_id: "EID01", account_name: "กสิกร เอม", transaction_date: "2026-10-10" });
    expect(taxReport("2026-10", "EID01", 0, [bill], {}).purchases).toHaveLength(1);
    // ภพ.30 เลือกเดือนด้วย transaction_date (กติกาเหล็ก) ⇒ เดือนที่ออกใบกำกับไม่ได้รับไป
    expect(taxReport("2026-09", "EID01", 0, [bill], {}).purchases).toHaveLength(0);
  });
});

describe("A22 — จัดกลุ่มบิลรอเบิกคืน", () => {
  it("แยกตาม (คนจ่าย, กิจการที่ซื้อให้) · รวมยอดถูก · เรียงวันที่ในกลุ่ม", () => {
    const g = groupPendingAdvances([
      adv({ txId: "B", date: "2026-09-26", netAmount: 535.5, vatAmount: 35.03 }),
      adv({ txId: "A", date: "2026-09-25", netAmount: 10700 }),
      adv({ txId: "C", payer: "EID03", netAmount: 100, vatAmount: 0 }),
    ]);
    expect(g.map((x) => x.key)).toEqual(["EID02|EID01", "EID03|EID01"]);
    expect(g[0].rows.map((r) => r.txId)).toEqual(["A", "B"]);
    expect(g[0].total).toBe(11235.5);
    expect(g[0].vatTotal).toBe(735.03);
  });
});

describe("A22 — ด่านก่อนกดเคลีย (ฝาแฝดของ fn_clear_advances)", () => {
  it("ไม่ได้เลือก = บอกให้เลือก", () => {
    expect(clearSelectionProblem([], "2026-10-10")).toMatch(/อย่างน้อย 1 ใบ/);
  });
  it("ปนคนจ่ายหรือกิจการปลายทาง = เคลียพร้อมกันไม่ได้", () => {
    expect(clearSelectionProblem([adv({}), adv({ txId: "X", payer: "EID03" })], "2026-10-10")).toMatch(/กิจการเดียวกัน/);
    expect(clearSelectionProblem([adv({}), adv({ txId: "X", target: "EID04" })], "2026-10-10")).toMatch(/กิจการเดียวกัน/);
  });
  it("เคลียก่อนวันที่สำรองจ่ายไม่ได้ · วันเดียวกันได้", () => {
    expect(clearSelectionProblem([adv({})], "2026-09-24")).toMatch(/ไม่ก่อนวันที่สำรองจ่าย/);
    expect(clearSelectionProblem([adv({})], "2026-09-25")).toBeNull();
  });
  it("ไม่ใส่วันที่ = บอก", () => {
    expect(clearSelectionProblem([adv({})], "")).toMatch(/วันที่เคลีย/);
  });
});

describe("A22 — บัญชีรับเงินคืนปริยาย", () => {
  it("ทุกใบจ่ายจากบัญชีเดียว = บัญชีนั้น · หลายบัญชี = ว่าง (ให้ผู้ใช้เลือก)", () => {
    expect(defaultRefundAccount([adv({}), adv({ txId: "X" })])).toBe("กสิกร ส่วนตัว");
    expect(defaultRefundAccount([adv({}), adv({ txId: "X", accountName: "เงินสด ส่วนตัว" })])).toBe("");
  });
});

describe("A22 — เตือนใบกำกับเก่าเกิน 6 เดือน (ม.82/3) — เตือนไม่บล็อก", () => {
  it("นับเดือนปฏิทิน", () => {
    expect(monthsBetween("2026-01-31", "2026-07-01")).toBe(6);
    expect(monthsBetween("2025-12-15", "2026-01-02")).toBe(1);
    expect(monthsBetween("", "2026-01-02")).toBe(0);
  });
  it("6 เดือนพอดียังไม่เตือน · 7 เดือนเตือน", () => {
    expect(staleInvoices([adv({ taxInvoiceDate: "2026-03-20" })], "2026-09-30")).toHaveLength(0);
    expect(staleInvoices([adv({ taxInvoiceDate: "2026-02-28" })], "2026-09-01")).toHaveLength(1);
  });
  it("ไม่มี VAT = ไม่เตือน (ไม่มีภาษีซื้อให้เสียสิทธิ์)", () => {
    expect(staleInvoices([adv({ taxInvoiceDate: "2025-01-01", vatAmount: 0 })], "2026-09-01")).toHaveLength(0);
  });
  it("ไม่มีวันที่ใบกำกับ = ใช้วันที่สำรองจ่าย", () => {
    expect(staleInvoices([adv({ taxInvoiceDate: "", date: "2026-01-05" })], "2026-09-01")).toHaveLength(1);
  });
  it("ข้อความบอกจำนวน+เลขใบ และบอกว่ายังเคลียได้", () => {
    const w = staleInvoiceWarn([adv({ taxInvoiceDate: "2026-01-05", taxInvoiceNo: "IV-OLD" }), adv({ txId: "Y" })], "2026-09-01");
    expect(w).toMatch(/1 ใบ/);
    expect(w).toMatch(/IV-OLD/);
    expect(w).toMatch(/ยังเคลียได้/);
    expect(staleInvoiceWarn([adv({})], "2026-10-10")).toBeNull();
  });
});

describe("A22 — ตัวเลือกบนฟอร์ม", () => {
  it("บัญชีของกิจการ: entity_ids ว่าง = ใช้ร่วม (กติกาเดียวกับ SQL)", () => {
    const acc = [
      { account_name: "เอม", entity_ids: ["EID01"] },
      { account_name: "ส่วนตัว", entity_ids: ["EID02", "EID03"] },
      { account_name: "ร่วม", entity_ids: [] },
    ];
    expect(accountsOf(acc, "EID01").map((a) => a.account_name)).toEqual(["เอม", "ร่วม"]);
    expect(accountsOf(acc, "EID03").map((a) => a.account_name)).toEqual(["ส่วนตัว", "ร่วม"]);
  });
  it("สำรองจ่ายให้ได้ทุกกิจการยกเว้นตัวเอง", () => {
    const ents = [{ entity_id: "EID01" }, { entity_id: "EID02" }, { entity_id: "EID03" }];
    expect(advanceTargets(ents, "EID02").map((e) => e.entity_id)).toEqual(["EID01", "EID03"]);
  });
});

describe("A22 — ตัดเป็นค่าใช้จ่ายส่วนตัว (ฝาแฝดของ fn_advance_to_personal)", () => {
  it("VAT กลายเป็นต้นทุน · เงินที่จ่ายจริงเท่าเดิม", () => {
    expect(toPersonalAmounts({ amountAfterDiscount: 10000, vatAmount: 700, netAmount: 10700 }))
      .toEqual({ amountAfterDiscount: 10700, vatAmount: 0, netAmount: 10700 });
    expect(toPersonalAmounts({ amountAfterDiscount: 100.1, vatAmount: 7.01, netAmount: 107.11 }).amountAfterDiscount).toBe(107.11);
  });
  it("ป้ายสถานะ", () => {
    expect(advanceStatusLabel("สำรองจ่าย", "รอเบิกคืน")).toBe("รอเบิกคืน");
    expect(advanceStatusLabel("สำรองจ่าย", null)).toBe("รอเบิกคืน");
    expect(advanceStatusLabel("รายจ่าย", "ตัดเป็นส่วนตัว")).toMatch(/ส่วนตัว/);
    expect(advanceStatusLabel("รายจ่าย", null)).toBe("");
  });
});
