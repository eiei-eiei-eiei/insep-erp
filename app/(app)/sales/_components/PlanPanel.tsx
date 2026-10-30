"use client";

import { useState } from "react";
import { EscToClose } from "@/lib/shared/ui";
import { showToast } from "@/lib/shared/toast";
import { fmt, todayISO, useSaver } from "./ui";
import type { OrderRow } from "./types";
import { formatThaiDate } from "@/lib/sales/orders";
import {
  isLocked, isSent, nextUnpaid, planError, type Installment, type PlanRowInput,
} from "@/lib/sales/installments";
import { issueInstallmentInvoiceAction, setOrderPlanAction, voidInstallmentInvoiceAction } from "../actions";
import { InstallmentEditor } from "./InstallmentEditor";

/**
 * ตารางงวดบนการ์ดออเดอร์ (D147 · เฟส 3c) — แสดงเฉพาะออเดอร์ที่มีแผนงวด
 *
 * ปุ่มต่องวดตามสถานะ: รับแล้ว → ใบเสร็จ · งวดถัดไป → ออกใบแจ้งหนี้ / ใบแจ้งหนี้ + รับชำระ
 * ปุ่มทั้งออเดอร์: ปรับงวด · ส่งคลังตอนนี้ · ใบแจ้งหนี้/ใบส่งสินค้า
 * ★ ปุ่มหลัก (สีเด่น) มีปุ่มเดียว = รับชำระงวดถัดไป — รับตามลำดับงวด (DB บังคับ)
 * ★ ตัดสินว่าโชว์ปุ่มไหนจาก lib (nextUnpaid · isSent · isLocked) ไม่คิดเองในคอมโพเนนต์ (D84)
 */
export function PlanPanel({
  order,
  canWrite,
  canConfig,
  onReceive,
  onShipNow,
  onPrint,
  onChanged,
}: {
  order: OrderRow;
  canWrite: boolean;
  /** sales.config — ยกเลิกใบแจ้งหนี้รายงวด */
  canConfig: boolean;
  onReceive: (inst: Installment) => void;
  onShipNow: () => void;
  /** พิมพ์เอกสาร — docType เช่น "invoice-installment:2" · "tax-invoice-installment:1" · "invoice" */
  onPrint: (docType: string) => void;
  onChanged: () => void;
}) {
  const plan = [...(order.installments ?? [])].sort((a, b) => a.seq - b.seq);
  const pays = order.instPayments ?? [];
  const net = order.netPayable || order.grandTotal;
  const next = nextUnpaid(plan);
  const closed = order.status === "ยกเลิก" || order.status === "ปิดการขาย";
  const paidCount = plan.filter((i) => i.paid).length;
  const [invoiceFor, setInvoiceFor] = useState<Installment | null>(null);
  const [replan, setReplan] = useState(false);
  const voidSaver = useSaver();

  function voidInvoice(i: Installment) {
    voidSaver.run(() => voidInstallmentInvoiceAction(order.quNo, i.seq), `ยกเลิกใบแจ้งหนี้งวดที่ ${i.seq} แล้ว`, onChanged);
  }

  const btn = "rounded border px-2 py-1 text-[11px] font-semibold transition whitespace-nowrap";
  const sec = `${btn} border-line bg-card text-muted hover:bg-raised hover:text-ink`;
  const pri = `${btn} border-brand bg-brand text-on-brand hover:opacity-90`;

  return (
    <div className="rounded-lg border border-line bg-raised p-2 text-xs">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-ink">
          แบ่งชำระ {paidCount}/{plan.length} งวด
          <span className="ml-2 font-normal text-faint">
            รับแล้ว ฿{fmt(order.deposit)} · ค้าง ฿{fmt(order.outstandingBalance)}
            {isSent(order.status) ? " · ส่งคลังแล้ว" : ""}
          </span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <tbody>
            {plan.map((i) => {
              const pay = pays.find((p) => p.installmentSeq === i.seq);
              const isNext = !closed && next?.seq === i.seq;
              return (
                <tr key={i.seq} className="border-t border-line align-top">
                  <td className="w-[34%] py-1 pr-2 text-ink">
                    งวดที่ {i.seq} {i.label}
                    {/* 🪤 ชื่องวดมักเป็น "ส่งของ" อยู่แล้ว — ป้ายต้องไม่ซ้ำคำเดียวกัน */}
                    {i.shipPoint && !isSent(order.status) && <span className="ml-1 text-faint">· จุดส่งของ</span>}
                  </td>
                  {/* % ของยอดจริง (ไม่ใช่ % ที่กรอก) — รับไม่เท่ายอดงวดแล้วยอดเปลี่ยน % ที่กรอกไว้จะโกหก */}
                  <td className="w-[8%] py-1 text-right text-muted">{shownPercent(i.amount, net)}</td>
                  <td className="w-[14%] py-1 text-right font-semibold text-ink">฿{fmt(i.amount)}</td>
                  <td className="py-1 pl-3 text-muted">
                    {i.paid ? (
                      <span className="text-ok">
                        รับแล้ว{pay?.docDate ? ` ${formatThaiDate(pay.docDate)}` : ""}{pay?.method ? ` · ${pay.method}` : ""}
                        {pay?.docNo && <span className="block text-faint">{pay.docNo}</span>}
                      </span>
                    ) : i.invNo ? (
                      <span>ใบแจ้งหนี้ {i.invNo}{i.dueDate ? ` · ครบ ${formatThaiDate(i.dueDate)}` : ""}</span>
                    ) : isNext ? (
                      <span>งวดถัดไป</span>
                    ) : (
                      <span className="text-faint">ยังไม่ถึง</span>
                    )}
                  </td>
                  <td className="py-1 text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {i.paid && <button className={sec} onClick={() => onPrint(`tax-invoice-installment:${i.seq}`)}>ใบเสร็จ</button>}
                      {!i.paid && i.invNo && <button className={sec} onClick={() => onPrint(`invoice-installment:${i.seq}`)}>ใบแจ้งหนี้</button>}
                      {!i.paid && i.invNo && canConfig && !closed && (
                        <button className={sec} disabled={voidSaver.pending} onClick={() => voidInvoice(i)}>ยกเลิกใบแจ้งหนี้</button>
                      )}
                      {isNext && canWrite && !i.invNo && <button className={sec} onClick={() => setInvoiceFor(i)}>ออกใบแจ้งหนี้</button>}
                      {isNext && canWrite && <button className={pri} onClick={() => onReceive(i)}>รับชำระงวดที่ {i.seq}</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!closed && (
        <div className="mt-1 flex flex-wrap gap-1 border-t border-line pt-1">
          {canWrite && next && <button className={sec} onClick={() => setReplan(true)}>ปรับงวด</button>}
          {canWrite && !isSent(order.status) && <button className={sec} onClick={onShipNow}>ส่งคลังตอนนี้</button>}
          {order.invNo && <button className={sec} onClick={() => onPrint("invoice")}>ใบแจ้งหนี้/ใบส่งสินค้า</button>}
        </div>
      )}
      {closed && order.invNo && order.status !== "ยกเลิก" && (
        <div className="mt-1 border-t border-line pt-1">
          <button className={sec} onClick={() => onPrint("invoice")}>ใบแจ้งหนี้/ใบส่งสินค้า</button>
        </div>
      )}

      {invoiceFor && (
        <InstallmentInvoiceDialog
          order={order}
          inst={invoiceFor}
          onClose={() => setInvoiceFor(null)}
          onDone={() => {
            const seq = invoiceFor.seq;
            setInvoiceFor(null);
            onChanged();
            showToast({ ok: true, text: `ออกใบแจ้งหนี้งวดที่ ${seq} แล้ว — กดปุ่ม ใบแจ้งหนี้ ของงวดเพื่อพิมพ์` });
          }}
        />
      )}
      {replan && <ReplanDialog order={order} onClose={() => setReplan(false)} onDone={() => { setReplan(false); onChanged(); }} />}
    </div>
  );
}

/** % ที่โชว์บนตารางงวด — คิดจากยอดบาทจริงของงวด (ทศนิยมไม่เกิน 2 ตำแหน่ง) */
function shownPercent(amount: number, net: number): string {
  if (!(net > 0)) return "";
  return `${Math.round((amount / net) * 10000) / 100}%`;
}

/** ออกใบแจ้งหนี้ของงวดถัดไป (ยังไม่ลงบัญชี — เหมือนใบแจ้งหนี้มัดจำ D45) */
function InstallmentInvoiceDialog({
  order, inst, onClose, onDone,
}: { order: OrderRow; inst: Installment; onClose: () => void; onDone: () => void }) {
  const [docDate, setDocDate] = useState(todayISO());
  const [days, setDays] = useState(7);
  const { pending, run } = useSaver();
  function submit() {
    const d = new Date(`${docDate}T00:00:00`);
    d.setDate(d.getDate() + (days || 0));
    const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    run(() => issueInstallmentInvoiceAction({ quNo: order.quNo, seq: inst.seq, docDate, dueDate: due }), "", onDone);
  }
  return (
    <Modal title={`ออกใบแจ้งหนี้งวดที่ ${inst.seq}`} onClose={onClose}>
      <div className="rounded bg-raised p-2 text-muted">
        {order.quNo} · {inst.label} · ยอด <b className="text-brand">฿{fmt(inst.amount)}</b>
        <br />
        <span className="text-xs">ใบแจ้งหนี้ยังไม่ลงบัญชี — รับเงินจริงแล้วกด รับชำระ ระบบจึงออกใบกำกับภาษี/ใบเสร็จของงวดนี้</span>
      </div>
      <label className="block">
        <span className="mb-1 block font-bold text-muted">วันที่ออกใบแจ้งหนี้</span>
        <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="w-full rounded-lg border border-line p-2" />
      </label>
      <label className="block">
        <span className="mb-1 block font-bold text-muted">ครบกำหนดชำระภายใน (วัน)</span>
        <input type="number" min={0} value={days} onChange={(e) => setDays(Number(e.target.value) || 0)} className="w-full rounded-lg border border-line p-2" />
      </label>
      {inst.seq === 1 && order.status === "รอคอนเฟิร์ม" && (
        <p className="text-xs text-warn">ออกใบแจ้งหนี้งวดแรกแล้ว จะแก้ใบเสนอราคาไม่ได้อีก (ยกเลิกใบแจ้งหนี้ก่อนจึงแก้ได้)</p>
      )}
      <button onClick={submit} disabled={pending} className="w-full rounded-lg bg-brand py-2 font-bold text-on-brand hover:opacity-90 disabled:opacity-50">
        {pending ? "กำลังบันทึก…" : "ออกใบแจ้งหนี้"}
      </button>
    </Modal>
  );
}

/** ปรับงวดที่ยังไม่ล็อก (รับแล้ว/ออกใบแจ้งหนี้แล้วคงไว้) — ตัวแก้ชุดเดียวกับใบเสนอราคา */
function ReplanDialog({ order, onClose, onDone }: { order: OrderRow; onClose: () => void; onDone: () => void }) {
  const plan = [...(order.installments ?? [])].sort((a, b) => a.seq - b.seq);
  const net = order.netPayable || order.grandTotal;
  const locked = plan.filter(isLocked);
  const lockedUnpaid = locked.filter((i) => !i.paid).reduce((s, i) => s + i.amount, 0);
  const remain = Math.round((order.outstandingBalance - lockedUnpaid) * 100) / 100;
  const startSeq = (locked.length ? Math.max(...locked.map((i) => i.seq)) : 0) + 1;
  const sent = isSent(order.status);
  const [rows, setRows] = useState<PlanRowInput[]>(() =>
    plan.filter((i) => !isLocked(i)).map((i) => ({
      label: i.label,
      percent: i.percent ?? (net > 0 ? Math.round((i.amount / net) * 10000) / 100 : 0),
      shipPoint: sent ? false : i.shipPoint,
      dueDate: i.dueDate,
    })),
  );
  const { pending, run } = useSaver();
  const err = remain > 0 ? planError(rows, net, remain, sent) : null;
  return (
    <Modal title="ปรับงวดที่ยังไม่ได้รับ" onClose={onClose} wide>
      <div className="rounded bg-raised p-2 text-xs text-muted">
        {locked.length > 0
          ? <>{startSeq - 1 === 1 ? "งวดที่ 1" : `งวดที่ 1-${startSeq - 1}`} {locked.some((i) => !i.paid) ? "รับแล้วหรือออกใบแจ้งหนี้แล้ว" : "รับแล้ว"} แก้ไม่ได้ · </>
          : null}
        งวดที่เหลือต้องรวมได้ <b>฿{fmt(remain)}</b> พอดี (งวดสุดท้ายรับเศษ)
      </div>
      {remain > 0 ? (
        <InstallmentEditor rows={rows} onChange={setRows} net={net} remain={remain} startSeq={startSeq} sent={sent} />
      ) : (
        <p className="text-xs text-warn">งวดที่เหลือออกใบแจ้งหนี้ไปแล้วทั้งหมด — ยกเลิกใบแจ้งหนี้ก่อนจึงปรับได้</p>
      )}
      <button
        onClick={() => run(() => setOrderPlanAction(order.quNo, rows), "บันทึกแผนงวดแล้ว", onDone)}
        disabled={pending || !!err || remain <= 0}
        className="w-full rounded-lg bg-brand py-2 font-bold text-on-brand hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "กำลังบันทึก…" : "บันทึกแผนงวด"}
      </button>
    </Modal>
  );
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4"
      // D73 — ปิดเมื่อกดลงที่พื้นหลังเท่านั้น
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <EscToClose onClose={onClose} />
      <div className={`max-h-[90vh] w-full ${wide ? "max-w-lg" : "max-w-md"} space-y-3 overflow-y-auto rounded-lg bg-card p-5 text-sm`}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="ปิด" className="text-2xl leading-none text-faint hover:text-crit">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}
