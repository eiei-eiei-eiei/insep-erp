import "server-only";
import { createClient } from "@/lib/supabase/server";
import { formatThaiDate, type OrderState } from "@/lib/sales/orders";
import { companyFromEntity, pickDocEntity, type EntityDocRow } from "@/lib/sales/company";
import { fetchAllRows } from "@/lib/shared/paginate";

async function db() {
  return createClient();
}

export type MenuRow = {
  name: string;
  price: number;
  category: string;
  itemCode: string;
  multiplier: number;
  stockQty: number | null;
  isLive: boolean;
};

export type CustomerRow = {
  id: string;
  name: string;
  address: string;
  taxId: string;
  branch: string;
  phone: string;
  creditTerm: number;
  saleName: string;
  isExport: boolean;
};

const ENTITY_DOC_COLS = "entity_id, name, name_eng, tax_id, branch, address, phone, bank_line";

/** ข้อมูลตั้งต้นหน้าขาย: role + ลูกค้า (contacts) + เมนู (+ live stock) + กิจการที่ออกเอกสาร */
export async function getSalesBootstrap() {
  const supabase = await db();
  const [{ data: user }, contacts, menu, stockP, whStock, entities, docSettings] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("contacts")
      .select("contact_id, name, address, tax_id, branch, phone, credit_term, sale_name, is_export, contact_type, roles")
      .order("name"),
    supabase.from("sale_menu").select("menu_name, price, category, product_id, multiplier").order("menu_name"),
    supabase.from("stock_product").select("product_id, balance"),
    supabase.from("warehouse_stock").select("item_code, qty"),
    supabase.from("entities").select(ENTITY_DOC_COLS).order("entity_id"),
    supabase.from("app_settings").select("kind, value").in("kind", ["sales_doc_entity", "sales_revenue_entity"]),
  ]);

  let role = "viewer";
  if (user.user) {
    const { data: p } = await supabase.from("profiles").select("role").eq("id", user.user.id).single();
    role = p?.role ?? "viewer";
  }

  const liveMap = new Map<string, number>();
  for (const s of stockP.data ?? []) liveMap.set(s.product_id as string, Number(s.balance) || 0);
  const whMap = new Map<string, number>();
  for (const s of whStock.data ?? []) whMap.set(s.item_code as string, Number(s.qty) || 0);

  const menuList: MenuRow[] = (menu.data ?? []).map((m) => {
    const itemCode = (m.product_id as string)?.trim() ?? "";
    const category = (m.category as string)?.trim() ?? "";
    const multiplier = Number(m.multiplier) || 1;
    const isLive = category === "สุรา" && itemCode !== "";
    let raw: number | null = null;
    if (isLive) raw = liveMap.has(itemCode) ? liveMap.get(itemCode)! : null;
    else if (itemCode !== "") raw = whMap.has(itemCode) ? whMap.get(itemCode)! : null;
    const stockQty = raw !== null ? Math.floor(raw / multiplier) : null;
    return { name: (m.menu_name as string).trim(), price: Number(m.price) || 0, category, itemCode, multiplier, stockQty, isLive };
  });

  // เฉพาะลูกค้า (ไม่เอาคู่ค้าที่เป็น "ผู้ขาย" ล้วน) — roles มี 'ลูกค้า' หรือ type ไม่ใช่ 'ผู้ขาย'
  const isCustomer = (c: { contact_type?: unknown; roles?: unknown }) => {
    const roles = (c.roles as string[]) ?? [];
    const type = (c.contact_type as string) ?? "";
    if (roles.includes("ลูกค้า")) return true;
    return type !== "ผู้ขาย";
  };
  const customers: CustomerRow[] = (contacts.data ?? []).filter(isCustomer).map((c) => ({
    id: c.contact_id as string,
    name: c.name as string,
    address: (c.address as string) ?? "",
    taxId: (c.tax_id as string) ?? "",
    branch: (c.branch as string) ?? "",
    phone: (c.phone as string) ?? "",
    creditTerm: Number(c.credit_term) || 0,
    saleName: (c.sale_name as string) ?? "",
    isExport: Boolean(c.is_export),
  }));

  // หัวเอกสารการค้า = ข้อมูลกิจการจาก DB (D44) — ไม่ hardcode แล้ว
  const st = docSettings.data ?? [];
  const wantedEntity =
    st.find((r) => r.kind === "sales_doc_entity")?.value ?? st.find((r) => r.kind === "sales_revenue_entity")?.value ?? "";
  const company = companyFromEntity(pickDocEntity((entities.data ?? []) as EntityDocRow[], wantedEntity));

  return { role, customers, menu: menuList, company };
}

export type OrderRow = {
  quNo: string;
  orderNo: string;
  timestamp: string;
  customerId: string;
  customerName: string;
  customerAddress: string;
  customerTaxId: string;
  customerBranch: string;
  subTotal: number;
  discount: number;
  subDiscount: number;
  vatAmount: number;
  grandTotal: number;
  status: string;
  deposit: number;
  outstandingBalance: number;
  dueDate: string;
  paymentMethod: string;
  invNo: string;
  taxNo1: string;
  taxNo2: string;
  remarks: string;
  docDate1: string;
  docDate2: string;
  checkDetail1: string;
  checkDetail2: string;
  whtPercent: number;
  whtAmount: number;
  netPayable: number;
  docToPrint: string;
  nextStatus: string;
  category: string;
  saleName: string;
  isDeposit: boolean;
  depositPercent: number;
  // D45 — ใบแจ้งหนี้ค่ามัดจำ (ออกก่อนรับเงิน)
  depInvNo: string;
  depInvDate: string;
  depInvAmount: number;
  depDueDate: string;
};

const ORDER_COLS =
  "qu_no, order_no, created_at, customer_id, customer_name, sale_name, sub_total, discount, sub_discount, vat_amount, grand_total, status, deposit, outstanding_balance, due_date, payment_method, inv_no, tax_no1, tax_no2, remarks, doc_date1, doc_date2, check_detail1, check_detail2, wht_percent, wht_amount, net_payable, doc_to_print, next_status, category, is_deposit, deposit_percent, dep_inv_no, dep_inv_date, dep_inv_amount, dep_due_date";

type SoRow = Record<string, unknown>;
function mapOrder(r: SoRow, contactMap: Map<string, { address: string; taxId: string; branch: string }>): OrderRow {
  const c = contactMap.get((r.customer_id as string) ?? "") ?? { address: "", taxId: "", branch: "" };
  return {
    quNo: (r.qu_no as string) ?? "",
    orderNo: (r.order_no as string) ?? "",
    timestamp: r.created_at ? formatThaiDate(String(r.created_at).substring(0, 10)) : "",
    customerId: (r.customer_id as string) ?? "",
    customerName: (r.customer_name as string) ?? "",
    customerAddress: c.address,
    customerTaxId: c.taxId,
    customerBranch: c.branch,
    subTotal: Number(r.sub_total) || 0,
    discount: Number(r.discount) || 0,
    subDiscount: Number(r.sub_discount) || 0,
    vatAmount: Number(r.vat_amount) || 0,
    grandTotal: Number(r.grand_total) || 0,
    status: (r.status as string) ?? "รอคอนเฟิร์ม",
    deposit: Number(r.deposit) || 0,
    outstandingBalance: Number(r.outstanding_balance) || 0,
    dueDate: r.due_date ? formatThaiDate(String(r.due_date)) : "",
    paymentMethod: (r.payment_method as string) ?? "",
    invNo: (r.inv_no as string) ?? "",
    taxNo1: (r.tax_no1 as string) ?? "",
    taxNo2: (r.tax_no2 as string) ?? "",
    remarks: (r.remarks as string) ?? "",
    docDate1: (r.doc_date1 as string) ?? "",
    docDate2: (r.doc_date2 as string) ?? "",
    checkDetail1: (r.check_detail1 as string) ?? "",
    checkDetail2: (r.check_detail2 as string) ?? "",
    whtPercent: Number(r.wht_percent) || 0,
    whtAmount: Number(r.wht_amount) || 0,
    netPayable: Number(r.net_payable) || Number(r.grand_total) || 0,
    docToPrint: (r.doc_to_print as string) ?? "",
    nextStatus: (r.next_status as string) ?? "",
    category: (r.category as string) ?? "รายได้ค่าสินค้า",
    saleName: (r.sale_name as string) ?? "",
    isDeposit: Boolean(r.is_deposit),
    depositPercent: Number(r.deposit_percent) || 0,
    depInvNo: (r.dep_inv_no as string) ?? "",
    depInvDate: (r.dep_inv_date as string) ?? "",
    depInvAmount: Number(r.dep_inv_amount) || 0,
    depDueDate: (r.dep_due_date as string) ?? "",
  };
}

async function contactInfoMap(supabase: Awaited<ReturnType<typeof db>>) {
  const { data } = await supabase.from("contacts").select("contact_id, address, tax_id, branch");
  const map = new Map<string, { address: string; taxId: string; branch: string }>();
  for (const c of data ?? [])
    map.set(c.contact_id as string, { address: (c.address as string) ?? "", taxId: (c.tax_id as string) ?? "", branch: (c.branch as string) ?? "" });
  return map;
}

/**
 * ดึงออเดอร์ทุกแถวแบบแบ่งหน้า — กัน PostgREST cap `max_rows` ตัดออเดอร์เก่าเงียบ ๆ (ประวัติขาด)
 * ตรรกะวน/ตรวจยอดกับ count อยู่ที่ lib/shared/paginate (มี unit test)
 */
async function fetchAllOrders(supabase: Awaited<ReturnType<typeof db>>): Promise<SoRow[]> {
  return fetchAllRows<SoRow>(
    async (from, to) => {
      const { data, error, count } = await supabase
        .from("sales_orders")
        .select(ORDER_COLS, from === 0 ? { count: "exact" } : undefined)
        .order("created_at", { ascending: false })
        .order("qu_no", { ascending: false })
        .range(from, to);
      return { data: (data ?? []) as SoRow[], error, count };
    },
    { label: "ออเดอร์ขาย" },
  );
}

/** ประวัติออเดอร์ทั้งหมด (ใหม่สุดก่อน) */
export async function getOrders(): Promise<OrderRow[]> {
  const supabase = await db();
  const [orders, cmap] = await Promise.all([
    fetchAllOrders(supabase),
    contactInfoMap(supabase),
  ]);
  return orders.map((r) => mapOrder(r, cmap));
}

export async function getOrderItems(quNo: string) {
  const supabase = await db();
  const { data } = await supabase.from("sales_order_items").select("item_name, qty, price").eq("qu_no", quNo).order("id");
  return (data ?? []).map((i) => ({ name: i.item_name as string, qty: Number(i.qty) || 0, price: Number(i.price) || 0 }));
}

/** ออเดอร์รอคลังจัดส่ง + items */
export async function getPendingWarehouse() {
  const supabase = await db();
  const [orders, cmap] = await Promise.all([
    supabase.from("sales_orders").select(ORDER_COLS).eq("status", "รอคลังจัดส่ง").order("created_at"),
    contactInfoMap(supabase),
  ]);
  const list = (orders.data ?? []).map((r) => mapOrder(r as SoRow, cmap));
  const quNos = list.map((o) => o.quNo);
  const itemsByQu = new Map<string, { name: string; qty: number; price: number }[]>();
  if (quNos.length) {
    const { data: items } = await supabase.from("sales_order_items").select("qu_no, item_name, qty, price").in("qu_no", quNos);
    for (const it of items ?? []) {
      const arr = itemsByQu.get(it.qu_no as string) ?? [];
      arr.push({ name: it.item_name as string, qty: Number(it.qty) || 0, price: Number(it.price) || 0 });
      itemsByQu.set(it.qu_no as string, arr);
    }
  }
  return list.map((o) => ({ ...o, items: itemsByQu.get(o.quNo) ?? [] }));
}

/** สต็อกรวม: สุรา (stock_product live) + ทั่วไป (warehouse_stock) */
export async function getWarehouseStock() {
  const supabase = await db();
  const [stockP, prods, wh] = await Promise.all([
    supabase.from("stock_product").select("product_id, balance"),
    supabase.from("products").select("product_id, name"),
    supabase.from("warehouse_stock").select("item_code, item_name, unit, qty").order("item_code"),
  ]);
  const nameMap = new Map<string, string>();
  for (const p of prods.data ?? []) nameMap.set(p.product_id as string, p.name as string);
  const liquor = (stockP.data ?? []).map((s) => ({
    itemCode: s.product_id as string,
    itemName: nameMap.get(s.product_id as string) ?? (s.product_id as string),
    category: "สุรา",
    unit: "ขวด",
    currentStock: Number(s.balance) || 0,
    isLive: true,
  }));
  const general = (wh.data ?? []).map((s) => ({
    itemCode: s.item_code as string,
    itemName: (s.item_name as string) ?? (s.item_code as string),
    category: "ทั่วไป",
    unit: (s.unit as string) ?? "",
    currentStock: Number(s.qty) || 0,
    isLive: false,
  }));
  return [...liquor, ...general].sort((a, b) => (a.itemCode < b.itemCode ? -1 : 1));
}

/** ประวัติเชื่อมระบบ (integration_log) — แทนหน้าคิว sync เดิม */
export async function getSyncHistory() {
  const supabase = await db();
  const { data } = await supabase
    .from("integration_log")
    .select("id, action, idempotency_key, status, message, created_at")
    .in("action", ["SELL_PRODUCT", "RECEIVE_REVENUE"])
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []).map((r) => ({
    id: r.id as number,
    action: r.action as string,
    key: (r.idempotency_key as string) ?? "",
    status: r.status as string,
    message: (r.message as string) ?? "",
    createdAt: r.created_at ? new Date(r.created_at as string).toLocaleString("th-TH") : "",
  }));
}

/** สถานะออเดอร์ปัจจุบัน (สำหรับ processOrder ฝั่ง action) */
export async function getOrderState(quNo: string): Promise<OrderState | null> {
  const supabase = await db();
  const { data } = await supabase
    .from("sales_orders")
    .select("qu_no, order_no, status, deposit, outstanding_balance, sub_total, discount, wht_percent, category, customer_name, customer_id, inv_no, tax_no1, tax_no2, dep_inv_no")
    .eq("qu_no", quNo)
    .maybeSingle();
  if (!data) return null;
  return {
    quNo: data.qu_no as string,
    orderNo: (data.order_no as string) ?? "",
    status: (data.status as string) ?? "",
    deposit: Number(data.deposit) || 0,
    outstandingBalance: Number(data.outstanding_balance) || 0,
    subTotal: Number(data.sub_total) || 0,
    discount: Number(data.discount) || 0,
    whtPercent: Number(data.wht_percent) || 0,
    category: (data.category as string) ?? "รายได้ค่าสินค้า",
    customerName: (data.customer_name as string) ?? "",
    invNo: (data.inv_no as string) ?? "",
    taxNo1: (data.tax_no1 as string) ?? "",
    taxNo2: (data.tax_no2 as string) ?? "",
    depInvNo: (data.dep_inv_no as string) ?? "",
  };
}

export async function getCustomerId(quNo: string): Promise<string | null> {
  const supabase = await db();
  const { data } = await supabase.from("sales_orders").select("customer_id").eq("qu_no", quNo).maybeSingle();
  return (data?.customer_id as string) ?? null;
}

// ── จัดการเมนูขาย (sale_menu CRUD) ───────────────────────────────────────────
export type SaleMenuRow = {
  id: number;
  menuName: string;
  price: number;
  category: string;
  productId: string;
  multiplier: number;
};

export async function getSaleMenuFull(): Promise<SaleMenuRow[]> {
  const supabase = await db();
  const { data } = await supabase.from("sale_menu").select("id, menu_name, price, category, product_id, multiplier").order("menu_name");
  return (data ?? []).map((m) => ({
    id: m.id as number,
    menuName: m.menu_name as string,
    price: Number(m.price) || 0,
    category: (m.category as string) ?? "",
    productId: (m.product_id as string) ?? "",
    multiplier: Number(m.multiplier) || 1,
  }));
}

/** ตัวเลือก product_id: สินค้าผลิต (products) + รหัสสต็อกทั่วไป (warehouse_stock) */
export async function getMenuLinkOptions() {
  const supabase = await db();
  const [prods, wh] = await Promise.all([
    supabase.from("products").select("product_id, name").order("product_id"),
    supabase.from("warehouse_stock").select("item_code, item_name").order("item_code"),
  ]);
  return {
    products: (prods.data ?? []).map((p) => ({ id: p.product_id as string, name: p.name as string })),
    warehouse: (wh.data ?? []).map((w) => ({ id: w.item_code as string, name: (w.item_name as string) ?? "" })),
  };
}
