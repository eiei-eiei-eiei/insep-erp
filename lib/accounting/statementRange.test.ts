import { describe, it, expect } from "vitest";
import { accountStatement, accountStatementRange, type LedgerTx } from "./ledger";

const tx = (id: string, date: string, type: string, net: number, extra: Partial<LedgerTx> = {}): LedgerTx => ({
  tx_id: id, transaction_date: date, type, account_name: "กสิกร", category: "", contact_name: "", description: "",
  net_amount: net, transfer_id: null, status: "ปกติ", ap_ar_status: null, ...extra,
});

const txs: LedgerTx[] = [
  tx("T1", "2026-05-20", "รายรับ", 1000),
  tx("T2", "2026-06-10", "รายจ่าย", 200),
  tx("T3", "2026-06-15", "รายรับ", 50),
  tx("T4", "2026-07-01", "รายจ่าย", 100),
  tx("T5", "2026-08-03", "รายรับ", 400),
  tx("TX", "2026-06-11", "รายรับ", 9999, { status: "ยกเลิก" }),
  tx("TO", "2026-06-12", "รายรับ", 9999, { account_name: "SCB" }),
];

describe("A27 — statement หลายเดือน / ทั้งหมด (D139)", () => {
  it("ช่วง มิ.ย.–ก.ค.: ยอดยกมานับรายการก่อนช่วง · รายการหลังช่วงไม่นับ", () => {
    const s = accountStatementRange("กสิกร", { from: "2026-06", to: "2026-07" }, txs, 500);
    expect(s.openingBalance).toBe(1500); // 500 + T1
    expect(s.rows.map((r) => r.txId)).toEqual(["T2", "T3", "T4"]);
    expect(s.rows.map((r) => r.runningBalance)).toEqual([1300, 1350, 1250]);
    expect(s.closingBalance).toBe(1250);
  });

  it("สรุปท้ายเดือน: เข้า/ออก/คงเหลือสิ้นเดือน ต่อเนื่องข้ามเดือน", () => {
    const s = accountStatementRange("กสิกร", { from: "2026-06", to: "2026-07" }, txs, 500);
    expect(s.months).toEqual([
      { month: "2026-06", totalIn: 50, totalOut: 200, closingBalance: 1350, count: 2 },
      { month: "2026-07", totalIn: 0, totalOut: 100, closingBalance: 1250, count: 1 },
    ]);
  });

  it("ทั้งหมด: ยอดยกมา = ยอดตั้งต้นของบัญชีล้วน · คงเหลือสุดท้าย = ยอดคงเหลือปัจจุบัน", () => {
    const s = accountStatementRange("กสิกร", { from: null, to: null }, txs, 500);
    expect(s.openingBalance).toBe(500);
    expect(s.rows.map((r) => r.txId)).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    expect(s.closingBalance).toBe(1650);
    expect(s.months.map((m) => m.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
  });

  it("เดือนที่ไม่มีรายการไม่มีแถวสรุป", () => {
    const s = accountStatementRange("กสิกร", { from: "2026-01", to: "2026-12" }, [tx("A", "2026-03-01", "รายรับ", 1), tx("B", "2026-09-01", "รายรับ", 1)], 0);
    expect(s.months.map((m) => m.month)).toEqual(["2026-03", "2026-09"]);
  });

  it("ช่วงเดือนเดียว = accountStatement เดิมทุกตัวเลข", () => {
    for (const p of ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
      const a = accountStatement("กสิกร", p, txs, 500);
      const b = accountStatementRange("กสิกร", { from: p, to: p }, txs, 500);
      expect({ o: b.openingBalance, r: b.rows, c: b.closingBalance }).toEqual({ o: a.openingBalance, r: a.rows, c: a.closingBalance });
    }
  });

  it("ปลายช่วงต่อกัน: คงเหลือสิ้นช่วงแรก = ยอดยกมาของช่วงถัดไป", () => {
    const a = accountStatementRange("กสิกร", { from: "2026-05", to: "2026-06" }, txs, 500);
    const b = accountStatementRange("กสิกร", { from: "2026-07", to: "2026-08" }, txs, 500);
    expect(b.openingBalance).toBe(a.closingBalance);
  });

  it("ตั้งค้างที่ชำระแล้วนับตามวันที่ชำระ (D123)", () => {
    const paid = tx("P", "2026-06-05", "รายรับ", 700, { settled_on: "2026-08-10" });
    const s = accountStatementRange("กสิกร", { from: "2026-06", to: "2026-07" }, [paid], 0);
    expect(s.rows).toHaveLength(0);
    expect(accountStatementRange("กสิกร", { from: "2026-08", to: null }, [paid], 0).rows.map((r) => r.date)).toEqual(["2026-08-10"]);
  });
});
