import { describe, it, expect } from "vitest";
import {
  num,
  round2,
  formatDateBE,
  isCorporate,
  itemDiscBahtFromPct,
  itemTotal,
  exVatFromInVat,
  inVatFromExVat,
  entryCalc,
  reverseWht,
  splitInstallments,
  taxReport,
  previousVat,
  whtReport,
  dashboardData,
  type Tx,
  type ContactMap,
  type TaxSummaryRow,
} from "./calc";

/** ค่า expected คำนวณด้วยมือจาก logic ระบบเดิม (Reports.js / _js_entry.html) */

const TAX_ACCOUNTS = new Set(["บัญชีบริษัท"]);
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
  // AP/AR ค้าง — ต้องหลุดทุกจุด
  { tx_id: "AR1", transaction_date: "2026-07-11", type: "รายรับ", account_name: "บัญชีบริษัท", category: "ขาย", contact_name: "ลูกค้า A", amount_after_discount: 9999, vat_amount: 700, wht_rate: 0, wht_amount: 0, net_amount: 10699, tax_invoice_no: "X", tax_invoice_date: "2026-07-11", status: "ปกติ", entity_id: EID, ap_ar_status: "AR" },
  // เช็คราคา — account ว่าง → หลุด
  { tx_id: "PC1", transaction_date: "2026-07-09", type: "เช็คราคา", account_name: "", category: "เช็คราคา", contact_name: "ลูกค้า A", amount_after_discount: 0, vat_amount: 0, wht_rate: 0, wht_amount: 0, net_amount: 0, tax_invoice_no: "", tax_invoice_date: null, status: "ปกติ", entity_id: EID, ap_ar_status: null },
  // ยกเลิก — หลุด
  { tx_id: "V1", transaction_date: "2026-07-06", type: "รายรับ", account_name: "บัญชีบริษัท", category: "ขาย", contact_name: "ลูกค้า A", amount_after_discount: 400, vat_amount: 28, wht_rate: 0, wht_amount: 0, net_amount: 428, tax_invoice_no: "Y", tax_invoice_date: "2026-07-06", status: "ยกเลิก", entity_id: EID, ap_ar_status: null },
  // บัญชีไม่อยู่ในระบบภาษี — หลุด
  { tx_id: "N1", transaction_date: "2026-07-12", type: "รายจ่าย", account_name: "เงินสดย่อย", category: "เบ็ดเตล็ด", contact_name: "นายสมชาย", amount_after_discount: 300, vat_amount: 21, wht_rate: 0, wht_amount: 0, net_amount: 321, tax_invoice_no: "", tax_invoice_date: null, status: "ปกติ", entity_id: EID, ap_ar_status: null },
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
  const r = taxReport("2026-07", EID, 50, txs, contacts, TAX_ACCOUNTS);
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
  it("guard: AP/AR, ยกเลิก, เช็คราคา, บัญชีนอกภาษี, กิจการอื่น หลุดหมด", () => {
    expect(r.sales.length).toBe(2); // เหลือ S1,S2 (AR1/V1/E1/PC1 หลุด)
    expect(r.purchases.length).toBe(1); // P2 vat=0 หลุด, N1 บัญชีนอกภาษีหลุด
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
    const r = taxReport("2026-07", EID, 0, importTx, {}, TAX_ACCOUNTS);
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
    const r = taxReport("2026-07", EID, 0, [mkTx("C-02")], cmap, TAX_ACCOUNTS);
    expect(r.sales[0].branchMark).toBe("00007");
  });
  it("ไม่มี contact_id → fallback ตามชื่อ (สาขา 13)", () => {
    const r = taxReport("2026-07", EID, 0, [mkTx(null)], cmap, TAX_ACCOUNTS);
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
  const w = whtReport("2026-07", EID, txs, contacts, TAX_ACCOUNTS);
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
    const d = dashboardData("2026-07", EID, txs, TAX_ACCOUNTS, new Set());
    expect(d.dash).toEqual({ income: 1500, expense: 3000, vatOut: 105, vatIn: 140 });
    expect(d.whtPending.map((p) => p.transactionId)).toEqual(["P1", "P2"]);
  });
  it("ตัดที่ออก 50ทวิ แล้วออกจาก pending", () => {
    const d = dashboardData("2026-07", EID, txs, TAX_ACCOUNTS, new Set(["P1"]));
    expect(d.whtPending.map((p) => p.transactionId)).toEqual(["P2"]);
  });
});
