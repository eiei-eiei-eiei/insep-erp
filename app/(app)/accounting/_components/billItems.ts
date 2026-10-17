"use client";

/**
 * ตรรกะ "รายการสินค้าในบิล" ที่ใช้ร่วมกันระหว่างฟอร์มบันทึกบิล (EntryTab)
 * และฟอร์มแก้บิลย้อนหลัง (EditBillModal ใน BillsTab)
 *
 * เดิมก๊อปกันคนละชุด (~150 บรรทัด) → แก้สูตร VAT-สลับช่อง/ส่วนลด ครั้งหน้าต้องแก้ 2 ที่
 * เสี่ยง "เลขตอนสร้าง ≠ เลขตอนแก้" · สูตรจริงยังอยู่ที่ lib/accounting/calc เหมือนเดิม
 * ไฟล์นี้แค่รวม state handler ไม่ได้คำนวณเงินเอง
 *
 * D98 — เพิ่ม "โหมดกรอกราคา" (A21) · D113 — เหลือช่องราคาช่องเดียว เลือกโหมดที่ปุ่มอย่างเดียว
 * 🚨 โหมดเป็นของ **บิล** ไม่ใช่ของแถว — ใบของผู้ขายตั้งราคาแบบเดียวทั้งใบ
 *    ถ้าให้แต่ละแถวมีโหมดของตัวเอง ยอดรวมบิลจะเป็นผลบวกของเลขคนละหน่วย
 */

import { useMemo, useState } from "react";
import {
  entryCalc,
  itemTotal,
  itemDiscBahtFromPct,
  inVatFromExVat,
  effectiveVatMode,
  priceFromInput,
  reinterpretPrice,
  unitPriceOf,
  allocateExTotals,
  round2,
  type VatMode,
} from "@/lib/accounting/calc";
import type { TxItemInput } from "../actions";

export type Qty = number | "";
export type BillItem = {
  itemName: string;
  itemCategory: string;
  itemJob: string;
  quantity: Qty;
  exVat: number;
  inVat: number;
  discPct: number;
  discBaht: number;
};

export const qn = (q: Qty): number => (q === "" ? 0 : q); // ช่องว่าง = 0 ตอนคำนวณ
export const emptyItem = (cat = "", job = ""): BillItem => ({
  itemName: "", itemCategory: cat, itemJob: job, quantity: 1, exVat: 0, inVat: 0, discPct: 0, discBaht: 0,
});

/** แถวที่นับเป็น "มีของ" — ในโหมด in ผู้ใช้อาจกรอกเฉพาะช่องรวม VAT */
export function hasContent(it: BillItem, mode: VatMode = "ex"): boolean {
  return Boolean(it.itemName || it.exVat || (mode === "in" && it.inVat));
}

/** แถวรายการ → payload ที่ RPC รับ (ช่องว่าง = 1 ตอนบันทึก ตามเดิม) */
export function buildItemInputs(items: BillItem[], mode: VatMode = "ex", baseAmount = 0): TxItemInput[] {
  const kept = items.filter((it) => hasContent(it, mode));
  const qtyOf = (it: BillItem) => (it.quantity === "" ? 1 : it.quantity);
  /**
   * total_price = ยอดบรรทัด **ก่อน VAT** (คอลัมน์นี้โผล่ในการ์ด "ดู" และแท็บประวัติราคา)
   * · โหมด ex: qty×ราคาไม่รวม VAT − ส่วนลด (เหมือนเดิมทุกตัวอักษร)
   * · โหมด in: ยอดบรรทัดที่กรอกเป็นยอด *รวม VAT* → ต้องถอดแล้วเกลี่ยให้ผลรวมเท่า
   *   baseAmount ของบิลเป๊ะ ไม่งั้นบวกคอลัมน์แล้วไม่ตรงกับยอดก่อน VAT ของบิลเดียวกัน
   */
  const totals = mode === "in"
    ? allocateExTotals(kept.map((it) => itemTotal(qtyOf(it), it.inVat, it.discBaht)), baseAmount)
    : kept.map((it) => itemTotal(qtyOf(it), it.exVat, it.discBaht));
  return kept.map((it, i) => ({
    item_name: it.itemName,
    quantity: qtyOf(it),
    in_vat: it.inVat || inVatFromExVat(it.exVat),
    ex_vat: it.exVat,
    total_price: totals[i] ?? 0,
    discount_pct: it.discPct,
    discount_baht: it.discBaht,
    item_category: it.itemCategory,
    item_job: it.itemJob,
  }));
}

/**
 * handler แก้แถวรายการ (ราคาช่องเดียว · ส่วนลด %↔บาท) — เหมือนกันทั้ง 2 ฟอร์ม
 *
 * D113 — เหลือช่องราคาช่องเดียว:
 * · `mode`      = โหมดที่ **มีผลจริง** (effVatMode) ใช้คิดส่วนลดบาท — เหมือนเดิม
 * · `inputMode` = โหมดที่ **ผู้ใช้เลือกที่ปุ่ม** บอกว่าตัวเลขในช่องคืออะไร
 *   🪤 ใช้ตัวนี้ ไม่ใช่ effVatMode — เลือก "รวม VAT" แต่ยังไม่ติ๊ก VAT แล้วช่องต้องยังโชว์
 *      เลขที่พิมพ์ไว้ ไม่ใช่สลับไปโชว์ค่าที่ถอดแล้ว (ตัวเลขบนจอเปลี่ยนเองโดยไม่ได้แตะ)
 */
export function makeItemHandlers(
  items: BillItem[],
  setItems: React.Dispatch<React.SetStateAction<BillItem[]>>,
  mode: VatMode = "ex",
  setMode?: (m: VatMode) => void,
  inputMode: VatMode = mode,
) {
  const setItem = (i: number, patch: Partial<BillItem>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  /** ส่วนลดบาทของแถว คิดจากฐานตามโหมด (โหมด in = บาทรวม VAT) */
  const discOf = (it: Pick<BillItem, "exVat" | "inVat">, qty: number, pct: number) =>
    itemDiscBahtFromPct(qty, unitPriceOf(mode, it.exVat, it.inVat), pct);
  return {
    setItem,
    /** ตัวเลขในช่องราคา (ตามโหมดที่ผู้ใช้เลือก) */
    priceOf: (it: BillItem) => unitPriceOf(inputMode, it.exVat, it.inVat),
    /** พิมพ์ช่องราคา — เติมอีกคอลัมน์ด้วยสูตรเดิม (priceFromInput) · ไม่สลับโหมดเอง */
    onPrice: (i: number, v: number) => {
      const it = items[i];
      const p = priceFromInput(inputMode, v);
      setItem(i, { ...p, discBaht: discOf(p, qn(it.quantity), it.discPct) });
    },
    onQty: (i: number, q: Qty) => setItem(i, { quantity: q, discBaht: discOf(items[i], qn(q), items[i].discPct) }),
    onDiscPct: (i: number, v: number) => setItem(i, { discPct: v, discBaht: discOf(items[i], qn(items[i].quantity), v) }),
    onDiscBaht: (i: number, v: number) => {
      const it = items[i];
      const gross = qn(it.quantity) * unitPriceOf(mode, it.exVat, it.inVat);
      setItem(i, { discBaht: v, discPct: gross > 0 ? round2((v / gross) * 100) : 0 });
    },
    removeItem: (i: number) => setItems((p) => p.filter((_, idx) => idx !== i)),
    /**
     * สลับโหมดจากปุ่มบนหัวการ์ด
     * D113: ตัวเลขในช่องคงเดิม เปลี่ยนแค่ความหมาย (reinterpretPrice) แล้วเติมอีกคอลัมน์ใหม่
     * แล้วต้องคิดส่วนลดบาทของทุกแถวใหม่ด้วย
     * 🪤 ไม่คิดใหม่ = ส่วนลด % บนจอกับยอดส่วนลดบาทที่ใช้จริงจะไม่ตรงกันเงียบ ๆ
     */
    changeVatMode: (m: VatMode) => {
      if (m === inputMode) return;
      setMode?.(m);
      setItems((prev) => prev.map((it) => {
        const p = reinterpretPrice(inputMode, m, it.exVat, it.inVat);
        const next = { ...it, ...p };
        return it.discPct > 0
          ? { ...next, discBaht: itemDiscBahtFromPct(qn(it.quantity), unitPriceOf(m, p.exVat, p.inVat), it.discPct) }
          : next;
      }));
    },
  };
}

/**
 * ยอดของบิล: โหมดปกติ = คำนวณจาก entryCalc · โหมดแก้เอง = ค่าที่ผู้ใช้กรอก
 * (บิลเจ้าอื่นบางใบปัดทศนิยมไม่ตรงสูตร ต้องคงเลขเดิมไว้ให้ตรงใบจริง)
 */
export function useBillAmounts(input: {
  items: BillItem[];
  discount: number;
  hasVat: boolean;
  hasWht: boolean;
  whtRate: number;
}) {
  const { items, discount, hasVat, hasWht, whtRate } = input;
  const [manualAmt, setManualAmt] = useState(false);
  const [ovAfterDisc, setOvAfterDisc] = useState(0);
  const [ovVat, setOvVat] = useState(0);
  const [ovWht, setOvWht] = useState(0);
  /** โหมดที่ผู้ใช้เลือก (ค่าปริยาย ex = พฤติกรรมเดิม) */
  const [vatMode, setVatMode] = useState<VatMode>("ex");
  /** 🚨 โหมดที่มีผลจริง — ไม่ติ๊ก VAT = ไม่มีอะไรให้ถอด ตกกลับ ex เสมอ */
  const effVatMode = effectiveVatMode(vatMode, hasVat);

  const calc = useMemo(
    () => entryCalc({ items: items.map((it) => ({ quantity: qn(it.quantity), exVat: it.exVat, inVat: it.inVat, discBaht: it.discBaht })), discount, hasVat, hasWht, whtRate, vatMode }),
    [items, discount, hasVat, hasWht, whtRate, vatMode],
  );

  const effAfterDisc = manualAmt ? ovAfterDisc : calc.amountAfterDiscount;
  const effVat = manualAmt ? ovVat : calc.vatAmount;
  const effWht = manualAmt ? ovWht : calc.whtAmount;
  const effNet = round2(effAfterDisc + effVat - effWht);

  return {
    calc,
    manualAmt, setManualAmt,
    ovAfterDisc, setOvAfterDisc,
    ovVat, setOvVat,
    ovWht, setOvWht,
    vatMode, setVatMode, effVatMode,
    effAfterDisc, effVat, effWht, effNet,
    unlockAmounts: () => { setOvAfterDisc(effAfterDisc); setOvVat(effVat); setOvWht(effWht); setManualAmt(true); },
    lockAmounts: () => setManualAmt(false),
  };
}
