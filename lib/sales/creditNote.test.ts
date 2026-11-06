import { describe, it, expect } from "vitest";
import { cancelMode, cnInputError, cnReasonText, cnTotals, cnWhtNote, CN_REASON_KEYS, type CnBill } from "./creditNote";
import { taxReport, dashboardData, type Tx } from "../accounting/calc";
import { accountStatementRange, cashDirection } from "../accounting/ledger";
import { billTotals } from "../accounting/billTotals";
import { SALES_CREDIT_TYPE } from "../accounting/creditNote";

/**
 * golden S22 (ขาย) + A29 (บัญชี) — ใบลดหนี้ตอนยกเลิกออเดอร์ (D159)
 * 🚨 กติกาเหล็กข้อ 1: golden เดิมของ ภพ.30 / แดชบอร์ด / ยอดเงิน ผ่านโดยไม่แก้ไฟล์เทส
 *    ไฟล์นี้ล็อกเฉพาะพฤติกรรมใหม่ของบิล `ลดหนี้ขาย`
 */

const bill = (o: Partial<CnBill> = {}): CnBill => ({
  txId: "TR-1", date: "2026-10-15", taxInvoiceNo: "TAX-1", taxInvoiceDate: "2026-10-15",
  preVat: 1000, vat: 70, net: 1070, wht: 0, ...o,
});

describe("S22 cancelMode — ยกเลิกแบบไหน", () => {
  const none = new Set<string>();
  it("ไม่มีใบกำกับที่มี VAT (ผู้ไม่จด VAT / ยังไม่รับเงิน) = ยกเลิกแบบเดิม", () => {
    expect(cancelMode([], "2026-11", none)).toBe("void");
    expect(cancelMode([bill({ vat: 0 })], "2026-11", none)).toBe("void");
  });
  it("ใบกำกับเดือนเดียวกับวันนี้ + ยังไม่ยื่น = เลือกได้", () => {
    expect(cancelMode([bill({ date: "2026-11-02" })], "2026-11", none)).toBe("choice");
  });
  it("🔴 ใบกำกับเดือนก่อน = ต้องใบลดหนี้ (ยกเลิกแบบเดิมจะทำภาษีขายหายจากงวดที่ยื่นแล้ว)", () => {
    expect(cancelMode([bill({ date: "2026-10-30" })], "2026-11", none)).toBe("credit_note");
  });
  it("เดือนเดียวกันแต่ติ๊กยื่น ภพ.30 แล้ว = ต้องใบลดหนี้", () => {
    expect(cancelMode([bill({ date: "2026-11-02" })], "2026-11", new Set(["2026-11"]))).toBe("credit_note");
  });
  it("มัดจำเดือนก่อน + ยอดค้างเดือนนี้ = ต้องใบลดหนี้ (ทั้งออเดอร์ใบเดียว)", () => {
    expect(cancelMode([bill({ date: "2026-10-20" }), bill({ txId: "TR-2", date: "2026-11-01" })], "2026-11", none)).toBe("credit_note");
  });
});

describe("S22 ยอดบนใบลดหนี้ (ม.86/10(5))", () => {
  it("บวกยอดที่บันทึกในบิลเดิมตรง ๆ · มูลค่าที่ถูกต้อง = 0 · ผลต่าง = มูลค่าเดิม", () => {
    const t = cnTotals([bill(), bill({ txId: "TR-2", preVat: 500, vat: 35, net: 535 })]);
    expect(t).toEqual({ original: 1500, correct: 0, diff: 1500, vat: 105, total: 1605, refund: 1605, wht: 0 });
  });
  it("ลูกค้าหัก ณ ที่จ่าย: คืนเฉพาะยอดที่รับจริง + มีบรรทัดเตือน", () => {
    const t = cnTotals([bill({ net: 1040, wht: 30 })]);
    expect(t.total).toBe(1070);
    expect(t.refund).toBe(1040);
    expect(cnWhtNote(t)).toContain("30.00");
    expect(cnWhtNote(cnTotals([bill()]))).toBeNull();
  });
  it("ไม่มีเศษทศนิยมสะสม", () => {
    const t = cnTotals([bill({ preVat: 0.1, vat: 0.01, net: 0.11 }), bill({ preVat: 0.2, vat: 0.01, net: 0.21 })]);
    expect(t.original).toBe(0.3);
  });
});

describe("S22 ตรวจข้อมูลก่อนออก", () => {
  const ok = { reason: "return", detail: "", date: "2026-11-05", bills: [bill()], today: "2026-11-05" };
  it("ผ่านเมื่อครบ", () => expect(cnInputError(ok)).toBeNull());
  it("ต้องเลือกเหตุ · เหตุอื่นต้องพิมพ์อธิบาย", () => {
    expect(cnInputError({ ...ok, reason: "" })).toContain("เหตุ");
    expect(cnInputError({ ...ok, reason: "other" })).toContain("อธิบาย");
    expect(cnInputError({ ...ok, reason: "other", detail: "ลูกค้าคืนของตามสัญญา" })).toBeNull();
  });
  it("วันที่: ห้ามอนาคต · ห้ามก่อนใบกำกับเดิม", () => {
    expect(cnInputError({ ...ok, date: "2026-11-06" })).toContain("อนาคต");
    expect(cnInputError({ ...ok, date: "2026-10-01" })).toContain("ก่อนวันที่ใบกำกับเดิม");
  });
  it("ไม่มีใบกำกับที่มี VAT = ออกไม่ได้", () => {
    expect(cnInputError({ ...ok, bills: [bill({ vat: 0 })] })).toContain("ไม่มีใบกำกับ");
  });
  it("ข้อความเหตุบนใบ = ป้ายเหตุ (+ คำอธิบาย) · ทุกเหตุมีตัวบทอ้าง", () => {
    expect(cnReasonText("return", "")).toBe("รับคืนสินค้า");
    expect(cnReasonText("return", " ขวดแตก 2 ขวด ")).toBe("รับคืนสินค้า — ขวดแตก 2 ขวด");
    expect(CN_REASON_KEYS).toEqual(["return", "refund_advance", "price_error", "other"]);
  });
});

// ── A29 — บิลลดหนี้ขายในรายงานฝั่งบัญชี ───────────────────────────────────────
const EID = "EID01";
const tx = (o: Partial<Tx>): Tx => ({
  tx_id: "X", transaction_date: "2026-10-15", type: "รายรับ", account_name: "ธนาคาร", category: "รายได้ค่าสินค้า",
  contact_name: "ลูกค้า ก", amount_after_discount: 1000, vat_amount: 70, wht_rate: 0, wht_amount: 0, net_amount: 1070,
  tax_invoice_no: "TAX-1", tax_invoice_date: "2026-10-15", status: "ปกติ", entity_id: EID, ap_ar_status: null, ...o,
});
const sale = tx({ tx_id: "S1" });
const cn = tx({ tx_id: "C1", type: SALES_CREDIT_TYPE, transaction_date: "2026-11-05", tax_invoice_no: "CN-1", tax_invoice_date: "2026-11-05" });

describe("A29 ภพ.30 — ใบลดหนี้หักในเดือนที่ออก งวดเดิมไม่ขยับ", () => {
  it("🔴 เดือนที่ขาย (ต.ค.) ยังเป็นยอดเต็ม ไม่ว่าจะออกใบลดหนี้เดือนไหน", () => {
    const r = taxReport("2026-10", EID, 0, [sale, cn], {});
    expect(r.totalSalesAmount).toBe(1000);
    expect(r.totalSalesVat).toBe(70);
  });
  it("เดือนที่ออกใบลดหนี้ (พ.ย.) = แถวติดลบ อ้างเลขใบลดหนี้ · ภาษีขายติดลบ", () => {
    const r = taxReport("2026-11", EID, 0, [sale, cn], {});
    expect(r.sales).toHaveLength(1);
    expect(r.sales[0]).toMatchObject({ invoiceNo: "CN-1", amount: -1000, vat: -70 });
    expect(r.totalSalesAmount).toBe(-1000);
    expect(r.totalSalesVat).toBe(-70);
  });
  it("ขายอื่นในเดือนเดียวกันหักกันเป็นยอดสุทธิ · VAT ยังคิดรอบเดียวจากยอดรวม", () => {
    const other = tx({ tx_id: "S2", transaction_date: "2026-11-10", amount_after_discount: 3000, vat_amount: 210 });
    const r = taxReport("2026-11", EID, 0, [cn, other], {});
    expect(r.totalSalesAmount).toBe(2000);
    expect(r.totalSalesVat).toBe(140);
  });
  it("ภาษีขายสุทธิติดลบ → ยกไปเดือนหน้า (สูตรเดิม)", () => {
    const r = taxReport("2026-11", EID, 0, [cn], {});
    expect(r.netPayable).toBe(-70);
    expect(r.forwardedVatOut).toBe(70);
  });
  it("ใบลดหนี้ที่ยังไม่คืนเงิน (ค้างจ่าย) ยังนับ เพราะมีเลขใบลดหนี้ (D123)", () => {
    const r = taxReport("2026-11", EID, 0, [{ ...cn, ap_ar_status: "AP", account_name: null }], {});
    expect(r.totalSalesVat).toBe(-70);
  });
});

describe("A29 แดชบอร์ด / ยอดเงิน / ค้นบิล", () => {
  it("แดชบอร์ดเดือนที่ออกใบลดหนี้หักรายได้ · เดือนเดิมไม่ขยับ", () => {
    expect(dashboardData("2026-10", EID, [sale, cn], new Set()).dash.income).toBe(1000);
    expect(dashboardData("2026-11", EID, [sale, cn], new Set()).dash).toMatchObject({ income: -1000, netIncome: -1070, vatOut: -70 });
  });
  it("ยอดเงิน: คืนเงิน = เงินออก · ค้างจ่ายยังไม่ขยับ", () => {
    expect(cashDirection(SALES_CREDIT_TYPE)).toBe("out");
    const L = (x: Tx) => ({ ...x, description: x.description ?? null, transfer_id: null });
    const st = accountStatementRange("ธนาคาร", { from: "2026-10", to: "2026-11" }, [L(sale), L(cn)], 0);
    expect(st.closingBalance).toBe(0);
    const pending = accountStatementRange("ธนาคาร", { from: "2026-10", to: "2026-11" }, [L(sale), L({ ...cn, ap_ar_status: "AP" })], 0);
    expect(pending.closingBalance).toBe(1070);
  });
  it("ค้นบิล: ใบลดหนี้แยกแถว และหักจาก รายรับ − รายจ่าย", () => {
    const t = billTotals([sale, cn].map((x) => ({ type: x.type, net_amount: x.net_amount, status: x.status, ap_ar_status: x.ap_ar_status })));
    expect(t.byType.map((b) => b.type)).toEqual(["รายรับ", SALES_CREDIT_TYPE]);
    expect(t.incomeMinusExpense).toBe(0);
  });
});

// ── ฝาแฝด TS ↔ SQL (0106) — SQL คือตัวบังคับจริง ─────────────────────────────
import { readdirSync, readFileSync } from "node:fs";
describe("S22 SQL ⇄ TS (fn_cancel_order 0106)", () => {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const latest = (name: string) => {
    const f = [...files].reverse().find((x) => readFileSync(`${dir}/${x}`, "utf8").includes(`function ${name}(p_qu_no text`))!;
    const src = readFileSync(`${dir}/${f}`, "utf8");
    const s = src.indexOf(`function ${name}(p_qu_no text`);
    return src.slice(s, src.indexOf("end $$;", s));
  };
  const def = latest("fn_cancel_order");
  it("เหตุในฐานข้อมูล = CN_REASON_KEYS (ทั้ง RPC และ CHECK ของตาราง)", () => {
    const rpc = def.match(/v_reason <> all \(array\[([^\]]*)\]\)/)![1];
    expect([...rpc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(CN_REASON_KEYS);
    const tbl = readFileSync(`${dir}/${files.find((f) => f.includes("_sales_credit_note"))}`, "utf8");
    const chk = tbl.match(/reason in \(([^)]*)\)/)![1];
    expect([...chk.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(CN_REASON_KEYS);
  });
  it("🔴 ยกเลิกแบบเดิมถูกปฏิเสธเมื่อใบกำกับอยู่เดือนก่อน/งวดที่ยื่นแล้ว (ด่านก่อน void)", () => {
    expect(def).toMatch(/to_char\(t\.transaction_date, 'YYYY-MM'\) <> to_char\(v_today, 'YYYY-MM'\)/);
    expect(def).toMatch(/f\.kind = 'vat'[\s\S]*f\.reopened_at is null/);
    expect(def.indexOf("ต้องออกใบลดหนี้")).toBeLessThan(def.indexOf("update transactions set status = 'ยกเลิก'"));
  });
  it("ใบลดหนี้: บิลเดิมไม่ถูก void · บิลใหม่ type ลดหนี้ขาย · ยังไม่คืน = ค้างจ่าย AP", () => {
    const creditPart = def.slice(def.indexOf("-- ── ออกใบลดหนี้"));
    expect(creditPart.slice(0, creditPart.indexOf("end if;\n\n  -- 2)"))).not.toContain("set status = 'ยกเลิก'");
    expect(def).toContain(`'${SALES_CREDIT_TYPE}'`);
    expect(def).toContain("case when v_acc is null then 'AP' end");
    expect(def).toContain("fn_next_doc_no('sales_cn'");
  });
});

// ── เอกสารใบลดหนี้ (ม.86/10) — เรนเดอร์ HTML ตัวเดียวกับที่พิมพ์ ──────────────
import { creditNoteDocsHtml } from "@/app/(app)/sales/_components/print";
import { COMPANY, ITEMS, vatOrder } from "./salesDocHtml.fixtures";
describe("S22 เอกสารใบลดหนี้มีรายการครบตาม ม.86/10", () => {
  const cnDoc = {
    cnNo: "CN-261105-001", cnDate: "2026-11-05", reasonText: "รับคืนสินค้า — ขวดแตก",
    refs: [{ docNo: "TAX-T1", date: "2026-10-10", preVat: 934.58, vat: 65.42 }, { docNo: "TAX-T2", date: "2026-10-20", preVat: 1065.42, vat: 74.58 }],
    original: 2000, correct: 0, diff: 2000, vat: 140, total: 2140, refund: 2140, wht: 0, refundAccount: "กสิกร",
  };
  const html = creditNoteDocsHtml(COMPANY, vatOrder(0), ITEMS, cnDoc);
  const text = html.split("(สำเนา")[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  it("(1) คำว่า ใบลดหนี้ เด่นชัด · ไม่มีคำว่า ใบหักหนี้ (ข้อหารือ 0811/พ.10090)", () => {
    expect(html).toContain(">ใบลดหนี้<");
    expect(html).not.toContain("ใบหักหนี้");
  });
  it("(2)(3)(4) ผู้ออก · ผู้ซื้อ · วันที่", () => {
    expect(text).toContain(COMPANY.name);
    expect(text).toContain("ลูกค้า ทดสอบ");
    expect(text).toContain("05/11/2569");
  });
  it("(5) เลขใบกำกับเดิมทุกใบ · มูลค่าเดิม · ที่ถูกต้อง · ผลต่าง · ภาษีของผลต่าง", () => {
    expect(text).toContain("TAX-T1 (10/10/2569)");
    expect(text).toContain("TAX-T2 (20/10/2569)");
    expect(text).toMatch(/มูลค่าตามใบกำกับภาษีเดิม 2,000\.00/);
    expect(text).toMatch(/มูลค่าที่ถูกต้อง 0\.00/);
    expect(text).toMatch(/ผลต่าง \(มูลค่าที่ลดลง\) 2,000\.00/);
    expect(text).toMatch(/ภาษีมูลค่าเพิ่ม 7% ของผลต่าง 140\.00/);
    expect(text).toMatch(/รวมลดหนี้ทั้งสิ้น 2,140\.00/);
  });
  it("(6) เหตุที่ออก · ต้นฉบับ+สำเนา", () => {
    expect(text).toContain("รับคืนสินค้า — ขวดแตก");
    expect((html.match(/data-doc-title="ใบลดหนี้"/g) ?? []).length).toBe(2);
  });
  it("ลูกค้าหัก ณ ที่จ่ายไว้ → บรรทัดยอดคืนเงินจริง", () => {
    const w = creditNoteDocsHtml(COMPANY, vatOrder(0), ITEMS, { ...cnDoc, wht: 60, refund: 2080 });
    expect(w.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toMatch(/ยอดคืนเงิน 2,080\.00/);
  });
});

// ── golden S23 — ใบลดหนี้บางส่วน (D160) ─────────────────────────────────────────
import { partialRemaining, partialTotals, type CnOrderItem, type PriorCn } from "./creditNote";
describe("S23 ใบลดหนี้บางส่วน — คืนบางรายการ / ลดราคา", () => {
  // ออเดอร์: A 2 ขวด × 535 + B 1 × 1,070 = 2,140 (รวม VAT) · ใบกำกับ 1 ใบ ก่อน VAT 2,000 VAT 140
  const items: CnOrderItem[] = [{ id: 1, name: "A", qty: 2, price: 535 }, { id: 2, name: "B", qty: 1, price: 1070 }];
  const bills = [bill({ preVat: 2000, vat: 140, net: 2140 })];
  const ctx = { bills, prior: [] as PriorCn[], items, grandTotal: 2140, whtPercent: 0 };

  it("คืน A 1 ขวด = 535 → ก่อน VAT 500 · VAT 35 (vatFromGross: base + vat = gross)", () => {
    const r = partialTotals({ mode: "return", qtys: { 1: 1 } }, ctx);
    expect(r).toMatchObject({ original: 2000, diff: 500, correct: 1500, vat: 35, total: 535, refund: 535, closing: false });
    expect(typeof r !== "string" && r.lines).toEqual([{ id: 1, name: "A", qty: 1, price: 535 }]);
  });
  it("ลดราคา 100 (รวม VAT) → 93.46 + 6.54", () => {
    expect(partialTotals({ mode: "discount", gross: 100 }, ctx)).toMatchObject({ diff: 93.46, vat: 6.54, total: 100 });
  });
  it("ส่วนลดท้ายบิลของออเดอร์ลดตามสัดส่วน (ขายจริง 1,926 จากราคาเต็ม 2,140)", () => {
    const r = partialTotals({ mode: "return", qtys: { 2: 1 } }, { ...ctx, grandTotal: 1926, bills: [bill({ preVat: 1800, vat: 126, net: 1926 })] });
    expect(typeof r !== "string" && r.total).toBe(963); // 1,070 × 1926/2140
  });
  it("ใบหลังต่อจากใบก่อน: มูลค่าเดิม = ที่เหลือ · คืนได้เฉพาะจำนวนที่เหลือ", () => {
    const prior: PriorCn[] = [{ pre: 500, vat: 35, total: 535, wht: 0, items: [{ id: 1, qty: 1 }] }];
    const rem = partialRemaining({ bills, prior, items });
    expect(rem).toMatchObject({ pre: 1500, vat: 105, gross: 1605, qty: { 1: 1, 2: 1 } });
    expect(partialTotals({ mode: "return", qtys: { 1: 2 } }, { ...ctx, prior })).toContain("คืนได้ไม่เกิน 1");
    expect(partialTotals({ mode: "return", qtys: { 1: 1 } }, { ...ctx, prior })).toMatchObject({ original: 1500, correct: 1000 });
  });
  it("🔴 คืนครบทุกชิ้นที่เหลือ = ปิดยอดพอดี (ใช้ยอดคงเหลือ ไม่ถอด VAT ใหม่ — ไม่มีเศษค้าง)", () => {
    // บิลเดิมถอด VAT แบบ 1,999.99 + 140.01 (ไม่เท่าที่ vatFromGross จะได้)
    const odd = [bill({ preVat: 1999.99, vat: 140.01, net: 2140 })];
    const r = partialTotals({ mode: "return", qtys: { 1: 2, 2: 1 } }, { ...ctx, bills: odd });
    expect(r).toMatchObject({ diff: 1999.99, vat: 140.01, total: 2140, correct: 0, closing: true });
    // ลดราคาเท่ายอดที่เหลือพอดีก็ปิดเหมือนกัน
    expect(partialTotals({ mode: "discount", gross: 2140 }, { ...ctx, bills: odd })).toMatchObject({ vat: 140.01, closing: true });
  });
  it("ลูกค้าหัก ณ ที่จ่าย 3%: คืนสุทธิ = รวม − หัก ณ ที่จ่ายของฐานที่ลด", () => {
    const r = partialTotals({ mode: "return", qtys: { 1: 1 } }, { ...ctx, whtPercent: 3, bills: [bill({ preVat: 2000, vat: 140, wht: 60, net: 2080 })] });
    expect(r).toMatchObject({ diff: 500, wht: 15, refund: 520 });
  });
  it("ขอบเขต: ไม่เลือกรายการ / ยอด 0 / เกินยอดที่เหลือ / ครบแล้ว / ไม่มีใบกำกับ", () => {
    expect(partialTotals({ mode: "return", qtys: {} }, ctx)).toContain("เลือกรายการ");
    expect(partialTotals({ mode: "discount", gross: 0 }, ctx)).toContain("กรอกยอด");
    expect(partialTotals({ mode: "discount", gross: 2140.02 }, ctx)).toContain("ไม่เกินยอดที่เหลือ");
    const full: PriorCn[] = [{ pre: 2000, vat: 140, total: 2140, wht: 0, items: [] }];
    expect(partialTotals({ mode: "discount", gross: 1 }, { ...ctx, prior: full })).toContain("ครบยอดแล้ว");
    expect(partialTotals({ mode: "discount", gross: 1 }, { ...ctx, bills: [bill({ vat: 0 })] })).toContain("ไม่มีใบกำกับ");
  });
});

// ── ฝาแฝด TS ↔ SQL (0107) — ใบลดหนี้บางส่วน · SQL คือตัวบังคับจริง ─────────────────
import { CANCEL_AFTER_PARTIAL_TEXT } from "./creditNote";
describe("S23 SQL ⇄ TS (fn_sales_credit_note · fn_cancel_order 0107)", () => {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const latest = (name: string) => {
    const f = [...files].reverse().find((x) => readFileSync(`${dir}/${x}`, "utf8").includes(`function ${name}(p_qu_no text`))!;
    const src = readFileSync(`${dir}/${f}`, "utf8");
    const s = src.indexOf(`function ${name}(p_qu_no text`);
    return src.slice(s, src.indexOf("end $$;", s));
  };
  const cn = latest("fn_sales_credit_note");
  const cancel = latest("fn_cancel_order");

  it("🚨 ยกเลิกทั้งออเดอร์หลังมีใบลดหนี้บางส่วน = ปฏิเสธ (ข้อความเดียวกับที่จอบอก) ก่อนแตะอะไร", () => {
    expect(cancel).toContain(`raise exception '${CANCEL_AFTER_PARTIAL_TEXT}'`);
    expect(cancel.indexOf(CANCEL_AFTER_PARTIAL_TEXT)).toBeLessThan(cancel.indexOf("update transactions set status = 'ยกเลิก'"));
  });
  it("หัวหน้าฝ่ายขายขึ้นไป · เฉพาะออเดอร์ที่ปิดการขาย", () => {
    expect(cn).toContain("has_cap('sales.config')");
    expect(cn).toMatch(/status <> 'ปิดการขาย'/);
  });
  it("เหตุในฐานข้อมูล = CN_REASON_KEYS", () => {
    const rpc = cn.match(/v_reason <> all \(array\[([^\]]*)\]\)/)![1];
    expect([...rpc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(CN_REASON_KEYS);
  });
  it("ยอดต้องไม่เกินที่เหลือ (บิล − ใบลดหนี้ที่ออกแล้ว) และ ก่อน VAT + VAT = รวม", () => {
    expect(cn).toContain("ลดได้ไม่เกินยอดที่เหลือ");
    expect(cn).toContain("ก่อน VAT + VAT ต้องเท่ายอดรวม");
  });
  it("จำนวนคืนต้องไม่เกินที่ขาย − ที่คืนไปแล้ว", () => {
    expect(cn).toMatch(/คืนได้ไม่เกิน/);
    expect(cn).toContain("รายการที่คืนซ้ำกัน"); // กันส่ง id เดิมซ้ำเพื่อหลบด่านจำนวน
    expect(cn.indexOf("รายการที่คืนซ้ำกัน")).toBeLessThan(cn.indexOf("คืนได้ไม่เกิน"));
  });
  it("บิลใหม่ type ลดหนี้ขาย · กันซ้ำด้วย CN:เลขใบ · ยังไม่คืน = ค้างจ่าย AP · บิลเดิมไม่ถูกแตะ", () => {
    expect(cn).toContain(`'${SALES_CREDIT_TYPE}'`);
    expect(cn).toContain("'CN:' || v_cn_no");
    expect(cn).toContain("case when v_acc is null then 'AP' end");
    expect(cn).not.toMatch(/update transactions/);
  });
  it("🚨 คืนสต็อกเฉพาะเมื่อเลือก · อ้างเลขใบลดหนี้ (ไม่ปนคู่ จ่าย/รับ ของการยกเลิก D90/D91)", () => {
    expect(cn).toContain("v_restock := v_kind = 'return' and coalesce((p_cn->>'restock')::boolean, false)");
    expect(cn).toMatch(/insert into log_product[\s\S]*'รับ'[\s\S]*v_cn_no\);/);
    expect(cn).not.toMatch(/excise_hidden/);
  });
});

describe("S23 เอกสารใบลดหนี้บางส่วน", () => {
  const base = {
    cnNo: "CN-261106-001", cnDate: "2026-11-06", reasonText: "รับคืนสินค้า",
    refs: [{ docNo: "TAX-T1", date: "2026-10-10", preVat: 2000, vat: 140 }],
    original: 2000, correct: 1500, diff: 500, vat: 35, total: 535, refund: 535, wht: 0, refundAccount: "",
  };
  const txt = (h: string) => h.split("(สำเนา")[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  it("คืนสินค้า: ตารางเป็นรายการที่คืน ไม่ใช่ทั้งออเดอร์ · มูลค่าที่ถูกต้องไม่ใช่ 0", () => {
    const t = txt(creditNoteDocsHtml(COMPANY, vatOrder(0), ITEMS, { ...base, kind: "return", items: [{ name: "ขวดที่คืน", qty: 1, price: 535 }] }));
    expect(t).toContain("ขวดที่คืน");
    for (const it of ITEMS) expect(t).not.toContain(it.name);
    expect(t).toMatch(/มูลค่าที่ถูกต้อง 1,500\.00/);
    expect(t).toMatch(/ผลต่าง \(มูลค่าที่ลดลง\) 500\.00/);
  });
  it("ลดราคา: บรรทัดเดียวบอกว่าลดราคาตามใบกำกับเดิม", () => {
    const t = txt(creditNoteDocsHtml(COMPANY, vatOrder(0), ITEMS, { ...base, kind: "discount" }));
    expect(t).toContain("ลดราคาสินค้า/บริการตามใบกำกับภาษีเดิม");
  });
  it("หลายใบในหน้าต่างเดียว = ต้นฉบับ+สำเนาของทุกใบ", () => {
    const h = creditNoteDocsHtml(COMPANY, vatOrder(0), ITEMS, [{ ...base, kind: "discount" }, { ...base, cnNo: "CN-261106-002", kind: "discount" }]);
    expect((h.match(/data-doc-title="ใบลดหนี้"/g) ?? []).length).toBe(4);
    expect(h).toContain('data-doc-no="CN-261106-002"');
  });
});

import { cnInvoiceLines } from "./creditNote";
describe("S23 ใบลดหนี้ใบที่ 2+ — มูลค่าตามใบกำกับเดิมต้องเป็นยอดบนใบกำกับจริง (ม.86/10(5))", () => {
  const refs = [{ preVat: 1308.41 }];
  it("ใบแรก: ไม่มีบรรทัดหัก (หน้าตาเดิม)", () => {
    expect(cnInvoiceLines(refs, 1308.41)).toEqual({ invoice: 1308.41, prior: 0 });
  });
  it("ใบที่ 2: ยอดใบกำกับจริง + หักครั้งก่อน · เดิม − ก่อนหน้า − ผลต่าง = ที่ถูกต้อง", () => {
    const r = cnInvoiceLines(refs, 981.31);
    expect(r).toEqual({ invoice: 1308.41, prior: 327.1 });
    expect(Math.round((r.invoice - r.prior - 327.1) * 100) / 100).toBe(654.21);
  });
  it("refs ว่าง (ข้อมูลไม่ครบ) → ไม่เดา ใช้ยอดที่บันทึกไว้", () => {
    expect(cnInvoiceLines([], 981.31)).toEqual({ invoice: 981.31, prior: 0 });
  });
  it("บนกระดาษ: ใบที่ 2 มีบรรทัด หัก ลดหนี้ครั้งก่อน · ใบแรกไม่มี", () => {
    const base = { cnNo: "CN-2", cnDate: "2026-11-06", reasonText: "x", refs: [{ docNo: "T1", date: "2026-11-06", preVat: 1308.41, vat: 91.59 }],
      correct: 654.21, diff: 327.1, vat: 22.9, total: 350, refund: 350, wht: 0, refundAccount: "", kind: "discount" as const };
    const t = (o: number) => creditNoteDocsHtml(COMPANY, vatOrder(0), ITEMS, { ...base, original: o }).split("(สำเนา")[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(t(981.31)).toMatch(/มูลค่าตามใบกำกับภาษีเดิม 1,308\.41 หัก ลดหนี้ครั้งก่อน -327\.10 มูลค่าที่ถูกต้อง 654\.21/);
    expect(t(1308.41)).not.toContain("หัก ลดหนี้ครั้งก่อน");
  });
});

describe("S23 ลดราคาไปแล้ว แล้วลูกค้าคืนของ", () => {
  const items: CnOrderItem[] = [{ id: 1, name: "A", qty: 4, price: 350 }];
  const bills: CnBill[] = [bill({ preVat: 1308.41, vat: 91.59, net: 1400 })];
  const prior: PriorCn[] = [
    { pre: 327.1, vat: 22.9, total: 350, wht: 0, items: [{ id: 1, qty: 1 }] },
    { pre: 186.92, vat: 13.08, total: 200, wht: 0, items: [] },
  ];
  const ctx = { bills, prior, items, grandTotal: 1400, whtPercent: 0 };
  it("คืนครบ 3 ขวดที่เหลือ (มูลค่า 1,050) = ปิดยอดที่เหลือ 850 พอดี · ไม่ถอด VAT ใหม่", () => {
    const r = partialTotals({ mode: "return", qtys: { 1: 3 } }, ctx);
    expect(r).toMatchObject({ diff: 794.39, vat: 55.61, total: 850, correct: 0, closing: true });
  });
  it("คืนบางส่วนที่มูลค่าเกินยอดที่ยังลดได้ → บอกเหตุผลและทางออก (ไม่ใช่ข้อความยอดเกินเฉย ๆ)", () => {
    const r = partialTotals({ mode: "return", qtys: { 1: 3 } }, { ...ctx, items: [{ id: 1, name: "A", qty: 5, price: 350 }], grandTotal: 1750 });
    expect(r).toMatch(/เกินยอดที่ยังลดได้ 850\.00.*ใส่ครบทุกรายการ/);
  });
  it("บนกระดาษ: ตารางรายการบวกได้เท่ายอดบนใบ (บรรทัดหักส่วนต่าง)", () => {
    const html = creditNoteDocsHtml(COMPANY, vatOrder(0), ITEMS, {
      cnNo: "CN-3", cnDate: "2026-11-06", reasonText: "x", refs: [{ docNo: "T1", date: "2026-11-06", preVat: 1308.41, vat: 91.59 }],
      original: 794.39, correct: 0, diff: 794.39, vat: 55.61, total: 850, refund: 850, wht: 0, refundAccount: "",
      kind: "return", items: [{ name: "A", qty: 3, price: 350 }],
    });
    const t = html.split("(สำเนา")[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(t).toMatch(/หัก ส่วนลดตามใบกำกับเดิม \/ ยอดที่ลดหนี้ไปแล้ว 1 -200\.00 -200\.00/);
  });
});
