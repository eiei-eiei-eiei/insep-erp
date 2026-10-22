/**
 * lib/accounting/advance — สำรองจ่าย (D119 · migration 0086)
 *
 * เจ้าของจ่ายเงินของตัวเอง (หรือของกิจการอื่น) แทนกิจการหนึ่งไปก่อน แล้วค่อยเบิกคืน:
 *   1) บิล type `สำรองจ่าย` อยู่ใน **กิจการของคนจ่าย** · advance_for_entity = กิจการที่ซื้อให้
 *      เงินออกจากบัญชีคนจ่ายทันที แต่ไม่เข้าค่าใช้จ่าย/ภาษีของใครเลย
 *   2) เคลีย = กิจการที่ซื้อให้โอนคืน → ได้บิลรายจ่ายของกิจการนั้น (ลงวันที่เคลีย) + รับคืนเข้าบัญชีคนจ่าย
 *
 * 🚨 ไฟล์นี้เป็นแค่ "คำอธิบายบนจอ + ด่านก่อนกด" — ตัวตัดสินจริงอยู่ใน SQL (fn_clear_advances)
 *    ด่านที่นี่ต้องตรงกับ SQL ไม่งั้นปุ่มกดได้แล้ว DB ปฏิเสธ (หรือกลับกัน) โดยไม่มีอะไรบอกว่าทำไม
 * golden test = advance.test.ts (A22)
 */

export const ADVANCE_TYPE = "สำรองจ่าย" as const;
export const ADVANCE_REFUND_TYPE = "รับคืนสำรองจ่าย" as const;
export type AdvanceStatus = "รอเบิกคืน" | "เคลียแล้ว" | "ตัดเป็นส่วนตัว";

/** ภาษีซื้อใช้ได้ถึงเดือนที่ 6 ถัดจากเดือนที่ออกใบกำกับ (ม.82/3) — เกินนี้เตือน ไม่บล็อก */
export const VAT_CLAIM_MONTHS = 6;

export type AdvanceRow = {
  txId: string;
  date: string; // yyyy-MM-dd
  /** กิจการของคนจ่าย (entity_id) */
  payer: string;
  /** กิจการที่ซื้อให้ (advance_for_entity) */
  target: string;
  accountName: string;
  contactName: string;
  description: string;
  category: string;
  netAmount: number;
  vatAmount: number;
  taxInvoiceNo: string;
  taxInvoiceDate: string;
};

export type AdvanceGroup = {
  key: string;
  payer: string;
  target: string;
  rows: AdvanceRow[];
  total: number;
  vatTotal: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** จัดกลุ่มบิลรอเบิกคืนตาม (คนจ่าย, กิจการที่ซื้อให้) — กลุ่มเดียวกันเท่านั้นที่เคลียพร้อมกันได้ */
export function groupPendingAdvances(rows: AdvanceRow[]): AdvanceGroup[] {
  const map = new Map<string, AdvanceGroup>();
  for (const r of rows) {
    const key = `${r.payer}|${r.target}`;
    let g = map.get(key);
    if (!g) {
      g = { key, payer: r.payer, target: r.target, rows: [], total: 0, vatTotal: 0 };
      map.set(key, g);
    }
    g.rows.push(r);
    g.total = r2(g.total + r.netAmount);
    g.vatTotal = r2(g.vatTotal + r.vatAmount);
  }
  const groups = [...map.values()];
  for (const g of groups) g.rows.sort((a, b) => (a.date === b.date ? (a.txId < b.txId ? -1 : 1) : a.date < b.date ? -1 : 1));
  return groups.sort((a, b) => (a.target === b.target ? (a.payer < b.payer ? -1 : 1) : a.target < b.target ? -1 : 1));
}

/**
 * ด่านก่อนกดเคลีย — ฝาแฝดของด่านใน fn_clear_advances
 * คืนข้อความไทยที่บอกว่าต้องแก้อะไร · null = กดได้
 */
export function clearSelectionProblem(rows: AdvanceRow[], clearDate: string): string | null {
  if (rows.length === 0) return "เลือกบิลสำรองจ่ายอย่างน้อย 1 ใบ";
  const payer = rows[0].payer;
  const target = rows[0].target;
  if (rows.some((r) => r.payer !== payer || r.target !== target)) {
    return "เคลียพร้อมกันได้เฉพาะบิลที่จ่ายโดยกิจการเดียวกันและซื้อให้กิจการเดียวกัน";
  }
  if (!clearDate) return "ใส่วันที่เคลีย";
  if (rows.some((r) => r.date > clearDate)) return "วันที่เคลียต้องไม่ก่อนวันที่สำรองจ่าย";
  return null;
}

/** บัญชีรับเงินคืนปริยาย = บัญชีที่จ่ายออกไป ถ้าทุกใบจ่ายจากบัญชีเดียวกัน (ไม่งั้น "" ให้ผู้ใช้เลือก) */
export function defaultRefundAccount(rows: AdvanceRow[]): string {
  const names = new Set(rows.map((r) => r.accountName));
  return names.size === 1 ? [...names][0] : "";
}

/** จำนวนเดือนจาก fromIso ถึง toIso (นับเป็นเดือนปฏิทิน: ม.ค. → ก.ค. = 6) */
export function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = fromIso.split("-").map(Number);
  const [ty, tm] = toIso.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return 0;
  return ty * 12 + tm - (fy * 12 + fm);
}

/**
 * บิลที่มี VAT ซึ่งใบกำกับเก่าเกินช่วงที่ใช้ภาษีซื้อได้ ณ วันเคลีย
 * ไม่มีวันที่ใบกำกับ = ใช้วันที่สำรองจ่ายแทน (ใบกำกับออกไม่ช้ากว่าวันที่จ่าย)
 */
export function staleInvoices(rows: AdvanceRow[], clearDate: string): AdvanceRow[] {
  if (!clearDate) return [];
  return rows.filter((r) => r.vatAmount > 0 && monthsBetween(r.taxInvoiceDate || r.date, clearDate) > VAT_CLAIM_MONTHS);
}

/** คำเตือนสีเหลืองตอนเคลีย — เตือนอย่างเดียว ไม่บล็อก (ผู้ใช้ตัดสิน · D119) */
export function staleInvoiceWarn(rows: AdvanceRow[], clearDate: string): string | null {
  const stale = staleInvoices(rows, clearDate);
  if (stale.length === 0) return null;
  const list = stale.map((r) => r.taxInvoiceNo || r.txId).join(", ");
  return (
    `ใบกำกับ ${stale.length} ใบเก่ากว่า ${VAT_CLAIM_MONTHS} เดือนนับจากเดือนที่ออกใบ (${list}) — ` +
    "ภาษีซื้อของใบเหล่านี้อาจใช้ใน ภพ.30 เดือนที่เคลียไม่ได้ ตรวจกับนักบัญชีก่อน · ยังเคลียได้ตามปกติ"
  );
}

type AccountLike = { account_name: string; entity_ids: string[] | null };

/** บัญชีที่ใช้กับกิจการนี้ได้ (entity_ids ว่าง = ใช้ร่วมทุกกิจการ) — กติกาเดียวกับ SQL */
export function accountsOf<T extends AccountLike>(accounts: T[], entityId: string): T[] {
  return accounts.filter((a) => {
    const ids = a.entity_ids ?? [];
    return ids.length === 0 || ids.includes(entityId);
  });
}

/** กิจการที่สำรองจ่ายให้ได้ = ทุกกิจการที่ไม่ใช่คนจ่าย */
export function advanceTargets<T extends { entity_id: string }>(entities: T[], payer: string): T[] {
  return entities.filter((e) => e.entity_id !== payer);
}

/**
 * ตัดเป็นค่าใช้จ่ายของคนจ่ายเอง — ฝาแฝดของ fn_advance_to_personal (ไว้แสดงก่อนกดยืนยัน)
 * ใบกำกับออกในนามกิจการที่ซื้อให้ ⇒ คนจ่ายขอคืนภาษีซื้อไม่ได้ · VAT กลายเป็นต้นทุน · เงินที่จ่ายจริงเท่าเดิม
 */
export function toPersonalAmounts(tx: { amountAfterDiscount: number; vatAmount: number; netAmount: number }) {
  return {
    amountAfterDiscount: r2(tx.amountAfterDiscount + tx.vatAmount),
    vatAmount: 0,
    netAmount: tx.netAmount,
  };
}

/** สถานะที่แสดงในตารางค้นบิล */
export function advanceStatusLabel(type: string, status: string | null | undefined): string {
  if (type === ADVANCE_TYPE) return status || "รอเบิกคืน";
  if (status === "ตัดเป็นส่วนตัว") return "ตัดเป็นค่าใช้จ่ายส่วนตัว (เดิมสำรองจ่าย)";
  return "";
}
