"use client";

import { useState } from "react";
import { fmt, NumBox, TextInput } from "./ui";
import {
  exVatFromInput, exVatFromNet, fillLastRow, inputFromExVat, intendedNet, planError, planRowAmounts, planSum, rowPercent,
  type AmountBasis, type PlanRowInput, type VatCtx,
} from "@/lib/sales/installments";

/**
 * ตัวแก้แผนงวด (D146) — ใช้ทั้งในใบเสนอราคา (เฟส 3b) และป๊อปอัพปรับงวดของออเดอร์ (เฟส 3c)
 *
 * แก้ได้เฉพาะงวดที่ยังไม่ล็อก · % คิดจากยอดสุทธิหลังหัก ณ ที่จ่าย · **งวดสุดท้ายรับเศษ** (planRowAmounts)
 * D164 — กรอกได้ทั้ง % และจำนวนเงิน: กรอก % → คิดเป็นเงินให้ (แบบเดิม) · กรอกเงิน → คิดกลับเป็น % ให้
 *   จำนวนเงินกรอกเป็น "รวม VAT" หรือ "ก่อน VAT" ก็ได้ (ปุ่มสลับ) · งวดที่กรอกเป็นเงินตรึงยอดก่อน VAT ไว้
 * ★ ยอดเป็นบาทบนจอคิดด้วยฟังก์ชันเดียวกับที่ server ส่งเข้า RPC — เห็นอย่างไร บันทึกอย่างนั้น
 * ★ ข้อความผิดมาจาก `planError()` ตัวเดียวกับที่ server ตรวจก่อนบันทึก
 * ★ ฐานที่เลือก (รวม/ก่อน VAT) เป็นแค่วิธีกรอก/แสดง ไม่ถูกบันทึก — สลับไปมาแล้วยอดไม่ขยับ
 */
export function InstallmentEditor({
  rows,
  onChange,
  net,
  remain,
  ctx,
  startSeq = 1,
  sent = false,
}: {
  rows: PlanRowInput[];
  onChange: (rows: PlanRowInput[]) => void;
  /** ยอดสุทธิทั้งสัญญา (ฐานของ %) */
  net: number;
  /** ยอดที่งวดชุดนี้ต้องรวมให้ได้ (ใบเสนอราคา = ยอดสุทธิ · ปรับงวด = ยอดค้าง − งวดล็อกที่ยังไม่รับ) */
  remain: number;
  /** D164 — VAT/หัก ณ ที่จ่ายของออเดอร์ (แปลงจำนวนเงินที่กรอก ↔ ยอดชำระ) · บังคับส่ง ห้ามเดา */
  ctx: VatCtx;
  /** เลขงวดแรกของชุดนี้ (ปรับงวดหลังรับงวดแรก = 2) */
  startSeq?: number;
  /** ส่งคลังไปแล้ว — ไม่มีจุดส่งของให้เลือก */
  sent?: boolean;
}) {
  const [basis, setBasis] = useState<AmountBasis>("incl");
  const sum = planSum(rows, net, remain, ctx);
  // ★ แผนรวมได้พอดี → โชว์ยอดที่จะบันทึก (งวดสุดท้ายรับเศษ) · ยังไม่พอดี → โชว์ยอดตามที่แต่ละงวดกรอก
  //   🪤 เดิมงวดสุดท้ายโชว์ "50%" คู่กับยอดส่วนที่เหลือ 77,000 = สองช่องในแถวเดียวกันขัดกันเอง (บันทึกไม่ได้อยู่แล้ว)
  const amounts = !(net > 0)
    ? rows.map(() => 0)
    : sum.ok ? planRowAmounts(net, rows, remain, ctx) : rows.map((r) => intendedNet(r, net, ctx));
  /** ปุ่ม "ปรับงวดสุดท้ายให้ครบ" — เฉพาะตอนผลรวมไม่พอดี */
  const filled = sum.ok ? null : fillLastRow(rows, net, remain, ctx);
  const err = net > 0 ? planError(rows, net, remain, sent, ctx) : null;
  const wht = (ctx.whtPct || 0) > 0;
  const fixed = (r: PlanRowInput) => r.exVat != null;

  // ยอดที่กรอกไม่ตรงกับยอดที่ลูกค้าจ่าย (ก่อน VAT หรือมีหัก ณ ที่จ่าย) → โชว์คอลัมน์ยอดชำระด้วย
  const showNet = wht || (ctx.isVat && basis === "ex");
  const amountHead = ctx.isVat ? (basis === "ex" ? "ก่อน VAT" : "รวม VAT") : wht ? "ก่อนหัก ณ ที่จ่าย" : "ยอด (บาท)";
  /** ตัวเลขในช่องจำนวนเงิน — งวดที่กรอกเป็นเงินโชว์ค่าที่กรอก · งวดที่กรอก % (และงวดสุดท้าย) โชว์ยอดที่คิดได้ */
  const shownAmount = (r: PlanRowInput, i: number) =>
    inputFromExVat(fixed(r) ? Number(r.exVat) : exVatFromNet(amounts[i] ?? 0, ctx), basis, ctx);

  const set = (i: number, patch: Partial<PlanRowInput>) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : patch.shipPoint ? { ...r, shipPoint: false } : r)));
  const setPercent = (i: number, v: number | "") => set(i, { percent: v === "" ? 0 : v, exVat: undefined });
  const setAmount = (i: number, v: number | "") =>
    set(i, { exVat: v === "" ? 0 : exVatFromInput(v, basis, ctx), percent: v === "" ? 0 : rows[i].percent });
  const remove = (i: number) => onChange(rows.filter((_, k) => k !== i));
  /** ยอดก่อน VAT ของงวด (ไว้รวมงวด) — งวดที่กรอก % ใช้ยอดที่คิดได้ */
  const exOf = (i: number) => (fixed(rows[i]) ? Number(rows[i].exVat) : exVatFromNet(amounts[i] ?? 0, ctx));
  /** รวมงวดนี้กับงวดถัดไป — คงชื่องวดแรก · % บวกกัน (มีงวดกรอกเป็นเงิน = ยอดบวกกัน) · จุดส่งของติดไปด้วย */
  const mergeNext = (i: number) =>
    onChange([
      ...rows.slice(0, i),
      {
        ...rows[i],
        percent: Math.round(((rows[i].percent || 0) + (rows[i + 1].percent || 0)) * 100) / 100,
        exVat: fixed(rows[i]) || fixed(rows[i + 1]) ? exOf(i) + exOf(i + 1) : undefined,
        shipPoint: rows[i].shipPoint || rows[i + 1].shipPoint,
      },
      ...rows.slice(i + 2),
    ]);
  /** เพิ่มงวด — เติมส่วนที่ขาดให้เอง (มีงวดกรอกเป็นเงิน = เติมเป็นเงิน ไม่งั้นเป็น %) */
  const add = () => {
    const label = `งวดที่ ${startSeq + rows.length}`;
    if (rows.some(fixed)) {
      const gap = Math.round((remain - sum.intended) * 100) / 100;
      onChange([...rows, { label, percent: 0, exVat: gap > 0 ? exVatFromNet(gap, ctx) : 0, shipPoint: false }]);
    } else {
      onChange([...rows, { label, percent: Math.max(0, Math.round((sum.need - sum.sumPct) * 100) / 100), shipPoint: false }]);
    }
  };

  const tab = (on: boolean) =>
    `rounded px-2 py-0.5 ${on ? "bg-brand text-on-brand" : "border border-line text-muted hover:bg-raised hover:text-ink"}`;

  return (
    <div className="space-y-2 text-xs">
      {ctx.isVat && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-faint">กรอกจำนวนเงินเป็น</span>
          <button type="button" onClick={() => setBasis("incl")} className={tab(basis === "incl")} aria-pressed={basis === "incl"}>รวม VAT</button>
          <button type="button" onClick={() => setBasis("ex")} className={tab(basis === "ex")} aria-pressed={basis === "ex"}>ก่อน VAT</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-faint">
              <th className="w-8 text-left font-normal">งวด</th>
              <th className="text-left font-normal">ชื่องวด</th>
              <th className="w-20 text-right font-normal">%</th>
              <th className="w-28 text-right font-normal">{amountHead}</th>
              {showNet && (
                <th className="w-24 text-right font-normal" title={`ยอดที่ลูกค้าจ่ายจริง${ctx.isVat ? " (รวม VAT" : " ("}${wht ? " หลังหัก ณ ที่จ่าย)" : ")"} — ยอดนี้คือยอดงวดที่บันทึก`}>
                  ลูกค้าจ่าย
                </th>
              )}
              {!sent && <th className="w-12 text-center font-normal" title="ส่งคลังเมื่อรับเงินงวดนี้">ส่งของ</th>}
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const last = i === rows.length - 1;
              const lastHint = last ? "งวดสุดท้ายรับยอดที่เหลือ (ไม่มีเศษสตางค์ตกหล่น)" : undefined;
              return (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 text-muted">{startSeq + i}</td>
                  <td className="py-1 pr-1"><TextInput value={r.label} onChange={(e) => set(i, { label: e.target.value })} className="h-8 text-xs" /></td>
                  <td className="py-1 pl-1">
                    <div className="ml-auto w-20" title={fixed(r) ? "คิดจากจำนวนเงินที่กรอก — พิมพ์ % ใหม่เพื่อกลับไปกรอกเป็น %" : undefined}>
                      <NumBox
                        value={rowPercent(r, net, ctx)}
                        blankZero
                        onChange={(v) => setPercent(i, v)}
                        className={`h-8 text-right text-xs ${fixed(r) ? "text-muted" : ""}`}
                      />
                    </div>
                  </td>
                  <td className="py-1 pl-1">
                    <div className="ml-auto w-28" title={!fixed(r) && !last ? "คิดจาก % — พิมพ์จำนวนเงินเพื่อกรอกเป็นเงินแทน" : lastHint}>
                      <NumBox
                        value={shownAmount(r, i)}
                        blankZero
                        onChange={(v) => setAmount(i, v)}
                        className={`h-8 text-right text-xs ${fixed(r) ? "" : "text-muted"}`}
                      />
                    </div>
                  </td>
                  {showNet && (
                    <td className={`py-1 text-right ${last ? "text-muted" : ""}`} title={lastHint}>{fmt(amounts[i] ?? 0)}</td>
                  )}
                  {!sent && (
                    <td className="py-1 text-center">
                      <input
                        type="radio"
                        name={`ship-${startSeq}`}
                        checked={r.shipPoint}
                        onChange={() => set(i, { shipPoint: true })}
                        aria-label={`ส่งของเมื่อรับงวดที่ ${startSeq + i}`}
                      />
                    </td>
                  )}
                  <td className="py-1 text-right whitespace-nowrap">
                    {i < rows.length - 1 && (
                      <button type="button" onClick={() => mergeNext(i)} title="รวมกับงวดถัดไป" className="mr-1 rounded border border-line px-1.5 py-0.5 text-faint hover:text-ink">รวม</button>
                    )}
                    {rows.length > 1 && (
                      <button type="button" onClick={() => remove(i)} aria-label={`ลบงวดที่ ${startSeq + i}`} className="rounded border border-line px-1.5 py-0.5 text-faint hover:text-crit">✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={add} className="rounded border border-line px-2 py-1 text-muted hover:bg-raised hover:text-ink">+ เพิ่มงวด</button>
        {/* ส่วนที่ขาด/เกินบอกในบรรทัดเหลืองด้านล่าง (planError) — ไม่พูดซ้ำตรงนี้ */}
        <span className={sum.ok ? "text-faint" : "font-semibold text-warn"}>
          รวม {sum.sumPct}%{sum.fixed ? ` · ลูกค้าจ่าย ฿${fmt(sum.intended)}` : ""}
        </span>
      </div>
      {!sent && !rows.some((r) => r.shipPoint) && (
        <p className="text-faint">ไม่ได้เลือกงวดส่งของ — ระบบส่งคลังเมื่อรับเงินครบทุกงวด หรือกด ส่งคลังตอนนี้ ที่หน้าจัดการออเดอร์</p>
      )}
      {err && (
        <p className="flex flex-wrap items-center gap-2 text-warn">
          <span>{err}</span>
          {filled && (
            <button type="button" onClick={() => onChange(filled)} className="rounded border border-warn-line px-2 py-0.5 font-semibold hover:bg-raised">
              ปรับงวดสุดท้ายให้ครบ
            </button>
          )}
        </p>
      )}
    </div>
  );
}
