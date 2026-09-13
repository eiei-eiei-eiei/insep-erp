import { describe, it, expect } from "vitest";
import { buildReceipt, docKind, shouldShowQr, type ReceiptInput } from "./receipt";
import { receiptHtml } from "./print80";
import { barTotals } from "./totals";
import type { CartLine } from "./types";

/**
 * golden **B8** — เนื้อหาสลิป/ใบเสร็จ (D96)
 *
 * 🚨 ข้อที่ชุดนี้ล็อกไว้เหนืออย่างอื่น: **ใบที่จ่ายแล้วห้ามมี QR**
 *    QR บนจอหายไปเองเมื่อปิดหน้า แต่กระดาษอยู่กับลูกค้าตลอดไป
 *    ⇒ ลูกค้าหยิบใบเก่ามาสแกนคืนหน้า = โอนเงินซ้ำโดยไม่มีอะไรกัน
 */

const LINES: CartLine[] = [
  { menuId: "M1", menuName: "Negroni", qty: 2, price: 260 },
  { menuId: "M3", menuName: "ถั่วทอด", qty: 1, price: 80 },
];

const base = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
  status: "เปิดอยู่",
  saleNo: "B260911-001",
  lines: LINES,
  totals: barTotals(LINES),
  seller: { name: "ศิวกร (บาร์)", taxId: "1234567890123" },
  printedAt: "2026-09-11T23:41:00+07:00",
  qrPayload: "00020101021229...6304ABCD",
  ...over,
});

describe("ชนิดเอกสาร", () => {
  it("บิลยังเปิด = ใบแจ้งรายการ (ยังไม่ชำระ)", () => {
    expect(docKind({ status: "เปิดอยู่" })).toBe("bill-unpaid");
  });

  it("ปิดบิลแล้ว = ใบแจ้งรายการ (ชำระแล้ว)", () => {
    expect(docKind({ status: "ปกติ" })).toBe("bill-paid");
  });

  it("กดขอใบเสร็จ = ใบเสร็จรับเงิน", () => {
    expect(docKind({ status: "ปกติ", wantReceipt: true })).toBe("receipt");
  });

  it("หัวกระดาษเป็นภาษาไทยตามชนิด", () => {
    expect(buildReceipt(base()).title).toBe("ใบแจ้งรายการ");
    expect(buildReceipt(base({ status: "ปกติ", wantReceipt: true })).title).toBe("ใบเสร็จรับเงิน");
  });
});

describe("🚨 QR — เงื่อนไขเดียว: บิลต้องยังไม่ถูกปิด", () => {
  it("บิลเปิดอยู่ + มี payload → มี QR", () => {
    expect(shouldShowQr({ status: "เปิดอยู่", qrPayload: "x" })).toBe(true);
    expect(buildReceipt(base()).hasQr).toBe(true);
  });

  it("🚨 ปิดบิลแล้ว → **ไม่มี QR** (กันลูกค้าหยิบใบเก่ามาสแกนแล้วจ่ายซ้ำ)", () => {
    const doc = buildReceipt(base({ status: "ปกติ" }));
    expect(doc.hasQr).toBe(false);
    expect(doc.qrPayload).toBeNull();
  });

  it("🚨 ใบเสร็จรับเงินไม่มี QR เด็ดขาด", () => {
    const doc = buildReceipt(base({ status: "ปกติ", wantReceipt: true }));
    expect(doc.hasQr).toBe(false);
    expect(doc.qrPayload).toBeNull();
  });

  it("บิลถูกยกเลิก → ไม่มี QR", () => {
    expect(buildReceipt(base({ status: "ยกเลิก" })).hasQr).toBe(false);
  });

  it("ตั้งค่าพร้อมเพย์ไม่ครบ (payload เป็น null) → ไม่มี QR แม้บิลยังเปิด", () => {
    expect(buildReceipt(base({ qrPayload: null })).hasQr).toBe(false);
  });

  it("🪤 ไม่ผูกกับวิธีรับเงิน — ลูกค้าเปลี่ยนใจจ่ายสดหลังเห็นบิลได้", () => {
    expect(shouldShowQr({ status: "เปิดอยู่", qrPayload: "x" })).toBe(true);
  });
});

describe("ประทับสถานะการชำระ", () => {
  it("ยังไม่ปิดบิล = ไม่มีประทับ", () => {
    expect(buildReceipt(base()).paidStamp).toBeNull();
  });

  it("ปิดแล้ว = ชำระแล้ว + วิธี + เวลา", () => {
    const doc = buildReceipt(base({ status: "ปกติ", method: "โอนเงิน", closedAt: "11/09/2569 23:41" }));
    expect(doc.paidStamp).toBe("ชำระแล้ว · โอนเงิน · 11/09/2569 23:41");
  });

  it("ไม่มีวิธี/เวลา ก็ยังบอกว่าชำระแล้ว (ไม่ทิ้งจุดคั่นลอย)", () => {
    expect(buildReceipt(base({ status: "ปกติ" })).paidStamp).toBe("ชำระแล้ว");
  });

  it("บิลถูกยกเลิกต้องเขียนบนกระดาษให้ชัด", () => {
    expect(buildReceipt(base({ status: "ยกเลิก" })).paidStamp).toBe("บิลนี้ถูกยกเลิก");
  });
});

describe("รายการบนกระดาษ", () => {
  it("แถวที่ถูกยกเลิกไม่ขึ้นบนบิล", () => {
    const doc = buildReceipt(
      base({ lines: [LINES[0], { ...LINES[1], voidedAt: "2026-09-11T20:00:00Z" }] }),
    );
    expect(doc.lines.map((l) => l.name)).toEqual(["Negroni"]);
  });

  it("ของแถมขึ้นบนบิลด้วยยอด 0 และติดธงไว้ให้พิมพ์คำว่าแถมได้", () => {
    const doc = buildReceipt(base({ lines: [{ ...LINES[0], isComp: true }] }));
    expect(doc.lines[0]).toMatchObject({ amount: 0, comp: true });
  });

  /**
   * 🔄 **กติกาเปลี่ยนใน D96 เฟส G — ผู้ใช้เป็นคนเปลี่ยนเอง**
   *    เดิม "ห้ามพิมพ์ป้ายช่องทาง/งานลงบิลเด็ดขาด" · ตอนนี้เป็น **สวิตช์ที่ปริยายปิด**
   *    ★ ปริยายปิดเพราะมันคือกระดาษที่อยู่ในมือลูกค้า — ป้ายอย่าง "งานวันเกิดพี่โอ๊ต"
   *      ไม่ควรโผล่โดยที่เจ้าของร้านไม่ได้ตั้งใจ
   */
  it("🚫 ปริยาย — ป้ายช่องทาง/งานไม่ขึ้นบนกระดาษ แม้จะส่งค่ามาให้", () => {
    const doc = buildReceipt({ ...base(), channel: "บูธ Craft Fest" });
    expect(doc.layout.on("channel")).toBe(false);
    expect(receiptHtml(doc)).not.toContain("บูธ Craft Fest");
  });

  it("เปิดสวิตช์เองแล้วถึงจะขึ้น (คู่ตรงข้าม)", () => {
    const doc = buildReceipt({
      ...base(),
      channel: "บูธ Craft Fest",
      layout: { off: [] }, // ผู้ใช้เปิดทุกบล็อก
    });
    expect(doc.layout.on("channel")).toBe(true);
    expect(receiptHtml(doc)).toContain("บูธ Craft Fest");
  });

  it("เลขเอกสาร: ใบแจ้งรายการใช้เลขบิล · ใบเสร็จใช้เลขใบเสร็จ", () => {
    expect(buildReceipt(base()).docNo).toBe("B260911-001");
    expect(
      buildReceipt(base({ status: "ปกติ", wantReceipt: true, rcptNo: "BR260911-007" })).docNo,
    ).toBe("BR260911-007");
  });

  it("🪤 ขอใบเสร็จแต่ยังไม่มีเลข → ตกไปใช้เลขบิล ไม่ใช่ช่องว่าง", () => {
    expect(buildReceipt(base({ status: "ปกติ", wantReceipt: true })).docNo).toBe("B260911-001");
  });

  it("ข้อความท้ายสลิปที่มีแต่ช่องว่างถือว่าไม่ได้ตั้ง", () => {
    expect(buildReceipt(base({ footer: "   " })).footer).toBeNull();
    expect(buildReceipt(base({ footer: "ขอบคุณครับ" })).footer).toBe("ขอบคุณครับ");
  });

  it("ผู้ซื้อเป็นตัวเลือก — ไม่เลือกลูกค้าก็ออกเอกสารได้", () => {
    expect(buildReceipt(base()).buyer).toBeNull();
    expect(buildReceipt(base({ buyer: { name: "บริษัท ก" } })).buyer?.name).toBe("บริษัท ก");
  });
});

/**
 * ป้าย % บนสลิป (D96 ภาค 2)
 * 🚨 ป้ายเป็น **คำอธิบาย** — ตัวเงินที่พิมพ์คือ `totals.discount` ที่ถูกคิดมาแล้วเสมอ
 *    กระดาษห้ามคิด % เอง ไม่งั้นเลขบนใบกับเลขในบัญชีจะไม่ตรงกัน
 */
describe("ป้ายส่วนลด % บนสลิป (D96)", () => {
  const base = () => ({
    status: "เปิดอยู่" as const,
    saleNo: "B260913-001",
    lines: [{ menuId: "BM1", menuName: "Negroni", qty: 2, price: 260 }],
    seller: { name: "บาร์ทดสอบ" },
    printedAt: "13/09/2569 20:00",
  });

  it("มีส่วนลด + กรอกเป็น % → ป้ายติดมาด้วย", () => {
    const doc = buildReceipt({
      ...base(),
      totals: barTotals(base().lines, { discount: 52 }),
      discountLabel: "10%",
    });
    expect(doc.discountLabel).toBe("10%");
  });

  it("🚨 ไม่มีส่วนลด → ป้ายต้องหาย แม้ผู้เรียกจะส่งมา (กันบรรทัด 'ลด 10%' โผล่บนบิลที่ไม่ได้ลด)", () => {
    const doc = buildReceipt({
      ...base(),
      totals: barTotals(base().lines, {}),
      discountLabel: "10%",
    });
    expect(doc.totals.discount).toBe(0);
    expect(doc.discountLabel).toBeNull();
  });

  it("กรอกเป็นบาท → ไม่มีป้าย (ตัวเลขเงินอธิบายตัวเองแล้ว)", () => {
    const doc = buildReceipt({
      ...base(),
      totals: barTotals(base().lines, { discount: 50 }),
      discountLabel: null,
    });
    expect(doc.discountLabel).toBeNull();
    expect(doc.totals.discount).toBe(50);
  });
});

/**
 * ── กิจการที่จด VAT (D96 เฟส F) ─────────────────────────────────────────────
 * 🚩 ทุกข้อในบล็อกนี้ต้องมีคู่ตรงข้ามของกิจการที่ไม่จด — ไม่งั้นพิสูจน์ไม่ได้ว่า
 *    เส้นทางเดิมไม่ขยับ (ซึ่งเป็นเส้นทางของลูกค้าที่ใช้อยู่ทุกวันนี้)
 */
describe("ใบกำกับภาษีอย่างย่อ เมื่อกิจการจด VAT (D96)", () => {
  const lines = [{ menuId: "BM1", menuName: "Negroni", qty: 1, price: 260 }];
  const base = (isVat: boolean) => ({
    status: "ปกติ" as const,
    saleNo: "B260913-009",
    rcptNo: "BR260913-004",
    wantReceipt: true,
    lines,
    totals: barTotals(lines, {}),
    seller: { name: "บาร์ทดสอบ", taxId: "0105558123456", isVat },
    printedAt: "13/09/2569 23:00",
  });

  it("จด VAT → หัวกระดาษเป็น ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ", () => {
    expect(buildReceipt(base(true)).title).toBe("ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ");
  });

  it("ไม่จด VAT → หัวกระดาษเป็น ใบเสร็จรับเงิน เหมือนเดิมทุกประการ", () => {
    expect(buildReceipt(base(false)).title).toBe("ใบเสร็จรับเงิน");
  });

  it("🚨 ไม่ส่ง isVat มาเลย = ถือว่าไม่จด (เดาว่าจดแล้วออกใบกำกับ = ผิด ม.86/13)", () => {
    const doc = buildReceipt({ ...base(false), seller: { name: "บาร์ทดสอบ" } });
    expect(doc.title).toBe("ใบเสร็จรับเงิน");
    expect(doc.vat).toBeNull();
  });

  it("จด VAT → มียอดแยกภาษี และ base + vat = ยอดสุทธิเป๊ะ", () => {
    const doc = buildReceipt(base(true));
    expect(doc.vat).toEqual({ base: 242.99, vat: 17.01, gross: 260 });
    expect(doc.vat!.base + doc.vat!.vat).toBe(doc.totals.grandTotal);
    expect(doc.vatLabel).toBe("ภาษีมูลค่าเพิ่ม 7%");
  });

  it("ไม่จด VAT → ไม่มียอดแยกภาษีเลย (สลิปหน้าตาเดิม)", () => {
    const doc = buildReceipt(base(false));
    expect(doc.vat).toBeNull();
    expect(doc.vatLabel).toBeNull();
  });

  it("🚨 ใบแจ้งรายการ (ยังไม่จ่าย) ของกิจการจด VAT ยังไม่ใช่ใบกำกับ", () => {
    // ใบกำกับออกได้ก็ต่อเมื่อรับเงินแล้ว — ใบแจ้งรายการเป็นแค่ใบบอกยอด
    const doc = buildReceipt({ ...base(true), status: "เปิดอยู่", wantReceipt: false, rcptNo: null });
    expect(doc.title).toBe("ใบแจ้งรายการ");
  });

  it("ภาษีถอดจากยอด **หลัง** ส่วนลด ไม่ใช่จากราคาเต็ม", () => {
    const t = barTotals(lines, { discount: 60 });
    const doc = buildReceipt({ ...base(true), totals: t });
    expect(doc.totals.grandTotal).toBe(200);
    expect(doc.vat).toEqual({ base: 186.92, vat: 13.08, gross: 200 });
  });
});
