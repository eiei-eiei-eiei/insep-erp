"use client";

import { useEffect, useState } from "react";
import { EscToClose } from "@/lib/shared/ui";
import { showToast } from "@/lib/shared/toast";
import { fmt, Field, Select, TextInput, LoadError } from "./ui";
import type { OrderRow } from "./types";
import type { CompanyInfo } from "@/lib/sales/company";
import { formatThaiDate } from "@/lib/sales/orders";
import { CN_REASONS, CN_REASON_KEYS, cnInputError, cnInvoiceLines, cnWhtNote, partialRemaining, partialTotals, type CnReason } from "@/lib/sales/creditNote";
import { getCreditNotesAction, getOrderItemsAction, getOrderPaymentsAction, getPartialCreditPlanAction, issueCreditNoteAction } from "../actions";
import { openPrintWindow, printCreditNote, type OrderLike } from "./print";

type Plan = Awaited<ReturnType<typeof getPartialCreditPlanAction>>;

/**
 * D160 — ใบลดหนี้บางส่วน (เฟส 2 ของ D159) บนออเดอร์ที่ปิดการขายแล้ว
 * · คืนสินค้า = เลือกรายการ+จำนวน (ยอดคิดจากราคาในออเดอร์ · ส่วนลดท้ายบิลลดตามสัดส่วน) + เลือกคืนเข้าสต็อก
 * · ลดราคา   = กรอกยอดที่ลด (รวม VAT)
 * ★ ตัวเลขบนจอ = partialTotals() ตัวเดียวกับที่ server คิดตอนบันทึก · ออกได้หลายใบจนยอดที่ลดได้เหลือ 0
 */
export function CreditNoteDialog({
  order, company, onClose, onDone,
}: {
  order: OrderRow;
  company: CompanyInfo;
  onClose: () => void;
  onDone: () => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [err, setErr] = useState(false);
  const [mode, setMode] = useState<"return" | "discount">("return");
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [restock, setRestock] = useState(true);
  const [gross, setGross] = useState("");
  const [reason, setReason] = useState<CnReason | "">("");
  const [detail, setDetail] = useState("");
  const [date, setDate] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setErr(false);
    getPartialCreditPlanAction(order.quNo)
      .then((p) => { setPlan(p); setDate(p.today); })
      .catch(() => setErr(true));
  }
  useEffect(load, [order.quNo]);

  const input = mode === "return"
    ? { mode, qtys: Object.fromEntries(Object.entries(qtys).map(([k, v]) => [Number(k), Number(v) || 0])) } as const
    : { mode, gross: Number(gross) || 0 } as const;
  const ctx = plan ? { bills: plan.bills, prior: plan.prior, items: plan.items, grandTotal: plan.grandTotal, whtPercent: plan.whtPercent } : null;
  const rem = ctx ? partialRemaining(ctx) : null;
  const result = ctx ? partialTotals(input, ctx) : null;
  const totals = result && typeof result !== "string" ? result : null;
  const inputErr = !plan ? null
    : typeof result === "string" ? result
    : cnInputError({ reason, detail, date, bills: plan.bills, today: plan.today });

  async function submit() {
    if (!plan || !totals) return;
    setError(null);
    const w = openPrintWindow(); // เปิดก่อน await กัน popup blocker
    setBusy(true);
    const r = await issueCreditNoteAction(
      order.quNo,
      mode === "return" ? { mode, qtys: input.mode === "return" ? input.qtys : {}, restock } : { mode, gross: Number(gross) || 0 },
      { reason, detail, date, refundAccount: account },
    );
    setBusy(false);
    if (!r.ok) { w?.close(); setError(r.error ?? "ออกใบลดหนี้ไม่สำเร็จ"); return; }
    const d = r.data as { cn_no?: string; excise_locked_months?: string[] } | undefined;
    const locked = d?.excise_locked_months?.length
      ? ` · เดือน ${d.excise_locked_months.join(", ")} ปิดบัญชีสรรพสามิตไปแล้ว — ยอดรับคืนจะทำให้งบเดือนที่ยื่นไปไม่ตรง ต้องถอนปิดเดือนแล้วยื่นใหม่ หรือแจ้งสรรพสามิต`
      : "";
    showToast(locked ? { ok: true, warn: true, text: `ออกใบลดหนี้ ${d?.cn_no} แล้ว${locked}` } : { ok: true, text: `ออกใบลดหนี้ ${d?.cn_no} แล้ว` });
    onDone();
    if (d?.cn_no && w) {
      try {
        const [cns, items, payments] = await Promise.all([getCreditNotesAction(order.quNo), getOrderItemsAction(order.quNo), getOrderPaymentsAction(order.quNo)]);
        const cn = cns.find((x) => x.cnNo === d.cn_no);
        if (cn) printCreditNote(company, { ...(order as OrderLike), payments }, items, cn, w);
        else w.close();
      } catch {
        w.close();
        showToast({ ok: false, text: `ออกใบลดหนี้ ${d.cn_no} แล้ว แต่โหลดมาพิมพ์ไม่สำเร็จ — กด พิมพ์ใบลดหนี้ ที่แถวออเดอร์` });
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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">ออกใบลดหนี้ {order.quNo}</h2>
          <button onClick={onClose} disabled={busy} aria-label="ปิด" className="text-2xl leading-none text-faint hover:text-crit">&times;</button>
        </div>
        {err ? (
          <LoadError err onRetry={load} what="ข้อมูลใบกำกับของออเดอร์" />
        ) : !plan || !rem ? (
          <div className="py-6 text-center text-faint">กำลังโหลด…</div>
        ) : rem.gross <= 0 || !plan.bills.length ? (
          // ลดหนี้ครบแล้ว / ไม่มีใบกำกับที่มี VAT → ไม่มีอะไรให้กรอก บอกเหตุผลแล้วจบ (ไม่โชว์ฟอร์มที่กดไม่ได้)
          <div className="space-y-3 text-sm">
            <div className="rounded border border-warn-line bg-warn-bg p-2 text-warn">
              {!plan.bills.length
                ? "ออเดอร์นี้ไม่มีใบกำกับภาษีให้ลดหนี้"
                : `ออเดอร์นี้ลดหนี้ครบยอดแล้ว (${plan.prior.length} ใบ) — ดูได้ที่ปุ่ม พิมพ์ใบลดหนี้`}
            </div>
            <div className="flex justify-end"><button onClick={onClose} className="rounded border border-line px-3 py-2 text-sm text-ink hover:bg-raised">กลับ</button></div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded bg-raised p-2 text-muted">
              {order.customerName} · ใบกำกับ: {plan.bills.map((b) => `${b.taxInvoiceNo || "-"} (${formatThaiDate(b.taxInvoiceDate || b.date)})`).join(", ") || "-"}
              <br />
              <span className="text-xs">ยังลดหนี้ได้อีก <b>{fmt(rem.gross)}</b> บาท (รวม VAT){plan.prior.length > 0 && ` · ออกใบลดหนี้ไปแล้ว ${plan.prior.length} ใบ`}</span>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "return"} onChange={() => setMode("return")} /> <b>คืนสินค้า</b> (เลือกรายการ)</label>
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "discount"} onChange={() => setMode("discount")} /> <b>ลดราคา</b> (กรอกยอด)</label>
            </div>

            {mode === "return" ? (
              <>
                <table className="tbl w-full">
                  <thead><tr><th>รายการ</th><th className="num hidden sm:table-cell">ราคา/หน่วย</th><th className="num hidden sm:table-cell">ขาย</th><th className="num">คืนได้อีก</th><th className="num">คืนครั้งนี้</th></tr></thead>
                  <tbody>
                    {plan.items.map((it) => (
                      <tr key={it.id}>
                        <td>
                          {it.name}
                          {/* จอแคบ: ราคา/จำนวนขายย้ายมาใต้ชื่อ (คอลัมน์ถูกซ่อน) — ไม่งั้นชื่อถูกบีบเหลือคำละบรรทัด */}
                          <div className="text-xs text-faint sm:hidden">{fmt(it.price)} · ขาย {it.qty}</div>
                        </td>
                        <td className="num hidden sm:table-cell">{fmt(it.price)}</td>
                        <td className="num hidden sm:table-cell">{it.qty}</td>
                        <td className="num">{rem.qty[it.id]}</td>
                        <td className="num">
                          <div className="ml-auto w-16 sm:w-20">
                            <TextInput type="number" min={0} max={rem.qty[it.id]} step="any" value={qtys[it.id] ?? ""}
                              disabled={rem.qty[it.id] <= 0}
                              onChange={(e) => setQtys((q) => ({ ...q, [it.id]: e.target.value }))} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="mt-1" />
                  <span><b>คืนเข้าสต็อก</b> — สินค้ากลับเข้าคลัง และสุราขึ้นฟอร์ม ภส. เป็นรับคืน (ไม่ติ๊กถ้าสินค้าแตก/เสียหายใช้ขายต่อไม่ได้)</span>
                </label>
              </>
            ) : (
              <Field label="ยอดที่ลด (รวม VAT)">
                <div className="w-40"><TextInput type="number" min={0} step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} /></div>
              </Field>
            )}

            <Field label="เหตุที่ออกใบลดหนี้ (ต้องเข้าเหตุตามกฎหมาย)">
              <Select value={reason} onChange={(e) => setReason(e.target.value as CnReason)}>
                <option value="">— เลือกเหตุ —</option>
                {CN_REASON_KEYS.map((k) => <option key={k} value={k}>{CN_REASONS[k].label}</option>)}
              </Select>
            </Field>
            {reason && <div className="-mt-2 text-xs text-faint">อ้างอิง {CN_REASONS[reason].law}</div>}
            <Field label={reason === "other" ? "คำอธิบาย (ต้องกรอก — พิมพ์บนใบลดหนี้)" : "คำอธิบายเพิ่มเติม (ไม่บังคับ)"}>
              <TextInput value={detail} maxLength={200} onChange={(e) => setDetail(e.target.value)} placeholder="เช่น ขวดแตก 2 ขวด ลูกค้าส่งคืน" />
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

            {totals && (
              <table className="tbl w-full">
                <tbody>
                  {/* ★ บรรทัดเดียวกับบนกระดาษ (cnInvoiceLines) — ใบที่ 2 ขึ้นไปมีบรรทัดหักใบก่อนหน้า */}
                  {(() => {
                    const inv = cnInvoiceLines(plan.bills.map((b) => ({ preVat: b.preVat })), totals.original);
                    return (
                      <>
                        <tr><td>มูลค่าตามใบกำกับภาษีเดิม</td><td className="num">{fmt(inv.invoice)}</td></tr>
                        {inv.prior > 0 && <tr><td>หัก ลดหนี้ครั้งก่อน</td><td className="num">-{fmt(inv.prior)}</td></tr>}
                      </>
                    );
                  })()}
                  <tr><td>มูลค่าที่ถูกต้อง</td><td className="num">{fmt(totals.correct)}</td></tr>
                  <tr><td>ผลต่าง (ก่อน VAT)</td><td className="num">{fmt(totals.diff)}</td></tr>
                  <tr><td>ภาษีมูลค่าเพิ่มที่ลดลง</td><td className="num">{fmt(totals.vat)}</td></tr>
                  <tr><td><b>รวมลดหนี้</b></td><td className="num"><b>{fmt(totals.total)}</b></td></tr>
                  {totals.wht > 0 && <tr><td>ยอดคืนเงินจริง</td><td className="num">{fmt(totals.refund)}</td></tr>}
                </tbody>
              </table>
            )}
            {totals && cnWhtNote(totals) && <div className="text-xs text-warn">{cnWhtNote(totals)}</div>}
            {totals?.closing && <div className="text-xs text-muted">ใบนี้ลดหนี้ครบยอดที่เหลือของออเดอร์</div>}

            {error && <div className="rounded border border-crit-line bg-crit-bg p-2 text-crit">{error}</div>}
            {inputErr && <div className="text-xs text-warn">ยังออกไม่ได้: {inputErr}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} disabled={busy} className="rounded border border-line px-3 py-2 text-sm text-ink hover:bg-raised">กลับ</button>
              <button
                onClick={submit}
                disabled={busy || !!inputErr || !totals}
                className="rounded bg-brand px-3 py-2 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "กำลังทำ…" : "ออกใบลดหนี้"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
