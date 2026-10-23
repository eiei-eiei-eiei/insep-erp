import { describe, it, expect } from "vitest";
import {
  num,
  round2,
  formatDateBE,
  isCorporate,
  itemDiscBahtFromPct,
  itemTotal,
  exVatFromInVat,
  priceFromInput,
  reinterpretPrice,
  unitPriceHeader,
  inVatFromExVat,
  entryCalc,
  effectiveVatMode,
  unitPriceOf,
  allocateExTotals,
  detectVatMode,
  vatModeWarn,
  lineTotalHeader,
  itemsHintText,
  VAT_MODE_LABEL,
  type VatMode,
  reverseWht,
  splitInstallments,
  taxReport,
  previousVat,
  whtReport,
  dashboardData,
  cashDateOf,
  missingInvoicePurchases,
  missingInvoiceWarn,
  type Tx,
  type ContactMap,
  type TaxSummaryRow,
} from "./calc";

/** ค่า expected คำนวณด้วยมือจาก logic ระบบเดิม (Reports.js / _js_entry.html) */

const EID = "EID99";

const contacts: ContactMap = {
  "ลูกค้า A": { tax_id: "0105512345678", branch: "สำนักงานใหญ่" },
  "ลูกค้า B": { tax_id: "1234", branch: "00002" },
  "นายสมชาย": { tax_id: "1103700000000", branch: "" },
  "บริษัท ขนส่ง จำกัด": { tax_id: "0105500000000", branch: "2", address: "กรุงเทพฯ" },
};

/** ชุดรายการทดสอบครอบ guard cash-basis + scope + เช็คราคา + ยกเลิก */
const txs: Tx[] = [
  // ขาย 2 ใบ (INV date ต่างกันเพื่อทดสอบการเรียง)
  { tx_id: "S1", transaction_date: "2026-07-05", type: "รายรับ", account_name: "บัญชีบริษัท", category: "ขายสินค้า", contact_name: "ลูกค้า A", amount_after_discount: 1000, vat_amount: 70, wht_rate: 0, wht_amount: 0, net_amount: 1070, tax_invoice_no: "INV-1", tax_invoice_date: "2026-07-10", status: "ปกติ", entity_id: EID, ap_ar_status: null },
  { tx_id: "S2", transaction_date: "2026-07-20", type: "รายรับ", account_name: "บัญชีบริษัท", category: "ขายสินค้า", contact_name: "ลูกค้า B", amount_after_discount: 500, vat_amount: 35, wht_rate: 0, wht_amount: 0, net_amount: 535, tax_invoice_no: "INV-2", tax_invoice_date: "2026-07-02", status: "ปกติ", entity_id: EID, ap_ar_status: null },
  // ซื้อ มี VAT + WHT บุคคล
  { tx_id: "P1", transaction_date: "2026-07-08", type: "รายจ่าย", account_name: "บัญชีบริษัท", category: "ค่าบริการ", contact_name: "นายสมชาย", amount_after_discount: 2000, vat_amount: 140, wht_rate: 3, wht_amount: 60, net_amount: 2080, tax_invoice_no: "B-1", tax_invoice_date: null, status: "ปกติ", entity_id: EID, ap_ar_status: null },
  // ซื้อ WHT นิติบุคคล ไม่มี VAT (เข้า ภงด.53 แต่ไม่เข้า ภพ.30)
  { tx_id: "P2", transaction_date: "2026-07-15", type: "รายจ่าย", account_name: "บัญชีบริษัท", category: "ค่าขนส่ง", contact_name: "บริษัท ขนส่ง จำกัด", amount_after_discount: 1000, vat_amount: 0, wht_rate: 1, wht_amount: 10, net_amount: 990, tax_invoice_no: "", tax_invoice_date: null, status: "ปกติ", entity_id: EID, ap_ar_status: null },
  // AP/AR ค้าง **ที่ยังไม่มีเลขใบกำกับ** — ต้องหลุดทุกจุด (บิลค้างที่มีใบกำกับแล้วนับ ภพ.30 ตั้งแต่ D123 — ดู A23)
  { tx_id: "AR1", transaction_date: "2026-07-11", type: "รายรับ", account_name: "บัญชีบริษัท", category: "ขาย", contact_name: "ลูกค้า A", amount_after_discount: 9999, vat_amount: 700, wht_rate: 0, wht_amount: 0, net_amount: 10699, tax_invoice_no: "", tax_invoice_date: "2026-07-11", status: "ปกติ", entity_id: EID, ap_ar_status: "AR" },
  // เช็คราคา — account ว่าง → หลุด
  { tx_id: "PC1", transaction_date: "2026-07-09", type: "เช็คราคา", account_name: "", category: "เช็คราคา", contact_name: "ลูกค้า A", amount_after_discount: 0, vat_amount: 0, wht_rate: 0, wht_amount: 0, net_amount: 0, tax_invoice_no: "", tax_invoice_date: null, status: "ปกติ", entity_id: EID, ap_ar_status: null },
  // ยกเลิก — หลุด
  { tx_id: "V1", transaction_date: "2026-07-06", type: "รายรับ", account_name: "บัญชีบริษัท", category: "ขาย", contact_name: "ลูกค้า A", amount_after_discount: 400, vat_amount: 28, wht_rate: 0, wht_amount: 0, net_amount: 428, tax_invoice_no: "Y", tax_invoice_date: "2026-07-06", status: "ยกเลิก", entity_id: EID, ap_ar_status: null },
  // กิจการอื่น — หลุดจาก scope EID99
  { tx_id: "E1", transaction_date: "2026-07-13", type: "รายรับ", account_name: "บัญชีบริษัท", category: "ขาย", contact_name: "ลูกค้า A", amount_after_discount: 800, vat_amount: 56, wht_rate: 0, wht_amount: 0, net_amount: 856, tax_invoice_no: "Z", tax_invoice_date: "2026-07-13", status: "ปกติ", entity_id: "EID01", ap_ar_status: null },
];

describe("helpers", () => {
  it("num แปลง string/คอมม่า", () => {
    expect(num("1,234.50")).toBe(1234.5);
    expect(num("x")).toBe(0);
    expect(num(42)).toBe(42);
  });
  it("round2", () => {
    expect(round2(105)).toBe(105);
    expect(round2(0.005)).toBe(0.01);
  });
  it("formatDateBE ปี พ.ศ. 2 หลัก", () => {
    expect(formatDateBE("2026-07-10", ".")).toBe("10.07.69");
    expect(formatDateBE("2026-07-08", "/")).toBe("08/07/69");
    expect(formatDateBE(null)).toBe("");
  });
  it("isCorporate", () => {
    expect(isCorporate("บริษัท ขนส่ง จำกัด")).toBe(true);
    expect(isCorporate("หจก. รุ่งเรือง")).toBe(true);
    expect(isCorporate("นายสมชาย")).toBe(false);
  });
});

describe("A4 — ส่วนลด item + ยอดรวม", () => {
  it("itemTotal / itemDiscBahtFromPct", () => {
    expect(itemTotal(3, 100, 50)).toBe(250);
    expect(itemTotal(2, 100, 0)).toBe(200);
    expect(itemDiscBahtFromPct(3, 100, 10)).toBe(30);
  });
  it("in/ex VAT", () => {
    expect(exVatFromInVat(107)).toBe(100);
    expect(inVatFromExVat(100)).toBe(107);
    expect(exVatFromInVat(0)).toBe(0);
  });
});

describe("A3 — entryCalc", () => {
  it("VAT อย่างเดียว", () => {
    expect(entryCalc({ items: [{ quantity: 2, exVat: 100, discBaht: 0 }], discount: 0, hasVat: true, hasWht: false, whtRate: 0 })).toEqual({
      baseAmount: 200, amountAfterDiscount: 200, vatAmount: 14, whtRate: 0, whtAmount: 0, netAmount: 214,
    });
  });
  it("ส่วนลดบิล + VAT + WHT", () => {
    expect(entryCalc({ items: [{ quantity: 1, exVat: 1000, discBaht: 0 }], discount: 100, hasVat: true, hasWht: true, whtRate: 3 })).toEqual({
      baseAmount: 1000, amountAfterDiscount: 900, vatAmount: 63, whtRate: 3, whtAmount: 27, netAmount: 936,
    });
  });
  it("reverseWht ถอดยอดสุทธิ", () => {
    expect(reverseWht(970, 3)).toEqual({ base: 1000, wht: 30 });
    expect(reverseWht(0, 3)).toEqual({ base: 0, wht: 0 });
  });
});

describe("A6 — splitInstallments", () => {
  it("แบ่ง 2 งวด 50/50 + VAT + WHT", () => {
    const rows = splitInstallments(1000, [{ percent: 50, dueDate: "2026-08-01" }, { percent: 50, dueDate: "2026-09-01" }], true, 3);
    expect(rows).toEqual([
      { installmentNo: 1, installmentTotal: 2, base: 500, vatAmount: 35, whtRate: 3, whtAmount: 15, netAmount: 520, dueDate: "2026-08-01" },
      { installmentNo: 2, installmentTotal: 2, base: 500, vatAmount: 35, whtRate: 3, whtAmount: 15, netAmount: 520, dueDate: "2026-09-01" },
    ]);
  });
  it("งวดสุดท้ายซับ remainder (ผลรวม = total เป๊ะ)", () => {
    const rows = splitInstallments(100, [{ percent: 33.33, dueDate: "" }, { percent: 33.33, dueDate: "" }, { percent: 33.34, dueDate: "" }], false, 0);
    expect(rows.map((r) => r.base)).toEqual([33.33, 33.33, 33.34]);
    expect(rows.reduce((s, r) => s + r.base, 0)).toBe(100);
  });
  it("mode B: normalize + ต่อเลขงวด", () => {
    const rows = splitInstallments(600, [{ percent: 1, dueDate: "" }, { percent: 1, dueDate: "" }], false, 0, { normalize: true, startNo: 2, totalNo: 3 });
    expect(rows.map((r) => [r.installmentNo, r.installmentTotal, r.base])).toEqual([[2, 3, 300], [3, 3, 300]]);
  });
});

describe("A1/A2/A13 — ภพ.30", () => {
  const r = taxReport("2026-07", EID, 50, txs, contacts);
  it("รวมยอด + VAT รอบเดียว", () => {
    expect(r.totalSalesAmount).toBe(1500);
    expect(r.totalPurchaseAmount).toBe(2000);
    expect(r.totalSalesVat).toBe(105);
    expect(r.totalPurchaseVat).toBe(140);
  });
  it("netPayable ติดลบ → ยกไป", () => {
    expect(r.netPayable).toBe(-85);
    expect(r.forwardedVatOut).toBe(85);
  });
  it("guard: AP/AR, ยกเลิก, เช็คราคา, กิจการอื่น หลุดหมด", () => {
    expect(r.sales.length).toBe(2); // เหลือ S1,S2 (AR1/V1/E1/PC1 หลุด)
    expect(r.purchases.length).toBe(1); // P2 vat=0 หลุด
    expect(r.sales.map((s) => s.amount).sort((a, b) => a - b)).toEqual([500, 1000]);
  });
  it("เรียงตามวันที่ใบกำกับ เก่า→ใหม่", () => {
    expect(r.sales.map((s) => s.date)).toEqual(["02.07.69", "10.07.69"]);
  });
  it("สนญ./สาขา + taxId pad", () => {
    const b = r.sales.find((s) => s.name === "ลูกค้า B")!;
    expect(b.isHQMark).toBe("");
    expect(b.branchMark).toBe("00002");
    expect(b.taxId).toBe("0000000001234");
    const a = r.sales.find((s) => s.name === "ลูกค้า A")!;
    expect(a.isHQMark).toBe("/");
  });
});

describe("D29 — บันทึกภาษี (ภาษีซื้อนำเข้า) เข้า ภพ.30 เป็นภาษีซื้อ ไม่กระทบบัญชี", () => {
  const importTx: Tx[] = [
    { tx_id: "IMP1", transaction_date: "2026-07-18", type: "บันทึกภาษี", account_name: "บัญชีบริษัท", category: "ค่าต้นทุนสินค้า", contact_name: "กรมศุลกากร", amount_after_discount: 10000, vat_amount: 700, wht_rate: 0, wht_amount: 0, net_amount: 10700, tax_invoice_no: "IMP-1", tax_invoice_date: null, status: "ปกติ", entity_id: EID, ap_ar_status: null },
  ];
  it("นับเป็นภาษีซื้อใน ภพ.30 (VAT = 7% ของยอด ตามกฎรวมยอด)", () => {
    const r = taxReport("2026-07", EID, 0, importTx, {});
    expect(r.purchases.length).toBe(1);
    expect(r.totalPurchaseAmount).toBe(10000);
    expect(r.totalPurchaseVat).toBe(700);
    expect(r.totalSalesAmount).toBe(0);
  });
});

describe("D30 — multi-branch: ภพ.30 ใช้สาขาจาก contact_id (ไม่ใช่ชื่อ)", () => {
  const cmap: ContactMap = {
    "C-02": { tax_id: "0105563164232", branch: "7", address: "ที่อยู่สาขา 7" },
    "บริษัท หลายสาขา จำกัด": { tax_id: "0105563164232", branch: "13", address: "ที่อยู่สาขา 13" }, // fallback ชื่อ = คนละสาขา
  };
  const mkTx = (cid: string | null): Tx => ({
    tx_id: "T", transaction_date: "2026-07-10", type: "รายรับ", account_name: "บัญชีบริษัท", category: "ขาย",
    contact_name: "บริษัท หลายสาขา จำกัด", contact_id: cid, amount_after_discount: 1000, vat_amount: 70,
    wht_rate: 0, wht_amount: 0, net_amount: 1070, tax_invoice_no: "INV", tax_invoice_date: "2026-07-10",
    status: "ปกติ", entity_id: EID, ap_ar_status: null,
  });
  it("มี contact_id → ใช้สาขาของ id นั้น (สาขา 7)", () => {
    const r = taxReport("2026-07", EID, 0, [mkTx("C-02")], cmap);
    expect(r.sales[0].branchMark).toBe("00007");
  });
  it("ไม่มี contact_id → fallback ตามชื่อ (สาขา 13)", () => {
    const r = taxReport("2026-07", EID, 0, [mkTx(null)], cmap);
    expect(r.sales[0].branchMark).toBe("00013");
  });
});

describe("previousVat", () => {
  const summaries: TaxSummaryRow[] = [
    { report_month: "'2026-06", forwarded_vat_out: 20, entity_id: "EID99", created_at: "2026-06-30T10:00:00Z" },
    { report_month: "'2026-06", forwarded_vat_out: 85, entity_id: "EID99", created_at: "2026-07-01T09:00:00Z" },
    { report_month: "'2026-06", forwarded_vat_out: 999, entity_id: "EID01", created_at: "2026-07-01T09:00:00Z" },
  ];
  it("อ่านแถวล่าสุดของเดือนก่อน ต่อกิจการ", () => {
    expect(previousVat("2026-07", "EID99", summaries)).toBe(85);
  });
  it("ข้ามปี ธ.ค.", () => {
    expect(previousVat("2026-01", "EID99", summaries)).toBe(0);
  });
});

describe("A10 — ภงด.3/53", () => {
  const w = whtReport("2026-07", EID, txs, contacts);
  it("แยกบุคคล/นิติบุคคล", () => {
    expect(w.pnd3.map((r) => r.contactName)).toEqual(["นายสมชาย"]);
    expect(w.pnd53.map((r) => r.contactName)).toEqual(["บริษัท ขนส่ง จำกัด"]);
  });
  it("ยอดรวม", () => {
    expect(w.pnd3TotalPaid).toBe(2000);
    expect(w.pnd3TotalWht).toBe(60);
    expect(w.pnd53TotalPaid).toBe(1000);
    expect(w.pnd53TotalWht).toBe(10);
  });
});

describe("A11 — dashboard + WHT pending", () => {
  it("สรุปเดือน (filter tax_invoice_date ก่อน)", () => {
    const d = dashboardData("2026-07", EID, txs, new Set());
    expect(d.dash).toEqual({ income: 1500, expense: 3000, netIncome: 1605, netExpense: 3070, vatOut: 105, vatIn: 140 });
    expect(d.whtPending.map((p) => p.transactionId)).toEqual(["P1", "P2"]);
  });
  it("ตัดที่ออก 50ทวิ แล้วออกจาก pending", () => {
    const d = dashboardData("2026-07", EID, txs, new Set(["P1"]));
    expect(d.whtPending.map((p) => p.transactionId)).toEqual(["P2"]);
  });
});


describe("A21 — โหมดกรอกราคา รวม VAT (D98)", () => {
  const wht0 = { discount: 0, hasVat: true, hasWht: false, whtRate: 0 };

  it("🚩 เคสจริงของผู้ใช้: 16 ชิ้น × 75 (รวม VAT) ต้องได้ 1,200.00 เท่าใบของผู้ขาย", () => {
    const items = [{ quantity: 16, exVat: exVatFromInVat(75), inVat: 75, discBaht: 0 }];
    const r = entryCalc({ items, ...wht0, vatMode: "in" });
    expect(r.baseAmount).toBe(1121.5);
    expect(r.vatAmount).toBe(78.5);
    expect(r.netAmount).toBe(1200);
  });

  it("🚨 เส้นทางเดิมต้องไม่ขยับ — เคสเดียวกันในโหมด ex ยังได้เลขเดิมทุกตัว", () => {
    const items = [{ quantity: 16, exVat: exVatFromInVat(75), inVat: 75, discBaht: 0 }];
    const r = entryCalc({ items, ...wht0, vatMode: "ex" });
    expect(r.baseAmount).toBe(1121.44);
    expect(r.vatAmount).toBe(78.5);
    expect(r.netAmount).toBe(1199.94);
  });

  it("🚨 ไม่ส่ง vatMode = ต้องเหมือนส่ง ex เป๊ะ (ค่าปริยายคือพฤติกรรมเดิม)", () => {
    const cases = [
      { items: [{ quantity: 16, exVat: 70.09, inVat: 75, discBaht: 0 }], discount: 0, hasVat: true, hasWht: false, whtRate: 0 },
      { items: [{ quantity: 1, exVat: 1000, inVat: 1070, discBaht: 0 }], discount: 100, hasVat: true, hasWht: true, whtRate: 3 },
      { items: [{ quantity: 3, exVat: 33.33, inVat: 35.66, discBaht: 10 }], discount: 5, hasVat: false, hasWht: true, whtRate: 1 },
    ];
    for (const c of cases) expect(entryCalc(c)).toEqual(entryCalc({ ...c, vatMode: "ex" }));
  });

  it("🚨 base + vat = ยอดที่จ่ายจริงเสมอ — ไล่ทุกจำนวน 1-60 ชิ้น × ราคาที่มีเศษ", () => {
    for (const price of [75, 19.5, 0.99, 123.45, 7, 250]) {
      for (let q = 1; q <= 60; q++) {
        const r = entryCalc({ items: [{ quantity: q, exVat: exVatFromInVat(price), inVat: price, discBaht: 0 }], ...wht0, vatMode: "in" });
        expect(round2(r.baseAmount + r.vatAmount)).toBe(round2(q * price));
        expect(r.netAmount).toBe(round2(q * price));
      }
    }
  });

  it("หลายบรรทัด — ถอด VAT ที่ยอดรวมครั้งเดียว ไม่ใช่รายบรรทัด", () => {
    const items = [
      { quantity: 16, exVat: 70.09, inVat: 75, discBaht: 0 },
      { quantity: 3, exVat: 18.69, inVat: 20, discBaht: 0 },
    ];
    const r = entryCalc({ items, ...wht0, vatMode: "in" });
    expect(round2(r.baseAmount + r.vatAmount)).toBe(1260);
    expect(r.netAmount).toBe(1260);
  });

  it("ส่วนลดบรรทัด + ส่วนลดบิล ในโหมด in เป็นบาทรวม VAT", () => {
    const items = [{ quantity: 16, exVat: 70.09, inVat: 75, discBaht: 100 }];
    const r = entryCalc({ items, discount: 100, hasVat: true, hasWht: false, whtRate: 0, vatMode: "in" });
    expect(r.netAmount).toBe(1000);
    // 🪤 baseAmount คือยอด *ก่อน* หักส่วนลดบิล ส่วน vatAmount คิด *หลัง* หัก — บวกกันไม่มีความหมาย
    expect(round2(r.amountAfterDiscount + r.vatAmount)).toBe(1000);
    expect(r.baseAmount).toBe(1028.04);
    expect(r.amountAfterDiscount).toBe(934.58);
    expect(r.vatAmount).toBe(65.42);
  });

  it("WHT คิดบนยอดก่อน VAT · สุทธิ = ยอดรวม VAT − WHT", () => {
    const items = [{ quantity: 16, exVat: 70.09, inVat: 75, discBaht: 0 }];
    const r = entryCalc({ items, discount: 0, hasVat: true, hasWht: true, whtRate: 3, vatMode: "in" });
    expect(r.amountAfterDiscount).toBe(1121.5);
    // round2 เดิมคือ Math.round(x*100)/100 · 1121.5×3% = 33.644999… → 33.64 (ไม่แตะสูตรปัด)
    expect(r.whtAmount).toBe(33.64);
    expect(r.netAmount).toBe(round2(1200 - 33.64));
  });

  it("🚨 ไม่ติ๊ก มี VAT = ตกกลับเส้นทางเดิมเสมอ (ไม่มีอะไรให้ถอด)", () => {
    expect(effectiveVatMode("in", false)).toBe("ex");
    expect(effectiveVatMode("in", true)).toBe("in");
    expect(effectiveVatMode("ex", true)).toBe("ex");
    expect(effectiveVatMode(undefined, true)).toBe("ex");
    const items = [{ quantity: 16, exVat: 70.09, inVat: 75, discBaht: 0 }];
    const noVat = { items, discount: 0, hasVat: false, hasWht: false, whtRate: 0 };
    expect(entryCalc({ ...noVat, vatMode: "in" })).toEqual(entryCalc(noVat));
  });

  it("unitPriceOf — โหมดไหนอ่านช่องไหน", () => {
    expect(unitPriceOf("in", 70.09, 75)).toBe(75);
    expect(unitPriceOf("ex", 70.09, 75)).toBe(70.09);
    expect(unitPriceOf("in", 70.09, undefined)).toBe(0);
  });

  it("🚨 allocateExTotals — ผลรวมรายบรรทัดต้องเท่ากับยอดก่อน VAT ของบิลเป๊ะ", () => {
    const grosses = [1200, 60, 0.03, 999.99];
    const base = entryCalc({
      items: grosses.map((g) => ({ quantity: 1, exVat: 0, inVat: g, discBaht: 0 })),
      ...wht0, vatMode: "in",
    }).baseAmount;
    const lines = allocateExTotals(grosses, base);
    expect(round2(lines.reduce((a, b) => a + b, 0))).toBe(base);
    expect(lines[0]).toBe(1121.5);
  });

  it("allocateExTotals — บิลว่าง/ยอดศูนย์ ไม่ระเบิด", () => {
    expect(allocateExTotals([], 0)).toEqual([]);
    expect(allocateExTotals([0, 0], 0)).toEqual([0, 0]);
  });

  it("🚨 detectVatMode — ถามว่าโหมดไหนได้ยอดที่บันทึกไว้ ไม่ใช่เดา", () => {
    const items = [{ quantity: 16, exVat: 70.09, inVat: 75, discBaht: 0 }];
    const base = { items, discount: 0, hasVat: true, hasWht: false, whtRate: 0 };
    expect(detectVatMode(base, { amountAfterDiscount: 1121.5, vatAmount: 78.5, whtAmount: 0 })).toBe("in");
    expect(detectVatMode(base, { amountAfterDiscount: 1121.44, vatAmount: 78.5, whtAmount: 0 })).toBe("ex");
    // ไม่เข้าทั้งคู่ (บิลเจ้าอื่นปัดทศนิยมเอง) → ex เสมอ · หน้าแก้บิลเปิดโหมดแก้ยอดเองอยู่แล้ว
    expect(detectVatMode(base, { amountAfterDiscount: 1000, vatAmount: 70, whtAmount: 0 })).toBe("ex");
  });

  it("🪤 detectVatMode — บิลที่ไม่มีเศษ เข้าได้ทั้งสองโหมด ต้องตอบ ex", () => {
    const items = [{ quantity: 2, exVat: 100, inVat: 107, discBaht: 0 }];
    const base = { items, discount: 0, hasVat: true, hasWht: false, whtRate: 0 };
    expect(entryCalc({ ...base, vatMode: "in" }).amountAfterDiscount).toBe(200);
    expect(detectVatMode(base, { amountAfterDiscount: 200, vatAmount: 14, whtAmount: 0 })).toBe("ex");
  });

  it("🚨 ประโยคบนจอตัดสินใน lib และต้องตรงกับสิ่งที่โค้ดทำ", () => {
    expect(vatModeWarn("in", false)).toContain("มี VAT 7%");
    expect(vatModeWarn("in", true)).toBe("");
    expect(vatModeWarn("ex", false)).toBe("");
    expect(vatModeWarn(undefined, false)).toBe("");
    expect(lineTotalHeader("in")).toBe("รวม (รวม VAT)");
    expect(lineTotalHeader("ex")).toBe("รวม (ก่อน VAT)");
    expect(itemsHintText("in")).toContain("ถอด VAT ออกจากยอดรวมครั้งเดียว");
    expect(itemsHintText("ex")).toContain("บวก VAT 7%");
    expect(itemsHintText("in")).not.toBe(itemsHintText("ex"));
    const modes: VatMode[] = ["ex", "in"];
    expect(new Set(modes.map((m) => VAT_MODE_LABEL[m])).size).toBe(2);
  });
});

describe("A21 — ช่องราคาช่องเดียว (D113)", () => {
  const prices = [0, 0.01, 1, 9.99, 70.09, 75, 100, 107, 1234.56];

  it("🚨 พิมพ์ช่องเดียวได้คอลัมน์คู่เท่าสูตรเดิมทุกตัวอักษร (เหมือนพิมพ์ช่องนั้นตอนมี 2 ช่อง)", () => {
    for (const v of prices) {
      expect(priceFromInput("ex", v)).toEqual({ exVat: v, inVat: inVatFromExVat(v) });
      expect(priceFromInput("in", v)).toEqual({ inVat: v, exVat: exVatFromInVat(v) });
    }
  });

  it("สลับโหมด = ตัวเลขในช่องคงเดิม เปลี่ยนแค่ความหมาย", () => {
    const ex = reinterpretPrice("ex", "in", 75, inVatFromExVat(75));
    expect(ex).toEqual({ inVat: 75, exVat: exVatFromInVat(75) });
    const back = reinterpretPrice("in", "ex", ex.exVat, ex.inVat);
    expect(back).toEqual({ exVat: 75, inVat: inVatFromExVat(75) });
    // โหมดเดิม = ไม่แตะค่า
    expect(reinterpretPrice("in", "in", 70.09, 75)).toEqual({ exVat: 70.09, inVat: 75 });
  });

  it("🚨 ยอดบิลจากช่องเดียวเท่าเดิม: 16×75 รวม VAT = 1,200.00 · ไม่รวม VAT = เส้นทาง A3 เดิม", () => {
    const run = (mode: VatMode, v: number) => {
      const p = priceFromInput(mode, v);
      return entryCalc({ items: [{ quantity: 16, ...p, discBaht: 0 }], discount: 0, hasVat: true, hasWht: false, whtRate: 0, vatMode: mode });
    };
    const inn = run("in", 75);
    expect(round2(inn.amountAfterDiscount + inn.vatAmount)).toBe(1200);
    const legacy = entryCalc({ items: [{ quantity: 16, exVat: 75, discBaht: 0 }], discount: 0, hasVat: true, hasWht: false, whtRate: 0 });
    expect(run("ex", 75)).toEqual(legacy);
  });

  it("หัวช่องบอกความหมายตามปุ่ม", () => {
    expect(unitPriceHeader("in")).toContain("รวม VAT");
    expect(unitPriceHeader("ex")).toContain("ไม่รวม VAT");
    expect(itemsHintText("ex")).not.toContain("พิมพ์ในช่องไหน");
  });
});

// ── A23 (D123) — ภาษีตามใบกำกับ + เงินเข้า/ออกตามวันที่เคลีย ────────────────────
describe("A23 — บิลค้างที่ออกใบกำกับแล้วเข้า ภพ.30 · เคลียแล้วใช้วันที่จ่ายจริง (D123)", () => {
  const base = {
    category: "ขาย", wht_rate: 0, wht_amount: 0, tax_invoice_date: null as string | null,
    status: "ปกติ", entity_id: EID, settled_on: null as string | null,
  };
  // บิลขายค้างรับ ออกใบกำกับ 10/10 ยังไม่ได้เงิน
  const arOpen: Tx = { ...base, tx_id: "AR-OPEN", transaction_date: "2026-10-10", type: "รายรับ", account_name: null, contact_name: "ลูกค้า A", amount_after_discount: 1000, vat_amount: 70, net_amount: 1070, tax_invoice_no: "INV-10", ap_ar_status: "AR" };
  // บิลเดียวกันหลังกดชำระ 10/11 — แถวเดิม วันที่รายการเดิม (fn_settle_apar)
  const arPaid: Tx = { ...arOpen, account_name: "บัญชีบริษัท", ap_ar_status: null, settled_on: "2026-11-10" };
  const arNoInv: Tx = { ...arOpen, tx_id: "AR-NOINV", tax_invoice_no: "" };
  const apOpen: Tx = { ...base, tx_id: "AP-OPEN", transaction_date: "2026-10-12", type: "รายจ่าย", account_name: null, contact_name: "บริษัท ผู้ขาย จำกัด", category: "ค่าบริการ", amount_after_discount: 2000, vat_amount: 140, wht_rate: 3, wht_amount: 60, net_amount: 2080, tax_invoice_no: "B-10", ap_ar_status: "AP" };
  const apPaid: Tx = { ...apOpen, account_name: "บัญชีบริษัท", ap_ar_status: null, settled_on: "2026-11-05" };

  it("บิลค้างที่มีเลขใบกำกับ นับเข้า ภพ.30 เดือนของวันที่รายการ (ทั้งขายและซื้อ)", () => {
    const r = taxReport("2026-10", EID, 0, [arOpen, apOpen], {});
    expect(r.totalSalesAmount).toBe(1000);
    expect(r.totalPurchaseAmount).toBe(2000);
    // ★ สูตร VAT เดิมทุกตัวอักษร: คิดจากยอดรวม × 7%
    expect(r.totalSalesVat).toBe(70);
    expect(r.totalPurchaseVat).toBe(140);
  });

  it("บิลค้างที่ยังไม่มีเลขใบกำกับ ไม่นับ", () => {
    expect(taxReport("2026-10", EID, 0, [arNoInv], {}).sales).toHaveLength(0);
  });

  it("🚩 กดชำระคนละเดือน: บิลยังอยู่เดือนเดิม ไม่โผล่ในเดือนที่จ่าย (ไม่นับซ้ำ)", () => {
    expect(taxReport("2026-10", EID, 0, [arPaid], {}).totalSalesAmount).toBe(1000);
    expect(taxReport("2026-11", EID, 0, [arPaid], {}).sales).toHaveLength(0);
  });

  it("บิลค้าง/ยกเลิก/กิจการอื่น", () => {
    expect(taxReport("2026-10", EID, 0, [{ ...arOpen, status: "ยกเลิก" }], {}).sales).toHaveLength(0);
    expect(taxReport("2026-10", EID, 0, [{ ...arOpen, entity_id: "EID01" }], {}).sales).toHaveLength(0);
  });

  it("cashDateOf: เคลียแล้วใช้วันที่เคลีย · นอกนั้นวันที่รายการ (ไม่อ่าน payment_date)", () => {
    expect(cashDateOf(arPaid)).toBe("2026-11-10");
    expect(cashDateOf(arOpen)).toBe("2026-10-10");
    expect(cashDateOf({ transaction_date: "2026-10-10", settled_on: null, payment_date: "2026-12-01" } as never)).toBe("2026-10-10");
  });

  it("ภงด.3/53: บิลค้างจ่ายไม่นับ · เคลียแล้วนับเดือนที่จ่ายจริง", () => {
    expect(whtReport("2026-10", EID, [apOpen], {}).pnd53).toHaveLength(0);
    expect(whtReport("2026-10", EID, [apPaid], {}).pnd53).toHaveLength(0);
    const nov = whtReport("2026-11", EID, [apPaid], {});
    expect(nov.pnd53TotalWht).toBe(60);
    expect(nov.pnd53[0].date).toBe("05/11/69");
  });

  it("50ทวิ ค้างออก ย้ายไปเดือนที่จ่าย แต่ยอดแดชบอร์ดคงเดิม", () => {
    const oct = dashboardData("2026-10", EID, [apPaid], new Set());
    expect(oct.dash.expense).toBe(2000);
    expect(oct.whtPending).toHaveLength(0);
    const nov = dashboardData("2026-11", EID, [apPaid], new Set());
    expect(nov.dash.expense).toBe(0);
    expect(nov.whtPending.map((p) => p.transactionId)).toEqual(["AP-OPEN"]);
    expect(nov.whtPending[0].transactionDateISO).toBe("2026-11-05");
  });

});

// ── A24 (D124) — ภาษีตัดสินจากกิจการ + เอกสาร ไม่ใช่บัญชีที่เงินเข้า/ออก ─────────────────
describe("A24 — ไม่กรองบัญชี · บิลซื้อไม่มีเลขใบกำกับนับแต่ต้องลิสต์ (D124)", () => {
  const mk = (o: Partial<Tx>): Tx => ({
    tx_id: "X", transaction_date: "2026-07-12", type: "รายจ่าย", account_name: "เงินสดย่อย", category: "เบ็ดเตล็ด",
    contact_name: "นายสมชาย", amount_after_discount: 300, vat_amount: 21, wht_rate: 0, wht_amount: 0, net_amount: 321,
    tax_invoice_no: "B-9", tax_invoice_date: null, status: "ปกติ", entity_id: EID, ap_ar_status: null, ...o,
  });

  it("🚩 บิลที่มีใบกำกับ จ่ายจากบัญชีไหนก็นับ (เดิมบัญชีนอกรายการหลุดทั้งใบ)", () => {
    for (const acc of ["เงินสดย่อย", "บัญชีส่วนตัว", "บัญชีบริษัท"]) {
      const r = taxReport("2026-07", EID, 0, [mk({ account_name: acc })], {});
      expect(r.totalPurchaseAmount, acc).toBe(300);
      expect(r.totalPurchaseVat, acc).toBe(21);
    }
    const s = taxReport("2026-07", EID, 0, [mk({ type: "รายรับ", account_name: "เงินสดในร้าน", tax_invoice_no: "INV-9" })], {});
    expect(s.totalSalesVat).toBe(21);
  });

  it("ภงด./แดชบอร์ด ก็ไม่ถามบัญชี", () => {
    const p = mk({ account_name: "เงินสดย่อย", wht_rate: 3, wht_amount: 9 });
    expect(whtReport("2026-07", EID, [p], {}).pnd3TotalWht).toBe(9);
    expect(dashboardData("2026-07", EID, [p], new Set()).dash.expense).toBe(300);
  });

  it("ทาง ก: บิลซื้อมี VAT แต่ไม่มีเลขใบกำกับ — ยังนับเข้า ภพ.30", () => {
    const r = taxReport("2026-07", EID, 0, [mk({ tax_invoice_no: "" })], {});
    expect(r.totalPurchaseVat).toBe(21);
  });

  it("missingInvoicePurchases ลิสต์เฉพาะบิลที่อยู่ในตัวเลข ภพ.30 จริงของเดือนนั้น", () => {
    const list = [
      mk({ tx_id: "M1", tax_invoice_no: "" }),                     // ✔ ซื้อ มี VAT ไม่มีเลข
      mk({ tx_id: "M2", tax_invoice_no: " " , type: "บันทึกภาษี" }), // ✔ ช่องว่างล้วน = ไม่มีเลข
      mk({ tx_id: "M3" }),                                         // มีเลข
      mk({ tx_id: "M4", tax_invoice_no: "", vat_amount: 0 }),      // ไม่มี VAT
      mk({ tx_id: "M5", tax_invoice_no: "", type: "รายรับ" }),     // ฝั่งขาย ไม่ใช่ภาษีซื้อ
      mk({ tx_id: "M6", tax_invoice_no: "", status: "ยกเลิก" }),
      mk({ tx_id: "M7", tax_invoice_no: "", entity_id: "EID01" }),
      mk({ tx_id: "M8", tax_invoice_no: "", transaction_date: "2026-08-01" }),
      mk({ tx_id: "M9", tax_invoice_no: "", ap_ar_status: "AP" }), // ค้างไม่มีเลข = ไม่อยู่ใน ภพ.30 อยู่แล้ว
    ];
    expect(missingInvoicePurchases("2026-07", EID, list).map((t) => t.tx_id)).toEqual(["M1", "M2"]);
  });

  it("missingInvoiceWarn ตอนบันทึก: เตือนเฉพาะซื้อ + ติ๊ก VAT + เลขว่าง", () => {
    expect(missingInvoiceWarn("รายจ่าย", true, "")).toMatch(/ภพ\.30/);
    expect(missingInvoiceWarn("บันทึกภาษี", true, "  ")).toMatch(/ภพ\.30/);
    expect(missingInvoiceWarn("รายจ่าย", true, "B-1")).toBeNull();
    expect(missingInvoiceWarn("รายจ่าย", false, "")).toBeNull();
    expect(missingInvoiceWarn("รายรับ", true, "")).toBeNull();
  });
});
