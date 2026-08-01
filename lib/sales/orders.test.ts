import { describe, it, expect } from "vitest";
import {
  processOrder,
  neededSerials,
  dueDateISO,
  formatThaiDate,
  type OrderState,
  type ContactInfo,
  type RevenueConfig,
} from "./orders";

const contact: ContactInfo = { taxId: "0105512345671", branch: "สำนักงานใหญ่", address: "123 กทม." };
const config: RevenueConfig = { accountName: "บัญชีรับเงินขาย", entityId: "EID01" };
const items = [{ name: "เหล้า", qty: 2, price: 500 }];

function baseOrder(over: Partial<OrderState> = {}): OrderState {
  return {
    quNo: "QU260721-001",
    orderNo: "ORD260721-001",
    status: "รอคอนเฟิร์ม",
    deposit: 0,
    outstandingBalance: 1070,
    subTotal: 1000,
    discount: 0,
    whtPercent: 0,
    category: "รายได้ค่าสินค้า",
    customerName: "บริษัท เทส จำกัด",
    invNo: "",
    taxNo1: "",
    taxNo2: "",
    ...over,
  };
}

describe("dueDateISO + formatThaiDate", () => {
  it("บวก credit days → ISO", () => {
    expect(dueDateISO("2026-07-21", 30)).toBe("2026-08-20");
  });
  it("0 วัน = วันเดิม", () => {
    expect(dueDateISO("2026-07-21", 0)).toBe("2026-07-21");
  });
  it("format ISO → พ.ศ. dd/MM/yyyy", () => {
    expect(formatThaiDate("2026-08-20")).toBe("20/08/2569");
  });
});

describe("neededSerials", () => {
  it("DEPOSIT ต้องการ inv+tax1 เมื่อยังว่าง", () => {
    expect(neededSerials("DEPOSIT_AND_SEND", baseOrder())).toEqual({ inv: true, tax1: true, tax2: false });
  });
  it("ไม่ generate ซ้ำถ้ามีเลขแล้ว", () => {
    expect(neededSerials("DEPOSIT_AND_SEND", baseOrder({ invNo: "INV1", taxNo1: "TAX1" }))).toEqual({
      inv: false,
      tax1: false,
      tax2: false,
    });
  });
  it("PAY_BALANCE ต้องการ tax2", () => {
    expect(neededSerials("PAY_BALANCE", baseOrder())).toEqual({ inv: false, tax1: false, tax2: true });
  });
});

describe("S2 DEPOSIT_AND_SEND", () => {
  const r = processOrder(
    baseOrder(),
    "DEPOSIT_AND_SEND",
    { amount: 535, method: "โอนเงิน", docDate: "2026-07-21", creditDays: 30 },
    items,
    { invNo: "INV260721-001", taxNo1: "TAX260721-001" },
    contact,
    config,
  );

  it("orderUpdate ครบตามเดิม", () => {
    expect(r.update.status).toBe("รอคลังจัดส่ง");
    expect(r.update.deposit).toBe(535);
    expect(r.update.outstandingBalance).toBe(535);
    expect(r.update.paymentMethod).toBe("โอนเงิน");
    expect(r.update.invNo).toBe("INV260721-001");
    expect(r.update.taxNo1).toBe("TAX260721-001");
    expect(r.update.dueDate).toBe("2026-08-20");
    expect(r.update.docToPrint).toBe("invoice,tax-invoice-deposit");
    expect(r.update.nextStatus).toBe("ส่งของแล้วรอชำระยอดค้าง");
    expect(r.update.docDate1).toBe("2026-07-21");
    expect(r.update.docDate2).toBeUndefined();
  });

  it("revenue payload (S1+S4+S5)", () => {
    const rev = r.revenue!;
    expect(rev.baseAmount).toBe(500);
    expect(rev.discount).toBe(0);
    expect(rev.amountAfterDiscount).toBe(500);
    expect(rev.vatAmount).toBe(35);
    expect(rev.whtAmount).toBe(0);
    expect(rev.netAmount).toBe(535);
    expect(rev.taxInvoiceNo).toBe("TAX260721-001");
    expect(rev.idempotencyKey).toBe("ORD260721-001");
    expect(rev.items).toHaveLength(1);
    // โมเดล inclusive: price 500 = รวม VAT → exVat=500/1.07=467.29, inVat=500
    expect(rev.items[0]).toEqual({ itemName: "เหล้า", quantity: 2, inVat: 500, exVat: 467.29, totalPrice: 934.58 });
    expect(rev.category).toBe("รายได้ค่าสินค้า");
    expect(rev.entityId).toBe("EID01");
  });

  it("LINE มัดจำ + คงค้าง", () => {
    expect(r.lineMsg).toContain("มัดจำ ฿535");
    expect(r.lineMsg).toContain("คงค้าง ฿535");
    expect(r.lineMsg).toContain("[ORD260721-001]");
  });
});

describe("S2 FULL_PAYMENT_AND_SEND (จากรอคอนเฟิร์ม)", () => {
  const r = processOrder(
    baseOrder(),
    "FULL_PAYMENT_AND_SEND",
    { method: "เงินสด", docDate: "2026-07-21" },
    items,
    { taxNo1: "TAX260721-002" },
    contact,
    config,
  );
  it("status + docToPrint + dateCol 22", () => {
    expect(r.update.status).toBe("รอคลังจัดส่ง");
    expect(r.update.outstandingBalance).toBe(0);
    expect(r.update.taxNo1).toBe("TAX260721-002");
    expect(r.update.docToPrint).toBe("tax-invoice-receipt-do");
    expect(r.update.nextStatus).toBe("ปิดการขาย");
    expect(r.update.docDate1).toBe("2026-07-21");
  });
  it("accBase = subTotal, accDiscount = discount (FULL)", () => {
    const rev = r.revenue!;
    expect(rev.baseAmount).toBe(1000);
    expect(rev.discount).toBe(0);
    expect(rev.amountAfterDiscount).toBe(1000);
    expect(rev.vatAmount).toBe(70);
    expect(rev.netAmount).toBe(1070);
  });
});

describe("S2 FULL_PAYMENT_AND_SEND (จากรอชำระเงิน จ่ายเต็ม → dateCol 23)", () => {
  const r = processOrder(
    baseOrder({ status: "รอชำระเงิน (จ่ายเต็ม)", invNo: "INV260721-009" }),
    "FULL_PAYMENT_AND_SEND",
    { method: "เงินสด", docDate: "2026-07-25" },
    items,
    { taxNo1: "TAX260725-001" },
    contact,
    config,
  );
  it("เขียน docDate2 (col 23) แทน docDate1", () => {
    expect(r.update.docDate2).toBe("2026-07-25");
    expect(r.update.docDate1).toBeUndefined();
  });
});

describe("S2 PAY_BALANCE (แก้ bug docToPrint)", () => {
  const r = processOrder(
    baseOrder({ status: "ส่งของแล้วรอชำระยอดค้าง", deposit: 535, outstandingBalance: 535, invNo: "INV260721-001", taxNo1: "TAX260721-001" }),
    "PAY_BALANCE",
    { amount: 535, method: "โอนเงิน", docDate: "2026-08-01" },
    items,
    { taxNo2: "TAX260801-001" },
    contact,
    config,
  );
  it("ปิดการขาย + taxNo2 + docToPrint ตั้งแล้ว (fixed)", () => {
    expect(r.update.status).toBe("ปิดการขาย");
    expect(r.update.outstandingBalance).toBe(0);
    expect(r.update.taxNo2).toBe("TAX260801-001");
    expect(r.update.docToPrint).toBe("tax-invoice-balance");
    expect(r.update.docDate2).toBe("2026-08-01");
  });
  it("isFirstPayment=false → items ว่าง, key -balance", () => {
    const rev = r.revenue!;
    expect(rev.items).toHaveLength(0);
    expect(rev.idempotencyKey).toBe("ORD260721-001-balance");
    expect(rev.netAmount).toBe(535);
    expect(rev.taxInvoiceNo).toBe("TAX260801-001");
  });
});

describe("S2 FULL_PAYMENT_LATER (แก้ bug docToPrint)", () => {
  const r = processOrder(
    baseOrder({ status: "ส่งของแล้วรอชำระเงิน", outstandingBalance: 1070 }),
    "FULL_PAYMENT_LATER",
    { method: "โอนเงิน", docDate: "2026-08-05" },
    items,
    { taxNo1: "TAX260805-001" },
    contact,
    config,
  );
  it("ปิดการขาย + taxNo1 + docToPrint ตั้งแล้ว (fixed)", () => {
    expect(r.update.status).toBe("ปิดการขาย");
    expect(r.update.taxNo1).toBe("TAX260805-001");
    expect(r.update.docToPrint).toBe("tax-invoice-receipt");
    expect(r.update.docDate2).toBe("2026-08-05");
  });
  it("isFirstPayment=true → มี items, accBase=subTotal", () => {
    const rev = r.revenue!;
    expect(rev.items).toHaveLength(1);
    expect(rev.baseAmount).toBe(1000);
    expect(rev.idempotencyKey).toBe("ORD260721-001");
  });
});

describe("S2 SEND_TO_WH / ISSUE_INVOICE_FULL (ไม่มีรับเงิน)", () => {
  it("SEND_TO_WH: invoice, no revenue", () => {
    const r = processOrder(
      baseOrder(),
      "SEND_TO_WH",
      { docDate: "2026-07-21", creditDays: 30 },
      items,
      { invNo: "INV260721-003" },
      contact,
      config,
    );
    expect(r.update.status).toBe("รอคลังจัดส่ง");
    expect(r.update.docToPrint).toBe("invoice");
    expect(r.update.nextStatus).toBe("ส่งของแล้วรอชำระเงิน");
    expect(r.update.dueDate).toBe("2026-08-20");
    expect(r.revenue).toBeNull();
    expect(r.lineMsg).toBeNull();
  });
  it("ISSUE_INVOICE_FULL: รอชำระเงิน (จ่ายเต็ม)", () => {
    const r = processOrder(
      baseOrder(),
      "ISSUE_INVOICE_FULL",
      { docDate: "2026-07-21" },
      items,
      { invNo: "INV260721-004" },
      contact,
      config,
    );
    expect(r.update.status).toBe("รอชำระเงิน (จ่ายเต็ม)");
    expect(r.update.invNo).toBe("INV260721-004");
    expect(r.update.docToPrint).toBe("invoice");
    expect(r.revenue).toBeNull();
  });
});

describe("cheque details ไปช่องถูก", () => {
  it("DEPOSIT → checkDetail1", () => {
    const r = processOrder(baseOrder(), "DEPOSIT_AND_SEND", { amount: 100, docDate: "2026-07-21", chequeDetails: "ธนาคารกสิกร เลขที่เช็ค : 123" }, items, { invNo: "I", taxNo1: "T" }, contact, config);
    expect(r.update.checkDetail1).toBe("ธนาคารกสิกร เลขที่เช็ค : 123");
    expect(r.update.checkDetail2).toBeUndefined();
  });
  it("PAY_BALANCE → checkDetail2", () => {
    const r = processOrder(baseOrder({ status: "ส่งของแล้วรอชำระยอดค้าง", outstandingBalance: 100 }), "PAY_BALANCE", { docDate: "2026-08-01", chequeDetails: "cq" }, items, { taxNo2: "T2" }, contact, config);
    expect(r.update.checkDetail2).toBe("cq");
    expect(r.update.checkDetail1).toBeUndefined();
  });
});

describe("multi-branch: contactId ลงบัญชีด้วย (ภพ.30/ภงด. ต้องได้สาขาถูก — D42)", () => {
  it("ส่ง contactId มา → อยู่ใน revenue payload (ไปลง transactions.contact_id)", () => {
    const r = processOrder(
      baseOrder(),
      "DEPOSIT_AND_SEND",
      { amount: 535, method: "โอนเงิน", docDate: "2026-07-21", creditDays: 30 },
      items,
      { invNo: "INV260721-001", taxNo1: "TAX260721-001" },
      { ...contact, contactId: "C-0123" },
      config,
    );
    expect(r.revenue!.contactId).toBe("C-0123");
    // ค่าอื่นไม่เปลี่ยน (เป็นแค่ฟิลด์เพิ่ม ไม่แตะสูตรเงิน)
    expect(r.revenue!.netAmount).toBe(535);
    expect(r.revenue!.taxInvoiceNo).toBe("TAX260721-001");
  });

  it("ไม่มี contactId (ออเดอร์เก่า) → คืนค่าว่าง แล้ว fallback ชื่อเหมือนเดิม", () => {
    const r = processOrder(
      baseOrder(),
      "DEPOSIT_AND_SEND",
      { amount: 535, method: "โอนเงิน", docDate: "2026-07-21", creditDays: 30 },
      items,
      { invNo: "I", taxNo1: "T" },
      contact,
      config,
    );
    expect(r.revenue!.contactId).toBe("");
    expect(r.revenue!.contactName).toBe("บริษัท เทส จำกัด");
  });
});
