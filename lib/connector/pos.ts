/**
 * ขายหน้าร้านผ่าน Claude connector — ตรวจรายการ + ข้อมูลการ์ด (D172)
 *
 * 🚨 **ไม่มีสูตรเงินชุดใหม่** — ยอดทั้งหมดมาจาก `posTotals()` ตัวเดียวกับหน้าขายหน้าร้านในแอป
 *    และตอนกดขาย server คิดใหม่ทั้งหมดจาก DB (ไม่เชื่อตัวเลขที่การ์ดส่งกลับมา)
 * 🚨 ขายได้เฉพาะเมนูที่ผูกสินค้า (`product_id`) — เมนูที่ไม่ผูกถูก fn_confirm_fulfillment ข้ามเงียบ ๆ
 *    = ขายแล้วสต็อกไม่ขยับ (กติกาเดียวกับหน้าขายหน้าร้าน D86)
 * ★ สต็อกไม่พอ = เตือน ไม่บล็อก (มติผู้ใช้ D86) · ไม่รู้สต็อก (null) = ไม่เตือน
 * ★ ขายลงวันที่วันนี้เท่านั้น — ลงย้อนหลังทำในแอป (ต้องกรอกเลขบนใบกระดาษ/ตรวจวันที่ ซึ่งในแชทพลาดง่าย)
 */
import { posTotals, stockShortages, mergeCart, POS_METHODS } from "@/lib/sales/pos";
import type { CartItem, QuotationTotals } from "@/lib/sales/calc";
import type { MenuStockRow } from "@/lib/sales/menuStock";

export type PosItemArg = { menu: string; quantity: number };

export type PosLine = {
  name: string;
  qty: number;
  /** ราคาต่อหน่วยตามเมนู (รวม VAT ถ้าจด VAT) */
  price: number;
  total: number;
  /** คงเหลือในหน่วยขาย ก่อนขายบิลนี้ · null = ไม่รู้ */
  stock_left: number | null;
  short: boolean;
};

export type PosCheck = {
  lines: PosLine[];
  cart: CartItem[];
  totals: QuotationTotals;
  errors: string[];
  warnings: string[];
};

/** ชื่อเมนูที่ Claude พิมพ์มา → เทียบแบบไม่สนตัวพิมพ์/ช่องว่างซ้อน (ชื่อที่บันทึกยังเป็นชื่อในเมนูเป๊ะ) */
export const menuKey = (s: string) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** เมนูที่ชื่อคล้าย — ใช้บอกผู้ใช้เมื่อหาไม่เจอ (ไม่เลือกให้เอง) */
export function similarMenus(name: string, menu: MenuStockRow[], max = 5): string[] {
  const words = menuKey(name).split(" ").filter((w) => w.length >= 2);
  if (!words.length) return [];
  return menu.filter((m) => words.some((w) => menuKey(m.name).includes(w))).slice(0, max).map((m) => m.name);
}

export function checkPos(
  items: PosItemArg[],
  menu: MenuStockRow[],
  opts: { discount?: number; method?: string; isVat: boolean },
): PosCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byKey = new Map(menu.map((m) => [menuKey(m.name), m]));

  if (!items.length) errors.push("ยังไม่มีรายการสินค้า");
  const picked: CartItem[] = [];
  items.forEach((it, i) => {
    const label = `รายการที่ ${i + 1} (${it.menu})`;
    const q = Number(it.quantity);
    if (!Number.isInteger(q) || q <= 0) {
      errors.push(`${label}: จำนวนต้องเป็นจำนวนเต็มมากกว่า 0`);
      return;
    }
    const m = byKey.get(menuKey(it.menu));
    if (!m) {
      const sim = similarMenus(it.menu, menu);
      errors.push(`${label}: ไม่พบเมนูนี้ในเมนูขาย${sim.length ? ` — ที่ใกล้เคียง: ${sim.join(", ")}` : ""}`);
      return;
    }
    if (!m.itemCode) {
      errors.push(`${label}: เมนูนี้ไม่ได้ผูกกับสินค้าในคลัง — ขายแล้วสต็อกจะไม่ขยับ จึงขายหน้าร้านไม่ได้ (ผูกสินค้าให้เมนูนี้ในหน้าขายก่อน)`);
      return;
    }
    picked.push({ name: m.name, price: m.price, qty: q });
  });

  const cart = mergeCart(picked);
  const discount = Number(opts.discount) || 0;
  const totals = posTotals(cart, discount, opts.isVat);
  if (discount < 0) errors.push("ส่วนลดติดลบไม่ได้");
  else if (cart.length && discount > totals.grandIncl) errors.push(`ส่วนลด ${discount} มากกว่ายอดสินค้า ${totals.grandIncl}`);
  if (opts.method !== undefined && !(POS_METHODS as readonly string[]).includes(opts.method)) {
    errors.push(`วิธีรับเงินต้องเป็น ${POS_METHODS.join(" / ")}`);
  }

  const shortages = stockShortages(cart, menu);
  const shortSet = new Set(shortages.map((s) => s.name));
  for (const s of shortages) warnings.push(`${s.name}: ขาย ${s.want} แต่เหลือ ${s.have} — ขายได้ แต่ยอดคงเหลือจะติดลบ`);

  const stockOf = new Map(menu.map((m) => [m.name.trim(), m.stockQty]));
  const lines: PosLine[] = cart.map((c) => ({
    name: c.name,
    qty: c.qty,
    price: c.price,
    total: money(c.price * c.qty),
    stock_left: stockOf.get(c.name.trim()) ?? null,
    short: shortSet.has(c.name),
  }));
  return { lines, cart, totals, errors, warnings };
}

/** ชื่อเอกสารที่จะออก — ผู้ไม่จด VAT ออกใบกำกับภาษีไม่ได้ (ม.86/13 · D55) */
export const posDocTitle = (isVat: boolean) => (isVat ? "ใบกำกับภาษี/ใบเสร็จรับเงิน" : "ใบเสร็จรับเงิน");

/** ข้อมูลการ์ดขายหน้าร้าน (structuredContent ของ pos_preview) */
export type PosCardData = {
  card: "pos";
  tenant_slug: string;
  /** เวลาเปิดการ์ด — ใช้รู้ว่าการ์ดนี้ขายไปแล้วหรือยัง (ออเดอร์หน้าร้านของลูกค้า+ยอดเดียวกันหลังเวลานี้) */
  previewed_at: string;
  sale_date: string;
  customer: { id: string; name: string };
  items: PosItemArg[];
  lines: PosLine[];
  discount: number;
  totals: { grand_incl: number; before_vat: number; vat: number; grand_total: number };
  is_vat: boolean;
  doc_title: string;
  method: string;
  methods: string[];
  errors: string[];
  warnings: string[];
};

export function isPosCard(x: unknown): x is PosCardData {
  return !!x && typeof x === "object" && (x as { card?: unknown }).card === "pos";
}

/** ปุ่มหลักของการ์ด — ตัดสินที่นี่ (มีเทส) การ์ดแค่วาด */
export function posPrimary(d: PosCardData): { enabled: boolean; label: string } {
  if (d.errors.length) return { enabled: false, label: "แก้รายการก่อน (บอก Claude ในแชท)" };
  return { enabled: true, label: `ขาย ${d.totals.grand_total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท · ตัดสต็อก` };
}

/** ข้อความหลังขาย */
export function posDoneText(r: { order_no: string; doc_no: string; doc_title: string }): string {
  return `ขายแล้ว · ออเดอร์ ${r.order_no}${r.doc_no ? ` · ${r.doc_title} เลขที่ ${r.doc_no}` : ""} · พิมพ์เอกสารได้ที่แอป แท็บจัดการออเดอร์`;
}
