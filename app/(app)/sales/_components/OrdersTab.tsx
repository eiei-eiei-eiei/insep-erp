"use client";

import { useEffect, useRef, useState } from "react";
import type { SalesBoot, OrderRow, OrderItem } from "./types";
import { Card, Msg, StatusBadge, TextInput, useSaver, fmt } from "./ui";
import { todayISO } from "./ui";
import { getOrdersAction, getOrderItemsAction, processOrderActionAction, cancelOrderAction } from "../actions";
import type { OrderAction, ActionPayload } from "@/lib/sales/orders";
import { printSalesDocs, printQuotation, openPrintWindow, type OrderLike } from "./print";
import { roundTo2 } from "@/lib/sales/calc";

const itemsCache = new Map<string, OrderItem[]>();
async function loadItems(quNo: string): Promise<OrderItem[]> {
  if (itemsCache.has(quNo)) return itemsCache.get(quNo)!;
  const its = await getOrderItemsAction(quNo);
  itemsCache.set(quNo, its);
  return its;
}

export function OrdersTab({ boot, canWrite, onEdit, active }: { boot: SalesBoot; canWrite: boolean; onEdit: (o: OrderRow) => void; active: boolean }) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ order: OrderRow; action: OrderAction } | null>(null);
  const { msg, setMsg } = useSaver();

  const firstLoad = useRef(true);
  function refresh() {
    itemsCache.clear(); // ล้าง cache รายการสินค้า → พิมพ์หลังแก้ใบเสนอราคาได้รายการล่าสุด (#9)
    if (firstLoad.current) setLoading(true);
    getOrdersAction().then((data) => {
      setOrders(data);
      setLoading(false);
      firstLoad.current = false;
    });
  }
  // โหลด/รีเฟรชเมื่อเข้าแท็บ (active) — ครอบคลุมกรณีสร้าง/แก้ใบเสนอราคาแล้วกลับมา
  useEffect(() => {
    if (active) refresh();
  }, [active]);

  const filtered = orders
    .filter((o) => (tab === "closed" ? o.status === "ปิดการขาย" || o.status === "ยกเลิก" : o.status !== "ปิดการขาย" && o.status !== "ยกเลิก"))
    .filter((o) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (o.quNo + o.orderNo + o.customerName).toLowerCase().includes(q);
    });

  async function doPrintFirst(o: OrderRow) {
    const w = openPrintWindow(); // เปิดก่อน await กัน popup blocker (มือถือ/iPad)
    if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — โปรดอนุญาต popup แล้วลองใหม่"); return; }
    const items = await loadItems(o.quNo);
    let docs: string[];
    if (o.deposit > 0) docs = ["invoice", "tax-invoice-deposit"];
    else if (o.status === "รอชำระเงิน (จ่ายเต็ม)") docs = ["invoice-only"];
    else docs = ["invoice"];
    printSalesDocs(o as OrderLike, items, docs, w);
  }
  async function doPrintClosed(o: OrderRow) {
    const w = openPrintWindow();
    if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — โปรดอนุญาต popup แล้วลองใหม่"); return; }
    const items = await loadItems(o.quNo);
    let docs: string[];
    if (o.deposit > 0) docs = ["tax-invoice-balance"];
    else if (o.dueDate === "" && o.deposit === 0) docs = ["tax-invoice-receipt-do"];
    else docs = ["tax-invoice-receipt"];
    printSalesDocs(o as OrderLike, items, docs, w);
  }
  async function doReprintQuotation(o: OrderRow) {
    const w = openPrintWindow();
    if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — โปรดอนุญาต popup แล้วลองใหม่"); return; }
    const items = await loadItems(o.quNo);
    let estDiscount = roundTo2(o.subTotal + o.vatAmount - o.grandTotal);
    if (Math.abs(estDiscount) < 0.1) estDiscount = 0;
    printQuotation({
      quNo: o.quNo,
      date: o.timestamp,
      quExp: "-",
      customerName: o.customerName,
      customerAddress: o.customerAddress,
      customerTaxId: o.customerTaxId,
      customerBranch: o.customerBranch,
      creditTerm: 0,
      items,
      subTotal: o.subTotal,
      discount: estDiscount > 0 ? estDiscount : 0,
      subDiscount: roundTo2(o.subTotal - (estDiscount > 0 ? estDiscount : 0)),
      vat: o.vatAmount,
      grandTotal: o.grandTotal,
      whtPercent: o.whtPercent,
      whtAmount: o.whtAmount,
      netPayable: o.netPayable,
      remarks: o.remarks,
      saleName: "",
    }, w);
  }

  function cancel(o: OrderRow) {
    if (!confirm(`ยกเลิกออเดอร์ ${o.quNo}? ระบบจะย้อนรายการบัญชี/สต็อกที่เกิดแล้วให้`)) return;
    setMsg(null);
    cancelOrderAction(o.quNo).then((r) => {
      if (r.ok) {
        setMsg({ ok: true, text: `ยกเลิก ${o.quNo} แล้ว` });
        refresh();
      } else setMsg({ ok: false, text: r.error ?? "ยกเลิกไม่สำเร็จ" });
    });
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <button onClick={() => setTab("open")} className={`rounded px-3 py-1.5 text-sm font-bold ${tab === "open" ? "bg-amber-100 text-amber-700" : "text-slate-500"}`}>
            🟠 ยังไม่ปิด
          </button>
          <button onClick={() => setTab("closed")} className={`rounded px-3 py-1.5 text-sm font-bold ${tab === "closed" ? "bg-green-100 text-green-700" : "text-slate-500"}`}>
            ✅ ปิด/ยกเลิก
          </button>
        </div>
        <TextInput placeholder="🔍 QU / Order / ลูกค้า" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        <button onClick={refresh} className="rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
          🔄 รีโหลด
        </button>
        <span className="ml-auto text-xs text-slate-500">พบ {filtered.length} รายการ</span>
      </div>
      <Msg msg={msg} />

      {loading ? (
        <div className="py-10 text-center text-slate-400">กำลังโหลด…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="p-2">วันที่</th>
                <th className="p-2">QU / Order</th>
                <th className="p-2">ลูกค้า</th>
                <th className="p-2 text-right">ยอดสุทธิ</th>
                <th className="p-2 text-right">ค้างชำระ</th>
                <th className="p-2 text-center">สถานะ</th>
                <th className="p-2 text-center" style={{ width: 340 }}>
                  จัดการ
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.quNo} className="border-b hover:bg-slate-50">
                  <td className="whitespace-nowrap p-2 text-slate-600">{o.timestamp}</td>
                  <td className="whitespace-nowrap p-2 font-medium text-slate-800">
                    <div className="flex items-center gap-1">
                      {o.quNo}
                      <button onClick={() => doReprintQuotation(o)} title="พิมพ์ใบเสนอราคาซ้ำ" className="rounded border border-slate-200 p-1 text-slate-500 hover:text-amber-600">
                        🖨️
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-400">{o.orderNo}</div>
                  </td>
                  <td className="p-2 text-slate-800">{o.customerName}</td>
                  <td className="whitespace-nowrap p-2 text-right font-semibold text-blue-600">฿{fmt(o.netPayable)}</td>
                  <td className="whitespace-nowrap p-2 text-right font-semibold text-red-500">฿{fmt(o.outstandingBalance)}</td>
                  <td className="whitespace-nowrap p-2 text-center">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      {canWrite && o.status === "รอคอนเฟิร์ม" && (
                        <>
                          <ActBtn color="amber" onClick={() => setDialog({ order: o, action: "DEPOSIT_AND_SEND" })}>
                            💰 มัดจำ&ส่งคลัง
                          </ActBtn>
                          <ActBtn color="indigo" onClick={() => setDialog({ order: o, action: "ISSUE_INVOICE_FULL" })}>
                            📄 ใบแจ้งหนี้(เต็ม)
                          </ActBtn>
                          <ActBtn color="purple" onClick={() => setDialog({ order: o, action: "SEND_TO_WH" })}>
                            📦 ส่งคลัง(เครดิต)
                          </ActBtn>
                          <ActBtn color="slate" onClick={() => onEdit(o)}>
                            ✏️ แก้ไข
                          </ActBtn>
                        </>
                      )}
                      {o.status !== "รอคอนเฟิร์ม" && o.status !== "ยกเลิก" && (
                        <ActBtn color="slate" onClick={() => doPrintFirst(o)}>
                          🖨️ ชุดแรก
                        </ActBtn>
                      )}
                      {canWrite && o.status === "รอชำระเงิน (จ่ายเต็ม)" && (
                        <ActBtn color="blue" onClick={() => setDialog({ order: o, action: "FULL_PAYMENT_AND_SEND" })}>
                          💳 รับเต็ม&ส่งคลัง
                        </ActBtn>
                      )}
                      {o.status === "รอคลังจัดส่ง" && <span className="rounded bg-orange-50 px-2 py-1 text-[10px] text-orange-600">⏳ รอคลังแพ็ค</span>}
                      {canWrite && o.status === "ส่งของแล้วรอชำระยอดค้าง" && (
                        <ActBtn color="blue" onClick={() => setDialog({ order: o, action: "PAY_BALANCE" })}>
                          💳 รับยอดค้าง
                        </ActBtn>
                      )}
                      {canWrite && o.status.includes("ส่งของแล้วรอชำระเงิน") && (
                        <ActBtn color="blue" onClick={() => setDialog({ order: o, action: "FULL_PAYMENT_LATER" })}>
                          💳 รับเต็มจำนวน
                        </ActBtn>
                      )}
                      {o.status === "ปิดการขาย" && (
                        <ActBtn color="teal" onClick={() => doPrintClosed(o)}>
                          🖨️ ใบกำกับฯ
                        </ActBtn>
                      )}
                      {canWrite && boot.role === "main" && o.status !== "ยกเลิก" && (
                        <ActBtn color="red" onClick={() => cancel(o)}>
                          🗑️ ยกเลิก
                        </ActBtn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    ไม่พบออเดอร์
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <PaymentDialog
          order={dialog.order}
          action={dialog.action}
          creditDays={boot.customers.find((c) => c.name === dialog.order.customerName)?.creditTerm ?? 0}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMsg({ ok: true, text });
            refresh();
          }}
        />
      )}
    </Card>
  );
}

const COLORS: Record<string, string> = {
  amber: "bg-amber-500 hover:bg-amber-600",
  indigo: "bg-indigo-500 hover:bg-indigo-600",
  purple: "bg-purple-500 hover:bg-purple-600",
  slate: "bg-slate-500 hover:bg-slate-600",
  blue: "bg-blue-600 hover:bg-blue-700",
  teal: "bg-teal-700 hover:bg-teal-800",
  red: "bg-red-500 hover:bg-red-600",
};
function ActBtn({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium text-white shadow-sm transition ${COLORS[color]}`}>
      {children}
    </button>
  );
}

const ACTION_TITLES: Record<OrderAction, string> = {
  DEPOSIT_AND_SEND: "💰 รับมัดจำ & ส่งให้คลัง",
  FULL_PAYMENT_AND_SEND: "💳 รับชำระเต็ม & ส่งให้คลัง",
  SEND_TO_WH: "📦 ส่งออเดอร์ให้คลัง (เครดิต)",
  ISSUE_INVOICE_FULL: "📄 ออกใบแจ้งหนี้จ่ายเต็ม",
  PAY_BALANCE: "💳 ชำระยอดค้าง",
  FULL_PAYMENT_LATER: "💳 ชำระเต็มจำนวน",
};

function PaymentDialog({
  order,
  action,
  creditDays,
  onClose,
  onDone,
}: {
  order: OrderRow;
  action: OrderAction;
  creditDays: number;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const needsAmount = action === "DEPOSIT_AND_SEND";
  const needsMethod = ["DEPOSIT_AND_SEND", "FULL_PAYMENT_AND_SEND", "PAY_BALANCE", "FULL_PAYMENT_LATER"].includes(action);
  const target = order.netPayable || order.grandTotal;
  const [amount, setAmount] = useState(needsAmount ? roundTo2(target * 0.5) : target);
  const [method, setMethod] = useState("โอนเงิน");
  const [docDate, setDocDate] = useState(todayISO());
  const [chequeBank, setChequeBank] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const { pending, msg, run } = useSaver();

  function submit() {
    let chequeDetails = "";
    if (needsMethod && method === "เช็ค") {
      let bank = chequeBank || "-";
      if (!bank.includes("ธนาคาร") && bank !== "-") bank = "ธนาคาร" + bank;
      chequeDetails = `${bank} เลขที่เช็ค : ${chequeNo || "-"} ลงวันที่ ${chequeDate || "-"}`;
    }
    const payload: ActionPayload = {
      docDate,
      method: needsMethod ? method : undefined,
      chequeDetails: chequeDetails || undefined,
      creditDays: action === "DEPOSIT_AND_SEND" || action === "SEND_TO_WH" ? creditDays : undefined,
      amount: needsAmount ? amount : action === "PAY_BALANCE" || action === "FULL_PAYMENT_LATER" ? order.outstandingBalance : undefined,
    };
    run(() => processOrderActionAction(order.quNo, action, payload), "", (data) => {
      const d = data as { warning?: string };
      onDone(d.warning ? `บันทึกแล้ว — ${d.warning}` : "อัปเดตสถานะเรียบร้อย");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">{ACTION_TITLES[action]}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-red-500">
            &times;
          </button>
        </div>
        <Msg msg={msg} />
        <div className="space-y-3 text-sm">
          <div className="rounded bg-slate-50 p-2 text-slate-700">
            {order.quNo} · {order.customerName}
            <br />
            {action === "PAY_BALANCE" || action === "FULL_PAYMENT_LATER" ? (
              <>ยอดที่ต้องชำระ (Net): <b className="text-blue-600">฿{fmt(order.outstandingBalance)}</b></>
            ) : (
              <>ยอดสุทธิทั้งบิล (Net): <b className="text-blue-600">฿{fmt(target)}</b></>
            )}
          </div>

          {needsAmount && (
            <label className="block">
              <span className="mb-1 block font-bold text-slate-600">ยอดเงินมัดจำที่รับ</span>
              <input type="number" step="0.01" min={0.01} max={target} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} className="w-full rounded-lg border border-slate-300 p-2 outline-none focus:border-amber-500" />
            </label>
          )}

          {needsMethod && (
            <label className="block">
              <span className="mb-1 block font-bold text-slate-600">ช่องทางการชำระ</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-lg border border-slate-300 p-2 outline-none focus:border-amber-500">
                <option>โอนเงิน</option>
                <option>เงินสด</option>
                <option>บัตรเครดิต</option>
                <option>เช็ค</option>
              </select>
            </label>
          )}
          {needsMethod && method === "เช็ค" && (
            <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
              <TextInput placeholder="ธนาคาร (เช่น กสิกรไทย)" value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} />
              <TextInput placeholder="เลขที่เช็ค" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
              <input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} className="w-full rounded-lg border border-slate-300 p-2 text-sm" />
            </div>
          )}

          {(action === "SEND_TO_WH" || action === "DEPOSIT_AND_SEND") && <div className="text-xs text-slate-500">เครดิตเทอมลูกค้า: {creditDays} วัน</div>}

          <label className="block">
            <span className="mb-1 block font-bold text-slate-600">วันที่ออกเอกสาร / วันที่รับเงิน</span>
            <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="w-full rounded-lg border border-slate-300 p-2 outline-none focus:border-amber-500" />
          </label>

          <button onClick={submit} disabled={pending} className="w-full rounded-lg bg-slate-800 py-2 font-bold text-white hover:bg-slate-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}
