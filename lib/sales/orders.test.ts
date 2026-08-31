import { describe, it, expect } from "vitest";
import {
  processOrder,
  neededSerials,
  dueDateISO,
  formatThaiDate,
  STATUS_AWAIT_DEPOSIT,
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

// ── S10 (D45) ใบแจ้งหนี้ค่ามัดจำ — ออกบิลก่อนได้รับเงิน ───────────────────────
describe("S10 ISSUE_INVOICE_DEPOSIT (ใบแจ้งหนี้ค่ามัดจำ — ยังไม่ได้รับเงิน)", () => {
  const run = (over = {}, payload = {}) =>
    processOrder(
      baseOrder(over),
      "ISSUE_INVOICE_DEPOSIT",
      { amount: 535, docDate: "2026-08-07", creditDays: 7, ...payload },
      items,
      { invNo: "INV260807-001" },
      contact,
      config,
    );

  it("สถานะ → รอชำระมัดจำ + เก็บเลข/ยอด/วันครบกำหนดในช่อง dep_*", () => {
    const r = run();
    expect(r.newStatus).toBe(STATUS_AWAIT_DEPOSIT);
    expect(r.update.status).toBe("รอชำระมัดจำ");
    expect(r.update.depInvNo).toBe("INV260807-001");
    expect(r.update.depInvAmount).toBe(535);
    expect(r.update.depInvDate).toBe("2026-08-07");
    expect(r.update.depDueDate).toBe("2026-08-14");
    expect(r.update.docToPrint).toBe("invoice-deposit");
    expect(r.update.nextStatus).toBe("รอคลังจัดส่ง");
  });

  it("⚠️ ห้ามลงบัญชี/ห้ามแตะยอดเงิน — ยังไม่ได้รับเงิน (cash basis + tax point)", () => {
    const r = run();
    expect(r.revenue).toBeNull();
    expect(r.lineMsg).toBeNull();
    expect(r.update.deposit).toBeUndefined();
    expect(r.update.outstandingBalance).toBeUndefined();
    expect(r.update.paymentMethod).toBeUndefined();
  });

  it("⚠️ ห้ามแตะ invNo/docDate1/docDate2 (สงวนให้ใบแจ้งหนี้+ใบกำกับภาษีตอนรับเงิน)", () => {
    const r = run();
    expect(r.update.invNo).toBeUndefined();
    expect(r.update.taxNo1).toBeUndefined();
    expect(r.update.docDate1).toBeUndefined();
    expect(r.update.docDate2).toBeUndefined();
    expect(r.update.dueDate).toBeUndefined();
  });

  it("ครบกำหนด 0 วัน = วันเดียวกับวันที่ออกบิล", () => {
    expect(run({}, { creditDays: 0 }).update.depDueDate).toBe("2026-08-07");
  });

  it("ยอดปัดทศนิยม 2 ตำแหน่ง", () => {
    expect(run({}, { amount: 535.005 }).update.depInvAmount).toBe(535.01);
    expect(run({}, { amount: undefined }).update.depInvAmount).toBe(0);
  });

  it("neededSerials: ขอเลข INV ครั้งแรก ไม่ขอซ้ำถ้าเคยออกแล้ว", () => {
    expect(neededSerials("ISSUE_INVOICE_DEPOSIT", baseOrder())).toEqual({ inv: true, tax1: false, tax2: false });
    expect(neededSerials("ISSUE_INVOICE_DEPOSIT", baseOrder({ depInvNo: "INV260807-001" }))).toEqual({
      inv: false,
      tax1: false,
      tax2: false,
    });
    // ใบแจ้งหนี้ยอดเต็ม (inv_no) ไม่เกี่ยวกัน — ออกใบมัดจำแล้วยังต้องขอเลขใหม่ตอนส่งของ
    expect(neededSerials("DEPOSIT_AND_SEND", baseOrder({ depInvNo: "INV260807-001" }))).toEqual({
      inv: true,
      tax1: true,
      tax2: false,
    });
  });

  it("รับเงินต่อจากสถานะ 'รอชำระมัดจำ' → เดินท่อเดิมของ DEPOSIT_AND_SEND ครบ (ลงบัญชี+ออกใบกำกับ)", () => {
    const r = processOrder(
      baseOrder({ status: STATUS_AWAIT_DEPOSIT, depInvNo: "INV260807-001" }),
      "DEPOSIT_AND_SEND",
      { amount: 535, method: "โอนเงิน", docDate: "2026-08-10", creditDays: 30 },
      items,
      { invNo: "INV260810-002", taxNo1: "TAX260810-001" },
      contact,
      config,
    );
    expect(r.update.status).toBe("รอคลังจัดส่ง");
    expect(r.update.deposit).toBe(535);
    expect(r.update.outstandingBalance).toBe(535);
    expect(r.update.docDate1).toBe("2026-08-10");
    expect(r.update.docToPrint).toBe("invoice,tax-invoice-deposit");
    expect(r.revenue!.netAmount).toBe(535);
    expect(r.revenue!.taxInvoiceNo).toBe("TAX260810-001");
    expect(r.revenue!.idempotencyKey).toBe("ORD260721-001");
  });

  it("ลูกค้าเปลี่ยนใจจ่ายเต็มจากสถานะ 'รอชำระมัดจำ' → docDate1 (ยังไม่เคยออกบิลยอดเต็ม)", () => {
    const r = processOrder(
      baseOrder({ status: STATUS_AWAIT_DEPOSIT, depInvNo: "INV260807-001" }),
      "FULL_PAYMENT_AND_SEND",
      { method: "โอนเงิน", docDate: "2026-08-10" },
      items,
      { taxNo1: "TAX260810-001" },
      contact,
      config,
    );
    expect(r.update.status).toBe("รอคลังจัดส่ง");
    expect(r.update.outstandingBalance).toBe(0);
    expect(r.update.docDate1).toBe("2026-08-10");
    expect(r.update.docDate2).toBeUndefined();
    expect(r.revenue!.netAmount).toBe(1070);
  });
});

// ── S11: กิจการที่ไม่จด VAT (4.3) ────────────────────────────────────────────
describe("S11 — ไม่จด VAT: ห้ามได้เลขใบกำกับภาษี (ม.86/13)", () => {
  it("★ ทุก action ต้องไม่ได้ tax1/tax2 เลย", () => {
    const actions = [
      "DEPOSIT_AND_SEND", "FULL_PAYMENT_AND_SEND", "SEND_TO_WH",
      "ISSUE_INVOICE_FULL", "ISSUE_INVOICE_DEPOSIT", "PAY_BALANCE", "FULL_PAYMENT_LATER",
    ] as const;
    for (const a of actions) {
      const s = neededSerials(a, baseOrder(), false);
      expect(s.tax1, `${a} ยังขอเลขใบกำกับ`).toBe(false);
      expect(s.tax2, `${a} ยังขอเลขใบกำกับ`).toBe(false);
    }
  });

  it("เลข INV (ใบแจ้งหนี้/ใบส่งของ) ยังออกได้ปกติ — ผู้ไม่จด VAT ออกได้", () => {
    expect(neededSerials("DEPOSIT_AND_SEND", baseOrder(), false).inv).toBe(true);
    expect(neededSerials("SEND_TO_WH", baseOrder(), false).inv).toBe(true);
    // มีเลขแล้วก็ไม่ขอซ้ำ (พฤติกรรมเดิม)
    expect(neededSerials("SEND_TO_WH", baseOrder({ invNo: "INV1" }), false).inv).toBe(false);
  });

  // 🔴 D86 — เดิม action ที่ออกใบเสร็จกินแต่เลข TAX (inv: false) พอตัด tax ทิ้งเพราะ
  //    ไม่จด VAT จึงไม่ได้เลขอะไรเลย = ใบเสร็จรับเงินไม่มีเลขที่ และบัญชีได้ tax_invoice_no = "-"
  it("🔴 ใบเสร็จของกิจการไม่จด VAT ต้องมีเลขที่ (ใช้ชุด INV แทนเลขใบกำกับที่ออกไม่ได้)", () => {
    expect(neededSerials("FULL_PAYMENT_AND_SEND", baseOrder(), false)).toEqual({
      inv: true, tax1: false, tax2: false,
    });
    expect(neededSerials("FULL_PAYMENT_LATER", baseOrder(), false)).toEqual({
      inv: true, tax1: false, tax2: false,
    });
  });

  it("มีเลข INV อยู่แล้วไม่ขอซ้ำ (ใบแจ้งหนี้กับใบเสร็จของใบเดียวกันใช้เลขเดียว)", () => {
    expect(neededSerials("FULL_PAYMENT_AND_SEND", baseOrder({ invNo: "INV1" }), false).inv).toBe(false);
  });

  it("★ เส้นทางจด VAT ต้องไม่ขยับ — ยังกินแต่เลข TAX เท่าเดิม", () => {
    expect(neededSerials("FULL_PAYMENT_AND_SEND", baseOrder())).toEqual({
      inv: false, tax1: true, tax2: false,
    });
    expect(neededSerials("FULL_PAYMENT_LATER", baseOrder())).toEqual({
      inv: false, tax1: true, tax2: false,
    });
  });

  it("ไม่ส่ง isVat มา = จด VAT (พฤติกรรมเดิมต้องไม่พัง)", () => {
    expect(neededSerials("DEPOSIT_AND_SEND", baseOrder())).toEqual({ inv: true, tax1: true, tax2: false });
  });

  it("★★ payload บัญชีของกิจการไม่จด VAT: vat = 0 และฐานคิดจาก (1 − wht)", () => {
    // รับเงินเต็ม 97 · WHT 3% → ฐาน 97/(1−0.03) = 100 · vat 0 · wht 3
    const r = processOrder(
      baseOrder({ status: "รอคอนเฟิร์ม", outstandingBalance: 97, whtPercent: 3 }),
      "FULL_PAYMENT_LATER",
      { docDate: "2026-08-14" },
      [{ name: "สุรา", qty: 1, price: 97 }],
      { invNo: "INV9", taxNo1: undefined, taxNo2: undefined },
      contact,
      { accountName: "บัญชีรับเงินขาย", entityId: "EID02", isVat: false },
    );
    expect(r.revenue).not.toBeNull();
    expect(r.revenue!.vatAmount).toBe(0);
    expect(r.revenue!.amountAfterDiscount).toBe(100);
    expect(r.revenue!.whtAmount).toBe(3);
    expect(r.revenue!.netAmount).toBe(97);
  });
});
