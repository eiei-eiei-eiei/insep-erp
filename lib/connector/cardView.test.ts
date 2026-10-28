/**
 * golden C5 — การ์ดตรวจบิล: ปุ่มหลัก + หมวดที่เสนอ (D141)
 * ★ ใช้ checkBill ตัวจริงประกอบ mismatch — ไม่ปั้น mismatch เอง (กันเทสผ่านด้วยข้อมูลที่ระบบไม่มีวันส่ง)
 */
import { describe, it, expect } from "vitest";
import { checkBill, type BillDraft, type BillContext } from "./bill";
import { primaryAction, categoryChips, suspectSet, savedContextText, type CardData } from "./cardView";

const ctx: BillContext = {
  entities: [
    { entity_id: "EID01", name: "บริษัท", is_vat: true },
    { entity_id: "EID02", name: "ร้านไม่จด VAT", is_vat: false },
  ],
  accounts: ["กสิกร 123"],
  forwardCats: [],
  categories: { รายจ่าย: ["ค่าวัสดุ", "ค่าซ่อม", "ค่าขนส่ง", "ค่าน้ำมัน"], รายรับ: ["รายได้ขาย"] },
  today: "2026-10-28",
};

const draft = (p: Partial<BillDraft> = {}): BillDraft => ({
  entity_id: "EID01", type: "รายจ่าย", transaction_date: "2026-10-27", category: "ค่าวัสดุ",
  account_name: "กสิกร 123", price_mode: "in", has_vat: true, tax_invoice_no: "IV1",
  items: [{ name: "ขวดแก้ว", quantity: 16, unit_price: 75 }], total_on_bill: 1200, ...p,
});

/** ประกอบ CardData แบบเดียวกับ server */
function card(d: BillDraft & { confirm_not_duplicate?: boolean }, dup = false): CardData {
  const r = checkBill(d, ctx);
  const mmText = r.mismatch && !r.usedBillAmounts ? r.errors.find((e) => e.startsWith("ยอดที่คิดได้")) : undefined;
  const ent = ctx.entities.find((e) => e.entity_id === d.entity_id);
  return {
    v: 1, tenant_slug: "t", tenant_name: "T", draft: d, entities: ctx.entities, category_chips: [], categories_all: [], accounts: ctx.accounts, jobs: [], jobs_required: false, contact: { kind: "none" },
    vat_effective: Boolean(d.has_vat && ent?.is_vat),
    computed: r.computed, mismatch: r.mismatch, used_bill_amounts: r.usedBillAmounts,
    errors: r.errors.filter((e) => e !== mmText), warnings: r.warnings,
    possible_duplicates: dup ? [{ tx_id: "TR-1", transaction_date: "2026-10-27", net_amount: 1200, tax_invoice_no: "IV1" }] : [],
  };
}

describe("C5 — ปุ่มหลักของการ์ด", () => {
  it("ยอดตรง ไม่ซ้ำ = บันทึก", () => {
    expect(primaryAction(card(draft()))).toMatchObject({ kind: "save", hint: "" });
  });

  it("ขั้น 1: โหมดราคาผิด = ปุ่มสลับโหมด (ไม่ใช่ยอดตามบิล)", () => {
    const a = primaryAction(card(draft({ price_mode: "ex" })));
    expect(a.kind).toBe("switch_mode");
    expect(a.label).toMatch(/รวม VAT/);
  });

  const three = (p: Partial<BillDraft> = {}) => draft({
    price_mode: "ex",
    items: [{ name: "a", quantity: 1, unit_price: 238.1 }, { name: "b", quantity: 1, unit_price: 238.1 }, { name: "c", quantity: 1, unit_price: 237.8 }],
    total_on_bill: 764.01, ...p,
  });

  it("ขั้น 2: ต่างนิดเดียว + มียอดก่อน VAT/VAT จากบิล = ใช้ยอดตามบิล", () => {
    expect(primaryAction(card(three({ bill_before_vat: 714, bill_vat: 50.01 }))).kind).toBe("use_bill_amounts");
  });

  it("ขั้น 2: ยังไม่มียอดก่อน VAT/VAT = ให้ Claude อ่านเพิ่ม (การ์ดไม่เดาตัวเลข)", () => {
    const a = primaryAction(card(three()));
    expect(a.kind).toBe("ask_claude");
    expect(a.message).toMatch(/bill_before_vat/);
  });

  it("ขั้น 2: กดใช้ยอดตามบิลแล้ว = บันทึกได้", () => {
    expect(primaryAction(card(three({ bill_before_vat: 714, bill_vat: 50.01, use_bill_amounts: true }))).kind).toBe("save");
  });

  it("ขั้น 3: ต่างมาก = ให้ Claude อ่านใหม่ + ไฮไลต์แถว", () => {
    const c = card(draft({ items: [{ name: "ขวด", quantity: 15, unit_price: 75 }, { name: "ฝา", quantity: 16, unit_price: 8.5 }], total_on_bill: 1336 }));
    const a = primaryAction(c);
    expect(a.kind).toBe("ask_claude");
    expect(a.hint).toMatch(/ไฮไลต์ \(1 แถว\)/);
    expect([...suspectSet(c)]).toEqual([0]);
  });

  it("ยังเลือกไม่ครบมาก่อนเรื่องยอด", () => {
    const a = primaryAction(card(draft({ account_name: "", price_mode: "ex" })));
    expect(a.kind).toBe("fix");
    expect(a.hint).toMatch(/บัญชีเงิน/);
  });

  it("บิลซ้ำ = ต้องกดยืนยันก่อน · ยืนยันแล้ว = บันทึก", () => {
    expect(primaryAction(card(draft(), true))).toMatchObject({ kind: "confirm_dup" });
    expect(primaryAction(card({ ...draft(), confirm_not_duplicate: true }, true)).kind).toBe("save");
  });

  it("ทุกปุ่มที่ไม่ใช่บันทึกต้องบอกเหตุผล (D83)", () => {
    for (const d of [draft({ price_mode: "ex" }), three(), draft({ account_name: "" })]) {
      const a = primaryAction(card(d));
      expect(a.kind).not.toBe("save");
      expect(a.hint.length).toBeGreaterThan(10);
    }
  });
});

describe("C5 — หมวดที่เสนอเป็นปุ่ม", () => {
  const all = ["ค่าวัสดุ", "ค่าซ่อม", "ค่าขนส่ง", "ค่าน้ำมัน"];
  it("ตัวที่เลือกอยู่ก่อน · ตามด้วยประวัติ · ไม่ซ้ำ · สูงสุด 3", () => {
    expect(categoryChips("ค่าซ่อม", ["ค่าวัสดุ", "ค่าซ่อม", "ค่าขนส่ง", "ค่าน้ำมัน"], all)).toEqual(["ค่าซ่อม", "ค่าวัสดุ", "ค่าขนส่ง"]);
  });
  it("🚨 หมวดนอกผังบัญชีไม่ขึ้น (กดไปก็บันทึกไม่ได้)", () => {
    expect(categoryChips("หมวดมั่ว", ["ค่าวัสดุ", "หมวดเก่าที่ลบแล้ว"], all)).toEqual(["ค่าวัสดุ"]);
  });
});

it("C5 — ข้อความบอก Claude หลังบันทึกจากการ์ด มีเลขบิลและห้ามเรียกซ้ำ", () => {
  expect(savedContextText("TR-9")).toMatch(/TR-9.*ไม่ต้องเรียก save_bill ซ้ำ/);
});
