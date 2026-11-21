/**
 * D179 — ยอดที่ใช้คิดหัก ณ ที่จ่าย ต่อบิล (transactions.wht_base) + บั๊กเคอร์เซอร์หลุดในช่องแก้ยอดเอง
 *
 * เคสจริงของผู้ใช้: บิลค่าทำของ 10,000 + ค่าขนส่ง 500 ผู้ขายให้หัก 3% เฉพาะค่าทำของ
 *   ⇒ ภาษี 300 · ใบ 50ทวิ / ภงด.3/53 ต้องพิมพ์ "จำนวนเงินที่จ่าย" 10,000 ไม่ใช่ 10,500
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  entryCalc,
  whtBaseOf,
  whtBaseForSave,
  whtBaseWarnings,
  whtReport,
  dashboardData,
  type Tx,
} from "./calc";
import { checkBill, previewSummary, whtBaseNote, type BillDraft, type BillContext } from "../connector/bill";

const ROOT = path.resolve(__dirname, "../..");
const src = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const items = [
  { quantity: 1, exVat: 10000, discBaht: 0 }, // ค่าทำของ
  { quantity: 1, exVat: 500, discBaht: 0 }, // ค่าขนส่ง
];

describe("A22 — entryCalc คิดหักจากยอดที่ระบุ", () => {
  it("ไม่ส่ง whtBase = พฤติกรรมเดิมเป๊ะ (หักจากยอดหลังหักส่วนลดทั้งบิล)", () => {
    const r = entryCalc({ items, discount: 0, hasVat: true, hasWht: true, whtRate: 3 });
    expect(r).toEqual({ baseAmount: 10500, amountAfterDiscount: 10500, vatAmount: 735, whtRate: 3, whtAmount: 315, netAmount: 10920 });
    // null ก็ต้องเหมือนไม่ส่ง
    expect(entryCalc({ items, discount: 0, hasVat: true, hasWht: true, whtRate: 3, whtBase: null })).toEqual(r);
  });

  it("whtBase 10,000 ⇒ หัก 300 · ยอดก่อน VAT / VAT ไม่ขยับ · สุทธิ = 10,500 + 735 − 300", () => {
    const r = entryCalc({ items, discount: 0, hasVat: true, hasWht: true, whtRate: 3, whtBase: 10000 });
    expect(r).toEqual({ baseAmount: 10500, amountAfterDiscount: 10500, vatAmount: 735, whtRate: 3, whtAmount: 300, netAmount: 10935 });
  });

  it("ไม่ติ๊กหัก ณ ที่จ่าย ⇒ whtBase ไม่มีผล", () => {
    expect(entryCalc({ items, discount: 0, hasVat: true, hasWht: false, whtRate: 3, whtBase: 10000 }).whtAmount).toBe(0);
  });
});

describe("A22 — whtBaseOf (ตัวเดียวที่ 50ทวิ / ภงด. / คิวรอออก อ่าน)", () => {
  it("ว่าง = ยอดหลังหักส่วนลด (บิลเก่าทั้งหมด)", () => {
    expect(whtBaseOf({ amount_after_discount: 10500, wht_base: null })).toBe(10500);
    expect(whtBaseOf({ amount_after_discount: 10500 })).toBe(10500);
    expect(whtBaseOf({ amount_after_discount: "10500.00", wht_base: "" })).toBe(10500);
  });
  it("มีค่า = ใช้ค่านั้น (DB ส่ง numeric มาเป็น string ได้)", () => {
    expect(whtBaseOf({ amount_after_discount: 10500, wht_base: 10000 })).toBe(10000);
    expect(whtBaseOf({ amount_after_discount: 10500, wht_base: "10000.00" })).toBe(10000);
  });
});

describe("A22 — whtBaseForSave (ค่าที่ลงคอลัมน์)", () => {
  it("ไม่หัก / ไม่ได้กรอก / กรอกเท่ายอดบิล ⇒ null (ให้ฐานตามยอดบิลไปเอง)", () => {
    expect(whtBaseForSave(false, 10000, 10500)).toBeNull();
    expect(whtBaseForSave(true, null, 10500)).toBeNull();
    expect(whtBaseForSave(true, undefined, 10500)).toBeNull();
    expect(whtBaseForSave(true, 10500, 10500)).toBeNull();
    expect(whtBaseForSave(true, 10500.004, 10500)).toBeNull();
  });
  it("ต่างจากยอดบิล ⇒ เก็บค่า (ปัด 2 ตำแหน่ง)", () => {
    expect(whtBaseForSave(true, 10000, 10500)).toBe(10000);
    expect(whtBaseForSave(true, 9999.999, 10500)).toBe(10000);
  });
});

describe("A22 — whtBaseWarnings (ไม่บล็อก แต่ต้องบอกบนจอ)", () => {
  const ok = { hasWht: true, whtBase: 10000, afterDiscount: 10500, whtRate: 3, whtAmount: 300 };
  it("ปกติ ⇒ ไม่มีคำเตือน · ไม่หัก ⇒ ไม่มีคำเตือน", () => {
    expect(whtBaseWarnings(ok)).toEqual([]);
    expect(whtBaseWarnings({ ...ok, hasWht: false, whtBase: 99999 })).toEqual([]);
  });
  it("ฐานมากกว่ายอดบิล", () => {
    expect(whtBaseWarnings({ ...ok, whtBase: 11000, whtAmount: 330 }).join()).toMatch(/มากกว่ายอดหลังหักส่วนลด/);
  });
  it("ฐาน 0", () => {
    expect(whtBaseWarnings({ ...ok, whtBase: 0, whtAmount: 0 }).join()).toMatch(/เป็น 0/);
  });
  it("🚨 แก้ภาษีหักเองแต่ไม่แก้ฐาน (สิ่งที่ผู้ใช้เคยทำ) ⇒ บอกว่าใบ 50ทวิ จะพิมพ์ยอดไหน", () => {
    const w = whtBaseWarnings({ hasWht: true, whtBase: 10500, afterDiscount: 10500, whtRate: 3, whtAmount: 300 });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("10,500.00 × 3% = 315.00");
    expect(w[0]).toContain("ใบ 50ทวิ จะพิมพ์ยอดจ่าย 10,500.00");
  });
});

describe("A22 — ภงด.3/53 + คิวรอออก 50ทวิ ใช้ยอดที่ใช้คิดหัก", () => {
  const base: Tx = {
    tx_id: "W1", transaction_date: "2026-11-10", type: "รายจ่าย", account_name: "บัญชีบริษัท", category: "ค่าทำของ",
    contact_name: "นายช่าง", amount_after_discount: 10500, vat_amount: 735, wht_rate: 3, wht_amount: 300,
    net_amount: 10935, tax_invoice_no: "T-1", tax_invoice_date: "2026-11-10", status: "ปกติ", entity_id: "EID99",
    ap_ar_status: null, wht_base: 10000,
  };
  it("ภงด.3 ยอดเงินได้ = 10,000 (ไม่ใช่ 10,500)", () => {
    const r = whtReport("2026-11", "EID99", [base], {});
    expect(r.pnd3[0].amountPaid).toBe(10000);
    expect(r.pnd3TotalPaid).toBe(10000);
    expect(r.pnd3TotalWht).toBe(300);
  });
  it("คิวรอออก 50ทวิ: amount = 10,000 · แดชบอร์ดรายจ่ายยังเป็นยอดบิลเต็ม 10,500", () => {
    const d = dashboardData("2026-11", "EID99", [base], new Set());
    expect(d.whtPending[0].amount).toBe(10000);
    expect(d.dash.expense).toBe(10500);
  });
  it("บิลเก่า (ไม่มี wht_base) ได้ผลเท่าเดิม", () => {
    const old = { ...base, wht_base: null, wht_amount: 315, net_amount: 10920 };
    expect(whtReport("2026-11", "EID99", [old], {}).pnd3[0].amountPaid).toBe(10500);
    expect(dashboardData("2026-11", "EID99", [old], new Set()).whtPending[0].amount).toBe(10500);
  });
});

describe("D179 — connector preview_bill รับ wht_base", () => {
  const ctx: BillContext = {
    entities: [{ entity_id: "EID01", name: "โรงกลั่นทดสอบ", is_vat: true }],
    accounts: ["กสิกร 123"],
    forwardCats: [],
    categories: { รายจ่าย: ["ค่าทำของ"], รายรับ: ["รายได้ขาย"] },
    today: "2026-11-21",
  };
  const draft = (p: Partial<BillDraft> = {}): BillDraft => ({
    entity_id: "EID01", type: "รายจ่าย", transaction_date: "2026-11-20", category: "ค่าทำของ",
    contact_name: "นายช่าง", account_name: "กสิกร 123", price_mode: "ex", has_vat: true,
    items: [{ name: "ค่าทำของ", quantity: 1, unit_price: 10000 }, { name: "ค่าขนส่ง", quantity: 1, unit_price: 500 }],
    total_on_bill: 11235, wht_rate: 3, ...p,
  });

  it("หักเฉพาะค่าทำของ ⇒ หัก 300 · payload.wht_base = 10,000 · สรุปในแชทบอกว่าไม่ใช่ทั้งบิล", () => {
    const r = checkBill(draft({ wht_base: 10000 }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.computed).toMatchObject({ amount_after_discount: 10500, wht_amount: 300, wht_base: 10000, net_amount: 10935 });
    expect(r.payload!.p.wht_base).toBe(10000);
    expect(previewSummary(draft({ wht_base: 10000 }), "โรงกลั่นทดสอบ", "อินเสพ", r.computed!)).toContain("คิดจากยอด 10,000.00 ไม่ใช่ทั้งบิล");
  });
  it("ไม่ส่ง wht_base ⇒ เหมือนเดิม (หัก 315) · payload.wht_base = null · ไม่พูดเรื่องฐาน", () => {
    const r = checkBill(draft(), ctx);
    expect(r.computed).toMatchObject({ wht_amount: 315, wht_base: 10500 });
    expect(r.payload!.p.wht_base).toBeNull();
    expect(whtBaseNote(r.computed!)).toBe("");
  });
  it("ด่าน: ไม่มีอัตรา · ฐาน ≤ 0 · ฐานเกินยอดก่อน VAT", () => {
    expect(checkBill(draft({ wht_rate: 0, wht_base: 10000 }), ctx).errors.join()).toMatch(/เฉพาะบิลที่มี wht_rate/);
    expect(checkBill(draft({ wht_base: 0 }), ctx).errors.join()).toMatch(/ต้องมากกว่า 0/);
    expect(checkBill(draft({ wht_base: 20000 }), ctx).errors.join()).toMatch(/มากกว่ายอดก่อน VAT/);
  });
  it("ใช้ยอดตามบิล (ปัดเศษ) ก็ยังหักจาก wht_base", () => {
    const r = checkBill(draft({ total_on_bill: 11235.01, use_bill_amounts: true, bill_before_vat: 10500, bill_vat: 735.01, wht_base: 10000 }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.computed).toMatchObject({ wht_amount: 300, wht_base: 10000 });
  });
});

describe("🔒 ล็อกซอร์ส D179", () => {
  it("🪤 ช่องแก้ยอดเองต้องประกาศ top-level (ประกาศใน component = เคอร์เซอร์หลุดทุกตัวอักษร · D71)", () => {
    for (const f of ["app/(app)/accounting/_components/EntryTab.tsx", "app/(app)/accounting/_components/BillsTab.tsx", "app/(app)/accounting/_components/WhtBaseField.tsx"]) {
      const s = src(f);
      expect(s, f).not.toMatch(/^[ \t]+function (Row|RowEdit|ERow|ERowEdit|WhtBaseField)\s*\(/m);
    }
    expect(src("app/(app)/accounting/_components/EntryTab.tsx")).toMatch(/^function RowEdit\(/m);
  });

  it("migration 0112: แก้บิลแล้ว payload ไม่มี key = คงค่าเดิม · ไม่หักแล้ว = ล้าง", () => {
    const m = src("supabase/migrations/20261121000112_wht_base.sql");
    expect(m).toContain("alter table transactions add column if not exists wht_base numeric(14,2)");
    expect(m).toMatch(/wht_base\s+= case when coalesce\(\(p->>'wht_amount'\)::numeric,0\) <= 0 then null\s+when p \? 'wht_base' then nullif\(p->>'wht_base',''\)::numeric\s+else wht_base end/);
    // save + clear_advances พาคอลัมน์ไปด้วย
    expect(m).toContain("case when coalesce((p->>'wht_amount')::numeric,0) > 0 then nullif(p->>'wht_base','')::numeric end");
    expect(m).toContain("r.wht_amount, r.wht_base, r.net_amount");
  });

  it("หน้าแก้บิลส่ง wht_base เสมอ (ไม่ส่ง = RPC คงค่าเดิม ล้างฐานไม่ได้) · ฟอร์มบันทึกก็ส่ง", () => {
    expect(src("app/(app)/accounting/_components/BillsTab.tsx")).toContain("wht_base: amt.whtBaseSave");
    expect(src("app/(app)/accounting/_components/EntryTab.tsx")).toContain("wht_base: whtBaseSave");
  });

  it("แบ่งงวด: การ์ดสรุปยอดไม่ใช้ฐานที่กรอก (เทสเบราว์เซอร์เจอ: การ์ดโชว์ 300 แต่งวดรวมกัน 315)", () => {
    expect(src("app/(app)/accounting/_components/EntryTab.tsx")).toContain("ignoreWhtBase: isInst && !isAdvance");
    expect(src("app/(app)/accounting/_components/billItems.ts")).toMatch(/const calcBase = ignoreWhtBase \? null : customBase;[\s\S]*whtBase: calcBase/);
  });

  it("TX_COLS ของรายงานอ่าน wht_base (ไม่อ่าน = whtBaseOf ตกกลับยอดเต็มเงียบ ๆ)", () => {
    expect(src("lib/accounting/reportLoaders.ts")).toMatch(/wht_amount, wht_base, net_amount/);
  });

  it("ภงด. + คิว 50ทวิ อ่านผ่าน whtBaseOf ไม่ใช่ amount_after_discount ตรง ๆ", () => {
    const c = src("lib/accounting/calc.ts");
    expect(c).toContain("amountPaid: whtBaseOf(tx)");
    expect(c).toContain("amount: whtBaseOf(tx)");
    expect(c).not.toContain("amountPaid: num(tx.amount_after_discount)");
  });
});
