"use client";

import { useEffect, useState } from "react";
import { EscToClose } from "@/lib/shared/ui";
import { showToast } from "@/lib/shared/toast";
import { fmt, TextInput, useSaver, LoadError } from "./ui";
import type { OrderRow } from "./types";
import type { CompanyInfo } from "@/lib/sales/company";
import {
  PAY_METHODS, chequeText, editPaymentDoneText, parseCheque, receiptDocFor,
  type EditPaymentResult, type SalesPayment,
} from "@/lib/sales/payments";
import { formatThaiDate } from "@/lib/sales/orders";
import { editPaymentMethodAction, getOrderItemsAction, getOrderPaymentsAction } from "../actions";
import { openPrintWindow, printSalesDocs, type OrderLike } from "./print";

/**
 * D144 — แก้วิธีชำระของการรับเงินที่บันทึกไปแล้ว (เฟส 2 ของแบ่งชำระหลายงวด)
 *
 * 1 แถว = รับเงิน 1 ครั้ง (ตาราง sales_payments · D143) · แก้ทีละครั้ง
 * ★ ส่วนใหญ่แก้ก่อนส่งใบเสร็จให้ลูกค้า (ผู้ใช้บอก) ⇒ หลังแก้มีปุ่ม "พิมพ์ใบนี้ใหม่" ได้เลขเดิม
 * 🚨 ไม่แตะยอด/VAT/เลขเอกสาร — ช่องที่แก้ได้มีแค่วิธีชำระ + เช็ค
 */
export function EditPaymentDialog({
  order,
  company,
  onClose,
  onChanged,
}: {
  order: OrderRow;
  company: CompanyInfo;
  onClose: () => void;
  /** แก้สำเร็จ → ให้หน้าจัดการออเดอร์โหลดใหม่ (ช่องวิธีชำระของออเดอร์เปลี่ยนด้วย) */
  onChanged: () => void;
}) {
  const [payments, setPayments] = useState<SalesPayment[] | null>(null);
  const [err, setErr] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [method, setMethod] = useState<string>(PAY_METHODS[0]);
  const [bank, setBank] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  /** ครั้งที่เพิ่งแก้ — โชว์ปุ่มพิมพ์ใบนี้ใหม่ */
  const [justEdited, setJustEdited] = useState<number | null>(null);
  const { pending, run } = useSaver();

  function load() {
    setErr(false);
    getOrderPaymentsAction(order.quNo)
      .then(setPayments)
      .catch(() => setErr(true)); // 🚨 D89 — ต้องจบสถานะโหลดเสมอ
  }
  useEffect(load, [order.quNo]);

  function startEdit(p: SalesPayment) {
    setEditing(p.seq);
    setJustEdited(null);
    setMethod((PAY_METHODS as readonly string[]).includes(p.method) ? p.method : PAY_METHODS[0]);
    // เติมเช็คเดิมให้ — แก้แค่เลขที่ที่กรอกผิดได้โดยไม่ต้องพิมพ์ธนาคารใหม่
    const c = parseCheque(p.chequeDetail);
    setBank(c.bank);
    setChequeNo(c.no);
    setChequeDate(c.date);
  }

  const chequeMissing = method === "เช็ค" && (!bank.trim() || !chequeNo.trim());
  /** วิธีเดิม (ไม่ใช่เช็ค) = ไม่มีอะไรให้บันทึก — บอกบนจอ ไม่ใช่แค่ title ที่มือถือมองไม่เห็น (D83) */
  const unchanged = (p: SalesPayment) => method === p.method && method !== "เช็ค";

  function save(p: SalesPayment) {
    const chequeDetail = method === "เช็ค" ? chequeText(bank, chequeNo, chequeDate) : "";
    run(
      () => editPaymentMethodAction({ quNo: order.quNo, seq: p.seq, method, chequeDetail }),
      "",
      (data) => {
        showToast({ ok: true, text: editPaymentDoneText(method, data as EditPaymentResult) });
        setEditing(null);
        setJustEdited(p.seq);
        load();
        onChanged();
      },
    );
  }

  async function reprint(p: SalesPayment) {
    const doc = receiptDocFor(p.label, order);
    if (!doc) return;
    const w = openPrintWindow(); // เปิดก่อน await กัน popup blocker
    if (!w) { showToast({ ok: false, text: "เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — โปรดอนุญาต popup แล้วลองใหม่" }); return; }
    try {
      const [items, fresh] = await Promise.all([getOrderItemsAction(order.quNo), getOrderPaymentsAction(order.quNo)]);
      printSalesDocs(company, { ...(order as OrderLike), payments: fresh }, items, [doc], w);
    } catch {
      w.close();
      showToast({ ok: false, text: `โหลดข้อมูลเอกสารของ ${order.quNo} ไม่สำเร็จ — ลองกดพิมพ์ใหม่อีกครั้ง` });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4"
      // D73 — ปิดเมื่อกดลงที่พื้นหลังเท่านั้น (ลากคลุมข้อความแล้วปล่อยนอกกล่องต้องไม่ปิด)
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <EscToClose onClose={onClose} />
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">แก้วิธีชำระ</h2>
          <button onClick={onClose} aria-label="ปิด" className="text-2xl leading-none text-faint hover:text-crit">&times;</button>
        </div>
        <div className="mb-3 rounded bg-raised p-2 text-sm text-muted">
          {order.quNo} · {order.customerName}
          <br />
          <span className="text-xs">แก้ได้เฉพาะวิธีชำระ — ยอด VAT และเลขเอกสารไม่เปลี่ยน · บิลรายรับย้ายบัญชีตามวิธีใหม่ให้เอง</span>
        </div>

        {err ? (
          <LoadError err onRetry={load} what="การรับเงินของออเดอร์" />
        ) : payments === null ? (
          <div className="py-6 text-center text-faint">กำลังโหลด…</div>
        ) : payments.length === 0 ? (
          <div className="py-6 text-center text-sm text-faint">
            ไม่พบประวัติการรับเงินของออเดอร์นี้ (ออเดอร์เก่าที่ไม่มีบิลรายรับให้ย้ายข้อมูลมา) — แก้บัญชีของบิลได้ที่ บัญชี → ค้นบิล
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.seq} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-ink">ครั้งที่ {p.seq} · {p.label} · ฿{fmt(p.amount)}</div>
                    <div className="text-xs text-faint">{p.docNo || "ไม่มีเลขเอกสาร"}{p.docDate ? ` · ${formatThaiDate(p.docDate)}` : ""}</div>
                    <div className="mt-0.5 text-muted">วิธีชำระ: <b>{p.method || "ไม่ระบุ"}</b></div>
                    {p.chequeDetail && <div className="text-xs text-faint">{p.chequeDetail}</div>}
                  </div>
                  {editing !== p.seq && (
                    <div className="flex gap-1.5">
                      {justEdited === p.seq && receiptDocFor(p.label, order) && (
                        <button onClick={() => reprint(p)} className="rounded border border-brand bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand hover:opacity-90">
                          พิมพ์ใบนี้ใหม่
                        </button>
                      )}
                      <button onClick={() => startEdit(p)} className="rounded border border-line px-2.5 py-1.5 text-xs font-semibold text-muted hover:bg-raised hover:text-ink">
                        แก้
                      </button>
                    </div>
                  )}
                </div>

                {editing === p.seq && (
                  <div className="mt-2 space-y-2 border-t border-line pt-2">
                    <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-lg border border-line p-2 outline-none focus:border-brand">
                      {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
                    </select>
                    {method === "เช็ค" && (
                      <div className="space-y-2 rounded border border-line bg-raised p-2">
                        <TextInput placeholder="ธนาคาร (เช่น กสิกรไทย)" value={bank} onChange={(e) => setBank(e.target.value)} />
                        <TextInput placeholder="เลขที่เช็ค" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
                        <input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} className="w-full rounded-lg border border-line p-2 text-sm" />
                      </div>
                    )}
                    {chequeMissing && <p className="text-xs text-warn">ยังกรอกไม่ครบ: ธนาคาร · เลขที่เช็ค</p>}
                    {unchanged(p) && <p className="text-xs text-faint">เลือกวิธีชำระใหม่ก่อน ถึงจะบันทึกได้</p>}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditing(null)} className="rounded border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:bg-raised">เลิกแก้</button>
                      <button
                        onClick={() => save(p)}
                        // เช็คเดิม → เช็คเดิมได้ (แก้เลขที่/ธนาคารที่กรอกผิด) · วิธีอื่นต้องเปลี่ยนก่อนถึงบันทึก
                        disabled={pending || chequeMissing || unchanged(p)}
                        className="rounded bg-brand px-3 py-1.5 text-xs font-bold text-on-brand hover:opacity-90 disabled:opacity-50"
                      >
                        {pending ? "กำลังบันทึก…" : "บันทึกวิธีชำระ"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
