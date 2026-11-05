import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { processOrder, type OrderState, type RevenueConfig } from "./orders";
import { STATUS_INSTALLMENT, type Installment } from "./installments";
import { salesDocsHtml } from "@/app/(app)/sales/_components/print";
import { COMPANY, ITEMS, vatOrder, planned } from "./salesDocHtml.fixtures";

/**
 * golden S21 — ใบแจ้งหนี้/ใบส่งสินค้าของออเดอร์แบ่งงวด พิมพ์ซ้ำแล้วยอดเท่าวันที่ออก (D156 · 0104)
 *
 * 🔴 เดิมหัก "รับชำระแล้ว" ด้วย deposit ปัจจุบัน → ส่งของหลังงวด 1 แล้วรับครบ พิมพ์ซ้ำขึ้นคงค้าง 0.00
 * ★ แช่ยอด ณ ตอนออกเลขใบแจ้งหนี้ (`invPaidBefore` → sales_orders.inv_paid_before)
 */

const inst = (seq: number, amount: number, o: Partial<Installment> = {}): Installment => ({
  seq, label: "", percent: null, amount, dueDate: "", invNo: "", invDate: "", shipPoint: false, paid: false, ...o,
});
const contact = { taxId: "", branch: "สำนักงานใหญ่", address: "" };
const items = [{ name: "เหล้า", qty: 2, price: 535 }];
const config: RevenueConfig = { accountName: "ธนาคาร", entityId: "EID01" };
const base: OrderState = {
  quNo: "QU1", orderNo: "ORD1", status: STATUS_INSTALLMENT, deposit: 749, outstandingBalance: 321,
  subTotal: 1000, discount: 0, whtPercent: 0, category: "รายได้ค่าสินค้า", customerName: "ทดสอบ",
  invNo: "", taxNo1: "", taxNo2: "",
  installments: [inst(1, 535, { paid: true }), inst(2, 214, { paid: true }), inst(3, 321, { shipPoint: true })],
};

describe("S21 processOrder แช่ยอดตอนออกเลขใบแจ้งหนี้", () => {
  it("รับงวดที่เป็นจุดส่งของ → นับงวดนี้ด้วย (ใบแจ้งหนี้ออกพร้อมกัน)", () => {
    const r = processOrder(base, "RECEIVE_INSTALLMENT", { installmentSeq: 3, amount: 321, method: "เงินสด", docDate: "2026-11-30" },
      items, { invNo: "INV-9", taxNo1: "TAX-I3" }, contact, config);
    expect(r.update.invNo).toBe("INV-9");
    expect(r.update.invPaidBefore).toBe(1070);
  });
  it("ส่งคลังตอนนี้ก่อนถึงจุดส่ง → ยอดที่รับแล้วถึงตอนนั้น", () => {
    const o = { ...base, deposit: 535, outstandingBalance: 535 };
    const r = processOrder(o, "SHIP_PLAN", { docDate: "2026-11-01" }, items, { invNo: "INV-2" }, contact, config);
    expect(r.update.invPaidBefore).toBe(535);
  });
  it("มีเลขใบแจ้งหนี้อยู่แล้ว / งวดที่ไม่ใช่จุดส่งของ = ไม่เขียนทับค่าที่แช่ไว้", () => {
    const shipped = { ...base, invNo: "INV-2", installments: [inst(1, 535, { paid: true }), inst(2, 214), inst(3, 321)] };
    const r1 = processOrder(shipped, "RECEIVE_INSTALLMENT", { installmentSeq: 2, amount: 214, method: "เงินสด", docDate: "2026-11-15" },
      items, { taxNo1: "TAX-I2" }, contact, config);
    expect(r1.update.invPaidBefore).toBeUndefined();
    const notShip = { ...base, deposit: 535, outstandingBalance: 535, installments: [inst(1, 535, { paid: true }), inst(2, 214), inst(3, 321, { shipPoint: true })] };
    const r2 = processOrder(notShip, "RECEIVE_INSTALLMENT", { installmentSeq: 2, amount: 214, method: "เงินสด", docDate: "2026-11-15" },
      items, { taxNo1: "TAX-I2" }, contact, config);
    expect(r2.update.invPaidBefore).toBeUndefined();
  });
  it("ออเดอร์แบบเดิม (ไม่แบ่งงวด) ไม่แช่ค่านี้ — deposit ตั้งครั้งเดียวอยู่แล้ว", () => {
    const plain: OrderState = { ...base, status: "รอคอนเฟิร์ม", deposit: 0, outstandingBalance: 1070, installments: [] };
    for (const [action, payload] of [
      ["DEPOSIT_AND_SEND", { amount: 500, method: "โอนเงิน", docDate: "2026-11-01", creditDays: 30 }],
      ["SEND_TO_WH", { docDate: "2026-11-01", creditDays: 30 }],
      ["ISSUE_INVOICE_FULL", { docDate: "2026-11-01" }],
    ] as const) {
      const r = processOrder(plain, action, payload, items, { invNo: "INV-X", taxNo1: "TAX-X" }, contact, config);
      expect(r.update.invPaidBefore, action).toBeUndefined();
    }
  });
});

describe("S21 ตัวพิมพ์ใช้ยอดที่แช่ไว้", () => {
  const summary = (html: string) => html.split("(สำเนา")[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").match(/รวมเป็นเงิน.*?\( ผู้/)?.[0] ?? "";
  // ออเดอร์ 2,140 · รับครบแล้ว (deposit 2,140) · ตอนส่งของรับไปแค่ 1,000
  const paidAll = { ...planned(vatOrder(0), true), deposit: 2140 };

  it("🔴 เคสที่เจอจริง: รับครบแล้วพิมพ์ซ้ำ → ยังหักแค่ 1,000 คงค้าง 1,140", () => {
    const s = summary(salesDocsHtml(COMPANY, { ...paidAll, invNo: "INV-S", invPaidBefore: 1000 }, ITEMS, ["invoice"]));
    expect(s).toContain("หัก รับชำระแล้ว (ก่อน VAT) -934.58");
    expect(s).toContain("ยอดค้างชำระ (รวม VAT) 1,140.00");
  });
  it("ไม่มีค่าที่แช่ไว้ (null) = แบบเดิม (หัก deposit ปัจจุบัน) — ไม่เดาตัวเลข", () => {
    const s = summary(salesDocsHtml(COMPANY, { ...paidAll, invNo: "INV-S", invPaidBefore: null }, ITEMS, ["invoice"]));
    expect(s).toContain("ยอดค้างชำระ (รวม VAT) 0.00");
  });
  it("ส่งของก่อนรับเงินสักงวด (แช่ 0) → ไม่มีบรรทัดหัก ยอดค้างเต็ม", () => {
    const s = summary(salesDocsHtml(COMPANY, { ...paidAll, invNo: "INV-S", invPaidBefore: 0 }, ITEMS, ["invoice"]));
    expect(s).not.toContain("หัก รับชำระแล้ว");
  });
  it("ออเดอร์แบบเดิม: มีค่านี้ติดมาก็ไม่ใช้ (หัก deposit เหมือนเดิม)", () => {
    const s = summary(salesDocsHtml(COMPANY, { ...vatOrder(0), invPaidBefore: 0 }, ITEMS, ["invoice"]));
    expect(s).toContain("หัก มัดจำรับแล้ว (ก่อน VAT) -934.58");
  });
});

describe("S21 SQL (0104)", () => {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const latest = [...files].reverse().find((x) => readFileSync(`${dir}/${x}`, "utf8").includes("create or replace function fn_apply_order_action("))!;
  const src = readFileSync(`${dir}/${latest}`, "utf8");
  it("fn_apply_order_action ล่าสุดเขียน inv_paid_before จาก invPaidBefore", () => {
    expect(src).toContain("inv_paid_before     = coalesce((p_update->>'invPaidBefore')::numeric, inv_paid_before)");
  });
  it("backfill: เฉพาะออเดอร์แบ่งงวดที่มี inv_no · ไม่เขียนทับค่าที่มีแล้ว · หาเวลาจาก edit_log", () => {
    expect(src).toContain("o.inv_no is not null and o.inv_paid_before is null");
    expect(src).toMatch(/exists \(select 1 from sales_installments i/);
    expect(src).toContain("p.created_at <= e.at");
  });
});
