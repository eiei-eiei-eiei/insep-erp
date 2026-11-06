"use client";

import { useEffect, useState } from "react";
import { EscToClose } from "@/lib/shared/ui";
import { showToast } from "@/lib/shared/toast";
import { fmt, Field, Select, TextInput, LoadError } from "./ui";
import type { OrderRow } from "./types";
import type { CompanyInfo } from "@/lib/sales/company";
import { useDateFmt } from "@/lib/shared/dateFormatContext";
import { CN_REASONS, CN_REASON_KEYS, cnInputError, cnWhtNote, type CnReason } from "@/lib/sales/creditNote";
import { CANCEL_ORDER_DETAIL } from "@/lib/sales/cancelledDocs";
import { cancelLockedText } from "@/lib/production/monthClose";
import { cancelOrderAction, getCancelPlanAction, getCreditNotesAction, getOrderItemsAction, getOrderPaymentsAction } from "../actions";
import { openPrintWindow, printCreditNote, type OrderLike } from "./print";

type Plan = Awaited<ReturnType<typeof getCancelPlanAction>>;

/**
 * D159 — ยกเลิกออเดอร์: ยกเลิกแบบเดิม หรือออกใบลดหนี้
 *
 * · ไม่มีใบกำกับที่มี VAT → กล่องยืนยันแบบเดิม (ผู้เรียกจัดการเอง · ไม่เปิดกล่องนี้)
 * · ใบกำกับเดือนนี้ + ยังไม่ยื่น ภพ.30 → เลือกได้ (ใบลดหนี้ = ค่าตั้งต้น)
 * · ใบกำกับเดือนก่อน/ยื่นแล้ว → ใบลดหนี้เท่านั้น (RPC บังคับซ้ำ)
 * ★ ตัวเลขบนจอมาจาก server (`cnTotals` ตัวเดียวกับที่ RPC บวก) · ออกเสร็จเปิดใบลดหนี้ให้พิมพ์ทันที
 */
export function CancelOrderDialog({
  order, company, onClose, onDone,
}: {
  order: OrderRow;
  company: CompanyInfo;
  onClose: () => void;
  onDone: () => void;
}) {
  const d = useDateFmt();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [err, setErr] = useState(false);
  const [useCredit, setUseCredit] = useState(true);
  const [reason, setReason] = useState<CnReason | "">("");
  const [detail, setDetail] = useState("");
  const [date, setDate] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setErr(false);
    getCancelPlanAction(order.quNo)
      .then((p) => { setPlan(p); setDate(p.today); })
      .catch(() => setErr(true));
  }
  useEffect(load, [order.quNo]);

  const credit = plan?.mode === "credit_note" || (plan?.mode === "choice" && useCredit);
  const inputErr = plan && credit ? cnInputError({ reason, detail, date, bills: plan.bills, today: plan.today }) : null;

  async function submit() {
    if (!plan) return;
    setError(null);
    // ★ เปิดหน้าต่างพิมพ์ก่อน await (กัน popup blocker) — ยกเลิกไม่สำเร็จก็ปิดทิ้ง
    const w = credit ? openPrintWindow() : null;
    setBusy(true);
    const r = await cancelOrderAction(order.quNo, credit ? { reason, detail, date, refundAccount: account } : undefined);
    setBusy(false);
    if (!r.ok) { w?.close(); setError(r.error ?? "ยกเลิกไม่สำเร็จ"); return; }
    const res = r.data as { cn_no?: string | null; excise_locked_months?: string[] } | undefined;
    const locked = cancelLockedText(order.quNo, res?.excise_locked_months ?? [], d.month);
    showToast(locked
      ? { ok: true, warn: true, text: locked }
      : { ok: true, text: res?.cn_no ? `ยกเลิก ${order.quNo} แล้ว · ออกใบลดหนี้ ${res.cn_no}` : `ยกเลิก ${order.quNo} แล้ว` });
    onDone();
    if (res?.cn_no && w) {
      try {
        const [cns, items, payments] = await Promise.all([getCreditNotesAction(order.quNo), getOrderItemsAction(order.quNo), getOrderPaymentsAction(order.quNo)]);
        const cn = cns.find((x) => x.cnNo === res.cn_no);
        if (cn) printCreditNote(company, { ...(order as OrderLike), payments }, items, cn, w);
        else w.close();
      } catch {
        w.close();
        showToast({ ok: false, text: `ออกใบลดหนี้ ${res.cn_no} แล้ว แต่โหลดมาพิมพ์ไม่สำเร็จ — กด พิมพ์ใบลดหนี้ ที่แท็บ ปิด / ยกเลิก` });
      }
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <EscToClose onClose={() => { if (!busy) onClose(); }} />
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">ยกเลิกออเดอร์ {order.quNo}</h2>
          <button onClick={onClose} disabled={busy} aria-label="ปิด" className="text-2xl leading-none text-faint hover:text-crit">&times;</button>
        </div>
        {err ? (
          <LoadError err onRetry={load} what="ข้อมูลใบกำกับของออเดอร์" />
        ) : !plan ? (
          <div className="py-6 text-center text-faint">กำลังโหลด…</div>
        ) : plan.partialBlocked ? (
          // D160 — มีใบลดหนี้บางส่วนแล้ว: ยกเลิกทั้งออเดอร์ไม่ได้ (RPC บังคับซ้ำ) · บอกว่าต้องกดอะไรแทน
          <div className="space-y-3 text-sm">
            <div className="rounded border border-warn-line bg-warn-bg p-2 text-warn">{plan.partialBlocked}</div>
            <div className="flex justify-end"><button onClick={onClose} className="rounded border border-line px-3 py-2 text-sm text-ink hover:bg-raised">กลับ</button></div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded bg-raised p-2 text-muted">
              {order.customerName}
              {plan.bills.length > 0 && <> · ใบกำกับภาษีที่ออกไปแล้ว: {plan.bills.map((b) => `${b.taxInvoiceNo || "-"} (${d.date(b.taxInvoiceDate || b.date)})`).join(", ")}</>}
            </div>

            {plan.mode === "void" ? null : plan.mode === "credit_note" ? (
              <div className="rounded border border-warn-line bg-warn-bg p-2 text-warn">
                ใบกำกับอยู่ในเดือนก่อน หรือเดือนที่ยื่น ภ.พ.30 แล้ว — ต้องออก<b>ใบลดหนี้</b> ภาษีขายจะลดใน ภ.พ.30 ของเดือนที่ออกใบลดหนี้ งวดเดิมไม่ขยับ
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="flex items-start gap-2">
                  <input type="radio" checked={useCredit} onChange={() => setUseCredit(true)} className="mt-1" />
                  <span><b>ออกใบลดหนี้</b> (แนะนำ) — ใบกำกับเดิมยังใช้ได้ ภาษีขายลดในเดือนที่ออกใบลดหนี้</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" checked={!useCredit} onChange={() => setUseCredit(false)} className="mt-1" />
                  <span><b>ยกเลิกใบกำกับเดิม</b> — ใช้ได้เฉพาะเดือนนี้ที่ยังไม่ยื่น ภ.พ.30 และต้องเรียกใบเดิมคืนจากลูกค้ามาประทับตรายกเลิก</span>
                </label>
              </div>
            )}

            {credit ? (
              <>
                <Field label="เหตุที่ออกใบลดหนี้ (ต้องเข้าเหตุตามกฎหมาย)">
                  <Select value={reason} onChange={(e) => setReason(e.target.value as CnReason)}>
                    <option value="">— เลือกเหตุ —</option>
                    {CN_REASON_KEYS.map((k) => <option key={k} value={k}>{CN_REASONS[k].label}</option>)}
                  </Select>
                </Field>
                {reason && <div className="-mt-2 text-xs text-faint">อ้างอิง {CN_REASONS[reason].law}</div>}
                <Field label={reason === "other" ? "คำอธิบาย (ต้องกรอก — พิมพ์บนใบลดหนี้)" : "คำอธิบายเพิ่มเติม (ไม่บังคับ)"}>
                  <TextInput value={detail} maxLength={200} onChange={(e) => setDetail(e.target.value)} placeholder="เช่น ลูกค้าคืนสินค้าทั้งหมดตามข้อตกลง" />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="วันที่ใบลดหนี้">
                    <TextInput type="date" value={date} max={plan.today} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                  <Field label="คืนเงินจากบัญชี">
                    <Select value={account} onChange={(e) => setAccount(e.target.value)}>
                      <option value="">ยังไม่คืน (ตั้งค้างจ่ายลูกค้า)</option>
                      {plan.accounts.map((a) => <option key={a} value={a}>{a}</option>)}
                    </Select>
                  </Field>
                </div>
                <table className="tbl w-full">
                  <tbody>
                    <tr><td>มูลค่าตามใบกำกับเดิม</td><td className="num">{fmt(plan.totals.original)}</td></tr>
                    <tr><td>มูลค่าที่ถูกต้อง</td><td className="num">{fmt(plan.totals.correct)}</td></tr>
                    <tr><td>ผลต่าง (ก่อน VAT)</td><td className="num">{fmt(plan.totals.diff)}</td></tr>
                    <tr><td>ภาษีมูลค่าเพิ่มที่ลดลง</td><td className="num">{fmt(plan.totals.vat)}</td></tr>
                    <tr><td><b>รวมลดหนี้</b></td><td className="num"><b>{fmt(plan.totals.total)}</b></td></tr>
                    {plan.totals.wht > 0 && <tr><td>ยอดคืนเงินจริง</td><td className="num">{fmt(plan.totals.refund)}</td></tr>}
                  </tbody>
                </table>
                {cnWhtNote(plan.totals) && <div className="text-xs text-warn">{cnWhtNote(plan.totals)}</div>}
                <div className="text-xs text-faint">
                  ระบบคืนสต็อกและย้อนรายการสต็อกให้เหมือนการยกเลิกแบบเดิม · ไม่ได้คืนเงินตอนนี้ = ขึ้นในหน้าลูกหนี้-เจ้าหนี้ กดชำระทีหลังได้
                </div>
              </>
            ) : (
              <div className="text-muted">{CANCEL_ORDER_DETAIL}</div>
            )}

            {error && <div className="rounded border border-crit-line bg-crit-bg p-2 text-crit">{error}</div>}
            {inputErr && <div className="text-xs text-warn">ยังกรอกไม่ครบ: {inputErr}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} disabled={busy} className="rounded border border-line px-3 py-2 text-sm text-ink hover:bg-raised">กลับ</button>
              <button
                onClick={submit}
                disabled={busy || !!inputErr}
                className="rounded bg-crit px-3 py-2 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "กำลังทำ…" : credit ? "ยกเลิก + ออกใบลดหนี้" : "ยกเลิกออเดอร์"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
