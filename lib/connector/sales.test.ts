/**
 * C9 — Claude connector ฝั่งขาย (D172): สิทธิ์ตามบทบาท × โมดูล · ขายหน้าร้านผ่านการ์ด · กติกาอ่านซอร์ส
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { connectorAccess, hasAnyAccess, noAccessText, accessSummary } from "./access";
import { checkPos, posPrimary, posDoneText, posDocTitle, isPosCard, menuKey, type PosCardData } from "./pos";
import { posTotals, POS_METHODS } from "@/lib/sales/pos";
import { menuWithStock, type MenuStockRow } from "@/lib/sales/menuStock";
import { ROLE_LABEL } from "@/lib/shared/roles";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

describe("C9 — สิทธิ์ของการเชื่อมต่อ = บทบาท × โมดูลที่ซื้อ", () => {
  it("พนักงานบัญชี: บัญชีอย่างเดียว (เส้นทางเดิมของ D141)", () => {
    expect(connectorAccess("accounting", null)).toEqual({ accounting: true, salesRead: false, salesWrite: false });
  });
  it("ฝ่ายขาย: ดูขาย + ขายหน้าร้าน · ไม่มีเครื่องมือบัญชี", () => {
    expect(connectorAccess("sales", null)).toEqual({ accounting: false, salesRead: true, salesWrite: true });
  });
  it("viewer: ดูขายได้อย่างเดียว ขายไม่ได้ บันทึกบัญชีไม่ได้", () => {
    expect(connectorAccess("viewer", null)).toEqual({ accounting: false, salesRead: true, salesWrite: false });
  });
  it("D172 พนักงานทุกฝ่าย: ได้ครบ", () => {
    expect(connectorAccess("general_staff", null)).toEqual({ accounting: true, salesRead: true, salesWrite: true });
  });
  it("🚨 ลูกค้าไม่ได้ซื้อโมดูลขาย = ไม่มีเครื่องมือขาย แม้บทบาทจะมีสิทธิ์", () => {
    expect(connectorAccess("general_staff", ["accounting"])).toEqual({ accounting: true, salesRead: false, salesWrite: false });
    expect(connectorAccess("general_staff", ["sales"])).toEqual({ accounting: false, salesRead: true, salesWrite: true });
  });
  it("ไม่มีอะไรทำได้เลย = ต่อไม่ได้ + บอกบทบาทเป็นชื่อไทย", () => {
    const a = connectorAccess("payroll", null);
    expect(hasAnyAccess(a)).toBe(false);
    expect(noAccessText("payroll")).toContain(ROLE_LABEL.payroll);
    expect(noAccessText("payroll")).toContain("ตั้งค่า → ผู้ใช้");
  });
  it("สรุปสิ่งที่ทำได้ให้ who_am_i", () => {
    expect(accessSummary(connectorAccess("sales", null))).toEqual(["ดูออเดอร์ · ลูกหนี้ค้าง · สต็อกสินค้า", "ขายหน้าร้าน (ตัดสต็อก + ออกใบเสร็จ)"]);
  });
});

const MENU: MenuStockRow[] = menuWithStock(
  [
    { menu_name: "สุราขาว 40 ดีกรี 700ml", price: 350, category: "สุรา", product_id: "P1", multiplier: 1 },
    { menu_name: "สุราขาว ยกลัง (12)", price: 4000, category: "สุรา", product_id: "P1", multiplier: 12 },
    { menu_name: "แก้วที่ระลึก", price: 120, category: "ของที่ระลึก", product_id: "W1", multiplier: 1 },
    { menu_name: "ค่าขนส่ง", price: 100, category: "บริการ", product_id: null, multiplier: 1 },
    { menu_name: "เสื้อยืด", price: 250, category: "ของที่ระลึก", product_id: "W9", multiplier: 1 },
  ],
  [{ product_id: "P1", balance: 30 }],
  [{ item_code: "W1", qty: 2 }],
);

describe("C9 — menuWithStock (ย้ายจากหน้าขายคำต่อคำ)", () => {
  it("หน่วยขายหารด้วย multiplier ปัดลง · ไม่มีแถวสต็อก = null", () => {
    expect(MENU.map((m) => [m.name, m.stockQty])).toEqual([
      ["สุราขาว 40 ดีกรี 700ml", 30],
      ["สุราขาว ยกลัง (12)", 2],
      ["แก้วที่ระลึก", 2],
      ["ค่าขนส่ง", null],
      ["เสื้อยืด", null],
    ]);
  });
});

describe("C9 — checkPos", () => {
  const ok = (items: { menu: string; quantity: number }[], o: Partial<{ discount: number; method: string }> = {}) =>
    checkPos(items, MENU, { isVat: true, method: "เงินสด", ...o });

  it("ชื่อเทียบไม่สนตัวพิมพ์/ช่องว่างซ้อน แต่บันทึกเป็นชื่อในเมนูเป๊ะ (fn_confirm_fulfillment join ด้วย trim ชื่อ)", () => {
    const r = ok([{ menu: "  สุราขาว   40 ดีกรี 700ML ", quantity: 2 }]);
    expect(r.errors).toEqual([]);
    expect(r.cart).toEqual([{ name: "สุราขาว 40 ดีกรี 700ml", price: 350, qty: 2 }]);
    expect(menuKey("A  b")).toBe("a b");
  });

  it("🚨 ยอดมาจาก posTotals ตัวเดียวกับแอป (ไม่มีสูตรชุดที่สอง)", () => {
    const r = ok([{ menu: "สุราขาว 40 ดีกรี 700ml", quantity: 3 }, { menu: "แก้วที่ระลึก", quantity: 1 }], { discount: 50 });
    expect(r.totals).toEqual(posTotals(r.cart, 50, true));
    expect(checkPos([{ menu: "แก้วที่ระลึก", quantity: 1 }], MENU, { isVat: false }).totals).toEqual(posTotals([{ name: "แก้วที่ระลึก", price: 120, qty: 1 }], 0, false));
  });

  it("เมนูเดียวกันสองบรรทัด → รวมเป็นบรรทัดเดียว", () => {
    const r = ok([{ menu: "แก้วที่ระลึก", quantity: 1 }, { menu: "แก้วที่ระลึก", quantity: 1 }]);
    expect(r.cart).toEqual([{ name: "แก้วที่ระลึก", price: 120, qty: 2 }]);
  });

  it("หาไม่เจอ = error พร้อมชื่อที่ใกล้เคียง (ไม่เลือกให้เอง)", () => {
    const r = ok([{ menu: "สุราขาว 1 ลิตร", quantity: 1 }]);
    expect(r.errors[0]).toMatch(/ไม่พบเมนูนี้/);
    expect(r.errors[0]).toMatch(/สุราขาว 40 ดีกรี 700ml/);
    expect(r.cart).toEqual([]);
  });

  it("🚨 เมนูที่ไม่ผูกสินค้า ขายหน้าร้านไม่ได้ (ขายแล้วสต็อกไม่ขยับเงียบ ๆ · D86)", () => {
    expect(ok([{ menu: "ค่าขนส่ง", quantity: 1 }]).errors[0]).toMatch(/ไม่ได้ผูกกับสินค้าในคลัง/);
  });

  it("จำนวนต้องเป็นจำนวนเต็มบวก", () => {
    for (const q of [0, -1, 1.5]) expect(ok([{ menu: "แก้วที่ระลึก", quantity: q }]).errors[0], String(q)).toMatch(/จำนวนเต็ม/);
  });

  it("สต็อกไม่พอ = เตือน ไม่บล็อก · ไม่รู้สต็อก = ไม่เตือน", () => {
    const r = ok([{ menu: "แก้วที่ระลึก", quantity: 5 }, { menu: "เสื้อยืด", quantity: 9 }]);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(["แก้วที่ระลึก: ขาย 5 แต่เหลือ 2 — ขายได้ แต่ยอดคงเหลือจะติดลบ"]);
    expect(r.lines.find((l) => l.name === "แก้วที่ระลึก")?.short).toBe(true);
    expect(r.lines.find((l) => l.name === "เสื้อยืด")?.stock_left).toBeNull();
  });

  it("ส่วนลดเกินยอด/ติดลบ · วิธีรับเงินนอกชุด = error", () => {
    expect(ok([{ menu: "แก้วที่ระลึก", quantity: 1 }], { discount: 500 }).errors[0]).toMatch(/มากกว่ายอดสินค้า/);
    expect(ok([{ menu: "แก้วที่ระลึก", quantity: 1 }], { discount: -1 }).errors[0]).toMatch(/ติดลบ/);
    expect(ok([{ menu: "แก้วที่ระลึก", quantity: 1 }], { method: "เช็ค" }).errors[0]).toMatch(/วิธีรับเงิน/);
    expect(POS_METHODS).not.toContain("เช็ค");
  });
});

describe("C9 — การ์ดขายหน้าร้าน", () => {
  const base: PosCardData = {
    card: "pos", tenant_slug: "x", previewed_at: "2026-11-14T10:00:00.000Z", sale_date: "2026-11-14",
    customer: { id: "C-1", name: "ลูกค้าทั่วไป" }, items: [], lines: [], discount: 0,
    totals: { grand_incl: 700, before_vat: 654.21, vat: 45.79, grand_total: 700 },
    is_vat: true, doc_title: posDocTitle(true), method: "เงินสด", methods: [...POS_METHODS], errors: [], warnings: [],
  };
  it("ปุ่มบอกยอด · มี error = กดไม่ได้", () => {
    expect(posPrimary(base)).toEqual({ enabled: true, label: "ขาย 700.00 บาท · ตัดสต็อก" });
    expect(posPrimary({ ...base, errors: ["x"] }).enabled).toBe(false);
  });
  it("🚨 ผู้ไม่จด VAT ออกใบเสร็จ ไม่ใช่ใบกำกับภาษี (ม.86/13)", () => {
    expect(posDocTitle(false)).toBe("ใบเสร็จรับเงิน");
    expect(posDocTitle(true)).toContain("ใบกำกับภาษี");
  });
  it("แยกการ์ดขายออกจากการ์ดบิล/คู่ค้า", () => {
    expect(isPosCard(base)).toBe(true);
    expect(isPosCard({ v: 1 })).toBe(false);
  });
  it("ข้อความหลังขายบอกเลขออเดอร์ เลขเอกสาร และที่พิมพ์เอกสาร", () => {
    expect(posDoneText({ order_no: "ORD-1", doc_no: "TAX-1", doc_title: "ใบกำกับภาษี/ใบเสร็จรับเงิน" })).toBe(
      "ขายแล้ว · ออเดอร์ ORD-1 · ใบกำกับภาษี/ใบเสร็จรับเงิน เลขที่ TAX-1 · พิมพ์เอกสารได้ที่แอป แท็บจัดการออเดอร์",
    );
  });
});

describe("C9 — 🚨 กติกาอ่านซอร์ส", () => {
  const tools = code("lib/connector/tools.ts");
  const sales = code("lib/connector/salesTools.ts");
  const body = (s: string, name: string) => {
    const a = s.indexOf(`"${name}",`);
    expect(a, name).toBeGreaterThan(0);
    const b = s.slice(a + 1).search(/\n  (server\.registerTool|registerAppTool|if \(!me\.access)/);
    return b < 0 ? s.slice(a) : s.slice(a, a + 1 + b);
  };

  it("เครื่องมือลงทะเบียนตามสิทธิ์ · ด่านเข้าไม่บังคับบัญชีแล้ว", () => {
    expect(tools).toMatch(/if \(me\.access\.accounting\) registerAccountingTools\(server, ctx\)/);
    expect(tools).toMatch(/if \(me\.access\.salesRead\) registerSalesTools\(server, ctx\)/);
    expect(sales).toMatch(/if \(!me\.access\.salesWrite\) return;[\s\S]*"pos_preview"/);
    expect(sales.indexOf("if (!me.access.salesWrite) return;")).toBeLessThan(sales.indexOf('"pos_preview"'));
    const sess = code("lib/connector/session.ts");
    expect(sess).not.toMatch(/can\(role, "acct\.write"\)/);
    expect(sess).toMatch(/connectorAccess\(role, modules\)/);
  });

  it.each(["find_customer", "sales_menu", "stock_levels", "search_orders", "get_order", "receivables", "pos_preview"])(
    "%s: อ่านอย่างเดียว",
    (n) => {
      const b = body(sales, n);
      expect(b).toMatch(/readOnlyHint: true/);
      expect(b).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|posSaleCore/);
    },
  );

  it("🚨 pos_sell: การ์ดเท่านั้น · ตรวจ tenant · คิดใหม่จาก DB · กันการ์ดเดิมขายซ้ำ · ใช้ posSaleCore ตัวเดียวกับแอป", () => {
    const b = body(sales, "pos_sell");
    expect(b).toMatch(/visibility: \["app"\]/);
    const slug = b.indexOf("me.tenantSlug");
    const rebuild = b.indexOf("buildPosCard(ctx, a, a.previewed_at)");
    const priceGuard = b.indexOf("expected_total");
    const dup = b.indexOf('.eq("remarks", "ขายหน้าร้าน")');
    const sell = b.indexOf("posSaleCore(");
    for (const [k, v] of Object.entries({ slug, rebuild, priceGuard, dup, sell })) expect(v, k).toBeGreaterThan(0);
    expect(slug).toBeLessThan(rebuild);
    expect(rebuild).toBeLessThan(dup);
    expect(dup).toBeLessThan(sell);
    expect(b).toMatch(/items: card\.lines\.map/); // ราคามาจากเมนูใน DB ไม่ใช่จากการ์ด
  });

  it("🚨 หน้าขายหน้าร้านในแอปกับ connector ใช้แกนเดียวกัน", () => {
    const act = code("app/(app)/sales/actions.ts");
    expect(act).toMatch(/posSaleCore\(supabase, input, await currentUserName\(supabase\)\)/);
    expect(act).not.toMatch(/rpc\("fn_save_quotation"/);
    const core = code("lib/sales/orderCore.ts");
    expect(core).not.toMatch(/revalidatePath|sendLine|createClient\(/);
  });

  it("connector ไม่ส่ง LINE (lib/line ใช้ service role)", () => {
    expect(sales).not.toMatch(/@\/lib\/line|sendLine/);
  });

  it("ไม่มีเครื่องมือยกเลิก/ใบลดหนี้/ยืนยันจัดส่ง/แก้วิธีชำระ", () => {
    expect(sales).not.toMatch(/fn_cancel_order|fn_sales_credit_note|fn_confirm_fulfillment|fn_sales_edit_payment/);
  });

  it("การ์ดขายใช้การ์ดชุดเดียวกับบิล", async () => {
    const { POS_CARD_URI } = await import("./salesTools").catch(() => ({ POS_CARD_URI: "" }));
    // salesTools เป็น server-only — import ไม่ได้ในเทส ⇒ เทียบจากซอร์ส
    const uri = (POS_CARD_URI || /POS_CARD_URI = "([^"]+)"/.exec(readFileSync(path.join(ROOT, "lib/connector/salesTools.ts"), "utf8"))?.[1]) ?? "";
    const bill = /BILL_CARD_URI = "([^"]+)"/.exec(readFileSync(path.join(ROOT, "lib/connector/tools.ts"), "utf8"))?.[1];
    expect(uri).toBe(bill);
    expect(code("lib/connector/card/billCard.ts")).toMatch(/if \(isPosCard\(sc\)\) \{ pdata = sc; renderPos\(\); return; \}/);
  });

  it("คำแนะนำบอก Claude ให้ใช้ขายหน้าร้าน ไม่ใช่บิลรายรับ เมื่อผู้ใช้ขายของ", () => {
    expect(sales).toMatch(/use pos_preview — NOT preview_bill with type รายรับ/);
  });
});

describe("C9 — D177: เวลาเปิดการ์ดขายใช้นาฬิกา DB", () => {
  it("🔴 previewed_at มาจาก rpc ping (นาฬิกาเดียวกับ created_at) ไม่ใช่ new Date() ของ server แอป", () => {
    const s = code("lib/connector/salesTools.ts");
    const b = s.slice(s.indexOf("async function buildPosCard"), s.indexOf("const posItemShape"));
    expect(b).toMatch(/rpc\("ping"\)/);
    expect(b).toMatch(/previewed_at: openedAt/);
    expect(b).not.toMatch(/new Date\(\)\.toISOString\(\)/);
  });
});
