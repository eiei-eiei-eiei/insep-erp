import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cancelledDocTypes, CANCEL_ORDER_DETAIL, type CancelledDocSource } from "./cancelledDocs";
import type { Installment } from "./installments";
import type { SalesPayment } from "./payments";

/**
 * golden S18 — พิมพ์ใบที่ยกเลิก (D153)
 * ใบที่ออกไปแล้วตัดสินจากเลขเอกสารที่มีจริง · ชนิดเอกสารใช้กฎเดียวกับปุ่มพิมพ์ของออเดอร์ที่ยังไม่ยกเลิก
 */

const base: CancelledDocSource = { invNo: "", taxNo1: "", taxNo2: "", deposit: 0, dueDate: "" };
const inst = (seq: number, invNo = ""): Installment => ({
  seq, label: "", percent: null, amount: 100, dueDate: "", invNo, invDate: "", shipPoint: false, paid: false,
});
const pay = (seq: number, installmentSeq: number | null, docNo = `TAX-${seq}`): SalesPayment => ({
  seq, label: "", amount: 100, method: "โอนเงิน", chequeDetail: "", docDate: "2026-11-01", docNo, txId: `TR-${seq}`, installmentSeq,
});

describe("S18 cancelledDocTypes — ออเดอร์แบบเดิม", () => {
  it("ยกเลิกตอนรอคอนเฟิร์ม (ยังไม่มีเลขใด ๆ) = ไม่มีอะไรให้พิมพ์", () => {
    expect(cancelledDocTypes(base)).toEqual([]);
  });

  it("มัดจำพร้อมส่ง → ใบแจ้งหนี้/ใบส่งสินค้า + ใบกำกับค่ามัดจำ", () => {
    expect(cancelledDocTypes({ ...base, invNo: "INV1", taxNo1: "TAX1", deposit: 500, dueDate: "2026-11-30" }))
      .toEqual(["invoice", "tax-invoice-deposit"]);
  });

  it("มัดจำแล้วรับยอดค้าง → เพิ่มใบกำกับยอดค้าง", () => {
    expect(cancelledDocTypes({ ...base, invNo: "INV1", taxNo1: "TAX1", taxNo2: "TAX2", deposit: 500, dueDate: "2026-11-30" }))
      .toEqual(["invoice", "tax-invoice-deposit", "tax-invoice-balance"]);
  });

  it("จ่ายเต็มพร้อมส่ง (ไม่มีใบแจ้งหนี้ · ไม่มีวันครบกำหนด) → ใบกำกับ/ใบเสร็จ/ใบส่งสินค้า", () => {
    expect(cancelledDocTypes({ ...base, taxNo1: "TAX1" })).toEqual(["tax-invoice-receipt-do"]);
  });

  it("ส่งของก่อนแล้วรับเต็มทีหลัง (มีวันครบกำหนด) → ใบแจ้งหนี้/ใบส่งสินค้า + ใบกำกับ/ใบเสร็จ", () => {
    expect(cancelledDocTypes({ ...base, invNo: "INV1", taxNo1: "TAX1", dueDate: "2026-11-30" }))
      .toEqual(["invoice", "tax-invoice-receipt"]);
  });

  it("ใบแจ้งหนี้ (จ่ายเต็ม) ไม่มีวันครบกำหนด → ใบแจ้งหนี้อย่างเดียว ไม่ใช่ใบส่งสินค้า", () => {
    expect(cancelledDocTypes({ ...base, invNo: "INV1" })).toEqual(["invoice-only"]);
    expect(cancelledDocTypes({ ...base, invNo: "INV1", taxNo1: "TAX1" })).toEqual(["invoice-only", "tax-invoice-receipt-do"]);
  });

  it("ใบแจ้งหนี้ค่ามัดจำมาก่อนเสมอ", () => {
    expect(cancelledDocTypes({ ...base, depInvNo: "INV0" })).toEqual(["invoice-deposit"]);
    expect(cancelledDocTypes({ ...base, depInvNo: "INV0", invNo: "INV1", taxNo1: "TAX1", deposit: 500, dueDate: "2026-11-30" }))
      .toEqual(["invoice-deposit", "invoice", "tax-invoice-deposit"]);
  });

  it("ผู้ไม่จด VAT ใช้ช่องเลขใบเสร็จ (rcpt) แทน tax · ได้ชนิดเอกสารเดียวกัน", () => {
    expect(cancelledDocTypes({ ...base, rcptNo1: "RC1" })).toEqual(["tax-invoice-receipt-do"]);
    expect(cancelledDocTypes({ ...base, invNo: "INV1", rcptNo1: "RC1", rcptNo2: "RC2", deposit: 500, dueDate: "2026-11-30" }))
      .toEqual(["invoice", "tax-invoice-deposit", "tax-invoice-balance"]);
  });
});

describe("S18 cancelledDocTypes — ออเดอร์แบ่งงวด", () => {
  it("เฉพาะงวดที่มีเลขใบแจ้งหนี้ / มีการรับเงินที่มีเลขใบเสร็จ · เรียงตามงวด", () => {
    const o: CancelledDocSource = {
      ...base, deposit: 300,
      installments: [inst(2), inst(1, "INV-I1"), inst(3)],
      payments: [pay(1, 1), pay(2, 2)],
    };
    expect(cancelledDocTypes(o)).toEqual([
      "invoice-installment:1", "tax-invoice-installment:1", "tax-invoice-installment:2",
    ]);
  });

  it("ส่งของแล้ว (มี inv_no) → ใบแจ้งหนี้/ใบส่งสินค้าท้ายสุด · ไม่อ่าน tax_no ของออเดอร์ (งวดไม่ใช้ช่องนั้น)", () => {
    const o: CancelledDocSource = {
      ...base, invNo: "INV9", taxNo1: "ไม่ควรถูกอ่าน", deposit: 100,
      installments: [inst(1)], payments: [pay(1, 1)],
    };
    expect(cancelledDocTypes(o)).toEqual(["tax-invoice-installment:1", "invoice"]);
  });

  it("แถวรับเงินที่ไม่มีเลขใบเสร็จ หรือไม่ใช่ของงวด = ไม่พิมพ์", () => {
    const o: CancelledDocSource = {
      ...base, installments: [inst(1)], payments: [pay(1, 1, ""), pay(2, null)],
    };
    expect(cancelledDocTypes(o)).toEqual([]);
  });
});

describe("S18 หน้าจอ — ปุ่มกับคำอธิบายตรงกัน", () => {
  const tab = readFileSync("app/(app)/sales/_components/OrdersTab.tsx", "utf8");
  it("ปุ่มพิมพ์ใบที่ยกเลิกมีอยู่จริง และส่งธง cancelled ให้ตัวพิมพ์", () => {
    expect(tab).toMatch(/>พิมพ์ใบที่ยกเลิก</);
    expect(tab).toMatch(/printSalesDocs\([^)]*\{ cancelled: true \}\)/);
  });
  it("กล่องยืนยันยกเลิกชี้ไปที่แท็บย่อยกับปุ่มที่มีอยู่จริง", () => {
    // D159 — ข้อความย้ายไปอยู่ในกล่อง CancelOrderDialog (กรณียกเลิกแบบเดิม)
    const dlg = readFileSync("app/(app)/sales/_components/CancelOrderDialog.tsx", "utf8");
    expect(dlg).toContain("{CANCEL_ORDER_DETAIL}");
    expect(tab).toMatch(/>\s*ปิด \/ ยกเลิก\s*</);
    expect(CANCEL_ORDER_DETAIL).toContain("ปิด / ยกเลิก → พิมพ์ใบที่ยกเลิก");
  });
  it("ตรายกเลิกอยู่ในแผ่นเอกสาร (ติดไปทั้งตอนพิมพ์และภาพที่คัดลอก) ทั้งเอกสารขายและใบเสนอราคา", () => {
    const pr = readFileSync("app/(app)/sales/_components/print.ts", "utf8");
    expect(pr).toMatch(/\$\{cancelled \? cancelledStamp\(\) : ""\}/);
    expect(pr).toMatch(/\$\{d\.cancelled \? cancelledStamp\(\) : ""\}/);
  });
  it("ยกเลิกก่อนออกเอกสาร = พิมพ์ใบเสนอราคาพร้อมตรา ไม่ใช่ปิดหน้าต่างเงียบ ๆ", () => {
    expect(tab).toMatch(/if \(!docs\.length\) return doReprintQuotation\(o, w, true\)/);
    expect(tab).toContain("orderNo: o.orderNo");
  });
  it("ปุ่มพิมพ์ใบเสนอราคาซ้ำของออเดอร์ที่ยกเลิก ต้องติดตราด้วย (ไม่งั้นได้ใบเสนอราคาหน้าตาปกติของออเดอร์ที่ยกเลิก)", () => {
    const plain = tab.match(/doReprintQuotation\(o\)/g) ?? [];
    expect(plain.length).toBe(0);
    expect((tab.match(/doReprintQuotation\(o, undefined, o\.status === "ยกเลิก"\)/g) ?? []).length).toBe(2);
  });
});
