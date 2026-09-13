import "server-only";
import { createClient } from "@/lib/supabase/server";
import { mustRead } from "@/lib/shared/dbError";
import { can, toRole } from "@/lib/shared/roles";
import { unpostedDays, type UnpostedDay } from "@/lib/bar/posting";
import { defaultLayout, type ReceiptLayout } from "@/lib/bar/layout";
import { businessDate } from "@/lib/bar/businessDate";
import { taxAccountsAreDefault } from "@/lib/accounting/taxAccounts";
import { getTenantPlan } from "@/lib/shared/tenant-plan";
import { hasModule } from "@/lib/shared/workspaces";
import type { BarCategory, BarItem, BarMenu, SaleWindow } from "@/lib/bar/types";
import type { PromptPayType } from "@/lib/bar/promptpay";

/**
 * ชั้นอ่านข้อมูลของโมดูลบาร์ (D96)
 *
 * 🚨 **กติกาเหล็กข้อ 1: ห้ามแตะตารางฝั่งผลิต/ขายแม้แถวเดียว**
 *    `lib/bar/isolation.test.ts` อ่านไฟล์นี้เป็นข้อความมาตรวจ
 *
 * 🚨 **ต้นทุน/กำไรห้ามหลุดไปที่ client ของพนักงานบาร์**
 *    RLS ซ่อนได้แค่ "แถว" ไม่ได้ซ่อน "คอลัมน์" → ต้องตัดที่นี่ ไม่ใช่ซ่อนด้วย CSS
 *    (ดู `stripCost()` ท้ายไฟล์ · เป็นกติกาความเป็นส่วนตัวระดับหน้าจอ
 *     ไม่ใช่ขอบเขตความปลอดภัยระดับ DB — คนที่ตั้งใจยิง API ตรงยังอ่านได้)
 *
 * 🚨 อ่านไม่สำเร็จต้องฟ้อง ไม่ใช่คืนลิสต์ว่าง (D89) → ใช้ `mustRead()` ทุกจุด
 */

export type BarSaleLine = {
  lineNo: number;
  menuId: string | null;
  menuName: string;
  qty: number;
  price: number;
  lineDiscount: number;
  /** % ที่ผู้ใช้กรอก — คำอธิบายเท่านั้น ตัวเงินคือ `lineDiscount` (D96) */
  lineDiscountPct: number | null;
  isComp: boolean;
  amount: number;
  voidedAt: string | null;
};

export type BarOpenSale = {
  saleNo: string;
  tabName: string | null;
  customerId: string | null;
  channel: string;
  openedAt: string;
  lines: BarSaleLine[];
};

export type BarCustomerRow = {
  customerId: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  taxId: string | null;
  branch: string | null;
  address: string | null;
  note: string | null;
};

export type BarSettings = {
  entityId: string;
  promptPayType: PromptPayType;
  promptPayId: string;
  channels: string[];
  window: SaleWindow;
  roundCash: boolean;
  blockNegative: boolean;
  footer: string;
  revenueAccount: string;
  incomeCat: string;
};

export type BarSeller = {
  name: string;
  address: string | null;
  taxId: string | null;
  branch: string | null;
  phone: string | null;
  isVat: boolean;
};

export type BarBoot = {
  role: string;
  userName: string;
  /** กิจการที่บาร์ใช้ — ว่าง = ยังไม่ได้ตั้ง (หน้าขายต้องบอกให้ไปตั้งก่อน) */
  entityId: string;
  entityOptions: { id: string; name: string }[];
  seller: BarSeller | null;
  settings: BarSettings;
  categories: BarCategory[];
  menus: BarMenu[];
  items: BarItem[];
  customers: BarCustomerRow[];
  openSales: BarOpenSale[];
  /**
   * บัญชีเงินที่เลือกให้รายได้บาร์เข้าได้ (D96 เฟส E)
   * `countedInTax` = บัญชีนี้ถูกนับเข้า ภพ.30 หรือยัง
   * 🚨 ต้องรู้ตรงนี้ เพราะเลือกบัญชีที่ไม่ถูกนับ = **ยอดบาร์หายจาก ภพ.30 ทั้งที่ลงบัญชีสำเร็จ**
   *    (`passesTaxGuard()` ของ lib/accounting/calc กรองด้วย `taxAccounts.has(account_name)`)
   */
  bankAccounts: { name: string; countedInTax: boolean }[];
  /** ซื้อโมดูลบัญชีไว้ไหม — ไม่ได้ซื้อ = ซ่อนทั้งการ์ดลงบัญชี (บาร์ต้องขายแยกได้) */
  hasAccounting: boolean;
  /** วันที่ขายแล้วแต่ยังไม่ได้ลงบัญชี — **ไม่รวมวันขายของตอนนี้** (ยังขายอยู่) */
  unposted: UnpostedDay[];
  /** ผังหน้าตาบิลที่ผู้ใช้จัดเอง (D96 เฟส G) */
  layout: ReceiptLayout;
  /** เห็นต้นทุน/กำไรไหม — ตัดสินจาก cap ไม่ใช่ชื่อบทบาท */
  canSeeCost: boolean;
  canWrite: boolean;
  canConfig: boolean;
};

const DEFAULT_SETTINGS = (entityId: string): BarSettings => ({
  entityId,
  promptPayType: "mobile",
  promptPayId: "",
  channels: [],
  window: { start: "00:00", end: "00:00" },
  roundCash: false,
  blockNegative: false,
  footer: "",
  revenueAccount: "",
  incomeCat: "",
});

/**
 * อ่านผังหน้าตาบิลจาก JSON ที่บันทึกไว้
 * 🚨 **JSON พังต้องไม่ทำให้พิมพ์บิลไม่ได้ทั้งร้าน** — ตกกลับไปใช้ผังปริยายเงียบ ๆ
 *    (ตัว `resolveLayout()` ทนคีย์แปลก/คีย์ขาดอยู่แล้วอีกชั้น)
 */
function readLayout(raw: string): ReceiptLayout {
  if (!raw) return defaultLayout();
  try {
    return { ...defaultLayout(), ...(JSON.parse(raw) as Partial<ReceiptLayout>) };
  } catch {
    return defaultLayout();
  }
}

export async function getBarBootstrap(): Promise<BarBoot> {
  const supabase = await createClient();

  const [{ data: user }, settingRows, entityRows] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("app_settings").select("kind, value"),
    supabase.from("entities").select("entity_id, name, address, tax_id, branch, phone, is_vat"),
  ]);

  let role = "viewer";
  let userName = "";
  if (user.user) {
    const { data: p } = await supabase
      .from("profiles")
      .select("role, display_name, username")
      .eq("id", user.user.id)
      .single();
    role = (p?.role as string) ?? "viewer";
    userName = p?.display_name ?? p?.username ?? "";
  }
  const r = toRole(role);

  const rows = mustRead({ data: settingRows.data, error: settingRows.error }, "ค่าตั้งค่า");
  const one = (kind: string) => rows.find((x) => x.kind === kind)?.value ?? "";
  const many = (kind: string) => rows.filter((x) => x.kind === kind).map((x) => x.value as string);

  const entities = mustRead({ data: entityRows.data, error: entityRows.error }, "กิจการ");
  const entityId = one("bar_entity") as string;

  const settings: BarSettings = {
    ...DEFAULT_SETTINGS(entityId),
    promptPayType: ((one("bar_promptpay_type") as string) || "mobile") as PromptPayType,
    promptPayId: one("bar_promptpay_id") as string,
    channels: many("bar_channels"),
    window: {
      start: (one("bar_day_start") as string) || "00:00",
      end: (one("bar_day_end") as string) || "00:00",
    },
    roundCash: one("bar_round_cash") === "1",
    blockNegative: one("bar_block_negative") === "1",
    footer: one("bar_receipt_footer") as string,
    revenueAccount: one("bar_revenue_account") as string,
    incomeCat: one("bar_income_cat") as string,
  };

  const entityOptions = entities.map((e) => ({ id: e.entity_id as string, name: e.name as string }));
  const ent = entities.find((e) => e.entity_id === entityId);
  const seller: BarSeller | null = ent
    ? {
        name: ent.name as string,
        address: (ent.address as string) ?? null,
        taxId: (ent.tax_id as string) ?? null,
        branch: (ent.branch as string) ?? null,
        phone: (ent.phone as string) ?? null,
        isVat: Boolean(ent.is_vat),
      }
    : null;

  const base: BarBoot = {
    role,
    userName,
    entityId,
    entityOptions,
    seller,
    settings,
    categories: [],
    menus: [],
    items: [],
    customers: [],
    openSales: [],
    bankAccounts: [],
    hasAccounting: false,
    unposted: [],
    layout: readLayout(one("bar_receipt_layout") as string),
    canSeeCost: can(r, "bar.config"),
    canWrite: can(r, "bar.write"),
    canConfig: can(r, "bar.config"),
  };

  // ★ ยังไม่ได้ตั้งกิจการ = ไม่มีอะไรให้โหลด · หน้าขายจะขึ้นข้อความบอกให้ไปตั้งก่อน
  //   🚨 **ห้ามเดาว่าเป็นกิจการหลัก** — บาร์เป็นรายได้ของอีกกิจการหนึ่ง
  //      เดาผิดแล้วยอดขายทั้งคืนไปลงบัญชีโรงกลั่น (ตระกูล D79)
  if (!entityId) return base;

  const [cats, menus, recipes, items, customers, sales] = await Promise.all([
    supabase.from("bar_category").select("category_id, name, sort, is_system")
      .eq("entity_id", entityId).order("sort"),
    supabase
      .from("bar_menu")
      .select("menu_id, name, price, fixed_cost, category_id, method, glass, note, created_for, active, sort")
      .eq("entity_id", entityId),
    supabase.from("bar_recipe").select("menu_id, item_id, qty").eq("entity_id", entityId),
    supabase
      .from("bar_item")
      .select("item_id, name, unit, qty, cost_per_unit, pack_size, pack_label, low_qty, active")
      .eq("entity_id", entityId)
      .order("name"),
    supabase
      .from("bar_customer")
      .select("customer_id, name, nickname, phone, tax_id, branch, address, note")
      .eq("entity_id", entityId)
      .eq("active", true)
      .order("name"),
    supabase
      .from("bar_sale")
      .select("sale_no, tab_name, customer_id, channel, opened_at")
      .eq("entity_id", entityId)
      .eq("status", "เปิดอยู่")
      .order("opened_at"),
  ]);

  /**
   * ── ของฝั่ง "ลงบัญชี" (D96 เฟส E) ────────────────────────────────────────
   * 🚨 อ่านแยกจากบล็อกหลักโดยตั้งใจ — บาร์ต้องเปิดใช้ได้แม้ไม่ได้ซื้อโมดูลบัญชี
   *    ⇒ ถ้าไม่ได้ซื้อ ไม่ต้องยิง query พวกนี้เลย
   */
  const plan = await getTenantPlan();
  const hasAccounting = hasModule(plan.modules, "accounting");
  let bankAccounts: BarBoot["bankAccounts"] = [];
  let unposted: UnpostedDay[] = [];
  if (hasAccounting) {
    const [banks, closed, posts] = await Promise.all([
      supabase.from("bank_accounts").select("account_name, entity_ids").order("account_name"),
      supabase
        .from("bar_sale")
        .select("business_date, grand_total")
        .eq("entity_id", entityId)
        .eq("status", "ปกติ")
        .not("business_date", "is", null),
      supabase
        .from("bar_post")
        .select("post_date")
        .eq("entity_id", entityId)
        .eq("status", "ปกติ"),
    ]);

    const bankRows = mustRead({ data: banks.data, error: banks.error }, "บัญชีเงิน");
    // ★ กรองบัญชีที่ผูกกับกิจการของบาร์ · `entity_ids` ว่าง = ใช้ได้ทุกกิจการ (กติกาเดิมของ 0001)
    const forBar = bankRows.filter((b) => {
      const ids = (b.entity_ids as string[] | null) ?? [];
      return ids.length === 0 || ids.includes(entityId);
    });
    const savedTax = many("tax_account");
    // 🚨 ไม่ได้ตั้ง = **นับทุกบัญชี** ไม่ใช่ไม่นับอะไรเลย (กติกา D93 · effectiveTaxAccounts)
    const allCounted = taxAccountsAreDefault(savedTax);
    const taxSet = new Set(savedTax.map((x) => String(x ?? "").trim()).filter(Boolean));
    bankAccounts = forBar.map((b) => ({
      name: b.account_name as string,
      countedInTax: allCounted || taxSet.has(b.account_name as string),
    }));

    unposted = unpostedDays(
      mustRead({ data: closed.data, error: closed.error }, "บิลที่ปิดแล้ว").map((x) => ({
        businessDate: (x.business_date as string) ?? "",
        grandTotal: Number(x.grand_total) || 0,
      })),
      mustRead({ data: posts.data, error: posts.error }, "การลงบัญชี").map((x) => x.post_date as string),
      businessDate(new Date(), settings.window),
    );
  }

  const recipeRows = mustRead({ data: recipes.data, error: recipes.error }, "สูตรเมนู");
  const byMenu = new Map<string, { itemId: string; qty: number }[]>();
  for (const x of recipeRows) {
    const k = x.menu_id as string;
    const list = byMenu.get(k);
    const line = { itemId: x.item_id as string, qty: Number(x.qty) };
    if (list) list.push(line);
    else byMenu.set(k, [line]);
  }

  const openSaleRows = mustRead({ data: sales.data, error: sales.error }, "บิลที่เปิดอยู่");
  let openSales: BarOpenSale[] = [];
  if (openSaleRows.length) {
    const lines = mustRead(
      await supabase
        .from("bar_sale_item")
        .select("sale_no, line_no, menu_id, menu_name, qty, price, line_discount, line_discount_pct, is_comp, amount, voided_at")
        .eq("entity_id", entityId)
        .in("sale_no", openSaleRows.map((s) => s.sale_no as string))
        .order("line_no"),
      "รายการในบิล",
    );
    openSales = openSaleRows.map((s) => ({
      saleNo: s.sale_no as string,
      tabName: (s.tab_name as string) ?? null,
      customerId: (s.customer_id as string) ?? null,
      channel: (s.channel as string) ?? "บาร์",
      openedAt: s.opened_at as string,
      lines: lines
        .filter((l) => l.sale_no === s.sale_no)
        .map((l) => ({
          lineNo: Number(l.line_no),
          menuId: (l.menu_id as string) ?? null,
          menuName: l.menu_name as string,
          qty: Number(l.qty),
          price: Number(l.price),
          lineDiscount: Number(l.line_discount),
          lineDiscountPct: l.line_discount_pct == null ? null : Number(l.line_discount_pct),
          isComp: Boolean(l.is_comp),
          amount: Number(l.amount),
          voidedAt: (l.voided_at as string) ?? null,
        })),
    }));
  }

  const itemRows = mustRead({ data: items.data, error: items.error }, "วัตถุดิบบาร์");

  return {
    ...base,
    bankAccounts,
    hasAccounting,
    unposted,
    categories: mustRead({ data: cats.data, error: cats.error }, "หมวดเมนู").map((c) => ({
      categoryId: c.category_id as string,
      name: c.name as string,
      sort: Number(c.sort),
      isSystem: Boolean(c.is_system),
    })),
    menus: mustRead({ data: menus.data, error: menus.error }, "เมนูบาร์").map((m) => ({
      menuId: m.menu_id as string,
      name: m.name as string,
      price: Number(m.price),
      fixedCost: m.fixed_cost === null ? null : Number(m.fixed_cost),
      categoryId: m.category_id as string,
      recipe: byMenu.get(m.menu_id as string) ?? [],
      method: (m.method as string) ?? null,
      glass: (m.glass as string) ?? null,
      note: (m.note as string) ?? null,
      createdFor: (m.created_for as string) ?? null,
      active: m.active !== false,
      sort: m.sort === null ? null : Number(m.sort),
    })),
    items: stripCost(
      itemRows.map((i) => ({
        itemId: i.item_id as string,
        name: i.name as string,
        unit: i.unit as string,
        qty: Number(i.qty),
        costPerUnit: Number(i.cost_per_unit),
        packSize: i.pack_size === null ? null : Number(i.pack_size),
        packLabel: (i.pack_label as string) ?? null,
        lowQty: i.low_qty === null ? null : Number(i.low_qty),
        active: i.active !== false,
      })),
      base.canSeeCost,
    ),
    customers: mustRead({ data: customers.data, error: customers.error }, "ลูกค้าบาร์").map((c) => ({
      customerId: c.customer_id as string,
      name: c.name as string,
      nickname: (c.nickname as string) ?? null,
      phone: (c.phone as string) ?? null,
      taxId: (c.tax_id as string) ?? null,
      branch: (c.branch as string) ?? null,
      address: (c.address as string) ?? null,
      note: (c.note as string) ?? null,
    })),
    openSales,
  };
}

/**
 * ตัดต้นทุนออกก่อนส่งไป client เมื่อผู้ใช้ไม่มี `bar.config`
 *
 * 🚨 **ซ่อนด้วย CSS ไม่พอ** — พนักงานบาร์เปิด devtools แล้วอ่าน payload ได้
 *    ⇒ ต้องไม่ส่งค่ามาตั้งแต่แรก
 * ⚠️ นี่คือกติกาความเป็นส่วนตัว**ระดับหน้าจอ** ไม่ใช่ขอบเขตความปลอดภัยระดับ DB —
 *    RLS ซ่อนแถวได้ แต่ซ่อนคอลัมน์ไม่ได้ · คนที่ตั้งใจยิง PostgREST ตรงยังอ่านได้
 *    (กรอบเดียวกับที่ `lib/shared/taxCustomer.ts` ประกาศตัวเองไว้)
 */
function stripCost(items: BarItem[], canSeeCost: boolean): BarItem[] {
  if (canSeeCost) return items;
  return items.map((i) => ({ ...i, costPerUnit: 0 }));
}
