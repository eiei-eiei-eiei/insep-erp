import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import {
  STATUS_INSTALLMENT, installmentLabel, nextUnpaid, isLocked, planAmounts, planError, defaultPlanRows, planTermsLines, installmentDocFigures,
  receiveAmountError, statusAfterInstallment, statusAfterShipNow, shipNowError, planActionError,
  type Installment,
} from "./installments";
import { PAY_LABEL, paymentForDoc } from "./payments";
import { processOrder, neededSerials, type OrderState, type RevenueConfig } from "./orders";

/**
 * golden S16 — แบ่งชำระหลายงวด (D145 · 0101)
 */

const inst = (seq: number, amount: number, o: Partial<Installment> = {}): Installment => ({
  seq, label: `งวด ${seq}`, percent: null, amount, dueDate: "", invNo: "", invDate: "", shipPoint: false, paid: false, ...o,
});

describe("S16 planAmounts — งวดสุดท้ายรับเศษ", () => {
  it("50/20/30 ของ 100,000", () => {
    expect(planAmounts(100000, [50, 20, 30], 100000)).toEqual([50000, 20000, 30000]);
  });
  it("ยอดไม่ลงตัว — ผลรวมเท่ายอดพอดีทุกสตางค์", () => {
    const a = planAmounts(1070, [33.33, 33.33, 33.34], 1070);
    expect(a).toEqual([356.63, 356.63, 356.74]);
    expect(Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100).toBe(1070);
  });
  it("ปรับงวดหลังรับงวดแรก (ยอดที่ต้องแบ่ง = ยอดค้าง)", () => {
    // ผู้ใช้ยกตัวอย่าง: 50/20/30 รับ 50 แล้ว → รวบ 50 · สลับ 30/20 · แตก 20/20/10
    expect(planAmounts(100000, [50], 50000)).toEqual([50000]);
    expect(planAmounts(100000, [30, 20], 50000)).toEqual([30000, 20000]);
    expect(planAmounts(100000, [20, 20, 10], 50000)).toEqual([20000, 20000, 10000]);
  });
});

describe("S16 planError", () => {
  const row = (percent: number, o: Partial<{ label: string; shipPoint: boolean }> = {}) =>
    ({ label: "งวด", percent, shipPoint: false, ...o });
  it("3 แบบที่ผู้ใช้ยกมา ผ่านหมด", () => {
    expect(planError([row(50)], 100000, 50000, false)).toBeNull();
    expect(planError([row(30), row(20)], 100000, 50000, false)).toBeNull();
    expect(planError([row(20), row(20), row(10)], 100000, 50000, false)).toBeNull();
  });
  it("รวม % ไม่เท่ายอดค้าง → บอกทั้งสองตัวเลข", () => {
    expect(planError([row(30), row(30)], 100000, 50000, false)).toBe("งวดรวมได้ 60% แต่ต้องได้ 50% (เท่ายอดค้าง)");
    expect(planError([row(50), row(40)], 100000, 100000, false)).toBe("งวดรวมได้ 90% แต่ต้องได้ 100%"); // ใบเสนอราคาใหม่
  });
  it("ยอดค้างเป็น % ไม่ลงตัว (ลูกค้าจ่ายขาด) ก็ตั้งได้", () => {
    // รับงวดแรก 49,500 จากแผน 50,000 → ค้าง 50,500 = 50.5%
    expect(planError([row(20), row(30.5)], 100000, 50500, false)).toBeNull();
  });
  it("กันข้อมูลผิด", () => {
    expect(planError([], 100000, 50000, false)).toBe("ต้องมีอย่างน้อย 1 งวด");
    expect(planError([row(50, { label: " " })], 100000, 50000, false)).toBe("ทุกงวดต้องมีชื่อ");
    expect(planError([row(0), row(50)], 100000, 50000, false)).toBe("ทุกงวดต้องมี % มากกว่า 0");
    expect(planError([row(25, { shipPoint: true }), row(25, { shipPoint: true })], 100000, 50000, false)).toBe("จุดส่งของเลือกได้งวดเดียว");
    expect(planError([row(50, { shipPoint: true })], 100000, 50000, true)).toBe("ส่งคลังไปแล้ว — ไม่ต้องเลือกจุดส่งของ");
    expect(planError([row(50)], 100000, 0, false)).toBe("รับเงินครบแล้ว — ไม่มีงวดให้แบ่ง");
  });
});

describe("S16 การรับเงินรายงวด", () => {
  const plan = [inst(1, 50000, { paid: true }), inst(2, 20000), inst(3, 30000)];
  it("งวดถัดไป = ต่ำสุดที่ยังไม่รับ · ล็อก = รับแล้วหรือออกใบแจ้งหนี้แล้ว", () => {
    expect(nextUnpaid(plan)?.seq).toBe(2);
    expect(isLocked(plan[0])).toBe(true);
    expect(isLocked(inst(2, 1, { invNo: "INV-1" }))).toBe(true);
    expect(isLocked(plan[1])).toBe(false);
  });
  it("รับตามลำดับ · ไม่เกินยอดค้าง · งวดสุดท้ายต้องเต็ม", () => {
    expect(receiveAmountError(plan, 2, 20000, 50000)).toBeNull();
    expect(receiveAmountError(plan, 2, 19500, 50000)).toBeNull(); // ขาด → ส่วนต่างไปงวด 3
    expect(receiveAmountError(plan, 3, 30000, 50000)).toBe("ต้องรับงวดที่ 2 ก่อน (รับตามลำดับงวด)");
    expect(receiveAmountError(plan, 2, 60000, 50000)).toBe("ยอดที่รับเกินยอดค้าง (50000)");
    expect(receiveAmountError(plan, 2, 0, 50000)).toBe("ยอดที่รับต้องมากกว่า 0");
    const last = [inst(1, 50000, { paid: true }), inst(2, 50000)];
    expect(receiveAmountError(last, 2, 49000, 50000)).toMatch(/งวดสุดท้ายต้องรับเต็มยอดค้าง 50000/);
    expect(receiveAmountError([inst(1, 1, { paid: true })], 1, 1, 0)).toBe("รับเงินครบทุกงวดแล้ว");
  });
});

describe("S16 สถานะหลังรับงวด", () => {
  it("ยังไม่ส่งคลัง ไม่ใช่จุดส่งของ → กำลังผ่อนชำระ", () => {
    expect(statusAfterInstallment("รอคอนเฟิร์ม", false, 50000)).toEqual({ status: STATUS_INSTALLMENT, ship: false });
  });
  it("ถึงจุดส่งของ → ส่งคลัง · หลังส่งของ = รอยอดค้าง หรือ ปิดการขาย", () => {
    expect(statusAfterInstallment(STATUS_INSTALLMENT, true, 30000))
      .toEqual({ status: "รอคลังจัดส่ง", nextStatus: "ส่งของแล้วรอชำระยอดค้าง", ship: true });
    expect(statusAfterInstallment(STATUS_INSTALLMENT, true, 0))
      .toEqual({ status: "รอคลังจัดส่ง", nextStatus: "ปิดการขาย", ship: true });
  });
  it("รับครบทุกงวดแล้วแต่ยังไม่ส่ง → ส่งคลังเอง (ไม่ค้างของไว้)", () => {
    expect(statusAfterInstallment(STATUS_INSTALLMENT, false, 0))
      .toEqual({ status: "รอคลังจัดส่ง", nextStatus: "ปิดการขาย", ship: true });
  });
  it("รอคลังแพ็คอยู่ → สถานะคงเดิม แต่ปรับสถานะหลังส่งของ", () => {
    expect(statusAfterInstallment("รอคลังจัดส่ง", false, 0)).toEqual({ status: "รอคลังจัดส่ง", nextStatus: "ปิดการขาย", ship: false });
  });
  it("ส่งของแล้ว → รับครบ = ปิดการขาย", () => {
    expect(statusAfterInstallment("ส่งของแล้วรอชำระยอดค้าง", false, 0)).toEqual({ status: "ปิดการขาย", ship: false });
    expect(statusAfterInstallment("ส่งของแล้วรอชำระยอดค้าง", false, 100)).toEqual({ status: "ส่งของแล้วรอชำระยอดค้าง", ship: false });
  });
  it("ส่งคลังตอนนี้ ส่งได้ครั้งเดียว", () => {
    expect(shipNowError(STATUS_INSTALLMENT)).toBeNull();
    expect(shipNowError("รอคลังจัดส่ง")).toBe("ส่งคลังไปแล้ว");
    expect(statusAfterShipNow(500)).toEqual({ status: "รอคลังจัดส่ง", nextStatus: "ส่งของแล้วรอชำระยอดค้าง" });
  });
});

describe("S16 ปุ่มต้องตรงกับชนิดออเดอร์", () => {
  it("มีแผน → ปุ่มแบบเดิมใช้ไม่ได้ · ไม่มีแผน → ปุ่มรายงวดใช้ไม่ได้", () => {
    for (const a of ["DEPOSIT_AND_SEND", "FULL_PAYMENT_AND_SEND", "PAY_BALANCE", "FULL_PAYMENT_LATER", "SEND_TO_WH", "ISSUE_INVOICE_DEPOSIT", "ISSUE_INVOICE_FULL"]) {
      expect(planActionError(a, true), a).not.toBeNull();
      expect(planActionError(a, false), a).toBeNull();
    }
    for (const a of ["RECEIVE_INSTALLMENT", "SHIP_PLAN"]) {
      expect(planActionError(a, true), a).toBeNull();
      expect(planActionError(a, false), a).not.toBeNull();
    }
  });
  it("🪤 ป้ายงวดไม่ชนป้ายการรับเงินแบบเดิม (ใบเสร็จมัดจำจะจับผิดใบ)", () => {
    const l = installmentLabel({ seq: 1, label: "มัดจำ" });
    expect(l).toBe("งวดที่ 1 (มัดจำ)");
    expect(Object.values(PAY_LABEL)).not.toContain(l);
  });
});

describe("S16 processOrder RECEIVE_INSTALLMENT / SHIP_PLAN", () => {
  const contact = { taxId: "", branch: "สำนักงานใหญ่", address: "" };
  const items = [{ name: "เหล้า", qty: 2, price: 535 }];
  const config: RevenueConfig = { accountName: "ธนาคาร", entityId: "EID01" };
  const base: OrderState = {
    quNo: "QU1", orderNo: "ORD1", status: "รอคอนเฟิร์ม", deposit: 0, outstandingBalance: 1070,
    subTotal: 1000, discount: 0, whtPercent: 0, category: "รายได้ค่าสินค้า", customerName: "ทดสอบ",
    invNo: "", taxNo1: "", taxNo2: "",
    installments: [inst(1, 535, { label: "มัดจำ" }), inst(2, 214), inst(3, 321, { shipPoint: true })],
  };

  it("งวดแรก: ถอด VAT แบบมัดจำ · แนบรายการสินค้า · key -i1 · ไม่แตะช่องเลขของออเดอร์", () => {
    const r = processOrder(base, "RECEIVE_INSTALLMENT", { installmentSeq: 1, amount: 535, method: "โอนเงิน", docDate: "2026-10-30" },
      items, { taxNo1: "TAX-I1" }, contact, config);
    expect(r.update).toMatchObject({ status: STATUS_INSTALLMENT, deposit: 535, outstandingBalance: 535 });
    expect(r.update.taxNo1).toBeUndefined();
    expect(r.update.checkDetail2).toBeUndefined();
    const rev = r.revenue!;
    expect(rev).toMatchObject({
      idempotencyKey: "ORD1-i1", taxInvoiceNo: "TAX-I1", installmentSeq: 1, paymentLabel: "งวดที่ 1 (มัดจำ)",
      netAmount: 535, amountAfterDiscount: 500, vatAmount: 35, baseAmount: 500, discount: 0,
    });
    expect(rev.items).toHaveLength(1);
    expect(r.lineMsg).toContain("งวดที่ 1 (มัดจำ) ฿535");
  });

  it("งวดที่ถึงจุดส่งของ: ส่งคลัง + เลขใบแจ้งหนี้/ใบส่งสินค้า · ไม่แนบรายการซ้ำ", () => {
    const o: OrderState = {
      ...base, status: STATUS_INSTALLMENT, deposit: 749, outstandingBalance: 321,
      installments: [inst(1, 535, { paid: true }), inst(2, 214, { paid: true }), inst(3, 321, { shipPoint: true })],
    };
    expect(neededSerials("RECEIVE_INSTALLMENT", o, true, { seq: 3, amount: 321 })).toEqual({ inv: true, tax1: true, tax2: false });
    const r = processOrder(o, "RECEIVE_INSTALLMENT", { installmentSeq: 3, amount: 321, method: "เงินสด", docDate: "2026-11-30" },
      items, { invNo: "INV-9", taxNo1: "TAX-I3" }, contact, config);
    expect(r.update).toMatchObject({ status: "รอคลังจัดส่ง", nextStatus: "ปิดการขาย", invNo: "INV-9", docToPrint: "invoice", outstandingBalance: 0 });
    expect(r.revenue!.items).toHaveLength(0);
    expect(r.revenue!.idempotencyKey).toBe("ORD1-i3");
  });

  it("กิจการไม่จด VAT: ใบเสร็จรายงวดใช้เลขชุดใบเสร็จ · VAT 0", () => {
    expect(neededSerials("RECEIVE_INSTALLMENT", base, false, { seq: 1, amount: 535 })).toEqual({ inv: false, tax1: false, tax2: false, rcpt1: true, rcpt2: false });
    const r = processOrder(base, "RECEIVE_INSTALLMENT", { installmentSeq: 1, amount: 535, method: "โอนเงิน", docDate: "2026-10-30" },
      items, { rcptNo1: "RC-1" }, contact, { ...config, isVat: false });
    expect(r.revenue).toMatchObject({ taxInvoiceNo: "RC-1", vatAmount: 0 });
  });

  it("ส่งคลังตอนนี้: ไม่มีบิล · ได้เลขใบแจ้งหนี้/ใบส่งสินค้า", () => {
    const o = { ...base, status: STATUS_INSTALLMENT, deposit: 535, outstandingBalance: 535 };
    expect(neededSerials("SHIP_PLAN", o, true)).toEqual({ inv: true, tax1: false, tax2: false });
    const r = processOrder(o, "SHIP_PLAN", { docDate: "2026-11-01" }, items, { invNo: "INV-2" }, contact, config);
    expect(r.revenue).toBeNull();
    expect(r.update).toMatchObject({ status: "รอคลังจัดส่ง", nextStatus: "ส่งของแล้วรอชำระยอดค้าง", invNo: "INV-2", docDate1: "2026-11-01" });
  });
});

describe("S16 SQL ⇄ TS (0101)", () => {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const latestDef = (name: string) => {
    const f = [...files].reverse().find((x) => readFileSync(`${dir}/${x}`, "utf8").includes(`create or replace function ${name}(`));
    const src = readFileSync(`${dir}/${f}`, "utf8");
    const start = src.indexOf(`create or replace function ${name}(`);
    return src.slice(start, src.indexOf("end $", start));
  };
  it("fn_apply_order_action ตรวจลำดับงวดก่อนลงบิล + เก็บ installment_seq + ส่วนต่างไปงวดสุดท้าย", () => {
    const def = latestDef("fn_apply_order_action");
    expect(def).toContain("p_revenue->>'installmentSeq'");
    expect(def.indexOf("ต้องรับงวดที่")).toBeLessThan(def.indexOf("v_tx_id := next_tx_id()"));
    expect(def).toMatch(/doc_date, doc_no, tx_id, installment_seq\)/);
    expect(def).toContain("งวดสุดท้ายต้องรับเต็มยอดค้าง");
  });
  it("fn_cancel_order ยกเลิกบิลของทุกงวดตามแถวการรับเงิน", () => {
    expect(latestDef("fn_cancel_order")).toMatch(/tx_id in \(select p\.tx_id from sales_payments p/);
  });
  it("สถานะใหม่ที่ RPC รู้จักว่า 'ยังไม่ส่ง' ตรงกับ TS (ส่งคลังแล้ว = ตั้งจุดส่งของไม่ได้)", () => {
    const src = readFileSync(`${dir}/${files.find((f) => f.includes("_sales_installments"))}`, "utf8");
    expect(src).toContain("v_sent := v_order.status in ('รอคลังจัดส่ง', 'ส่งของแล้วรอชำระยอดค้าง', 'ส่งของแล้วรอชำระเงิน')");
  });
});

// ── D146 · เฟส 3b ใบเสนอราคา ─────────────────────────────────────────────────

describe("S16 ใบเสนอราคา (D146)", () => {
  it("แผนตั้งต้น = มัดจำ x% (จุดส่งของ) + ส่วนที่เหลือ — เท่าโฟลว์มัดจำเดิม", () => {
    expect(defaultPlanRows(30)).toEqual([
      { label: "มัดจำ", percent: 30, shipPoint: true },
      { label: "ส่วนที่เหลือ", percent: 70, shipPoint: false },
    ]);
    expect(defaultPlanRows(0)[0].percent).toBe(50); // ใบเก่าไม่ได้ระบุ % → 50
    expect(defaultPlanRows(100)[0].percent).toBe(50); // 100% ไม่ใช่การแบ่งงวด
  });
  it("บรรทัดเงื่อนไขบนใบเสนอราคา", () => {
    expect(planTermsLines([
      { seq: 1, label: "มัดจำ", percent: 50, amount: 50000, shipPoint: false },
      { seq: 2, label: "ส่งของ", percent: 50, amount: 50000, shipPoint: true },
    ])).toEqual([
      "งวดที่ 1 มัดจำ 50% = 50,000.00 บาท",
      "งวดที่ 2 ส่งของ 50% = 50,000.00 บาท (ส่งสินค้าหลังรับงวดนี้)",
    ]);
    expect(planTermsLines([{ seq: 1, label: "ก", percent: null, amount: 1.5, shipPoint: false }])).toEqual(["งวดที่ 1 ก = 1.50 บาท"]);
  });
  it("สร้าง/แก้ใบเสนอราคา: มีแผน = ปิดมัดจำเดิม · ตรวจแผนก่อนบันทึก · แก้ไม่ได้เมื่อมีงวดล็อก", () => {
    const src = readFileSync("app/(app)/sales/actions.ts", "utf8");
    expect(src).toMatch(/buildQuotationDbPayload\(withPlan\(input\), vat\.isVat\)[\s\S]*fn_save_quotation/);
    expect(src).toMatch(/buildQuotationDbPayload\(withPlan\(input\), vat\.isVat\)[\s\S]*fn_update_quotation/);
    expect(src.indexOf("quotationPlanError(input, totals.netPayable)")).toBeLessThan(src.indexOf('rpc("fn_save_quotation"'));
    expect(src).toMatch(/installments\?\.some\(\(i\) => i\.paid \|\| i\.invNo\)[\s\S]*แก้ใบเสนอราคาไม่ได้/);
  });
  it("หน้าใบเสนอราคาเลิกใช้ช่องติ๊กมัดจำแบบเดิม", () => {
    const src = readFileSync("app/(app)/sales/_components/QuotationTab.tsx", "utf8");
    // 🪤 ตรวจโค้ดจริง ไม่ใช่คำในไฟล์ (D95) — คอมเมนต์อธิบายว่า "แทน กำหนดเงื่อนไขมัดจำ" ได้
    expect(src).not.toMatch(/setIsDeposit|\/> กำหนดเงื่อนไขมัดจำ/);
    expect(src).toContain("<InstallmentEditor");
  });
  it("0102: ใบแจ้งหนี้งวดแรก → รอชำระมัดจำ (fn_update_quotation รับแค่ รอคอนเฟิร์ม)", () => {
    const dir = "supabase/migrations";
    const f = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort().reverse()
      .find((x) => readFileSync(`${dir}/${x}`, "utf8").includes("create or replace function fn_sales_installment_invoice("));
    expect(readFileSync(`${dir}/${f}`, "utf8")).toMatch(/set status = 'รอชำระมัดจำ'\s+where tenant_id = v_tenant and qu_no = p_qu_no and status = 'รอคอนเฟิร์ม'/);
    const uq = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort().reverse()
      .find((x) => readFileSync(`${dir}/${x}`, "utf8").includes("create or replace function fn_update_quotation("));
    expect(readFileSync(`${dir}/${uq}`, "utf8")).toMatch(/if v_status <> 'รอคอนเฟิร์ม' then/);
  });
});

// ── D147 · เฟส 3c เอกสารรายงวด + หน้าจัดการออเดอร์ ───────────────────────────────
describe("S16 ตัวเลขบนเอกสารรายงวด (D147)", () => {
  const plan = [
    inst(1, 500, { paid: true, label: "มัดจำ" }),
    inst(2, 190, { paid: true }),
    inst(3, 310, { invNo: "INV-3", label: "ส่งของ" }),
  ];
  it("ใบเสร็จงวด 2: ตามสัญญา · รับก่อนหน้า (งวด 1) · งวดนี้ · คงเหลือ", () => {
    expect(installmentDocFigures(plan, 2, 1000)).toEqual({ k: 2, n: 3, label: "งวด 2", contract: 1000, paidBefore: 500, amount: 190, remaining: 310 });
  });
  it("ใบแจ้งหนี้งวดสุดท้าย: คงเหลือหลังงวดนี้ = 0", () => {
    expect(installmentDocFigures(plan, 3, 1000)).toMatchObject({ k: 3, n: 3, paidBefore: 690, amount: 310, remaining: 0 });
  });
  it("งวดแรก: ไม่มีรับก่อนหน้า", () => {
    expect(installmentDocFigures(plan, 1, 1000)).toMatchObject({ paidBefore: 0, amount: 500, remaining: 500 });
  });
  it("พิมพ์ซ้ำหลังรับงวดถัดไปแล้ว ตัวเลขของใบเดิมไม่ขยับ (ไม่อ่านยอดค้างปัจจุบัน)", () => {
    const later = plan.map((i) => (i.seq === 3 ? { ...i, paid: true } : i));
    expect(installmentDocFigures(later, 2, 1000)).toEqual(installmentDocFigures(plan, 2, 1000));
  });
});

describe("S16 หน้าจอ/เอกสาร (D147)", () => {
  it("ใบเสร็จรายงวดจับคู่การรับเงินด้วยเลขงวด", () => {
    const pays = [
      { seq: 1, label: "งวดที่ 1 (มัดจำ)", amount: 500, method: "เงินสด", chequeDetail: "", docDate: "", docNo: "T1", txId: "", installmentSeq: 1 },
      { seq: 2, label: "งวดที่ 2", amount: 190, method: "โอนเงิน", chequeDetail: "", docDate: "", docNo: "T2", txId: "", installmentSeq: 2 },
    ];
    expect(paymentForDoc("tax-invoice-installment:2", pays)?.docNo).toBe("T2");
    expect(paymentForDoc("tax-invoice-installment:3", pays)).toBeNull();
  });
  it("ออเดอร์แบ่งงวดไม่โชว์ปุ่มรับเงินแบบเดิม (server ปฏิเสธอยู่แล้ว — ปุ่มที่กดแล้วพังห้ามมี)", () => {
    const src = readFileSync("app/(app)/sales/_components/OrdersTab.tsx", "utf8");
    for (const a of ["ISSUE_INVOICE_DEPOSIT\"", "action: \"DEPOSIT_AND_SEND\" })}>รับมัดจำ", "PAY_BALANCE\" })}", "FULL_PAYMENT_LATER\" })}"]) {
      const at = src.indexOf(a);
      expect(at, a).toBeGreaterThan(0);
    }
    // ทุกเงื่อนไขของปุ่มรับเงินแบบเดิมต้องมี !hasPlan(o)
    const legacyGates = [...src.matchAll(/\{canWrite && o\.status[^\n]*?&& \(\n/g)].map((m) => m[0]);
    expect(legacyGates.length).toBeGreaterThanOrEqual(5);
    for (const g of legacyGates) expect(g, g).toMatch(/hasPlan\(o\)/);
  });
  it("เอกสารรายงวด: ผู้ไม่จด VAT ห้ามมีคำว่าใบกำกับภาษี (ม.86/13)", () => {
    const src = readFileSync("app/(app)/sales/_components/print.ts", "utf8");
    expect(src).toMatch(/isVat \? `ใบกำกับภาษี\/ใบเสร็จรับเงิน \(\$\{tag\}\)` : `ใบเสร็จรับเงิน \(\$\{tag\}\)`/);
    expect(src).toContain("installmentDocFigures(plan, seq, netPayable)");
  });
});
