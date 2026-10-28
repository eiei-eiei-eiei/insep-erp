/**
 * golden C1 — Claude connector: ตรวจ + คิดยอดบิลจากรูป (D141)
 *
 * 🚨 ไฟล์นี้ไม่ได้ทดสอบสูตรเงิน (สูตรอยู่ใน entryCalc · golden A3/A4/A21) — ทดสอบว่า
 *    connector ส่งของเข้าสูตรตัวเดิมถูก และด่าน "ยอดต้องตรงบิล" จับการอ่านผิดได้จริง
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkBill, taxIdValid, normalizeTaxId, previewSummary, ROUNDING_CAP, type BillDraft, type BillContext } from "./bill";

const ctx: BillContext = {
  entities: [
    { entity_id: "EID01", name: "โรงกลั่นทดสอบ", is_vat: true },
    { entity_id: "EID02", name: "ร้านไม่จด VAT", is_vat: false },
  ],
  accounts: ["กสิกร 123", "เงินสด"],
  forwardCats: ["วัตถุดิบผลิตสุรา"],
  categories: { รายจ่าย: ["ค่าวัสดุสิ้นเปลือง", "วัตถุดิบผลิตสุรา"], รายรับ: ["รายได้ขาย", "วัตถุดิบผลิตสุรา"] },
  today: "2026-10-28",
};

const draft = (p: Partial<BillDraft> = {}): BillDraft => ({
  entity_id: "EID01",
  type: "รายจ่าย",
  transaction_date: "2026-10-27",
  category: "ค่าวัสดุสิ้นเปลือง",
  contact_name: "ร้านทดสอบ",
  account_name: "กสิกร 123",
  price_mode: "in",
  has_vat: true,
  items: [{ name: "ขวดแก้ว", quantity: 16, unit_price: 75 }],
  total_on_bill: 1200,
  tax_invoice_no: "IV001",
  ...p,
});

describe("C1 — ยอดมาจาก entryCalc ตัวเดิม", () => {
  it("16 × 75 รวม VAT = 1,200.00 เป๊ะ (เคส D98) · ฐาน + VAT = ยอดบิล", () => {
    const r = checkBill(draft(), ctx);
    expect(r.errors).toEqual([]);
    expect(r.computed).toMatchObject({ amount_after_discount: 1121.5, vat_amount: 78.5, gross_total: 1200, net_amount: 1200 });
  });

  it("ราคาไม่รวม VAT: 10 × 100 + VAT = 1,070", () => {
    const r = checkBill(draft({ price_mode: "ex", items: [{ name: "x", quantity: 10, unit_price: 100 }], total_on_bill: 1070 }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.computed).toMatchObject({ amount_after_discount: 1000, vat_amount: 70, gross_total: 1070 });
  });

  it("หัก ณ ที่จ่าย 3% คิดบนยอดก่อน VAT · ยอดเทียบบิลคือก่อนหัก (เคส D98: สุทธิ 1,166.36)", () => {
    const r = checkBill(draft({ wht_rate: 3 }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.computed).toMatchObject({ wht_amount: 33.64, net_amount: 1166.36, gross_total: 1200 });
  });

  it("ส่วนลดท้ายบิล", () => {
    const r = checkBill(draft({ price_mode: "ex", items: [{ name: "x", quantity: 2, unit_price: 500 }], bill_discount: 100, total_on_bill: 963 }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.computed).toMatchObject({ amount_after_discount: 900, vat_amount: 63 });
  });

  it("payload: total_price รายบรรทัดรวมกันเท่ายอดก่อน VAT ของบิล · source = claude", () => {
    const r = checkBill(draft({ items: [{ name: "a", quantity: 3, unit_price: 33.33 }, { name: "b", quantity: 7, unit_price: 12.5 }], total_on_bill: 187.49 }), ctx);
    expect(r.errors).toEqual([]);
    const sum = r.payload!.items.reduce((s, it) => s + it.total_price, 0);
    expect(Math.round(sum * 100) / 100).toBe(r.computed!.base_amount);
    expect(r.payload!.p.source).toBe("claude");
    expect(r.payload!.p.net_amount).toBe(r.computed!.net_amount);
  });
});

describe("C1 — 🚨 ยอดไม่ตรงบิล = ไม่ยอมบันทึก", () => {
  it("อ่านจำนวนผิด (15 แทน 16) → error · payload null", () => {
    const r = checkBill(draft({ items: [{ name: "ขวดแก้ว", quantity: 15, unit_price: 75 }] }), ctx);
    expect(r.payload).toBeNull();
    expect(r.errors[0]).toMatch(/ไม่ตรงกับยอดรวมบนบิล 1,200.00/);
    expect(r.errors[0]).toMatch(/ห้ามปรับตัวเลขให้ยอดตรงเอง/);
  });

  it("ขั้น 1: เลือก price_mode ผิด → บอกว่าสลับแล้วตรงพอดี (altPriceMode) · ไม่เสนอใช้ยอดตามบิล", () => {
    const r = checkBill(draft({ price_mode: "ex" }), ctx);
    expect(r.payload).toBeNull();
    expect(r.mismatch).toMatchObject({ altPriceMode: "in", canUseBillAmounts: false });
    expect(r.errors[0]).toMatch(/price_mode = "in"/);
  });

  it("ขั้น 1: เคส D98 ตรงตัว — ราคา 75 รวม VAT แต่อ่านเป็นไม่รวม ได้ altPriceMode", () => {
    const r = checkBill(draft({ price_mode: "ex", total_on_bill: 1200 }), ctx);
    expect(r.mismatch?.altPriceMode).toBe("in");
  });

  it("ต่างไม่เกิน 1 สตางค์ผ่านได้", () => {
    expect(checkBill(draft({ total_on_bill: 1200.01 }), ctx).errors).toEqual([]);
    expect(checkBill(draft({ total_on_bill: 1200.02 }), ctx).errors).not.toEqual([]);
  });

  it("ขั้น 1 อีกทิศ: ราคาไม่รวม VAT แต่ส่ง in → แนะนำ ex", () => {
    const r = checkBill(draft({ price_mode: "in", items: [{ name: "x", quantity: 10, unit_price: 100 }], total_on_bill: 1070 }), ctx);
    expect(r.mismatch?.altPriceMode).toBe("ex");
  });
});

describe("C1 — 🚨 ขั้น 2: ผู้ขายปัดเศษคนละวิธี → ใช้ยอดตามบิล (เพดาน 1 บาท)", () => {
  // 3 รายการ ราคาไม่รวม VAT · ระบบคิด VAT จากยอดรวม = 49.98 · ผู้ขายปัด VAT ทีละบรรทัดได้ 50.01 (บิล 764.01)
  const three = (p: Partial<BillDraft> = {}) => draft({
    price_mode: "ex",
    items: [{ name: "a", quantity: 1, unit_price: 238.1 }, { name: "b", quantity: 1, unit_price: 238.1 }, { name: "c", quantity: 1, unit_price: 237.8 }],
    total_on_bill: 764.01,
    ...p,
  });

  it("ต่าง 0.03 → ไม่บันทึกเอง แต่บอกว่าใช้ยอดตามบิลได้", () => {
    const r = checkBill(three(), ctx);
    expect(r.payload).toBeNull();
    expect(r.mismatch).toMatchObject({ altPriceMode: null, canUseBillAmounts: true, suspectLines: [] });
    expect(r.errors[0]).toMatch(/use_bill_amounts/);
  });

  it("ส่ง use_bill_amounts + ยอดที่อ่านจากบิล → บันทึกด้วยตัวเลขของบิล + ทิ้งร่องรอยในคำอธิบาย", () => {
    const r = checkBill(three({ use_bill_amounts: true, bill_before_vat: 714, bill_vat: 50.01 }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.usedBillAmounts).toBe(true);
    expect(r.payload!.p).toMatchObject({ amount_after_discount: 714, vat_amount: 50.01, net_amount: 764.01 });
    expect(r.payload!.p.description).toMatch(/ยอดตามบิล ต่างจากคำนวณ/);
    expect(r.warnings.join()).toMatch(/ใช้ยอดตามบิล/);
  });

  it("หัก ณ ที่จ่ายคิดบนยอดก่อน VAT ตามบิล", () => {
    const r = checkBill(three({ use_bill_amounts: true, bill_before_vat: 714, bill_vat: 50.01, wht_rate: 3 }), ctx);
    expect(r.payload!.p).toMatchObject({ wht_amount: 21.42, net_amount: 742.59 });
  });

  it("🚨 ก่อน VAT + VAT ไม่เท่ายอดรวม = อ่านผิด", () => {
    expect(checkBill(three({ use_bill_amounts: true, bill_before_vat: 714, bill_vat: 49 }), ctx).errors.join()).toMatch(/ไม่เท่ายอดรวมบนบิล/);
  });

  it("🚨 VAT ไม่ใกล้ 7% ของยอดก่อน VAT = อ่านผิด ไม่ใช่ปัดเศษ", () => {
    const r = checkBill(three({ total_on_bill: 764.01, use_bill_amounts: true, bill_before_vat: 700, bill_vat: 64.01 }), ctx);
    expect(r.errors.join()).toMatch(/ไม่ใช่ 7%/);
    expect(r.payload).toBeNull();
  });

  it("🚨 ต่างเกินเพดานใช้ยอดตามบิลไม่ได้", () => {
    expect(ROUNDING_CAP).toBe(1);
    const r = checkBill(three({ total_on_bill: 766, use_bill_amounts: true, bill_before_vat: 715.89, bill_vat: 50.11 }), ctx);
    expect(r.mismatch?.canUseBillAmounts).toBe(false);
    expect(r.errors.join()).toMatch(/เกินเพดาน/);
  });

  it("ต้องส่งยอดก่อน VAT + VAT มาด้วยเมื่อบิลมี VAT", () => {
    expect(checkBill(three({ use_bill_amounts: true }), ctx).errors.join()).toMatch(/bill_before_vat และ bill_vat/);
  });

  it("ยอดตรงอยู่แล้ว = ไม่สนธง use_bill_amounts (ใช้ยอดของระบบ)", () => {
    const r = checkBill(draft({ use_bill_amounts: true, bill_before_vat: 1, bill_vat: 1 }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.usedBillAmounts).toBe(false);
    expect(r.payload!.p.amount_after_discount).toBe(1121.5);
  });

  it("กิจการไม่จด VAT: ยอดตามบิล = ยอดรวมทั้งก้อน ไม่มี VAT", () => {
    const r = checkBill(draft({ entity_id: "EID02", items: [{ name: "x", quantity: 4, unit_price: 33.33 }], total_on_bill: 133.4, use_bill_amounts: true }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.usedBillAmounts).toBe(true);
    expect(r.payload!.p).toMatchObject({ amount_after_discount: 133.4, vat_amount: 0, net_amount: 133.4 });
  });
});

describe("C1 — ขั้น 3: ต่างมาก → ไฮไลต์แถวที่น่าจะผิด", () => {
  it("อ่านจำนวนขวดแก้วขาดไป 1 → ชี้แถวที่ 1 (ส่วนต่าง = ราคาขวด 1 ใบรวม VAT)", () => {
    const r = checkBill(draft({
      items: [{ name: "ขวดแก้ว", quantity: 15, unit_price: 75 }, { name: "ฝาจุก", quantity: 16, unit_price: 8.5 }],
      total_on_bill: 1336,
    }), ctx);
    expect(r.mismatch).toMatchObject({ canUseBillAmounts: false, altPriceMode: null, suspectLines: [0] });
    expect(r.errors[0]).toContain("รายการที่ 1 (ขวดแก้ว)");
  });

  it("ส่วนต่างไม่ลงตัวกับแถวไหน = ไม่ชี้ (ไม่เดา)", () => {
    const r = checkBill(draft({ total_on_bill: 1263.37 }), ctx);
    expect(r.mismatch?.suspectLines).toEqual([]);
  });
});

describe("C1 — ด่านอื่น", () => {
  it("กิจการไม่มีอยู่ / ประเภทที่ไม่รองรับ", () => {
    expect(checkBill(draft({ entity_id: "EID09" }), ctx).errors.join()).toMatch(/ไม่พบกิจการ EID09/);
    expect(checkBill(draft({ type: "สำรองจ่าย" as never }), ctx).errors.join()).toMatch(/ทำในแอป/);
  });

  it("จ่ายสดต้องมีบัญชี · บัญชีต้องมีอยู่จริงในกิจการ · ตั้งค้างไม่ต้องมีบัญชี", () => {
    expect(checkBill(draft({ account_name: "" }), ctx).errors.join()).toMatch(/ต้องระบุบัญชีเงิน/);
    expect(checkBill(draft({ account_name: "บัญชีมั่ว" }), ctx).errors.join()).toMatch(/ไม่พบบัญชีเงิน/);
    const ap = checkBill(draft({ account_name: "", unpaid: true, due_date: "2026-11-30" }), ctx);
    expect(ap.errors).toEqual([]);
    expect(ap.payload!.p).toMatchObject({ ap_ar_status: "AP", account_name: "", due_date: "2026-11-30" });
  });

  it("รายรับตั้งค้าง = AR", () => {
    const r = checkBill(draft({ type: "รายรับ", category: "รายได้ขาย", account_name: "", unpaid: true }), ctx);
    expect(r.payload!.p.ap_ar_status).toBe("AR");
  });

  it("วันที่ต้องเป็น ค.ศ. · ปี พ.ศ. ที่หลุดมาจะเป็นวันในอนาคต → เตือน", () => {
    expect(checkBill(draft({ transaction_date: "27/10/2569" }), ctx).errors.join()).toMatch(/YYYY-MM-DD/);
    expect(checkBill(draft({ transaction_date: "2026-02-30" }), ctx).errors.join()).toMatch(/YYYY-MM-DD/);
    expect(checkBill(draft({ transaction_date: "2569-10-27" }), ctx).warnings.join()).toMatch(/พ.ศ. → ค.ศ./);
  });

  it("ไม่มีหมวด / ไม่มีรายการ / จำนวน 0", () => {
    expect(checkBill(draft({ category: " " }), ctx).errors.join()).toMatch(/หมวดหมู่/);
    expect(checkBill(draft({ category: "ค่าวัสดุ" }), ctx).errors.join()).toMatch(/ไม่มีหมวด "ค่าวัสดุ"/);
    expect(checkBill(draft({ items: [] }), ctx).errors.join()).toMatch(/อย่างน้อย 1/);
    expect(checkBill(draft({ items: [{ name: "x", quantity: 0, unit_price: 1 }] }), ctx).errors.join()).toMatch(/มากกว่า 0/);
  });

  it("มี VAT ไม่มีเลขใบกำกับ → คำเตือนตัวเดียวกับฟอร์ม (D124) ไม่บล็อก", () => {
    const r = checkBill(draft({ tax_invoice_no: "" }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/ยังไม่กรอกเลขใบกำกับ/);
  });

  it("มีเลขใบกำกับแต่ไม่ส่งวันที่ใบกำกับ → ใช้วันที่รายการ (D114)", () => {
    expect(checkBill(draft(), ctx).payload!.p.tax_invoice_date).toBe("2026-10-27");
    expect(checkBill(draft({ tax_invoice_no: "" }), ctx).payload!.p.tax_invoice_date).toBe("");
  });

  it("🚨 กิจการไม่จด VAT: รายรับมี VAT = error · รายจ่าย = ไม่คิด VAT ยอดเท่าที่จ่ายจริง + เตือน", () => {
    expect(checkBill(draft({ entity_id: "EID02", type: "รายรับ" }), ctx).errors.join()).toMatch(/ไม่ได้จด VAT/);
    const r = checkBill(draft({ entity_id: "EID02" }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.computed).toMatchObject({ vat_amount: 0, gross_total: 1200 });
    expect(r.warnings.join()).toMatch(/ไม่ได้จด VAT/);
  });

  it("หมวดจุดชนวนรับวัตถุดิบ → forward_material + เตือน", () => {
    const r = checkBill(draft({ category: "วัตถุดิบผลิตสุรา" }), ctx);
    expect(r.payload!.p.forward_material).toBe(true);
    expect(r.warnings.join()).toMatch(/สต็อกผลิต/);
    expect(checkBill(draft({ category: "วัตถุดิบผลิตสุรา", type: "รายรับ", account_name: "" }), ctx).payload!.p.forward_material).toBe(false);
  });
});

describe("C1 — เลขประจำตัวผู้เสียภาษี", () => {
  it("checksum ถูก/ผิด · รับขีดและช่องว่าง", () => {
    expect(taxIdValid("0107536000102")).toBe(true);
    expect(taxIdValid("0-1075-36000-10-2")).toBe(true);
    expect(taxIdValid("0107536000103")).toBe(false); // หลักสุดท้ายผิด
    expect(taxIdValid("0107536000012")).toBe(false); // สลับหลัก
    expect(taxIdValid("010753600010")).toBe(false); // 12 หลัก
    expect(normalizeTaxId("0-1075-36000-10-2")).toBe("0107536000102");
  });
});

describe("C1 — สรุปให้ Claude พูดก่อนขออนุญาต", () => {
  it("มีชื่อลูกค้า (tenant) + กิจการ + ยอด", () => {
    const r = checkBill(draft({ wht_rate: 3 }), ctx);
    const s = previewSummary(draft({ wht_rate: 3 }), "โรงกลั่นทดสอบ", "อินเสพ", r.computed!);
    expect(s).toMatch(/ลงให้ อินเสพ · กิจการ EID01/);
    expect(s).toMatch(/รวม 1,200.00/);
    expect(s).toMatch(/สุทธิ 1,166.36/);
  });
});

describe("C1 — 🚨 ไม่มีสูตรเงินในไฟล์ connector (อ่านซอร์ส)", () => {
  const src = readFileSync(path.join(__dirname, "bill.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // ★ ตรวจตัวคิดยอดทั้งหมด (toBillItems · checkBill · ขั้น 2/3)
  const money = src.slice(src.indexOf("function toBillItems"), src.indexOf("export function previewSummary"));
  it("ตัวคิดยอดไม่คูณ/หาร 1.07 หรือ 0.07 เอง", () => {
    expect(money.length).toBeGreaterThan(500); // กันเทสผ่านเพราะตัดซอร์สผิดจนว่าง
    expect(money).not.toMatch(/1\.07|0\.07|\* *7 *\/ *100|\/ *107/);
  });
  it("ยอดมาจาก entryCalc", () => {
    expect(src).toMatch(/entryCalc\(/);
  });
});
