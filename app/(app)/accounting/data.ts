import "server-only";
import { forwardCatsOf, FORWARD_CAT_KIND } from "@/lib/accounting/forwardCats";
import { createClient } from "@/lib/supabase/server";
import {
  taxReport,
  whtReport,
  dashboardData,
  previousVat,
  missingInvoicePurchases,
  type Tx,
  type ContactMap,
  type TaxSummaryRow,
} from "@/lib/accounting/calc";
import {
  accountBalances,
  accountStatementRange,
  type LedgerTx,
  type AccountMeta,
  type StatementRange,
} from "@/lib/accounting/ledger";
import { ADVANCE_TYPE, ADVANCE_REFUND_TYPE, type AdvanceRow } from "@/lib/accounting/advance";
import { fetchAllRows } from "@/lib/shared/paginate";
import { mustRead } from "@/lib/shared/dbError";
import { getTenantPlan } from "@/lib/shared/tenant-plan";
import { hasModule } from "@/lib/shared/workspaces";
import { taxDueBoard } from "@/lib/accounting/taxPay";
import { toFilingMethod, type TaxFilingRow } from "@/lib/accounting/taxFiling";

// คอลัมน์ transactions ที่ใช้ทุกรายงาน
const TX_COLS =
  "tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description, base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount, tax_invoice_no, tax_invoice_date, status, entity_id, ap_ar_status, payment_date, settled_on, transfer_id, po_group_id, installment_no, installment_total, due_date, source, receipt_image_url, advance_for_entity, advance_status, advance_clear_id, advance_src_tx";

async function db() {
  return createClient();
}

function txBase(supabase: Awaited<ReturnType<typeof db>>, withCount = false) {
  return supabase.from("transactions").select(TX_COLS, withCount ? { count: "exact" } : undefined);
}
type TxBuilder = ReturnType<typeof txBase>;

/**
 * ดึงทุกแถวของ transactions แบบแบ่งหน้า (range) — กัน PostgREST cap `max_rows` ตัดเงียบ
 * ทำให้รายงานเงิน/ภาษี (dashboard/ยอดบัญชี/ภพ.30/statement) ขาดแถวเก่าโดยไม่มี error เมื่อข้อมูลโต
 * ตรรกะวน/ตรวจยอดกับ count อยู่ที่ lib/shared/paginate (มี unit test — paginate.test.ts)
 */
async function fetchAllTransactions(
  supabase: Awaited<ReturnType<typeof db>>,
  applyFilters?: (q: TxBuilder) => TxBuilder,
): Promise<Record<string, unknown>[]> {
  return fetchAllRows<Record<string, unknown>>(
    async (from, to) => {
      let q = txBase(supabase, from === 0); // ขอ count เฉพาะหน้าแรก → ตรวจว่าได้ครบ
      if (applyFilters) q = applyFilters(q);
      const { data, error, count } = await q.order("tx_id", { ascending: true }).range(from, to);
      return { data: (data ?? []) as Record<string, unknown>[], error, count };
    },
    { label: "รายการบัญชี" },
  );
}

/** map ชื่อคู่ค้า → {tax_id, branch, address} */
async function loadContactMap(supabase: Awaited<ReturnType<typeof db>>): Promise<ContactMap> {
  // 🚨 D89 — ว่างเพราะอ่านไม่ได้ = ช่องเลขผู้เสียภาษีบน ภพ.30/ภงด. ว่างทั้งแบบ
  const data = mustRead(
    await supabase.from("contacts").select("contact_id, name, tax_id, branch, address"),
    "ทะเบียนคู่ค้า",
  );
  const map: ContactMap = {};
  // key ทั้ง contact_id (แม่นสาขา) และ name (fallback ข้อมูลเก่า — ชื่อซ้ำหลายสาขา = อันท้ายชนะ)
  for (const c of data ?? []) {
    const info = { tax_id: c.tax_id, branch: c.branch, address: c.address };
    map[c.name as string] = info;
    if (c.contact_id) map[c.contact_id as string] = info;
  }
  return map;
}

/** ข้อมูลตั้งต้นหน้าบัญชี (dropdowns + role) */
export async function getBootstrap() {
  const supabase = await db();
  const [{ data: user }, entities, accounts, settings, contacts, materials, plan] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("entities")
      .select("entity_id, name, excise_id, is_vat, name_eng, tax_id, branch, address, phone, bank_line")
      .order("entity_id"),
    supabase.from("bank_accounts").select("account_id, account_name, entity_ids, opening_balance, kind, active").order("account_name"),
    supabase.from("app_settings").select("kind, value, sort").order("sort"),
    supabase.from("contacts").select("contact_id, name, tax_id, branch, address, contact_type, roles").order("name"),
    supabase.from("materials").select("material_id, name, unit").order("material_id"),
    getTenantPlan(),
  ]);

  let role = "viewer";
  if (user.user) {
    const { data: p } = await supabase.from("profiles").select("role").eq("id", user.user.id).single();
    role = p?.role ?? "viewer";
  }

  const s = settings.data ?? [];
  const byKind = (k: string) => s.filter((x) => x.kind === k).map((x) => x.value as string);
  // 🚨 D124 — ไม่อ่านค่าตั้ง "บัญชีในระบบภาษี" (kind tax_account) แล้ว (ภาษีขึ้นกับกิจการ + เอกสาร ไม่ใช่บัญชี) แถวเก่าใน DB ทิ้งไว้ได้ ไม่มีใครอ่าน
  // D80: หมวดที่จุดชนวนรับวัตถุดิบเข้าสต็อกผลิต — ตั้งเองได้ ไม่ตั้ง = ค่าปริยายในโค้ด
  const forwardCatsSet = byKind(FORWARD_CAT_KIND);          // ที่ลูกค้าตั้งเองจริง ๆ (อาจว่าง)
  const hasProduction = hasModule(plan.modules, "production");
  const forwardCats = forwardCatsOf(forwardCatsSet, hasProduction); // ที่มีผลจริง (ว่าง = ค่าปริยาย · ไม่มีโมดูลผลิต = ไม่มีเลย D133)

  return {
    role,
    entities: entities.data ?? [],
    accounts: accounts.data ?? [],
    contacts: contacts.data ?? [],
    materials: materials.data ?? [],
    expenseCats: byKind("expense_cat"),
    incomeCats: byKind("income_cat"),
    whtRates: byKind("wht_rate"),
    forwardCats,
    forwardCatsSet,
    // D125 — การ์ดหมวดรับวัตถุดิบเข้าสต็อกผลิต ไม่มีความหมายถ้าไม่ได้ซื้อโมดูลผลิต
    hasProduction,
    // ★ แบรนด์ / กิจการบนเอกสาร / LINE ไม่อยู่ที่นี่แล้ว — ย้ายไป app/(app)/settings/settings-data.ts (D63)
  };
}

/** A11 — Dashboard + WHT pending (issuedTxIds จาก wht_certificates.tx_ids) */
export async function getDashboard(period: string, entityId: string) {
  const supabase = await db();
  const [txAll, wht] = await Promise.all([
    fetchAllTransactions(supabase),
    supabase.from("wht_certificates").select("tx_ids"),
  ]);
  const issued = new Set<string>();
  // 🚨 D89 — ว่างเพราะอ่านไม่ได้ = บิลที่ออกใบ 50ทวิ ไปแล้วโผล่ซ้ำในคิว "รอออก 50ทวิ"
  for (const w of mustRead(wht, "ประวัติใบ 50 ทวิ")) for (const id of (w.tx_ids as string[]) ?? []) if (id) issued.add(id);
  return dashboardData(period, entityId, txAll as unknown as Tx[], issued);
}

/** A2/A5 — AP/AR ค้าง + (union) ยอดค้างจากออเดอร์ขาย (read-only, แก้ T2) */
export async function getApAr(entityId: string) {
  const supabase = await db();
  const data = await fetchAllTransactions(supabase, (q) => q.eq("status", "ปกติ").not("ap_ar_status", "is", null));

  const inScope = (e: string) => !entityId || entityId === "ALL" || e === entityId;
  const payable: ApArRow[] = [];
  const receivable: ApArRow[] = [];
  let totalAP = 0;
  let totalAR = 0;
  for (const r of data as unknown as Tx[]) {
    if (!inScope(r.entity_id)) continue;
    const amount = Number(r.net_amount) || 0;
    const rec: ApArRow = {
      transactionId: r.tx_id,
      date: r.transaction_date ?? "",
      dueDate: (r as unknown as { due_date?: string }).due_date ?? "",
      contactName: r.contact_name ?? "",
      category: r.category ?? "",
      description: r.description ?? "",
      amount,
      installment: (r as unknown as { installment_no?: number; installment_total?: number }).installment_no
        ? `${(r as unknown as { installment_no?: number }).installment_no}/${(r as unknown as { installment_total?: number }).installment_total ?? ""}`
        : "",
      poGroupId: (r as unknown as { po_group_id?: string }).po_group_id ?? "",
    };
    if (r.ap_ar_status === "AP") {
      payable.push(rec);
      totalAP += amount;
    } else {
      receivable.push(rec);
      totalAR += amount;
    }
  }

  // ยอดค้างออเดอร์ขาย (ถ้ามีตาราง/ข้อมูล) — read-only (sales_orders ไม่มี entity_id)
  let salesOutstanding: SalesOutstandingRow[] = [];
  const so = await supabase
    .from("sales_orders")
    .select("qu_no, order_no, customer_name, outstanding_balance, status")
    .gt("outstanding_balance", 0);
  if (!so.error) {
    salesOutstanding = (so.data ?? []).map((r) => ({
      quNo: (r.qu_no as string) ?? "",
      orderNo: (r.order_no as string) ?? "",
      customerName: (r.customer_name as string) ?? "",
      outstanding: Number(r.outstanding_balance) || 0,
      status: (r.status as string) ?? "",
    }));
  }

  const groupBy = (arr: ApArRow[]) => {
    const m: Record<string, number> = {};
    for (const r of arr) m[r.contactName] = (m[r.contactName] || 0) + r.amount;
    return Object.entries(m)
      .map(([contactName, total]) => ({ contactName, total }))
      .sort((a, b) => b.total - a.total);
  };

  return {
    payable,
    receivable,
    totalAP,
    totalAR,
    payableByContact: groupBy(payable),
    receivableByContact: groupBy(receivable),
    salesOutstanding,
  };
}

export type ApArRow = {
  transactionId: string;
  date: string;
  dueDate: string;
  contactName: string;
  category: string;
  description: string;
  amount: number;
  installment: string;
  poGroupId: string;
};
export type SalesOutstandingRow = {
  quNo: string;
  orderNo: string;
  customerName: string;
  outstanding: number;
  status: string;
};

/** การเคลียสำรองจ่าย 1 ครั้ง (บิลสำรองจ่าย + บิลของกิจการปลายทาง + รับคืน) */
export type AdvanceClearBatch = {
  clearId: string;
  date: string;
  payer: string;
  target: string;
  payAccount: string;
  refundAccount: string;
  total: number;
  /** บิลรายจ่ายของกิจการปลายทาง */
  billIds: string[];
  /** บิลสำรองจ่ายต้นทาง */
  advanceIds: string[];
};

/**
 * D119 — สำรองจ่ายรอเบิกคืน + การเคลียที่ยังมีผลอยู่
 * ขอบเขต: กิจการที่เลือกด้านบนเป็น **คนจ่าย หรือ** กิจการที่ซื้อให้ (ALL = ทุกใบ)
 * ★ RLS กรองอีกชั้น — ผู้ใช้ที่เห็นแค่บริษัทจะไม่เห็นบิลสำรองจ่ายเลย (บิลอยู่ในกิจการของคนจ่าย)
 *   ซึ่งตรงกับเจตนา "บริษัทยังไม่รู้จนกว่าจะเคลีย"
 */
export async function getAdvances(entityId: string) {
  const supabase = await db();
  const [pendingRaw, clearedRaw] = await Promise.all([
    fetchAllTransactions(supabase, (q) =>
      q.eq("type", ADVANCE_TYPE).eq("status", "ปกติ").eq("advance_status", "รอเบิกคืน")),
    fetchAllTransactions(supabase, (q) => q.eq("status", "ปกติ").not("advance_clear_id", "is", null)),
  ]);
  const inScope = (payer: string, target: string) =>
    !entityId || entityId === "ALL" || payer === entityId || target === entityId;

  type Raw = Tx & { advance_for_entity?: string | null; advance_clear_id?: string | null; description?: string | null };
  const pending: AdvanceRow[] = [];
  for (const r of pendingRaw as unknown as Raw[]) {
    const target = r.advance_for_entity ?? "";
    if (!inScope(r.entity_id, target)) continue;
    pending.push({
      txId: r.tx_id,
      date: String(r.transaction_date ?? "").substring(0, 10),
      payer: r.entity_id,
      target,
      accountName: r.account_name ?? "",
      contactName: r.contact_name ?? "",
      description: r.description ?? "",
      category: r.category ?? "",
      netAmount: Number(r.net_amount) || 0,
      vatAmount: Number(r.vat_amount) || 0,
      taxInvoiceNo: r.tax_invoice_no ?? "",
      taxInvoiceDate: String(r.tax_invoice_date ?? "").substring(0, 10),
    });
  }

  const batches = new Map<string, AdvanceClearBatch>();
  for (const r of clearedRaw as unknown as Raw[]) {
    const id = r.advance_clear_id ?? "";
    let b = batches.get(id);
    if (!b) {
      b = { clearId: id, date: "", payer: "", target: "", payAccount: "", refundAccount: "", total: 0, billIds: [], advanceIds: [] };
      batches.set(id, b);
    }
    if (r.type === ADVANCE_REFUND_TYPE) {
      b.date = String(r.transaction_date ?? "").substring(0, 10);
      b.payer = r.entity_id;
      b.refundAccount = r.account_name ?? "";
      b.total = Number(r.net_amount) || 0;
    } else if (r.type === ADVANCE_TYPE) {
      b.advanceIds.push(r.tx_id);
      b.target = r.advance_for_entity ?? b.target;
    } else {
      b.billIds.push(r.tx_id);
      b.target = r.entity_id;
      b.payAccount = r.account_name ?? "";
    }
  }
  // 🪤 เห็นไม่ครบชุด (เช่น ผู้ใช้ที่เห็นแค่บริษัท เห็นบิลของบริษัทแต่ไม่เห็นรายการรับคืน)
  //    = ไม่ใช่ชุดที่ผู้ใช้คนนี้ถอนได้ทั้งชุด → ไม่แสดงในรายการถอน (บิลของบริษัทยังเห็นในค้นบิลตามปกติ)
  const cleared = [...batches.values()]
    .filter((b) => b.date && b.advanceIds.length > 0 && inScope(b.payer, b.target))
    .sort((a, b) => (a.date === b.date ? (a.clearId < b.clearId ? 1 : -1) : a.date < b.date ? 1 : -1));

  return { pending, cleared };
}

/** A8 — ยอดคงเหลือทุกบัญชี ณ สิ้นเดือน */
export async function getBalances(upToPeriod: string, entityId: string) {
  const supabase = await db();
  const [txAll, accRes] = await Promise.all([
    fetchAllTransactions(supabase),
    supabase.from("bank_accounts").select("account_name, entity_ids, opening_balance"),
  ]);
  // 🚨 D89 — ว่าง = ยอดยกมาหายทั้งระบบ → ยอดคงเหลือทุกบัญชีผิด
  const accounts: AccountMeta[] = mustRead(accRes, "ทะเบียนบัญชีเงิน").map((a) => ({
    accountName: a.account_name as string,
    openingBalance: Number(a.opening_balance) || 0,
    entityIds: (a.entity_ids as string[]) ?? [],
  }));
  return accountBalances(upToPeriod, txAll as unknown as LedgerTx[], accounts, entityId);
}

/** A8 — statement บัญชี · D139 เลือกช่วงเดือน / ทั้งหมด (from/to = null) */
export async function getStatement(accountName: string, range: StatementRange) {
  const ym = /^\d{4}-\d{2}$/;
  if ((range.from && !ym.test(range.from)) || (range.to && !ym.test(range.to))) throw new Error("รูปแบบเดือนไม่ถูกต้อง");
  if (range.from && range.to && range.from > range.to) throw new Error("เดือนเริ่มต้องไม่หลังเดือนสุดท้าย");
  const supabase = await db();
  const [txAll, accRes] = await Promise.all([
    fetchAllTransactions(supabase, (q) => q.eq("account_name", accountName)),
    supabase.from("bank_accounts").select("opening_balance").eq("account_name", accountName).maybeSingle(),
  ]);
  // 🚨 D89 — opening = 0 เงียบ ๆ ทำให้ running balance ทั้งคอลัมน์ผิด
  const openRow = mustRead<{ opening_balance: number | null } | null>(accRes, "ยอดยกมาของบัญชี");
  const opening = Number(openRow?.opening_balance) || 0;
  return accountStatementRange(accountName, range, txAll as unknown as LedgerTx[], opening);
}

/** ค้นบิล (ค้นบิลแท็บ) — filter entity/เดือน/type/คู่ค้า/ข้อความ */
export async function searchBills(params: {
  entityId?: string;
  month?: string;
  type?: string;
  contact?: string;
  text?: string;
  includeVoid?: boolean;
}) {
  const supabase = await db();
  // 🪤 เรียงด้วย transaction_date อย่างเดียวไม่พอ — บิลที่ลงวันเดียวกันจะออกมาแบบสุ่มลำดับ
  //    ทำให้บิลที่เพิ่งบันทึกไปโผล่กลางกองแทนที่จะอยู่บนสุด แล้วผู้ใช้สรุปว่า "ไม่ได้บันทึก"
  //    (เจอจริงตอนเทส POS: บิลขายไปแทรกอยู่แถวที่ 9 กลางบิลเงินเดือน 8 ใบของวันเดียวกัน)
  let q = supabase
    .from("transactions")
    .select(TX_COLS)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (params.entityId && params.entityId !== "ALL") q = q.eq("entity_id", params.entityId);
  if (params.type) q = q.eq("type", params.type);
  if (params.contact) q = q.eq("contact_name", params.contact);
  if (!params.includeVoid) q = q.neq("status", "ยกเลิก");
  if (params.month) {
    q = q.gte("transaction_date", `${params.month}-01`).lt("transaction_date", nextMonthStart(params.month));
  }
  // 🚨 D89 (ต้นเรื่อง) — ของเดิมทิ้ง error → query พังแล้วผู้ใช้เห็น "— ไม่มีรายการ —"
  //    ซึ่งอ่านได้ว่า "ไม่มีบิล" ไม่ใช่ "โหลดไม่สำเร็จ" (ผู้ใช้เคยสรุปว่าบิลที่เพิ่งขายหายจริง)
  let rows = mustRead(await q, "บิล") as unknown as Tx[];
  if (params.text) {
    const t = params.text.toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.description ?? "").toLowerCase().includes(t) ||
        (r.contact_name ?? "").toLowerCase().includes(t) ||
        (r.tax_invoice_no ?? "").toLowerCase().includes(t) ||
        r.tx_id.toLowerCase().includes(t),
    );
  }
  return rows;
}

/** C2-5 — บิลล่าสุดของคู่ค้า (เติม description/หมวดหมู่/รายการอัตโนมัติ) เทียบ legacy getRecentTransactionsByContact */
export async function getRecentBillsByContact(contactName: string, limit = 5, entityId?: string, contactId?: string) {
  const supabase = await db();
  if (!contactName?.trim() && !contactId) return [] as RecentBill[];
  let q = supabase
    .from("transactions")
    .select("tx_id, transaction_date, type, category, description, net_amount, entity_id")
    .eq("status", "ปกติ")
    // ระบุสาขาที่แน่นอนก่อน (multi-branch D30) — ไม่มี contact_id ค่อย fallback ชื่อ
    .eq(contactId ? "contact_id" : "contact_name", contactId || contactName)
    .order("transaction_date", { ascending: false })
    .order("tx_id", { ascending: false })
    .limit(limit);
  if (entityId && entityId !== "ALL") q = q.eq("entity_id", entityId);
  const rows = mustRead(await q, "บิลล่าสุดของคู่ค้า") as unknown as {
    tx_id: string; transaction_date: string | null; type: string; category: string | null; description: string | null; net_amount: number | string | null;
  }[];
  if (rows.length === 0) return [] as RecentBill[];
  // ดึง items ของบิลเหล่านี้มาพร้อมกัน (เติมรายการทั้งใบได้)
  const ids = rows.map((r) => r.tx_id);
  const itemsData = mustRead(
    await supabase
      .from("transaction_items")
      .select("tx_id, item_name, quantity, in_vat, ex_vat, total_price, discount_pct, discount_baht, item_category, item_job")
      .in("tx_id", ids)
      .order("item_id"),
    "รายการในบิล",
  );
  const itemsByTx: Record<string, RecentBillItem[]> = {};
  for (const it of (itemsData ?? []) as Record<string, unknown>[]) {
    const tid = it.tx_id as string;
    (itemsByTx[tid] ??= []).push({
      itemName: (it.item_name as string) ?? "",
      quantity: Number(it.quantity) || 0,
      inVat: Number(it.in_vat) || 0,
      exVat: Number(it.ex_vat) || 0,
      discountPct: Number(it.discount_pct) || 0,
      discountBaht: Number(it.discount_baht) || 0,
      itemCategory: (it.item_category as string) ?? "",
      itemJob: (it.item_job as string) ?? "",
    });
  }
  return rows.map((r) => ({
    txId: r.tx_id,
    date: r.transaction_date ?? "",
    type: r.type,
    category: r.category ?? "",
    description: r.description ?? "",
    netAmount: Number(r.net_amount) || 0,
    items: itemsByTx[r.tx_id] ?? [],
  })) as RecentBill[];
}

export type RecentBillItem = {
  itemName: string; quantity: number; inVat: number; exVat: number;
  discountPct: number; discountBaht: number; itemCategory: string; itemJob: string;
};
export type RecentBill = {
  txId: string; date: string; type: string; category: string; description: string; netAmount: number; items: RecentBillItem[];
};

/** รายการค่าไม่ซ้ำจากประวัติ (ชื่อสินค้า/หมวดหมู่/งาน) → เติมดรอปดาวน์หน้าบันทึก */
export async function getItemHistory(entityId?: string) {
  const supabase = await db();
  let q = supabase
    .from("transaction_items")
    .select("item_name, item_category, item_job, transactions!inner(entity_id, status)")
    .limit(5000);
  if (entityId && entityId !== "ALL") q = q.eq("transactions.entity_id", entityId);
  const data = mustRead(await q, "ประวัติชื่อรายการ");
  const names = new Set<string>();
  const cats = new Set<string>();
  const jobs = new Set<string>();
  for (const r of (data ?? []) as unknown as { item_name: string | null; item_category: string | null; item_job: string | null; transactions: { status: string } | null }[]) {
    if (r.transactions && r.transactions.status !== "ปกติ") continue;
    if (r.item_name?.trim()) names.add(r.item_name.trim());
    if (r.item_category?.trim()) cats.add(r.item_category.trim());
    if (r.item_job?.trim()) jobs.add(r.item_job.trim());
  }
  const sortTh = (a: string, b: string) => a.localeCompare(b, "th");
  return {
    itemNames: [...names].sort(sortTh),
    itemCategories: [...cats].sort(sortTh),
    itemJobs: [...jobs].sort(sortTh),
  };
}

/** รายละเอียดบิล + items */
export async function getBillDetail(txId: string) {
  const supabase = await db();
  const [tx, items, wht] = await Promise.all([
    supabase.from("transactions").select(TX_COLS).eq("tx_id", txId).maybeSingle(),
    supabase.from("transaction_items").select("*").eq("tx_id", txId).order("item_id"),
    // D132 — ใบ 50ทวิ ที่อ้างบิลนี้ (ออกแล้ว = ย้ายกิจการไม่ได้) · อ่านไม่ได้ต้องฟ้อง ไม่ใช่ถือว่าไม่มี (D89)
    supabase.from("wht_certificates").select("doc_no").contains("tx_ids", [txId]).order("doc_no"),
  ]);
  const whtDocNos = (mustRead(wht, "ใบ 50ทวิ ของบิล") ?? []).map((r) => r.doc_no as string);
  return { tx: tx.data as unknown as Tx | null, items: items.data ?? [], whtDocNos };
}

/** แท็บประวัติราคา: เพดานแถวที่โหลด (ล่าสุดก่อน) — เกินแล้วบอกบนจอ ไม่ตัดเงียบ */
const PRICE_HISTORY_MAX = 10000;

/**
 * ประวัติราคาสินค้า/วัตถุดิบ (searchItemHistory) — join items↔tx
 * D140: กรองทุกอย่างที่ฝั่ง server (เดิม limit 300 แถวล่าสุดแล้วกรองทีหลัง = ของเก่าหายเงียบ ๆ
 * และยอดรวมของงานจะขาดแถวเก่า) · แบ่งหน้าทีละ 1,000 (PostgREST max_rows) จนถึงเพดาน
 * · ชื่อสินค้ากรองต่อที่หน้าจอ (พิมพ์แล้วกรองทันที) — ได้ครบเพราะโหลดมาทั้งชุดแล้ว
 */
export async function searchPriceHistory(params: {
  contact?: string;
  entityId?: string;
  includePriceCheck?: boolean;
  job?: string;
  category?: string;
  /** yyyy-MM รวมทั้งสองข้าง · null/ไม่ส่ง = ไม่จำกัด */
  from?: string | null;
  to?: string | null;
}) {
  const ym = /^\d{4}-\d{2}$/;
  if ((params.from && !ym.test(params.from)) || (params.to && !ym.test(params.to))) throw new Error("รูปแบบเดือนไม่ถูกต้อง");
  const supabase = await db();
  const page = (from: number, to: number) => {
    let q = supabase
      .from("transaction_items")
      .select(
        "item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price, item_category, item_job, transactions!inner(transaction_date, contact_name, type, status, entity_id, advance_status)",
        from === 0 ? { count: "exact" } : undefined,
      )
      .eq("transactions.status", "ปกติ");
    if (params.entityId && params.entityId !== "ALL") q = q.eq("transactions.entity_id", params.entityId);
    if (params.contact) q = q.eq("transactions.contact_name", params.contact);
    if (!params.includePriceCheck) q = q.neq("transactions.type", "เช็คราคา");
    if (params.job) q = q.eq("item_job", params.job);
    if (params.category) q = q.eq("item_category", params.category);
    if (params.from) q = q.gte("transactions.transaction_date", `${params.from}-01`);
    if (params.to) q = q.lt("transactions.transaction_date", nextMonthStart(params.to));
    return q.order("item_id", { ascending: false }).range(from, to);
  };

  const CHUNK = 1000;
  const raw: Record<string, unknown>[] = [];
  let total: number | null = null;
  while (raw.length < PRICE_HISTORY_MAX) {
    const res = await page(raw.length, Math.min(raw.length + CHUNK, PRICE_HISTORY_MAX) - 1);
    // 🚨 D89 — อ่านไม่ได้ต้องฟ้อง ไม่ใช่ถือว่าไม่มีประวัติ
    const rows = mustRead(res, "ประวัติราคา") as Record<string, unknown>[];
    if (total == null && res.count != null) total = res.count;
    raw.push(...rows);
    if (rows.length < CHUNK) break;
  }

  type Row = {
    item_name: string;
    quantity: number;
    ex_vat: number;
    in_vat: number;
    total_price: number;
    tx_id: string;
    item_category: string | null;
    item_job: string | null;
    transactions: { transaction_date: string; contact_name: string | null; type: string; status: string; advance_status: string | null } | null;
  };
  const rows = (raw as unknown as Row[])
    .filter((r) => r.transactions && r.transactions.status === "ปกติ")
    // D119 — สำรองจ่ายที่เคลียแล้ว: รายการเดียวกันถูกคัดลอกไปเป็นบิลของกิจการปลายทาง → ไม่นับซ้ำ
    .filter((r) => !(r.transactions!.type === ADVANCE_TYPE && r.transactions!.advance_status === "เคลียแล้ว"))
    .map((r) => ({
      itemName: r.item_name,
      quantity: Number(r.quantity) || 0,
      exVat: Number(r.ex_vat) || 0,
      inVat: Number(r.in_vat) || 0,
      totalPrice: Number(r.total_price) || 0,
      date: r.transactions!.transaction_date,
      contactName: r.transactions!.contact_name ?? "",
      type: r.transactions!.type,
      txId: r.tx_id,
      category: r.item_category ?? "",
      job: r.item_job ?? "",
    }))
    // ใหม่สุดก่อนตามวันที่บิล (item_id เรียงตามลำดับที่คีย์ ซึ่งไม่ใช่วันที่บิลเสมอ) · sort เสถียร = คงลำดับเดิมเมื่อวันเท่ากัน
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  return { rows, loaded: raw.length, total };
}

/** A6 — รายการกลุ่มงวดทั้งหมด (ให้เลือกจากลิสต์ ไม่ต้องจำรหัส TR-) */
export async function listInstallmentGroups() {
  const supabase = await db();
  const rows = await fetchAllTransactions(supabase, (q) => q.not("po_group_id", "is", null).eq("status", "ปกติ"));
  type R = Tx & { po_group_id?: string; installment_total?: number };
  const byGroup: Record<string, { poGroupId: string; contactName: string; type: string; category: string; description: string; total: number; count: number; date: string }> = {};
  for (const r of rows as unknown as R[]) {
    const g = r.po_group_id;
    if (!g) continue;
    const e = (byGroup[g] ??= {
      poGroupId: g, contactName: r.contact_name ?? "", type: r.type, category: r.category ?? "",
      description: (r.description ?? "").replace(/\s*\(งวด \d+\/\d+\)\s*$/, ""), total: 0, count: 0, date: r.transaction_date ?? "",
    });
    e.total += Number(r.amount_after_discount) || 0;
    e.count += 1;
  }
  return Object.values(byGroup).sort((a, b) => b.date.localeCompare(a.date));
}

/** A6 — รายละเอียดกลุ่มงวด */
export async function getInstallmentGroup(poGroupId: string) {
  const supabase = await db();
  const [grp, items] = await Promise.all([
    supabase.from("transactions").select(TX_COLS).eq("po_group_id", poGroupId).eq("status", "ปกติ"),
    supabase.from("transaction_items").select("*").eq("tx_id", poGroupId).order("item_id"),
  ]);
  const rows = ((grp.data ?? []) as unknown as (Tx & { installment_no: number; due_date: string; po_group_id: string })[]).sort(
    (a, b) => (Number(a.installment_no) || 0) - (Number(b.installment_no) || 0),
  );
  if (rows.length === 0) return null;
  const first = rows[0];
  const stripDesc = (first.description ?? "").replace(/\s*\(งวด \d+\/\d+\)\s*$/, "");
  let totalBase = 0;
  const installments = rows.map((r) => {
    const base = Number(r.amount_after_discount) || 0;
    totalBase += base;
    return {
      txId: r.tx_id,
      installmentNo: r.installment_no,
      base,
      net: Number(r.net_amount) || 0,
      paid: !r.ap_ar_status,
      dueDate: r.due_date ?? "",
      paymentDate: (r as unknown as { payment_date?: string }).payment_date ?? "",
      accountType: r.account_name ?? "",
    };
  });
  return {
    poGroupId,
    header: {
      entityId: first.entity_id,
      type: first.type,
      category: first.category ?? "",
      contactName: first.contact_name ?? "",
      description: stripDesc,
      hasVat: rows.some((r) => (Number(r.vat_amount) || 0) > 0),
      whtRate: Number(first.wht_rate) || 0,
      transactionDate: first.transaction_date ?? "",
    },
    items: items.data ?? [],
    installments,
    totalBase: Math.round(totalBase * 100) / 100,
    anyPaid: installments.some((x) => x.paid),
    allPaid: installments.every((x) => x.paid),
  };
}

/** ข้อมูล 50ทวิ: pending (จาก dashboard) + history + doc_no ที่มีแล้ว (สำหรับออกเลขถัดไป) */
export async function getWhtBundle(period: string, entityId: string) {
  const supabase = await db();
  const dash = await getDashboard(period, entityId);
  // 🚨 D89 — certs ว่างเพราะอ่านไม่ได้ = ออกเลข 50ทวิ ซ้ำเลขที่เคยออกไปแล้ว
  const certs = mustRead(
    await supabase
    .from("wht_certificates")
    .select("doc_no, issue_date, contact_name, contact_id, address, wht_amount, pnd_type, income_type, income_seq, base_amount, tx_ids, entity_id")
    .order("doc_no"),
    "ประวัติใบ 50 ทวิ",
  );
  const inScope = (e: string) => !entityId || entityId === "ALL" || (e || "EID01") === entityId;
  const scoped = (certs ?? []).filter((c) => inScope((c.entity_id as string) ?? ""));
  const history = scoped
    .filter((c) => {
      const m = String(c.issue_date ?? "").substring(0, 7);
      return !period || m === period;
    })
    .map((c) => ({
      docNo: c.doc_no as string,
      issueDate: (c.issue_date as string) ?? "",
      contactName: (c.contact_name as string) ?? "",
      contactId: (c.contact_id as string) ?? "", // multi-branch: พิมพ์ซ้ำได้สาขาถูก (ใบเก่า = "" → fallback ชื่อ)
      address: (c.address as string) ?? "",
      whtAmount: Number(c.wht_amount) || 0,
      pndType: (c.pnd_type as string) ?? "",
      incomeType: (c.income_type as string) ?? "",
      incomeSeq: Number(c.income_seq) || 6,
      baseAmount: Number(c.base_amount) || 0,
      txIds: (c.tx_ids as string[]) ?? [],
      entityId: (c.entity_id as string) ?? "",
    }));
  // เลขเอกสารที่มีแล้วของกิจการนี้ (รันเลขแยกต่อกิจการ)
  const existingDocNos = scoped.map((c) => c.doc_no as string);
  return { pending: dash.whtPending, history, existingDocNos };
}

/**
 * FLOW sec 6/8 — "เดือนนี้สร้างรายงานครบยัง" อ่านจาก report_runs ที่เขียนอยู่แล้วตอนกดสร้าง
 * คืน { report_key: วันที่สร้างล่าสุด } ของเดือน/กิจการนั้น (ไม่มี = ยังไม่ได้สร้าง)
 */
export async function getReportRuns(month: string, entityId: string): Promise<Record<string, string>> {
  const supabase = await db();
  let q = supabase
    .from("report_runs")
    .select("report_key, entity_id, created_at")
    .eq("month", month)
    .order("created_at", { ascending: false });
  if (entityId && entityId !== "ALL") q = q.eq("entity_id", entityId);
  // 🚨 D89 — ว่าง = บอก "ยังไม่ได้สร้างแบบ" ทั้งที่สร้างแล้ว → ปุ่มจ่ายภาษีล็อกโดยไม่มีเหตุผล
  const data = mustRead(await q, "ประวัติการสร้างแบบยื่น");
  const out: Record<string, string> = {};
  for (const r of data ?? []) {
    const k = r.report_key as string;
    if (!out[k]) out[k] = String(r.created_at).slice(0, 10); // แถวแรก = ล่าสุด (order desc)
  }
  return out;
}

/** ชุดข้อมูล ภพ.30 / ภงด. สำหรับ PDF (เรียกจาก /reports) */
export async function getTaxReportBundle(period: string, entityId: string) {
  const supabase = await db();
  const [txAll, contactMap, summaries, entity] = await Promise.all([
    fetchAllTransactions(supabase),
    loadContactMap(supabase),
    supabase.from("tax_summaries").select("report_month, forwarded_vat_out, entity_id, created_at"),
    supabase.from("entities").select("name, tax_id, branch, excise_id").eq("entity_id", entityId).maybeSingle(),
  ]);
  const txs = txAll as unknown as Tx[];
  // 🚨 D89 — summaries ว่าง = ภาษีซื้อยกมาหายทั้งก้อน → ยอดที่ยื่นใน ภพ.30 ผิด
  const fwdIn = previousVat(period, entityId, mustRead(summaries, "ยอดภาษียกมา") as unknown as TaxSummaryRow[]);
  return {
    entity: mustRead<{ name: string; tax_id: string; branch: string; excise_id: string } | null>(
      entity, "ข้อมูลกิจการบนแบบยื่น",
    ) ?? { name: "", tax_id: "", branch: "", excise_id: "" },
    taxReport: taxReport(period, entityId, fwdIn, txs, contactMap),
    whtReport: whtReport(period, entityId, txs, contactMap),
    forwardedVatIn: fwdIn,
  };
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map((x) => parseInt(x, 10));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/**
 * D88 — กระดาน "ชำระภาษี" ของงวดที่เลือก (ภพ.30 · ภงด.3 · ภงด.53)
 *
 * ดึงทุกอย่างรอบเดียวแล้วส่งให้ `taxDueBoard()` ตัดสิน — **ตรรกะการตัดสินอยู่ใน lib
 * ที่มี golden test คุม ไม่ใช่ในไฟล์นี้** (บทเรียน D81: สูตรถูกหมดแต่ `data.ts` เลือก
 * ชุดข้อมูลผิด แล้วไม่มีเทสไหนมองเห็น)
 *
 * ★ `tx_status` = สถานะจริงของบิลใน `transactions` — ผู้ใช้ยกเลิกบิลจากหน้าค้นบิลได้
 *   ตรง ๆ ถ้าไม่อ่านมาด้วย หน้าจอจะยืนยันว่า "จ่ายแล้ว" ทั้งที่เงินไม่เคยออก
 */
export async function getTaxPayBoard(period: string, entityId: string) {
  const supabase = await db();
  const [txAll, contactMap, summariesRes, entityRes, runs, paysRes, filesRes] = await Promise.all([
    fetchAllTransactions(supabase),
    loadContactMap(supabase),
    supabase.from("tax_summaries").select("report_month, net_payable, forwarded_vat_out, entity_id, created_at"),
    supabase.from("entities").select("is_vat, filing_method").eq("entity_id", entityId).maybeSingle(),
    getReportRuns(period, entityId),
    supabase
      .from("tax_payments")
      .select(
        "id, kind, period, amount, surcharge, computed_amount, pay_date, tx_id, surcharge_tx_id, account_name, category, surcharge_category, contact_name, contact_id, note, status, created_at",
      )
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false }),
    // D95 — ประกาศ "ยื่นแล้ว" ต่อแบบต่องวด (คนละเรื่องกับ report_runs ที่แปลว่ากดพิมพ์แล้ว)
    supabase
      .from("tax_filings")
      .select("id, kind, period, filed_at, filed_on, source, note, reopened_at")
      .eq("entity_id", entityId)
      .order("filed_at", { ascending: false }),
  ]);

  const txs = txAll as unknown as Tx[];
  // 🚨 D89 — ว่าง = ป้าย "ยังไม่ได้สร้างแบบ" ทั้งที่สร้างแล้ว และยอดยกไปเพี้ยน
  const summaryRows = mustRead(summariesRes, "ยอดภาษีที่ยื่นไว้");
  const summaries = summaryRows as unknown as TaxSummaryRow[];
  const fwdIn = previousVat(period, entityId, summaries);
  const tr = taxReport(period, entityId, fwdIn, txs, contactMap);
  const wr = whtReport(period, entityId, txs, contactMap);

  // ยอดที่ "แช่ไว้" ตอนกดสร้าง ภพ.30 ของงวดนี้ (แถวล่าสุด) — null = ยังไม่เคยสร้าง
  const summaryOfPeriod = summaryRows
    .filter((s) => String(s.report_month).replace(/^'/, "").trim() === period && (s.entity_id ?? "") === entityId)
    .sort((a, b) => (String(a.created_at) < String(b.created_at) ? -1 : 1))
    .pop();

  const statusOf = new Map<string, string>();
  for (const t of txs) statusOf.set(String(t.tx_id), String(t.status ?? ""));

  // 🚨🚨 D89 — ว่างเพราะอ่านไม่ได้ = canPay กลับเป็น true → **จ่ายภาษีซ้ำรอบสอง**
  //    (DB ยังกันด้วย partial unique index อยู่ แต่หน้าจอจะโกหกว่า "ยังไม่เคยจ่าย")
  const payments = mustRead(paysRes, "ประวัติการชำระภาษี").map((p) => ({
    kind: p.kind as string,
    period: p.period as string,
    amount: Number(p.amount) || 0,
    surcharge: Number(p.surcharge) || 0,
    computed_amount: p.computed_amount === null ? null : Number(p.computed_amount),
    pay_date: (p.pay_date as string) ?? "",
    tx_id: (p.tx_id as string) ?? null,
    surcharge_tx_id: (p.surcharge_tx_id as string) ?? null,
    account_name: (p.account_name as string) ?? null,
    category: (p.category as string) ?? null,
    surcharge_category: (p.surcharge_category as string) ?? null,
    contact_name: (p.contact_name as string) ?? null,
    contact_id: (p.contact_id as string) ?? null,
    note: (p.note as string) ?? null,
    status: (p.status as string) ?? "ปกติ",
    tx_status: p.tx_id ? (statusOf.get(String(p.tx_id)) ?? null) : null,
  }));

  /**
   * 🚨🚨 D89/D95 — อ่าน `tax_filings` ไม่ได้แล้วปล่อยผ่าน = กระดานบอกว่า "ยังไม่ได้ยื่น"
   *    ทั้งที่ยื่นแล้ว → ผู้ใช้กดยื่นซ้ำ (DB กันด้วย unique index อยู่ แต่หน้าจอโกหก)
   */
  const filings: TaxFilingRow[] = mustRead(filesRes, "สถานะการยื่นแบบ").map((f) => ({
    id: Number(f.id),
    kind: String(f.kind),
    period: String(f.period),
    filedAt: String(f.filed_at ?? ""),
    filedOn: (f.filed_on as string) ?? null,
    source: String(f.source ?? "manual"),
    note: (f.note as string) ?? null,
    reopenedAt: (f.reopened_at as string) ?? null,
  }));

  const rows = taxDueBoard({
    period,
    isVat: (entityRes.data?.is_vat ?? true) !== false,
    filings,
    summaryNetPayable: summaryOfPeriod ? Number(summaryOfPeriod.net_payable) || 0 : null,
    summaryCarry: summaryOfPeriod ? Number(summaryOfPeriod.forwarded_vat_out) || 0 : null,
    liveVatPayable: tr.netPayable,
    liveVatCarry: tr.forwardedVatOut,
    livePnd3: wr.pnd3TotalWht,
    livePnd53: wr.pnd53TotalWht,
    runs,
    payments,
  });

  /**
   * ค่าที่ใช้ครั้งก่อนของแต่ละแบบ = **ตัวแทนหน้าตั้งค่า** (D88 ข้อ 6.3)
   * ครั้งแรกไม่มีอะไรให้จำ → ป๊อปอัพเติมค่าปริยายจาก `lib/accounting/taxPay`
   * 🪤 เอาจากแถวล่าสุด **รวมแถวที่ถอนแล้ว** — ถอนเพราะกรอกยอดผิด ไม่ได้แปลว่า
   *    บัญชี/หมวดที่เลือกไว้ผิดไปด้วย
   */
  const prefs: Record<string, Record<string, string>> = {};
  for (const p of payments) {
    if (prefs[p.kind]) continue;
    prefs[p.kind] = {
      accountName: p.account_name ?? "",
      category: p.category ?? "",
      surchargeCategory: p.surcharge_category ?? "",
      contactName: p.contact_name ?? "",
      contactId: p.contact_id ?? "",
    };
  }

  return {
    rows,
    prefs,
    history: payments.slice(0, 24),
    /**
     * วิธียื่นของกิจการ — null = ยังไม่ได้ตั้ง
     * 🚨 ส่ง null ตามจริง **ห้ามเติมค่าปริยายที่นี่** หน้าจอต้องรู้ว่ายังไม่ตั้งเพื่อบอกผู้ใช้
     *    (ค่าปริยายที่มองไม่เห็น = กับดัก D80)
     */
    filingMethod: toFilingMethod(entityRes.data?.filing_method),
    filings,
  };
}

/**
 * D124 — บิลซื้อเดือนนี้ที่มี VAT แต่ยังไม่กรอกเลขใบกำกับ (นับอยู่ใน ภพ.30 — ทาง ก)
 * ★ ตัดสินด้วย `missingInvoicePurchases()` ซึ่งใช้ด่านเดียวกับ ภพ.30 ⇒ ลิสต์ = บิลที่อยู่ในตัวเลขจริงพอดี
 */
export async function getMissingInvoices(period: string, entityId: string) {
  const supabase = await db();
  const txs = await fetchAllTransactions(supabase, (q) => q.gt("vat_amount", 0).in("type", ["รายจ่าย", "บันทึกภาษี"]));
  return missingInvoicePurchases(period, entityId, txs as unknown as Tx[])
    .sort((a, b) => String(a.transaction_date).localeCompare(String(b.transaction_date)))
    .map((t) => ({
      txId: t.tx_id,
      date: t.transaction_date ?? "",
      contactName: t.contact_name ?? "",
      description: t.description ?? "",
      amount: Number(t.amount_after_discount) || 0,
      vat: Number(t.vat_amount) || 0,
    }));
}

/**
 * D125 — การ์ดบัญชีเงินในหน้าตั้งค่า: ทะเบียนบัญชี + การใช้งาน (ลบได้ไหม) + ยอดคงเหลือปัจจุบัน
 * ★ การใช้งานมาจาก `fn_bank_account_usage()` (definer — นับบิลของทุกกิจการ ไม่ใช่แค่ที่ผู้ใช้เห็น)
 * ★ ยอดคงเหลือใช้ `accountBalances` ตัวเดียวกับแท็บ บัญชี & เงินสด (ไม่มีสูตรชุดที่สอง)
 */
export async function getBankAccountAdmin() {
  const supabase = await db();
  const [accRes, usageRes, txAll] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("account_id, account_name, entity_ids, kind, opening_balance, opening_date, active")
      .order("account_name"),
    supabase.rpc("fn_bank_account_usage"),
    fetchAllTransactions(supabase),
  ]);
  const rows = mustRead(accRes, "ทะเบียนบัญชีเงิน");
  const usage = mustRead(usageRes, "การใช้งานบัญชีเงิน") as {
    account_name: string; tx_count: number; pay_count: number; leg_count: number; setting_kinds: string[] | null;
  }[];
  const bal = accountBalances(
    "9999-12",
    txAll as unknown as LedgerTx[],
    rows.map((a) => ({ accountName: a.account_name as string, openingBalance: Number(a.opening_balance) || 0, entityIds: [] })),
    "ALL",
  );
  const balOf = new Map(bal.balances.map((b) => [b.accountType, b.balance]));
  const useOf = new Map(usage.map((u) => [u.account_name, u]));
  return rows.map((a) => {
    const u = useOf.get(a.account_name as string);
    return {
      accountId: a.account_id as string,
      accountName: a.account_name as string,
      entityIds: ((a.entity_ids as string[] | null) ?? []),
      kind: (a.kind as string | null) ?? "",
      openingBalance: Number(a.opening_balance) || 0,
      openingDate: (a.opening_date as string | null) ?? "",
      active: a.active !== false,
      balance: balOf.get(a.account_name as string) ?? null,
      usage: u
        ? { txCount: u.tx_count, payCount: u.pay_count, legCount: u.leg_count, settingKinds: u.setting_kinds ?? [] }
        : undefined,
    };
  });
}
export type BankAccountAdminRow = Awaited<ReturnType<typeof getBankAccountAdmin>>[number];
