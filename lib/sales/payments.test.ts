import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import {
  PAY_LABEL, payLabelFor, paymentForDoc, type SalesPayment,
  PAY_METHODS, chequeText, receiptDocFor, hasReceivedPayment, editPaymentDoneText, parseCheque,
} from "./payments";
import { processOrder, type OrderState, type RevenueConfig } from "./orders";

/**
 * golden S15 — การรับเงินทีละครั้ง sales_payments (D143 · 0099)
 */

const pay = (seq: number, label: string, method: string, chequeDetail = ""): SalesPayment => ({
  seq, label, amount: 100, method, chequeDetail, docDate: "2026-10-30", docNo: `TAX-${seq}`, txId: `TR-${seq}`,
});

describe("S15 payLabelFor", () => {
  it("action รับเงินทุกตัวมีป้าย · action อื่นไม่มี", () => {
    expect(payLabelFor("DEPOSIT_AND_SEND")).toBe(PAY_LABEL.deposit);
    expect(payLabelFor("PAY_BALANCE")).toBe(PAY_LABEL.balance);
    expect(payLabelFor("FULL_PAYMENT_AND_SEND")).toBe(PAY_LABEL.full);
    expect(payLabelFor("FULL_PAYMENT_LATER")).toBe(PAY_LABEL.full);
    for (const a of ["SEND_TO_WH", "ISSUE_INVOICE_FULL", "ISSUE_INVOICE_DEPOSIT"] as const) {
      expect(payLabelFor(a), a).toBeNull();
    }
  });
});

describe("S15 paymentForDoc — ใบเสร็จแต่ละใบได้แถวของครั้งตัวเอง", () => {
  const both = [pay(1, PAY_LABEL.deposit, "เงินสด"), pay(2, PAY_LABEL.balance, "โอนเงิน")];

  it("🔴 บั๊กเดิม: ใบเสร็จมัดจำหลังรับยอดค้างแล้ว ต้องได้วิธีชำระของมัดจำ", () => {
    expect(paymentForDoc("tax-invoice-deposit", both)?.method).toBe("เงินสด");
    expect(paymentForDoc("tax-invoice-balance", both)?.method).toBe("โอนเงิน");
  });
  it("ใบเสร็จจ่ายเต็มทั้ง 2 แบบ → แถวชำระเต็ม", () => {
    const full = [pay(1, PAY_LABEL.full, "เช็ค", "ธนาคารกสิกร เลขที่เช็ค : 123")];
    expect(paymentForDoc("tax-invoice-receipt", full)?.chequeDetail).toContain("123");
    expect(paymentForDoc("tax-invoice-receipt-do", full)?.method).toBe("เช็ค");
  });
  it("ใบแจ้งหนี้ไม่ใช่ใบเสร็จ → null (ใช้ค่าของออเดอร์ตามเดิม)", () => {
    for (const d of ["invoice", "invoice-only", "invoice-deposit"]) expect(paymentForDoc(d, both), d).toBeNull();
  });
  it("ไม่มีแถว (ออเดอร์เก่าที่ไม่มีบิลให้ backfill) → null", () => {
    expect(paymentForDoc("tax-invoice-deposit", [])).toBeNull();
    expect(paymentForDoc("tax-invoice-deposit", undefined)).toBeNull();
  });
  it("จับคู่ด้วยป้าย ไม่ใช่ลำดับ — backfill ได้แค่ครั้งที่ 2 ก็ยังถูกใบ", () => {
    expect(paymentForDoc("tax-invoice-balance", [pay(2, PAY_LABEL.balance, "โอนเงิน")])?.seq).toBe(2);
    expect(paymentForDoc("tax-invoice-deposit", [pay(2, PAY_LABEL.balance, "โอนเงิน")])).toBeNull();
  });
});

describe("S15 processOrder ส่งข้อมูลของครั้งนี้ไปให้ RPC", () => {
  const contact = { taxId: "0105512345671", branch: "สำนักงานใหญ่", address: "กทม." };
  const items = [{ name: "เหล้า", qty: 2, price: 500 }];
  const config: RevenueConfig = { accountName: "ธนาคาร", entityId: "EID01" };
  const order: OrderState = {
    quNo: "QU261030-001", orderNo: "ORD261030-001", status: "รอคอนเฟิร์ม",
    deposit: 0, outstandingBalance: 1070, subTotal: 1000, discount: 0, whtPercent: 0,
    category: "รายได้ค่าสินค้า", customerName: "ทดสอบ", invNo: "", taxNo1: "", taxNo2: "",
  };

  it("มัดจำด้วยเช็ค → ป้าย/วิธี/เช็คของครั้งนี้", () => {
    const r = processOrder(order, "DEPOSIT_AND_SEND",
      { amount: 535, method: "เช็ค", chequeDetails: "ธนาคารกสิกร เลขที่เช็ค : 99", docDate: "2026-10-30" },
      items, { invNo: "INV1", taxNo1: "TAX1" }, contact, config);
    expect(r.revenue!.paymentLabel).toBe("มัดจำ");
    expect(r.revenue!.paymentMethod).toBe("เช็ค");
    expect(r.revenue!.chequeDetail).toContain("99");
  });
  it("ยอดค้างด้วยโอน → ป้ายยอดค้าง · ไม่มีเช็ค", () => {
    const after: OrderState = { ...order, status: "ส่งของแล้วรอชำระยอดค้าง", deposit: 535, outstandingBalance: 535, invNo: "INV1", taxNo1: "TAX1" };
    const r = processOrder(after, "PAY_BALANCE", { method: "โอนเงิน", docDate: "2026-11-05" },
      items, { taxNo2: "TAX2" }, contact, config);
    expect(r.revenue!.paymentLabel).toBe("ชำระยอดค้าง");
    expect(r.revenue!.paymentMethod).toBe("โอนเงิน");
    expect(r.revenue!.chequeDetail).toBe("");
  });
  it("ข้อความ LINE ใช้ป้ายชุดเดียวกัน", () => {
    const r = processOrder(order, "FULL_PAYMENT_AND_SEND", { method: "เงินสด", docDate: "2026-10-30" },
      items, { taxNo1: "TAX1" }, contact, config);
    expect(r.lineMsg).toContain(`${PAY_LABEL.full} ฿1,070`);
  });
});

describe("S15 SQL ⇄ TS (0099)", () => {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const latestDef = (name: string) => {
    const f = [...files].reverse().find((x) => readFileSync(`${dir}/${x}`, "utf8").includes(`create or replace function ${name}(`));
    const src = readFileSync(`${dir}/${f}`, "utf8");
    const start = src.indexOf(`create or replace function ${name}(`);
    return src.slice(start, src.indexOf("end $", start));
  };

  it("fn_apply_order_action ล่าสุดเขียน sales_payments ด้วยคีย์ที่ processOrder ส่งจริง", () => {
    const def = latestDef("fn_apply_order_action");
    expect(def).toMatch(/insert into sales_payments/);
    for (const k of ["paymentLabel", "paymentMethod", "chequeDetail"]) expect(def, k).toContain(`p_revenue->>'${k}'`);
    // ต้องอยู่ใต้ not v_dup — กดซ้ำแล้วไม่เกิดแถวซ้ำ
    expect(def.indexOf("if not v_dup then")).toBeLessThan(def.indexOf("insert into sales_payments"));
  });
  it("backfill ใช้ป้ายชุดเดียวกับ PAY_LABEL", () => {
    const src = readFileSync(`${dir}/${files.find((f) => f.includes("_sales_payments"))}`, "utf8");
    for (const l of Object.values(PAY_LABEL)) expect(src, l).toContain(`'${l}'`);
  });
  it("ใบเสร็จอ่านแถวของครั้งนั้นผ่าน paymentForDoc", () => {
    const print = readFileSync("app/(app)/sales/_components/print.ts", "utf8");
    expect(print).toMatch(/paymentForDoc\(docType, order\.payments\)/);
  });
});

// ── D144 · เฟส 2 แก้วิธีชำระ ──────────────────────────────────────────────────

describe("S15 แก้วิธีชำระ (D144)", () => {
  it("PAY_METHODS ตรงกับ array ใน fn_sales_edit_payment ล่าสุด", () => {
    const dir = "supabase/migrations";
    const f = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort().reverse()
      .find((x) => readFileSync(`${dir}/${x}`, "utf8").includes("create or replace function fn_sales_edit_payment("));
    const src = readFileSync(`${dir}/${f}`, "utf8");
    const arr = src.match(/v_method = any \(array\[([^\]]*)\]\)/)?.[1] ?? "";
    expect([...arr.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...PAY_METHODS]);
  });
  it("RPC ต้องเช็ค sales.config และบล็อกบิลที่ยกเลิกแล้ว", () => {
    const dir = "supabase/migrations";
    const f = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort().reverse()
      .find((x) => readFileSync(`${dir}/${x}`, "utf8").includes("create or replace function fn_sales_edit_payment("));
    const src = readFileSync(`${dir}/${f}`, "utf8");
    expect(src).toContain("has_cap('sales.config')");
    expect(src).toMatch(/status = 'ยกเลิก'/);
  });
  it("chequeText รูปเดิมของหน้าต่างรับเงิน", () => {
    expect(chequeText("กสิกรไทย", "123", "2026-10-30")).toBe("ธนาคารกสิกรไทย เลขที่เช็ค : 123 ลงวันที่ 2026-10-30");
    expect(chequeText("ธนาคารกรุงเทพ", "9", "")).toBe("ธนาคารกรุงเทพ เลขที่เช็ค : 9 ลงวันที่ -");
    expect(chequeText("", "", "")).toBe("- เลขที่เช็ค : - ลงวันที่ -");
  });
  it("หน้าต่างรับเงินใช้ chequeText ตัวเดียวกัน (ไม่ประกอบเอง)", () => {
    const src = readFileSync("app/(app)/sales/_components/OrdersTab.tsx", "utf8");
    expect(src).toMatch(/chequeText\(chequeBank, chequeNo, chequeDate\)/);
    expect(src).not.toMatch(/เลขที่เช็ค : \$\{/);
  });
  it("receiptDocFor — กติกาเดียวกับปุ่มพิมพ์เดิม", () => {
    expect(receiptDocFor("มัดจำ", { dueDate: "", deposit: 100 })).toBe("tax-invoice-deposit");
    expect(receiptDocFor("ชำระยอดค้าง", { dueDate: "2026-11-01", deposit: 100 })).toBe("tax-invoice-balance");
    expect(receiptDocFor("ชำระเต็ม", { dueDate: "", deposit: 0 })).toBe("tax-invoice-receipt-do");
    expect(receiptDocFor("ชำระเต็ม", { dueDate: "2026-11-01", deposit: 0 })).toBe("tax-invoice-receipt");
    expect(receiptDocFor("รับชำระ", { dueDate: "", deposit: 0 })).toBeNull();
  });
  it("hasReceivedPayment — ตัดสินจากยอด ไม่ใช่สถานะ", () => {
    const o = { status: "รอคลังจัดส่ง", netPayable: 1000, grandTotal: 1000 };
    expect(hasReceivedPayment({ ...o, outstandingBalance: 1000 })).toBe(false); // ส่งเครดิต ยังไม่รับเงิน
    expect(hasReceivedPayment({ ...o, outstandingBalance: 500 })).toBe(true); // รับมัดจำแล้ว
    expect(hasReceivedPayment({ ...o, status: "ปิดการขาย", outstandingBalance: 0 })).toBe(true);
    expect(hasReceivedPayment({ ...o, status: "ยกเลิก", outstandingBalance: 0 })).toBe(false);
  });
  it("ข้อความหลังแก้บอกบัญชีที่ย้ายและเลขที่พิมพ์ใหม่ได้", () => {
    const t = editPaymentDoneText("โอนเงิน", { from_method: "เงินสด", from_account: "เงินสดในมือ", to_account: "กสิกร", doc_no: "TAX-1" });
    expect(t).toBe("แก้วิธีชำระแล้ว: เงินสด → โอนเงิน · บิลรายรับย้ายบัญชี เงินสดในมือ → กสิกร · พิมพ์ใบ TAX-1 ใหม่ได้เลย (เลขเดิม)");
    // บัญชีเดิม = ไม่พูดถึงบัญชี (ไม่ตั้งบัญชีเงินสดแยก)
    expect(editPaymentDoneText("บัตรเครดิต", { from_method: null, from_account: "ก", to_account: "ก", doc_no: null }))
      .toBe("แก้วิธีชำระแล้ว: ไม่ระบุ → บัตรเครดิต");
  });
});

describe("S15 parseCheque — เติมเช็คเดิมตอนแก้ (D144)", () => {
  it("ย้อนรูปของ chequeText ได้ครบ 3 ช่อง", () => {
    expect(parseCheque(chequeText("กรุงเทพ", "D144-01", "2026-10-30")))
      .toEqual({ bank: "ธนาคารกรุงเทพ", no: "D144-01", date: "2026-10-30" });
  });
  it("ช่องที่เคยว่าง (-) กลับเป็นว่าง · วันที่ไม่ใช่รูป yyyy-mm-dd = ว่าง", () => {
    expect(parseCheque(chequeText("", "", ""))).toEqual({ bank: "", no: "", date: "" });
    expect(parseCheque("ธนาคารกสิกร เลขที่เช็ค : 5 ลงวันที่ 30/10/2569")).toEqual({ bank: "ธนาคารกสิกร", no: "5", date: "" });
  });
  it("รูปอื่น/ว่าง → ไม่เดาแยก ใส่ทั้งก้อนในช่องธนาคาร", () => {
    expect(parseCheque("เช็คกสิกร 12345")).toEqual({ bank: "เช็คกสิกร 12345", no: "", date: "" });
    expect(parseCheque("")).toEqual({ bank: "", no: "", date: "" });
  });
});
