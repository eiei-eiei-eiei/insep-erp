/**
 * lib/accounting/ledger — ยอดบัญชี + statement + โอนระหว่างบัญชี (A7/A8)
 * port จาก Accounts.js getAccountBalances / getAccountStatement / saveTransfer effect
 *
 * ⚠️ ยอดบัญชีใช้ net_amount (col14) · ข้ามแถว 'ยกเลิก' + AP/AR ค้าง (cash basis)
 *   บัญชีใช้ร่วมทุกกิจการ — ไม่ filter entity ตอนคิดยอด, entity แค่คัด "บัญชีที่แสดง"
 *   golden test = ledger.test.ts
 */

import { num } from "./calc";

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
 * A7 — ผลของรายการต่อยอดบัญชี (debit/credit/effect)
 * รายรับ = credit (+net) · รายจ่าย = debit (−net) · โอน: net>0 รับเข้า, net<0 โอนออก
 */
export function txEffect(type: string, net: number): { debit: number; credit: number; effect: number } {
  const n = num(net);
  if (type === "รายรับ") return { debit: 0, credit: n, effect: n };
  if (type === "รายจ่าย") return { debit: n, credit: 0, effect: -n };
  if (type === "โอนระหว่างบัญชี") {
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
  isTaxAccount: boolean;
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
  taxAccounts: Set<string>,
): { balances: AccountBalance[]; grandTotal: number; upToPeriod: string } {
  const accMap: Record<string, { totalIn: number; totalOut: number }> = {};

  for (const tx of txs) {
    if (tx.status !== "ปกติ") continue;
    if (tx.ap_ar_status) continue;
    const mo = monthOf(tx.transaction_date);
    if (!mo || mo > upToPeriod) continue; // ถึงสิ้นเดือน upToPeriod เท่านั้น

    const accName = String(tx.account_name ?? "").trim();
    const net = num(tx.net_amount);
    if (!accMap[accName]) accMap[accName] = { totalIn: 0, totalOut: 0 };
    if (tx.type === "รายรับ") accMap[accName].totalIn += net;
    else if (tx.type === "รายจ่าย") accMap[accName].totalOut += net;
    else if (tx.type === "โอนระหว่างบัญชี") {
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
      isTaxAccount: taxAccounts.has(name),
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
 */
export function accountStatement(
  accountType: string,
  period: string,
  txs: LedgerTx[],
  openingBalanceMeta: number,
): { accountType: string; period: string; openingBalance: number; rows: StatementRow[]; closingBalance: number } {
  const start = `${period}-01`;
  let openingBalance = num(openingBalanceMeta);
  const periodRows: (StatementRow & { _effect: number })[] = [];

  for (const tx of txs) {
    if (tx.status !== "ปกติ") continue;
    if (tx.ap_ar_status) continue;
    if (String(tx.account_name ?? "").trim() !== accountType) continue;
    const iso = String(tx.transaction_date ?? "").substring(0, 10);
    if (!iso) continue;
    const { debit, credit, effect } = txEffect(tx.type, num(tx.net_amount));

    if (iso < start) {
      openingBalance += effect;
    } else if (monthOf(iso) === period) {
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
  const rows: StatementRow[] = periodRows.map((r) => {
    running += r._effect;
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
  return { accountType, period, openingBalance, rows, closingBalance };
}
