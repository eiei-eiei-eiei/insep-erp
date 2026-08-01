"use client";

/**
 * ตรรกะ "รายการสินค้าในบิล" ที่ใช้ร่วมกันระหว่างฟอร์มบันทึกบิล (EntryTab)
 * และฟอร์มแก้บิลย้อนหลัง (EditBillModal ใน BillsTab)
 *
 * เดิมก๊อปกันคนละชุด (~150 บรรทัด) → แก้สูตร VAT-สลับช่อง/ส่วนลด ครั้งหน้าต้องแก้ 2 ที่
 * เสี่ยง "เลขตอนสร้าง ≠ เลขตอนแก้" · สูตรจริงยังอยู่ที่ lib/accounting/calc เหมือนเดิม
 * ไฟล์นี้แค่รวม state handler ไม่ได้คำนวณเงินเอง
 */

import { useMemo, useState } from "react";
import {
  entryCalc,
  itemTotal,
  itemDiscBahtFromPct,
  inVatFromExVat,
  exVatFromInVat,
  round2,
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

/** แถวรายการ → payload ที่ RPC รับ (ช่องว่าง = 1 ตอนบันทึก ตามเดิม) */
export function buildItemInputs(items: BillItem[]): TxItemInput[] {
  return items
    .filter((it) => it.itemName || it.exVat)
    .map((it) => {
      const q = it.quantity === "" ? 1 : it.quantity;
      return {
        item_name: it.itemName,
        quantity: q,
        in_vat: it.inVat || inVatFromExVat(it.exVat),
        ex_vat: it.exVat,
        total_price: itemTotal(q, it.exVat, it.discBaht),
        discount_pct: it.discPct,
        discount_baht: it.discBaht,
        item_category: it.itemCategory,
        item_job: it.itemJob,
      };
    });
}

/** handler แก้แถวรายการ (in↔ex VAT สลับกัน · ส่วนลด %↔บาท) — เหมือนกันทั้ง 2 ฟอร์ม */
export function makeItemHandlers(
  items: BillItem[],
  setItems: React.Dispatch<React.SetStateAction<BillItem[]>>,
) {
  const setItem = (i: number, patch: Partial<BillItem>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  return {
    setItem,
    onExVat: (i: number, v: number) =>
      setItem(i, { exVat: v, inVat: inVatFromExVat(v), discBaht: round2((v * qn(items[i].quantity) * items[i].discPct) / 100) }),
    onInVat: (i: number, v: number) => {
      const ex = exVatFromInVat(v);
      setItem(i, { inVat: v, exVat: ex, discBaht: round2((ex * qn(items[i].quantity) * items[i].discPct) / 100) });
    },
    onQty: (i: number, q: Qty) => setItem(i, { quantity: q, discBaht: itemDiscBahtFromPct(qn(q), items[i].exVat, items[i].discPct) }),
    onDiscPct: (i: number, v: number) => setItem(i, { discPct: v, discBaht: itemDiscBahtFromPct(qn(items[i].quantity), items[i].exVat, v) }),
    onDiscBaht: (i: number, v: number) => {
      const gross = qn(items[i].quantity) * items[i].exVat;
      setItem(i, { discBaht: v, discPct: gross > 0 ? round2((v / gross) * 100) : 0 });
    },
    removeItem: (i: number) => setItems((p) => p.filter((_, idx) => idx !== i)),
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

  const calc = useMemo(
    () => entryCalc({ items: items.map((it) => ({ quantity: qn(it.quantity), exVat: it.exVat, discBaht: it.discBaht })), discount, hasVat, hasWht, whtRate }),
    [items, discount, hasVat, hasWht, whtRate],
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
    effAfterDisc, effVat, effWht, effNet,
    unlockAmounts: () => { setOvAfterDisc(effAfterDisc); setOvVat(effVat); setOvWht(effWht); setManualAmt(true); },
    lockAmounts: () => setManualAmt(false),
  };
}
