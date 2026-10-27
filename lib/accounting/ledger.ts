/**
 * lib/accounting/ledger — ยอดบัญชี + statement + โอนระหว่างบัญชี (A7/A8)
 * port จาก Accounts.js getAccountBalances / getAccountStatement / saveTransfer effect
 *
 * ⚠️ ยอดบัญชีใช้ net_amount (col14) · ข้ามแถว 'ยกเลิก' + AP/AR ค้าง (cash basis)
 *   บัญชีใช้ร่วมทุกกิจการ — ไม่ filter entity ตอนคิดยอด, entity แค่คัด "บัญชีที่แสดง"
 *   golden test = ledger.test.ts
 */

import { num, cashDateOf } from "./calc";

export type LedgerTx = {
  tx_id: string;
  transaction_date: string | null; // yyyy-MM-dd
  type: string;
  account_name: string | null;
  category: string | null;
  contact_name: string | null;
  description: string | null;
  net_amount: number | string;
  transfer_id: string | null;
  status: string;
  ap_ar_status: string | null;
  /** D123 — บิลค้างที่กดชำระแล้ว: เงินเข้า/ออกวันนี้ ไม่ใช่วันที่รายการ */
  settled_on?: string | null;
};

export type AccountMeta = {
  accountName: string;
  openingBalance: number;
  entityIds: string[];
};

/** yyyy-MM ของวันที่ */
function monthOf(iso: string | null | undefined): string {
  return String(iso ?? "").substring(0, 7);
}

/**
 * ทิศทางเงินของแต่ละประเภทบิล — จุดเดียวที่ตัดสินว่าบิลไหนขยับยอดเงินในบัญชี
 * · in = เงินเข้า (+net) · out = เงินออก (−net) · signed = ตามเครื่องหมาย net (โอน) · null = ไม่ขยับ
 * ★ D119: สำรองจ่าย = เงินออกจากบัญชีคนจ่าย · รับคืนสำรองจ่าย = เงินกลับเข้า
 *   (ทั้งคู่ไม่ใช่รายรับ/รายจ่าย ⇒ ไม่เข้าแดชบอร์ด/ภพ.30/ภงด. เพราะรายงานพวกนั้นเลือกด้วย type ตรง ๆ)
 */
export function cashDirection(type: string): "in" | "out" | "signed" | null {
  if (type === "รายรับ" || type === "รับคืนสำรองจ่าย") return "in";
  if (type === "รายจ่าย" || type === "สำรองจ่าย") return "out";
  if (type === "โอนระหว่างบัญชี") return "signed";
  return null;
}

/**
 * A7 — ผลของรายการต่อยอดบัญชี (debit/credit/effect)
 * รายรับ = credit (+net) · รายจ่าย = debit (−net) · โอน: net>0 รับเข้า, net<0 โอนออก
 */
export function txEffect(type: string, net: number): { debit: number; credit: number; effect: number } {
  const n = num(net);
  const dir = cashDirection(type);
  if (dir === "in") return { debit: 0, credit: n, effect: n };
  if (dir === "out") return { debit: n, credit: 0, effect: -n };
  if (dir === "signed") {
    if (n > 0) return { debit: 0, credit: n, effect: n };
    return { debit: Math.abs(n), credit: 0, effect: n };
  }
  return { debit: 0, credit: 0, effect: 0 };
}

export type AccountBalance = {
  accountType: string;
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  balance: number;
  shared: boolean;
};

/**
 * A8 — ยอดคงเหลือทุกบัญชี ณ สิ้นเดือน upToPeriod (inclusive)
 * balance = opening + totalIn − totalOut
 */
export function accountBalances(
  upToPeriod: string,
  txs: LedgerTx[],
  accounts: AccountMeta[],
  entityId: string,
): { balances: AccountBalance[]; grandTotal: number; upToPeriod: string } {
  const accMap: Record<string, { totalIn: number; totalOut: number }> = {};

  for (const tx of txs) {
    if (tx.status !== "ปกติ") continue;
    if (tx.ap_ar_status) continue;
    const mo = monthOf(cashDateOf(tx)); // D123 — วันที่เงินเข้า/ออกจริง
    if (!mo || mo > upToPeriod) continue; // ถึงสิ้นเดือน upToPeriod เท่านั้น

    const accName = String(tx.account_name ?? "").trim();
    const net = num(tx.net_amount);
    if (!accMap[accName]) accMap[accName] = { totalIn: 0, totalOut: 0 };
    const dir = cashDirection(tx.type);
    if (dir === "in") accMap[accName].totalIn += net;
    else if (dir === "out") accMap[accName].totalOut += net;
    else if (dir === "signed") {
      if (net > 0) accMap[accName].totalIn += net;
      else accMap[accName].totalOut += Math.abs(net);
    }
  }

  const openingOf: Record<string, number> = {};
  const entityIdsOf: Record<string, string[]> = {};
  const displayNames: string[] = [];

  for (const a of accounts) {
    const visible =
      !entityId || entityId === "ALL" || a.entityIds.length === 0 || a.entityIds.indexOf(entityId) !== -1;
    if (!visible) continue;
    displayNames.push(a.accountName);
    openingOf[a.accountName] = a.openingBalance;
    entityIdsOf[a.accountName] = a.entityIds;
  }
  // บัญชีที่มีรายการแต่ไม่อยู่ใน master (กัน data ขาด)
  for (const acc of Object.keys(accMap)) {
    if (acc && displayNames.indexOf(acc) === -1) displayNames.push(acc);
  }

  let grandTotal = 0;
  const balances = displayNames.map((name) => {
    const { totalIn = 0, totalOut = 0 } = accMap[name] || {};
    const opening = openingOf[name] || 0;
    const balance = opening + totalIn - totalOut;
    grandTotal += balance;
    const ids = entityIdsOf[name] || [];
    return {
      accountType: name,
      openingBalance: opening,
      totalIn,
      totalOut,
      balance,
      shared: ids.length > 1,
    };
  });

  return { balances, grandTotal, upToPeriod };
}

export type StatementRow = {
  txId: string;
  date: string;
  type: string;
  category: string;
  contactName: string;
  description: string;
  transferId: string;
  debit: number;
  credit: number;
  runningBalance: number;
};

/**
 * A8 — statement บัญชีรายเดือน
 * opening = opening ของบัญชี + Σ effect รายการก่อนเดือน · running balance สะสมจาก opening
 * เรียงตามวันที่ asc แล้ว txId asc
 * ★ D139 — เดือนเดียว = กรณีพิเศษของ accountStatementRange (สูตรมีที่เดียว · golden A8 เดิมคุม)
 */
export function accountStatement(
  accountType: string,
  period: string,
  txs: LedgerTx[],
  openingBalanceMeta: number,
): { accountType: string; period: string; openingBalance: number; rows: StatementRow[]; closingBalance: number } {
  const r = accountStatementRange(accountType, { from: period, to: period }, txs, openingBalanceMeta);
  return { accountType, period, openingBalance: r.openingBalance, rows: r.rows, closingBalance: r.closingBalance };
}

/** ช่วงเดือนของ statement · from/to = yyyy-MM (รวมทั้งสองข้าง) · null = ไม่มีขอบด้านนั้น */
export type StatementRange = { from: string | null; to: string | null };

/** สรุปท้ายเดือน (แถวคั่นเมื่อดูหลายเดือน) */
export type StatementMonth = {
  month: string;
  totalIn: number;
  totalOut: number;
  /** ยอดคงเหลือสิ้นเดือน = ยอด running ของรายการสุดท้ายในเดือนนั้น */
  closingBalance: number;
  count: number;
};

/**
 * D139 — statement หลายเดือน / ทั้งหมด
 * · opening = opening ของบัญชี + Σ effect รายการก่อนเดือนแรกของช่วง (from=null ⇒ opening ของบัญชีล้วน)
 * · รายการหลัง to ไม่นับเลย (ไม่เข้า rows ไม่เข้า closing)
 * · months = เฉพาะเดือนที่มีรายการ เรียงเก่า→ใหม่
 */
export function accountStatementRange(
  accountType: string,
  range: StatementRange,
  txs: LedgerTx[],
  openingBalanceMeta: number,
): {
  accountType: string;
  range: StatementRange;
  openingBalance: number;
  rows: StatementRow[];
  closingBalance: number;
  months: StatementMonth[];
} {
  const start = range.from ? `${range.from}-01` : null;
  let openingBalance = num(openingBalanceMeta);
  const periodRows: (StatementRow & { _effect: number })[] = [];

  for (const tx of txs) {
    if (tx.status !== "ปกติ") continue;
    if (tx.ap_ar_status) continue;
    if (String(tx.account_name ?? "").trim() !== accountType) continue;
    const iso = String(cashDateOf(tx) ?? "").substring(0, 10); // D123 — วันที่เงินเข้า/ออกจริง
    if (!iso) continue;
    const { debit, credit, effect } = txEffect(tx.type, num(tx.net_amount));

    if (start && iso < start) {
      openingBalance += effect;
    } else if (!range.to || monthOf(iso) <= range.to) {
      periodRows.push({
        txId: tx.tx_id,
        date: iso,
        type: tx.type,
        category: tx.category ?? "",
        contactName: tx.contact_name ?? "",
        description: tx.description ?? "",
        transferId: tx.transfer_id ? String(tx.transfer_id).trim() : "",
        debit,
        credit,
        runningBalance: 0,
        _effect: effect,
      });
    }
  }

  periodRows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.txId < b.txId ? -1 : 1;
  });

  let running = openingBalance;
  const months: StatementMonth[] = [];
  const rows: StatementRow[] = periodRows.map((r) => {
    running += r._effect;
    const mo = monthOf(r.date);
    let m = months[months.length - 1];
    if (!m || m.month !== mo) {
      m = { month: mo, totalIn: 0, totalOut: 0, closingBalance: 0, count: 0 };
      months.push(m);
    }
    m.totalIn += r.credit;
    m.totalOut += r.debit;
    m.closingBalance = running;
    m.count += 1;
    return {
      txId: r.txId,
      date: r.date,
      type: r.type,
      category: r.category,
      contactName: r.contactName,
      description: r.description,
      transferId: r.transferId,
      debit: r.debit,
      credit: r.credit,
      runningBalance: running,
    };
  });

  const closingBalance = openingBalance + periodRows.reduce((s, r) => s + r._effect, 0);
  return { accountType, range, openingBalance, rows, closingBalance, months };
}
