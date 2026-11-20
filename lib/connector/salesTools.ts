import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { mapDbError } from "@/lib/shared/dbError";
import { bangkokDateISO } from "@/lib/shared/datetime";
import { menuWithStock } from "@/lib/sales/menuStock";
import { loadPlansFor, orderItemsFor, mapPayment, PAYMENT_COLS, warehouseStockFor } from "@/lib/sales/orderLoaders";
import { loadRevenueConfig, resolveSalesVat, posSaleCore } from "@/lib/sales/orderCore";
import { POS_METHODS } from "@/lib/sales/pos";
import { checkPos, posDocTitle, posDoneText, type PosCardData, type PosItemArg } from "./pos";
import { dateArg, money } from "./reports";
import type { ConnectorAccess } from "./access";
import type { ConnectorMe } from "./session";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * เครื่องมือฝั่งขายของ Claude connector (D172)
 *
 * ★ อ่านอย่างเดียว (sales.read): ลูกค้า · เมนู+สต็อก · ค้นออเดอร์ · ดูออเดอร์ · ลูกหนี้ค้าง · สต็อก
 * ★ ขายหน้าร้าน (sales.write): pos_preview แสดงการ์ด → ผู้ใช้กดขายในการ์ด → pos_sell (visibility: app)
 * 🚨 pos_sell เรียก `posSaleCore()` ตัวเดียวกับปุ่มขายหน้าร้านในแอป (lib/sales/orderCore)
 *    ⇒ เลขเอกสาร · ถอด VAT · ลงบัญชี · ตัดสต็อก/ฟอร์ม ภส. เส้นทางเดียวกันทุกบรรทัด (D86)
 * 🚨 ไม่ส่ง LINE จาก connector — lib/line ใช้ service role ซึ่งเส้นทางนี้ห้ามแตะ (connectorRoute.test.ts)
 * 🚨 ไม่มีเครื่องมือ ยกเลิก/ใบลดหนี้/ยืนยันจัดส่ง/แก้วิธีชำระ — ทำในแอปเท่านั้น
 */

/** ต้องตรงกับ BILL_CARD_URI ใน tools.ts (การ์ดชุดเดียว · เทสเทียบ) — ประกาศซ้ำกัน import วนกัน */
export const POS_CARD_URI = "ui://insep-erp/bill-card";

type Ctx = { db: SupabaseClient; me: ConnectorMe };

const text = (s: string, isError = false) => ({ content: [{ type: "text" as const, text: s }], ...(isError ? { isError: true } : {}) });
const json = (o: unknown) => text(JSON.stringify(o, null, 2));

export const ORDER_ROW_CAP = 100;

export const SALES_INSTRUCTIONS = (a: ConnectorAccess) => `Sales module (orders, receivables, stock${a.salesWrite ? ", shop sales" : ""}):
- If you have not yet, call who_am_i once per conversation and tell the user which customer (tenant) you are connected to.
- find_customer looks up customers (and the default walk-in customer for shop sales). sales_menu lists sellable items with
  price and stock left (in selling units). stock_levels lists stock of every product.
- search_orders finds orders by customer, status or date; get_order shows one order in full (items, payments, installments,
  documents issued). receivables lists money customers still owe. Quote these numbers; never compute them yourself.
  Orders in status รอคอนเฟิร์ม are only quotations: never call them debts.
${a.salesWrite ? `- Shop sale (sell goods now, cut stock, issue the receipt/tax invoice, record income): call pos_preview with the exact menu names
  from sales_menu and quantities. It shows the user a card; the user picks the payment method and presses ขาย in the card.
  You cannot sell: pos_sell is only available to the card. Sale date is always today (back-dated sales: in the app).
  When the user tells you they SOLD products from the sales menu, use pos_preview — NOT preview_bill with type รายรับ
  (that would record income without cutting stock or issuing the sales document). If unsure, ask.
- Cancelling orders, credit notes, confirming warehouse shipping and editing payments are done in the app only.` : "- This account cannot sell (no sales write permission)."}`;

function customerOnly(c: { contact_type?: unknown; roles?: unknown }) {
  const roles = (c.roles as string[]) ?? [];
  if (roles.includes("ลูกค้า")) return true;
  return ((c.contact_type as string) ?? "") !== "ผู้ขาย";
}

/** ช่วงวันที่ (เวลาไทย) → ขอบ timestamptz */
const dayStart = (d: string) => `${d}T00:00:00+07:00`;
const nextDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

const ORDER_LIST_COLS =
  "qu_no, order_no, created_at, customer_id, customer_name, grand_total, net_payable, outstanding_balance, status, due_date, inv_no, tax_no1, tax_no2, rcpt_no1, rcpt_no2, dep_inv_no, dep_due_date, remarks";

function orderSummary(r: Record<string, unknown>) {
  return {
    qu_no: r.qu_no,
    order_no: r.order_no || null,
    created_on: r.created_at ? bangkokDateISO(new Date(String(r.created_at))) : null,
    customer: r.customer_name,
    status: r.status,
    grand_total: money(r.grand_total),
    net_payable: money(Number(r.net_payable) || Number(r.grand_total)),
    outstanding: money(r.outstanding_balance),
    documents: [r.inv_no, r.dep_inv_no, r.tax_no1, r.tax_no2, r.rcpt_no1, r.rcpt_no2].filter(Boolean),
  };
}

/** ข้อมูลที่ pos_preview / pos_sell ต้องใช้ — อ่านด้วยสิทธิ์ผู้ใช้ */
async function posContext({ db }: Ctx) {
  const [menu, stockP, wh, st] = await Promise.all([
    db.from("sale_menu").select("menu_name, price, category, product_id, multiplier").order("menu_name"),
    db.from("stock_product").select("product_id, balance"),
    db.from("warehouse_stock").select("item_code, qty"),
    db.from("app_settings").select("kind, value").eq("kind", "pos_walkin_contact"),
  ]);
  const bad = menu.error ?? stockP.error ?? wh.error ?? st.error;
  if (bad) return "อ่านเมนู/สต็อกไม่สำเร็จ: " + mapDbError(bad);
  // ★ ตรวจค่าตั้งการรับรายได้ก่อนเปิดการ์ด — ไม่งั้นกดขายแล้วได้ใบเสนอราคาค้างครึ่งทาง
  const config = await loadRevenueConfig(db);
  if (!config.entityId || !config.accountName) {
    return "ยังไม่ได้ตั้งกิจการ/บัญชีที่รับรายได้จากการขาย — ไปที่ ตั้งค่า → กิจการ → การ์ด “กิจการและบัญชีที่รับรายได้จากการขาย” (ต้องเป็นเจ้าของกิจการ)";
  }
  const vat = await resolveSalesVat(db, config.entityId);
  if ("conflict" in vat) return vat.conflict;
  return {
    menu: menuWithStock(menu.data ?? [], stockP.data ?? [], wh.data ?? []),
    walkinId: String(st.data?.[0]?.value ?? ""),
    isVat: vat.isVat,
  };
}

async function buildPosCard(
  ctx: Ctx,
  a: { customer_id?: string; items: PosItemArg[]; discount?: number; method?: string },
  previewedAt?: string,
): Promise<PosCardData | string> {
  const pc = await posContext(ctx);
  if (typeof pc === "string") return pc;
  const custId = (a.customer_id ?? "").trim() || pc.walkinId;
  if (!custId) return "ยังไม่ได้ระบุลูกค้า และยังไม่ได้ตั้ง “ลูกค้าทั่วไป” ของขายหน้าร้าน — ใช้ find_customer หา customer_id หรือตั้งลูกค้าทั่วไปที่แท็บขายหน้าร้านในแอป";
  const c = await ctx.db.from("contacts").select("contact_id, name").eq("contact_id", custId).maybeSingle();
  if (c.error) return "อ่านทะเบียนลูกค้าไม่สำเร็จ: " + mapDbError(c.error);
  if (!c.data) return `ไม่พบลูกค้า ${custId} ในทะเบียน — ใช้ find_customer`;
  const method = a.method ?? "เงินสด";
  const ck = checkPos(a.items, pc.menu, { discount: a.discount, method, isVat: pc.isVat });
  // 🔴 D177 — เวลาเปิดการ์ดต้องเป็น **นาฬิกาของ DB** ตัวเดียวกับ sales_orders.created_at
  //    เดิมใช้ new Date() ของ server แอป · นาฬิกาเครื่องเร็วกว่า DB 2 วินาที = ออเดอร์ที่เพิ่งขาย
  //    มีเวลาก่อน previewed_at ⇒ ด่าน "การ์ดนี้ขายไปแล้ว" มองไม่เห็น = กดการ์ดเดิมแล้วขายซ้ำ (test:tenant จับได้)
  let openedAt = previewedAt;
  if (!openedAt) {
    const t = await ctx.db.rpc("ping");
    if (t.error || !t.data) return "อ่านเวลาของระบบไม่สำเร็จ — ลองใหม่อีกครั้ง";
    openedAt = new Date(String(t.data)).toISOString();
  }
  return {
    card: "pos",
    tenant_slug: ctx.me.tenantSlug,
    previewed_at: openedAt,
    sale_date: bangkokDateISO(),
    customer: { id: String(c.data.contact_id), name: String(c.data.name ?? "") },
    items: a.items,
    lines: ck.lines,
    discount: Number(a.discount) || 0,
    totals: {
      grand_incl: ck.totals.grandIncl,
      before_vat: ck.totals.subDiscount,
      vat: ck.totals.vatAmount,
      grand_total: ck.totals.grandTotal,
    },
    is_vat: pc.isVat,
    doc_title: posDocTitle(pc.isVat),
    method,
    methods: [...POS_METHODS],
    errors: ck.errors,
    warnings: ck.warnings,
  };
}

const posItemShape = z.object({
  menu: z.string().describe("Exact menu name from sales_menu"),
  quantity: z.number().describe("Number of selling units (whole number)"),
});
const posShape = {
  customer_id: z.string().optional().describe("contact_id from find_customer · omit = the default walk-in customer"),
  items: z.array(posItemShape).min(1).max(50),
  discount: z.number().optional().describe("Bill discount in baht (same basis as menu prices — prices include VAT when VAT registered)"),
  method: z.enum(POS_METHODS).optional().describe("Payment method · omit = เงินสด (the user can change it in the card)"),
};

export function registerSalesTools(server: McpServer, ctx: Ctx): void {
  const { db, me } = ctx;

  server.registerTool(
    "find_customer",
    {
      title: "ค้นลูกค้า",
      description: "Find customers by name, tax ID or phone (empty query = first 30). Also returns the default walk-in customer used for shop sales.",
      inputSchema: { query: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const [cs, st] = await Promise.all([
        db.from("contacts").select("contact_id, name, tax_id, branch, phone, contact_type, roles").order("name"),
        db.from("app_settings").select("value").eq("kind", "pos_walkin_contact").limit(1),
      ]);
      if (cs.error || st.error) return text("อ่านทะเบียนลูกค้าไม่สำเร็จ: " + mapDbError(cs.error ?? st.error), true);
      const q = String(a.query ?? "").trim().toLowerCase();
      const rows = (cs.data ?? []).filter(customerOnly).filter((c) =>
        !q || [c.name, c.tax_id, c.phone].some((v) => String(v ?? "").toLowerCase().includes(q)),
      );
      const walk = String(st.data?.[0]?.value ?? "");
      return json({
        customers: rows.slice(0, 30).map((c) => ({ contact_id: c.contact_id, name: c.name, tax_id: c.tax_id || null, branch: c.branch || null, phone: c.phone || null })),
        more: Math.max(0, rows.length - 30),
        walk_in_customer: walk ? (cs.data ?? []).find((c) => c.contact_id === walk)?.name ?? walk : null,
        walk_in_customer_id: walk || null,
      });
    },
  );

  server.registerTool(
    "sales_menu",
    {
      title: "เมนูขาย + สต็อก",
      description: "Sales menu items with price and stock left in selling units (null = unknown). sellable_at_shop=false means the item is not linked to stock and cannot be sold through pos_preview.",
      inputSchema: { query: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const [menu, stockP, wh] = await Promise.all([
        db.from("sale_menu").select("menu_name, price, category, product_id, multiplier").order("menu_name"),
        db.from("stock_product").select("product_id, balance"),
        db.from("warehouse_stock").select("item_code, qty"),
      ]);
      const bad = menu.error ?? stockP.error ?? wh.error;
      if (bad) return text("อ่านเมนู/สต็อกไม่สำเร็จ: " + mapDbError(bad), true);
      const q = String(a.query ?? "").trim().toLowerCase();
      const rows = menuWithStock(menu.data ?? [], stockP.data ?? [], wh.data ?? []).filter((m) => !q || m.name.toLowerCase().includes(q));
      return json({
        items: rows.map((m) => ({ name: m.name, price: m.price, category: m.category || null, stock_left: m.stockQty, sellable_at_shop: m.itemCode !== "" })),
      });
    },
  );

  server.registerTool(
    "stock_levels",
    {
      title: "สต็อกสินค้า",
      description: "Current stock of every product (liquor from the production stock, other goods from the warehouse), in base units.",
      inputSchema: { query: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        const q = String(a.query ?? "").trim().toLowerCase();
        const rows = (await warehouseStockFor(db)).filter((r) => !q || `${r.itemCode} ${r.itemName}`.toLowerCase().includes(q));
        return json({ items: rows.map((r) => ({ code: r.itemCode, name: r.itemName, category: r.category, unit: r.unit, stock: r.currentStock })) });
      } catch (e) {
        return text((e as Error).message, true);
      }
    },
  );

  server.registerTool(
    "search_orders",
    {
      title: "ค้นออเดอร์ขาย",
      description: `Find sales orders by customer name, status, order/quotation number or creation date range (Gregorian YYYY-MM-DD). Newest first, at most ${ORDER_ROW_CAP}.`,
      inputSchema: {
        customer: z.string().optional(),
        status: z.string().optional().describe("Exact status, e.g. รอคอนเฟิร์ม, รอคลังจัดส่ง, ส่งของแล้วรอชำระเงิน, ปิดการขาย, ยกเลิก"),
        number: z.string().optional().describe("Part of a QU/order/document number"),
        from: z.string().optional(),
        to: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const from = a.from ? dateArg(a.from) : null;
      const to = a.to ? dateArg(a.to) : null;
      if ((a.from && !from) || (a.to && !to)) return text("วันที่ต้องเป็น ค.ศ. YYYY-MM-DD", true);
      let q = db.from("sales_orders").select(ORDER_LIST_COLS).order("created_at", { ascending: false }).order("qu_no", { ascending: false }).limit(ORDER_ROW_CAP + 1);
      if (a.customer?.trim()) q = q.ilike("customer_name", `%${a.customer.trim().replace(/[\\%_]/g, (m) => "\\" + m)}%`);
      if (a.status?.trim()) q = q.eq("status", a.status.trim());
      if (from) q = q.gte("created_at", dayStart(from));
      if (to) q = q.lt("created_at", dayStart(nextDay(to)));
      if (a.number?.trim()) {
        const n = a.number.trim().replace(/[,()%_\\]/g, "");
        q = q.or(["qu_no", "order_no", "inv_no", "tax_no1", "tax_no2", "rcpt_no1", "rcpt_no2"].map((c) => `${c}.ilike.%${n}%`).join(","));
      }
      const r = await q;
      if (r.error) return text("ค้นออเดอร์ไม่สำเร็จ: " + mapDbError(r.error), true);
      const rows = r.data ?? [];
      return json({
        orders: rows.slice(0, ORDER_ROW_CAP).map((x) => orderSummary(x as Record<string, unknown>)),
        truncated: rows.length > ORDER_ROW_CAP ? `มีมากกว่า ${ORDER_ROW_CAP} รายการ — แคบช่วงค้นหา` : null,
      });
    },
  );

  server.registerTool(
    "get_order",
    {
      title: "ดูออเดอร์",
      description: "One sales order in full: header, items, every payment received, installment plan and documents issued.",
      inputSchema: { qu_no: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const quNo = a.qu_no.trim();
      const h = await db.from("sales_orders").select(`${ORDER_LIST_COLS}, sub_total, discount, vat_amount, wht_percent, wht_amount, deposit, payment_method, sale_name, category`).eq("qu_no", quNo).maybeSingle();
      if (h.error) return text("อ่านออเดอร์ไม่สำเร็จ: " + mapDbError(h.error), true);
      if (!h.data) return text(`ไม่พบออเดอร์ ${quNo}`, true);
      try {
        const [items, pays, plans] = await Promise.all([
          orderItemsFor(db, quNo),
          db.from("sales_payments").select(PAYMENT_COLS).eq("qu_no", quNo).order("seq"),
          loadPlansFor(db, [quNo]),
        ]);
        if (pays.error) return text("อ่านการรับเงินไม่สำเร็จ: " + mapDbError(pays.error), true);
        const r = h.data as Record<string, unknown>;
        return json({
          ...orderSummary(r),
          sale_name: r.sale_name || null,
          category: r.category,
          remarks: r.remarks || null,
          before_vat: money(Number(r.sub_total) - Number(r.discount)),
          vat: money(r.vat_amount),
          wht: money(r.wht_amount),
          received: money(r.deposit),
          items: items.map((i) => ({ name: i.name, quantity: i.qty, unit_price: i.price, line_total: money(i.qty * i.price) })),
          payments: (pays.data ?? []).map((p) => {
            const m = mapPayment(p as Record<string, unknown>);
            return { seq: m.seq, label: m.label, amount: money(m.amount), method: m.method, date: m.docDate || null, doc_no: m.docNo || null };
          }),
          installments: (plans.plans.get(quNo) ?? []).map((i) => ({ seq: i.seq, label: i.label, amount: money(i.amount), due_date: i.dueDate || null, invoice_no: i.invNo || null, paid: i.paid })),
        });
      } catch (e) {
        return text((e as Error).message, true);
      }
    },
  );

  server.registerTool(
    "receivables",
    {
      title: "ลูกหนี้ค้าง",
      description: "Money customers still owe on sales orders, oldest first, with due dates and the next unpaid installment. Quotations not yet confirmed (รอคอนเฟิร์ม) are listed separately and are NOT debts.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const r = await db.from("sales_orders").select(ORDER_LIST_COLS).gt("outstanding_balance", 0).neq("status", "ยกเลิก").order("created_at");
      if (r.error) return text("อ่านยอดค้างไม่สำเร็จ: " + mapDbError(r.error), true);
      const rows = (r.data ?? []) as Record<string, unknown>[];
      const owedRows = rows.filter((x) => x.status !== "รอคอนเฟิร์ม");
      let plans: Awaited<ReturnType<typeof loadPlansFor>>["plans"];
      try {
        plans = (await loadPlansFor(db, owedRows.map((x) => String(x.qu_no)))).plans;
      } catch (e) {
        return text((e as Error).message, true);
      }
      const today = bangkokDateISO();
      const owed = owedRows.map((x) => {
        const next = (plans.get(String(x.qu_no)) ?? []).find((i) => !i.paid);
        const due = (next?.dueDate || (x.status === "รอชำระมัดจำ" ? x.dep_due_date : x.due_date) || "") as string;
        return {
          ...orderSummary(x),
          due_date: due ? String(due).slice(0, 10) : null,
          overdue: due ? String(due).slice(0, 10) < today : null,
          next_installment: next ? { seq: next.seq, label: next.label, amount: money(next.amount), invoice_no: next.invNo || null } : null,
        };
      });
      return json({
        today,
        total_owed: money(owed.reduce((s, o) => s + o.outstanding, 0)),
        owed,
        quotations_not_confirmed: rows.filter((x) => x.status === "รอคอนเฟิร์ม").map((x) => orderSummary(x)),
      });
    },
  );

  if (!me.access.salesWrite) return;

  registerAppTool(
    server,
    "pos_preview",
    {
      title: "ขายหน้าร้าน — ตรวจก่อนขาย",
      description: "Show the user a shop-sale card (sell now: cut stock, issue the receipt/tax invoice, record income) WITHOUT selling. The user picks the payment method and presses ขาย in the card.",
      inputSchema: posShape,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: POS_CARD_URI } },
    },
    async (a) => {
      const card = await buildPosCard(ctx, a);
      if (typeof card === "string") return text(card, true);
      return {
        ...json({ ok: card.errors.length === 0, errors: card.errors, warnings: card.warnings, customer: card.customer.name, total: card.totals.grand_total, document: card.doc_title }),
        structuredContent: card,
      };
    },
  );

  // 🚨 ขายได้จากการ์ดทางเดียว (visibility: app) — การกดปุ่มในการ์ดคือการยืนยันของผู้ใช้
  registerAppTool(
    server,
    "pos_sell",
    {
      title: "ขายหน้าร้าน (การ์ด)",
      description: "Sell (called by the shop-sale card when the user presses ขาย). tenant_slug must equal who_am_i.tenant_slug.",
      inputSchema: {
        ...posShape,
        tenant_slug: z.string(),
        previewed_at: z.string().describe("previewed_at from the card — guards against selling the same card twice"),
        expected_total: z.number().describe("grand total shown on the card — refuses if prices changed since"),
        method: z.enum(POS_METHODS),
      },
      _meta: { ui: { resourceUri: POS_CARD_URI, visibility: ["app"] } },
    },
    async (a) => {
      if (String(a.tenant_slug ?? "").trim().toLowerCase() !== me.tenantSlug.toLowerCase()) {
        return text(`ไม่ขาย: tenant_slug "${a.tenant_slug}" ไม่ตรงกับบัญชีที่เชื่อมต่ออยู่ (${me.tenantSlug})`, true);
      }
      // ★ คิดใหม่ทั้งหมดจาก DB — ไม่เชื่อยอด/ราคาที่การ์ดส่งมา
      const card = await buildPosCard(ctx, a, a.previewed_at);
      if (typeof card === "string") return text(card, true);
      if (card.errors.length) return text("ไม่ขาย: " + card.errors.join(" · "), true);
      // 🚨 ราคาเมนูเปลี่ยนระหว่างเปิดการ์ดกับกดขาย = ยอดที่ผู้ใช้เห็นไม่ใช่ยอดที่จะขาย
      if (Math.abs(card.totals.grand_total - Number(a.expected_total)) > 0.005) {
        return text(`ไม่ขาย: ยอดเปลี่ยนจาก ${a.expected_total} เป็น ${card.totals.grand_total} (ราคาเมนูถูกแก้หลังเปิดการ์ด) — ให้ Claude เปิดการ์ดใหม่`, true);
      }

      // 🚨 การ์ดเดิมถูกกดซ้ำ (เปิดแชทใหม่แล้วการ์ดกลับมาพร้อมปุ่ม) = ขายซ้ำ
      //    ออเดอร์หน้าร้านของลูกค้า+ยอดเดียวกันที่สร้างหลังเปิดการ์ดนี้ = การ์ดนี้ขายไปแล้ว
      const since = new Date(a.previewed_at);
      if (Number.isNaN(since.getTime())) return text("ไม่ขาย: previewed_at ไม่ถูกต้อง — ให้ Claude เปิดการ์ดใหม่", true);
      const dup = await db
        .from("sales_orders")
        .select("qu_no, order_no, status")
        .eq("customer_id", card.customer.id)
        .eq("grand_total", card.totals.grand_total)
        .eq("remarks", "ขายหน้าร้าน")
        .neq("status", "ยกเลิก")
        .gte("created_at", since.toISOString())
        .limit(1);
      if (dup.error) return text("ตรวจการขายซ้ำไม่สำเร็จ: " + mapDbError(dup.error), true);
      if (dup.data?.length) {
        const d = dup.data[0];
        return text(`การ์ดนี้ขายไปแล้ว — ออเดอร์ ${d.order_no || d.qu_no} (${d.status}) · ถ้าจะขายอีกบิล ให้ Claude เปิดการ์ดใหม่`, true);
      }

      const res = await posSaleCore(
        db,
        {
          customer: card.customer,
          items: card.lines.map((l) => ({ name: l.name, price: l.price, qty: l.qty })),
          discount: card.discount,
          method: a.method,
        },
        me.displayName || me.username,
      );
      if (!res.ok) return text(res.error, true);
      const docNo = res.data.taxNo1 || res.data.rcptNo1 || "";
      const sc = {
        sold: true,
        order_no: res.data.orderNo,
        qu_no: res.data.quNo,
        doc_no: docNo,
        doc_title: card.doc_title,
        warning: res.data.warning,
        stock_after: res.data.summary,
        message: posDoneText({ order_no: res.data.orderNo, doc_no: docNo, doc_title: card.doc_title }),
      };
      return { ...json(sc), structuredContent: sc };
    },
  );
}
