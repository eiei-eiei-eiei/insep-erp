import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  taxReport,
  whtReport,
  dashboardData,
  previousVat,
  type Tx,
  type ContactMap,
  type TaxSummaryRow,
} from "@/lib/accounting/calc";
import {
  accountBalances,
  accountStatement,
  type LedgerTx,
  type AccountMeta,
} from "@/lib/accounting/ledger";
import { fetchAllRows } from "@/lib/shared/paginate";
import { brandingFromSettings } from "@/lib/shared/branding";

// คอลัมน์ transactions ที่ใช้ทุกรายงาน
const TX_COLS =
  "tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description, base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount, tax_invoice_no, tax_invoice_date, status, entity_id, ap_ar_status, payment_date, transfer_id, po_group_id, installment_no, installment_total, due_date, source, receipt_image_url";

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

/** ชื่อบัญชีในระบบภาษี (app_settings kind='tax_account') — fallback บัญชีบริษัท */
async function loadTaxAccounts(supabase: Awaited<ReturnType<typeof db>>): Promise<Set<string>> {
  const { data } = await supabase.from("app_settings").select("value").eq("kind", "tax_account");
  const list = (data ?? []).map((r) => r.value as string).filter(Boolean);
  if (list.length === 0) list.push("บัญชีบริษัท");
  return new Set(list);
}

/** map ชื่อคู่ค้า → {tax_id, branch, address} */
async function loadContactMap(supabase: Awaited<ReturnType<typeof db>>): Promise<ContactMap> {
  const { data } = await supabase.from("contacts").select("contact_id, name, tax_id, branch, address");
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
  const [{ data: user }, entities, accounts, settings, contacts, materials] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("entities")
      .select("entity_id, name, excise_id, is_vat, name_eng, tax_id, branch, address, phone, bank_line")
      .order("entity_id"),
    supabase.from("bank_accounts").select("account_name, entity_ids, opening_balance, kind").order("account_name"),
    supabase.from("app_settings").select("kind, value, sort").order("sort"),
    supabase.from("contacts").select("contact_id, name, tax_id, branch, address, contact_type, roles").order("name"),
    supabase.from("materials").select("material_id, name, unit").order("material_id"),
  ]);

  let role = "viewer";
  if (user.user) {
    const { data: p } = await supabase.from("profiles").select("role").eq("id", user.user.id).single();
    role = p?.role ?? "viewer";
  }

  const s = settings.data ?? [];
  const byKind = (k: string) => s.filter((x) => x.kind === k).map((x) => x.value as string);
  const taxAccounts = byKind("tax_account");

  return {
    role,
    entities: entities.data ?? [],
    accounts: accounts.data ?? [],
    contacts: contacts.data ?? [],
    materials: materials.data ?? [],
    expenseCats: byKind("expense_cat"),
    incomeCats: byKind("income_cat"),
    whtRates: byKind("wht_rate"),
    taxAccounts: taxAccounts.length ? taxAccounts : ["บัญชีบริษัท"],
    branding: brandingFromSettings(s as { kind: string; value: string }[]),
    // กิจการที่ใช้ออกเอกสารการค้า (D44) — ยังไม่ตั้ง → ใช้กิจการที่รับรายได้ขายเป็นค่าตั้งต้น
    docEntityId: byKind("sales_doc_entity")[0] ?? byKind("sales_revenue_entity")[0] ?? "",
  };
}

/** A11 — Dashboard + WHT pending (issuedTxIds จาก wht_certificates.tx_ids) */
export async function getDashboard(period: string, entityId: string) {
  const supabase = await db();
  const [txAll, taxAccounts, wht] = await Promise.all([
    fetchAllTransactions(supabase),
    loadTaxAccounts(supabase),
    supabase.from("wht_certificates").select("tx_ids"),
  ]);
  const issued = new Set<string>();
  for (const w of wht.data ?? []) for (const id of (w.tx_ids as string[]) ?? []) if (id) issued.add(id);
  return dashboardData(period, entityId, txAll as unknown as Tx[], taxAccounts, issued);
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

/** A8 — ยอดคงเหลือทุกบัญชี ณ สิ้นเดือน */
export async function getBalances(upToPeriod: string, entityId: string) {
  const supabase = await db();
  const [txAll, accRes, taxAccounts] = await Promise.all([
    fetchAllTransactions(supabase),
    supabase.from("bank_accounts").select("account_name, entity_ids, opening_balance"),
    loadTaxAccounts(supabase),
  ]);
  const accounts: AccountMeta[] = (accRes.data ?? []).map((a) => ({
    accountName: a.account_name as string,
    openingBalance: Number(a.opening_balance) || 0,
    entityIds: (a.entity_ids as string[]) ?? [],
  }));
  return accountBalances(upToPeriod, txAll as unknown as LedgerTx[], accounts, entityId, taxAccounts);
}

/** A8 — statement บัญชีรายเดือน */
export async function getStatement(accountName: string, period: string) {
  const supabase = await db();
  const [txAll, accRes] = await Promise.all([
    fetchAllTransactions(supabase, (q) => q.eq("account_name", accountName)),
    supabase.from("bank_accounts").select("opening_balance").eq("account_name", accountName).maybeSingle(),
  ]);
  const opening = Number(accRes.data?.opening_balance) || 0;
  return accountStatement(accountName, period, txAll as unknown as LedgerTx[], opening);
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
  let q = supabase.from("transactions").select(TX_COLS).order("transaction_date", { ascending: false }).limit(500);
  if (params.entityId && params.entityId !== "ALL") q = q.eq("entity_id", params.entityId);
  if (params.type) q = q.eq("type", params.type);
  if (params.contact) q = q.eq("contact_name", params.contact);
  if (!params.includeVoid) q = q.neq("status", "ยกเลิก");
  if (params.month) {
    q = q.gte("transaction_date", `${params.month}-01`).lt("transaction_date", nextMonthStart(params.month));
  }
  const { data } = await q;
  let rows = (data ?? []) as unknown as Tx[];
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
  const { data } = await q;
  const rows = (data ?? []) as {
    tx_id: string; transaction_date: string | null; type: string; category: string | null; description: string | null; net_amount: number | string | null;
  }[];
  if (rows.length === 0) return [] as RecentBill[];
  // ดึง items ของบิลเหล่านี้มาพร้อมกัน (เติมรายการทั้งใบได้)
  const ids = rows.map((r) => r.tx_id);
  const { data: itemsData } = await supabase
    .from("transaction_items")
    .select("tx_id, item_name, quantity, in_vat, ex_vat, total_price, discount_pct, discount_baht, item_category, item_job")
    .in("tx_id", ids)
    .order("item_id");
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
  const { data } = await q;
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
  const [tx, items] = await Promise.all([
    supabase.from("transactions").select(TX_COLS).eq("tx_id", txId).maybeSingle(),
    supabase.from("transaction_items").select("*").eq("tx_id", txId).order("item_id"),
  ]);
  return { tx: tx.data as unknown as Tx | null, items: items.data ?? [] };
}

/** ประวัติราคาสินค้า/วัตถุดิบ (searchItemHistory) — join items↔tx */
export async function searchPriceHistory(params: { itemName?: string; contact?: string; entityId?: string; includePriceCheck?: boolean }) {
  const supabase = await db();
  let q = supabase
    .from("transaction_items")
    .select("item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price, transactions!inner(transaction_date, contact_name, type, status, entity_id)")
    .order("item_id", { ascending: false })
    .limit(300);
  if (params.itemName) q = q.ilike("item_name", `%${params.itemName}%`);
  if (params.entityId && params.entityId !== "ALL") q = q.eq("transactions.entity_id", params.entityId);
  if (params.contact) q = q.eq("transactions.contact_name", params.contact);
  const { data } = await q;
  type Row = {
    item_name: string;
    quantity: number;
    ex_vat: number;
    in_vat: number;
    total_price: number;
    tx_id: string;
    transactions: { transaction_date: string; contact_name: string | null; type: string; status: string } | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.transactions && r.transactions.status === "ปกติ")
    .filter((r) => (params.includePriceCheck ? true : r.transactions!.type !== "เช็คราคา"))
    .filter((r) => (params.contact ? r.transactions!.contact_name === params.contact : true))
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
    }));
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
  const { data: certs } = await supabase
    .from("wht_certificates")
    .select("doc_no, issue_date, contact_name, contact_id, address, wht_amount, pnd_type, income_type, income_seq, base_amount, tx_ids, entity_id")
    .order("doc_no");
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
  const { data } = await q;
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
  const [txAll, contactMap, taxAccounts, summaries, entity] = await Promise.all([
    fetchAllTransactions(supabase),
    loadContactMap(supabase),
    loadTaxAccounts(supabase),
    supabase.from("tax_summaries").select("report_month, forwarded_vat_out, entity_id, created_at"),
    supabase.from("entities").select("name, tax_id, branch, excise_id").eq("entity_id", entityId).maybeSingle(),
  ]);
  const txs = txAll as unknown as Tx[];
  const fwdIn = previousVat(period, entityId, (summaries.data ?? []) as unknown as TaxSummaryRow[]);
  return {
    entity: entity.data ?? { name: "", tax_id: "", branch: "", excise_id: "" },
    taxReport: taxReport(period, entityId, fwdIn, txs, contactMap, taxAccounts),
    whtReport: whtReport(period, entityId, txs, contactMap, taxAccounts),
    forwardedVatIn: fwdIn,
  };
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map((x) => parseInt(x, 10));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}
