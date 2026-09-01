"use client";

import { useEffect, useRef, useState } from "react";
import type { SalesBoot, OrderRow, OrderItem } from "./types";
import { Card, Msg, StatusBadge, TextInput, useSaver, fmt, LoadError } from "./ui";
import { todayISO } from "./ui";
import { getOrdersAction, getOrderItemsAction, processOrderActionAction, cancelOrderAction, voidDepositInvoiceAction } from "../actions";
import type { OrderAction, ActionPayload } from "@/lib/sales/orders";
import { printSalesDocs, printQuotation, openPrintWindow, type OrderLike } from "./print";
import { roundTo2 } from "@/lib/sales/calc";
import {
  IconBox, IconClock, IconDoc, IconEdit, IconMoney, IconPrint, IconRefresh, IconSearch, IconTrash,
} from "@/lib/shared/icons";
import { can, toRole } from "@/lib/shared/roles";
import { cancelLockedText } from "@/lib/production/monthClose";

const itemsCache = new Map<string, OrderItem[]>();
async function loadItems(quNo: string): Promise<OrderItem[]> {
  if (itemsCache.has(quNo)) return itemsCache.get(quNo)!;
  const its = await getOrderItemsAction(quNo);
  itemsCache.set(quNo, its);
  return its;
}

export function OrdersTab({ boot, canWrite, onEdit, active }: { boot: SalesBoot; canWrite: boolean; onEdit: (o: OrderRow) => void; active: boolean }) {
  // 🚨 ยกเลิกออเดอร์ / ยกเลิกใบแจ้งหนี้มัดจำ = **void ใบกำกับภาษีที่ออกไปแล้ว + คืนสต็อก**
  //    จึงเป็นระดับหัวหน้า ไม่ใช่ทุกคนที่ทำงานขายได้ (ผู้ใช้ตัดสิน D85)
  //    ★ แยกจาก canWrite โดยตั้งใจ — RPC ฝั่ง DB ก็เช็ค sales.config ซ้ำอีกชั้น
  const canCancel = can(toRole(boot.role), "sales.config");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ order: OrderRow; action: OrderAction } | null>(null);
  const { msg, setMsg } = useSaver();
  const [err, setErr] = useState(false);

  const firstLoad = useRef(true);
  function refresh() {
    itemsCache.clear(); // ล้าง cache รายการสินค้า → พิมพ์หลังแก้ใบเสนอราคาได้รายการล่าสุด (#9)
    if (firstLoad.current) setLoading(true);
    setErr(false);
    getOrdersAction()
      .then((data) => {
        setOrders(data);
        setLoading(false);
        firstLoad.current = false;
      })
      .catch(() => {
        // 🚨 D89 — ต้องจบสถานะโหลดเสมอ ไม่งั้นค้างที่ "กำลังโหลด…" ตลอดกาล
        setErr(true);
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
    if (o.status === "รอชำระมัดจำ") docs = ["invoice-deposit"]; // D45 — ใบแจ้งหนี้ค่ามัดจำ
    else if (o.deposit > 0) docs = ["invoice", "tax-invoice-deposit"];
    else if (o.status === "รอชำระเงิน (จ่ายเต็ม)") docs = ["invoice-only"];
    else docs = ["invoice"];
    printSalesDocs(boot.company, o as OrderLike, items, docs, w);
  }
  async function doPrintClosed(o: OrderRow) {
    const w = openPrintWindow();
    if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — โปรดอนุญาต popup แล้วลองใหม่"); return; }
    const items = await loadItems(o.quNo);
    let docs: string[];
    if (o.deposit > 0) docs = ["tax-invoice-balance"];
    else if (o.dueDate === "" && o.deposit === 0) docs = ["tax-invoice-receipt-do"];
    else docs = ["tax-invoice-receipt"];
    printSalesDocs(boot.company, o as OrderLike, items, docs, w);
  }
  async function doReprintQuotation(o: OrderRow) {
    const w = openPrintWindow();
    if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — โปรดอนุญาต popup แล้วลองใหม่"); return; }
    const items = await loadItems(o.quNo);
    let estDiscount = roundTo2(o.subTotal + o.vatAmount - o.grandTotal);
    if (Math.abs(estDiscount) < 0.1) estDiscount = 0;
    printQuotation(boot.company, {
      quNo: o.quNo,
      date: o.timestamp,
      quExp: "-",
      customerName: o.customerName,
      customerAddress: o.customerAddress,
      customerTaxId: o.customerTaxId,
      customerBranch: o.customerBranch,
      creditTerm: boot.customers.find((c) => c.id === o.customerId)?.creditTerm ?? 0,
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
      saleName: o.saleName,
    }, w);
  }

  function voidDepositInvoice(o: OrderRow) {
    if (!confirm(`ยกเลิกใบแจ้งหนี้มัดจำ ${o.depInvNo || ""} ของ ${o.quNo}?\nออเดอร์จะกลับไปสถานะ "รอคอนเฟิร์ม" (แก้ใบเสนอราคาต่อได้) · เลขใบที่ออกไปแล้วถือเป็นยกเลิก`)) return;
    setMsg(null);
    voidDepositInvoiceAction(o.quNo).then((r) => {
      if (r.ok) {
        setMsg({ ok: true, text: `ยกเลิกใบแจ้งหนี้มัดจำของ ${o.quNo} แล้ว` });
        refresh();
      } else setMsg({ ok: false, text: r.error ?? "ยกเลิกไม่สำเร็จ" });
    });
  }

  function cancel(o: OrderRow) {
    if (!confirm(`ยกเลิกออเดอร์ ${o.quNo}? ระบบจะย้อนรายการบัญชี/สต็อกที่เกิดแล้วให้`)) return;
    setMsg(null);
    cancelOrderAction(o.quNo).then((r) => {
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? "ยกเลิกไม่สำเร็จ" }); return; }
      // D91 — ยกเลิกสำเร็จ แต่ถ้าเดือนนั้นปิดบัญชีสรรพสามิตไปแล้ว คู่ จ่าย/รับ จะยังอยู่บนฟอร์ม
      //        🚨 ต้องบอกตรง ๆ พร้อมบอกว่าใครต้องกดอะไรต่อ — ห้ามขึ้นเขียวเฉย ๆ (D83/D88)
      const d = r.data as { excise_locked_months?: string[] } | undefined;
      const locked = cancelLockedText(o.quNo, d?.excise_locked_months ?? []);
      setMsg(locked ? { ok: true, warn: true, text: locked } : { ok: true, text: `ยกเลิก ${o.quNo} แล้ว` });
      refresh();
    });
  }

  // ปุ่มจัดการออเดอร์ (ใช้ร่วมทั้งตาราง desktop และการ์ด mobile)
  // D43: เดิมมีปุ่ม 7 สี (amber/indigo/purple/blue/teal/slate/red) = ตาลาย แยกไม่ออกว่าอันไหนสำคัญ
  // → เหลือ 3 ระดับตามความหมาย: primary (สิ่งที่ควรทำต่อ) · secondary (ทำได้) · danger (ทำลาย)
  const orderActions = (o: OrderRow) => (
    <>
      {canWrite && o.status === "รอคอนเฟิร์ม" && (
        <>
          {/* D45 — เงื่อนไขมัดจำ: ปกติต้องวางบิลค่ามัดจำก่อน ลูกค้าถึงโอน → ปุ่มนี้เด่นสุด */}
          <ActBtn tone={o.isDeposit ? "primary" : "secondary"} icon={<IconDoc size={14} />} onClick={() => setDialog({ order: o, action: "ISSUE_INVOICE_DEPOSIT" })}>ใบแจ้งหนี้มัดจำ</ActBtn>
          <ActBtn tone={o.isDeposit ? "secondary" : "primary"} icon={<IconMoney size={14} />} onClick={() => setDialog({ order: o, action: "DEPOSIT_AND_SEND" })}>รับมัดจำ &amp; ส่งคลัง</ActBtn>
          <ActBtn tone="secondary" icon={<IconDoc size={14} />} onClick={() => setDialog({ order: o, action: "ISSUE_INVOICE_FULL" })}>ใบแจ้งหนี้ (เต็ม)</ActBtn>
          <ActBtn tone="secondary" icon={<IconBox size={14} />} onClick={() => setDialog({ order: o, action: "SEND_TO_WH" })}>ส่งคลัง (เครดิต)</ActBtn>
          <ActBtn tone="secondary" icon={<IconEdit size={14} />} onClick={() => onEdit(o)}>แก้ไข</ActBtn>
        </>
      )}
      {canWrite && o.status === "รอชำระมัดจำ" && (
        <>
          <ActBtn tone="primary" icon={<IconMoney size={14} />} onClick={() => setDialog({ order: o, action: "DEPOSIT_AND_SEND" })}>รับมัดจำ &amp; ส่งคลัง</ActBtn>
          <ActBtn tone="secondary" icon={<IconMoney size={14} />} onClick={() => setDialog({ order: o, action: "FULL_PAYMENT_AND_SEND" })}>รับเต็ม &amp; ส่งคลัง</ActBtn>
          {canCancel && (
            <ActBtn tone="danger" icon={<IconTrash size={14} />} onClick={() => voidDepositInvoice(o)}>ยกเลิกใบแจ้งหนี้มัดจำ</ActBtn>
          )}
        </>
      )}
      {o.status !== "รอคอนเฟิร์ม" && o.status !== "ยกเลิก" && (
        <ActBtn tone="secondary" icon={<IconPrint size={14} />} onClick={() => doPrintFirst(o)}>พิมพ์ชุดแรก</ActBtn>
      )}
      {canWrite && o.status === "รอชำระเงิน (จ่ายเต็ม)" && (
        <ActBtn tone="primary" icon={<IconMoney size={14} />} onClick={() => setDialog({ order: o, action: "FULL_PAYMENT_AND_SEND" })}>รับเต็ม &amp; ส่งคลัง</ActBtn>
      )}
      {o.status === "รอคลังจัดส่ง" && (
        <span className="inline-flex items-center gap-1.5 rounded border border-warn-line bg-warn-bg px-2 py-1 text-[11px] font-medium text-warn">
          <IconClock size={13} />รอคลังแพ็ค
        </span>
      )}
      {canWrite && o.status === "ส่งของแล้วรอชำระยอดค้าง" && (
        <ActBtn tone="primary" icon={<IconMoney size={14} />} onClick={() => setDialog({ order: o, action: "PAY_BALANCE" })}>รับยอดค้าง</ActBtn>
      )}
      {canWrite && o.status.includes("ส่งของแล้วรอชำระเงิน") && (
        <ActBtn tone="primary" icon={<IconMoney size={14} />} onClick={() => setDialog({ order: o, action: "FULL_PAYMENT_LATER" })}>รับเต็มจำนวน</ActBtn>
      )}
      {o.status === "ปิดการขาย" && (
        <ActBtn tone="secondary" icon={<IconPrint size={14} />} onClick={() => doPrintClosed(o)}>พิมพ์ใบกำกับฯ</ActBtn>
      )}
      {canCancel && o.status !== "ยกเลิก" && (
        <ActBtn tone="danger" icon={<IconTrash size={14} />} onClick={() => cancel(o)}>ยกเลิก</ActBtn>
      )}
    </>
  );

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-line p-0.5">
          <button onClick={() => setTab("open")} className={`rounded px-3 py-1.5 text-sm font-semibold transition ${tab === "open" ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"}`}>
            ยังไม่ปิด
          </button>
          <button onClick={() => setTab("closed")} className={`rounded px-3 py-1.5 text-sm font-semibold transition ${tab === "closed" ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"}`}>
            ปิด / ยกเลิก
          </button>
        </div>
        <div className="relative">
          <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <TextInput placeholder="QU / Order / ลูกค้า" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56 pl-8" />
        </div>
        <button onClick={refresh} title="โหลดข้อมูลใหม่" className="flex items-center gap-1.5 rounded border border-line px-2.5 py-2 text-sm text-muted transition hover:bg-raised hover:text-ink">
          <IconRefresh size={15} />รีโหลด
        </button>
        <span className="ml-auto text-xs text-faint">พบ {filtered.length} รายการ</span>
      </div>
      <Msg msg={msg} />

      {loading ? (
        <div className="py-10 text-center text-faint">กำลังโหลด…</div>
      ) : err && filtered.length === 0 ? (
        <LoadError err onRetry={refresh} what="ออเดอร์" />
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-faint">ไม่พบออเดอร์</div>
      ) : (
        <>
          {/* Desktop: ตาราง */}
          <div className="hidden overflow-x-auto md:block">
            <table className="tbl min-w-[820px]">
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>QU / Order</th>
                  <th>ลูกค้า</th>
                  <th className="num">ยอดสุทธิ</th>
                  <th className="num">ค้างชำระ</th>
                  <th className="text-center">สถานะ</th>
                  <th className="text-center" style={{ width: 340 }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.quNo} className="border-b hover:bg-raised">
                    <td className="whitespace-nowrap text-muted">{o.timestamp}</td>
                    <td className="whitespace-nowrap font-medium text-ink">
                      <div className="flex items-center gap-1">
                        {o.quNo}
                        <button onClick={() => doReprintQuotation(o)} title="พิมพ์ใบเสนอราคาซ้ำ" className="rounded border border-line p-1 text-faint hover:text-warn"><IconPrint size={16} /></button>
                      </div>
                      <div className="text-[10px] text-faint">{o.orderNo}</div>
                    </td>
                    <td className="text-ink">{o.customerName}</td>
                    <td className="whitespace-nowrap font-semibold text-brand num">฿{fmt(o.netPayable)}</td>
                    <td className="whitespace-nowrap font-semibold text-crit num">฿{fmt(o.outstandingBalance)}</td>
                    <td className="whitespace-nowrap text-center"><StatusBadge status={o.status} /></td>
                    <td><div className="flex flex-wrap items-center justify-center gap-1">{orderActions(o)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: การ์ด */}
          <div className="space-y-3 md:hidden">
            {filtered.map((o) => (
              <div key={o.quNo} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 font-medium text-ink">
                      {o.quNo}
                      <button onClick={() => doReprintQuotation(o)} title="พิมพ์ใบเสนอราคาซ้ำ" className="rounded border border-line p-1 text-faint hover:text-warn"><IconPrint size={16} /></button>
                    </div>
                    <div className="text-[10px] text-faint">{o.orderNo} · {o.timestamp}</div>
                    <div className="mt-0.5 truncate text-sm text-muted">{o.customerName}</div>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 text-sm">
                  <span className="text-faint">สุทธิ <b className="text-brand">฿{fmt(o.netPayable)}</b></span>
                  {o.outstandingBalance > 0 && <span className="text-faint">ค้าง <b className="text-crit">฿{fmt(o.outstandingBalance)}</b></span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">{orderActions(o)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {dialog && (
        <PaymentDialog
          order={dialog.order}
          action={dialog.action}
          /* หาด้วย customerId — ลูกค้าหลายสาขาชื่อเดียวกันมีเครดิตเทอมคนละค่า (dueDate ผิด) · fallback ชื่อสำหรับออเดอร์เก่าที่ไม่มี id */
          creditDays={
            (boot.customers.find((c) => c.id === dialog.order.customerId) ??
              boot.customers.find((c) => c.name === dialog.order.customerName))?.creditTerm ?? 0
          }
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

// 3 ระดับตามความหมาย — ไม่ใช่ 7 สีสุ่ม (D43)
const ACT_TONES = {
  primary: "border-brand bg-brand text-on-brand hover:opacity-90",   // สิ่งที่ควรทำต่อ
  secondary: "border-line bg-card text-muted hover:bg-raised hover:text-ink", // ทำได้ ไม่เร่ง
  danger: "border-crit-line bg-card text-crit hover:bg-crit-bg",     // ทำลาย/ย้อนกลับไม่ได้
} as const;
function ActBtn({
  tone,
  icon,
  onClick,
  children,
}: {
  tone: keyof typeof ACT_TONES;
  icon?: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  // มือถือ: touch target ≥ 44px (หน้านี้ใช้นอกสถานที่จริง — ไปส่งของ/เก็บเงิน) · desktop คงขนาดเดิม
  return (
    <button
      onClick={onClick}
      className={`inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded border px-3 text-xs font-semibold transition sm:min-h-0 sm:px-2.5 sm:py-1.5 ${ACT_TONES[tone]}`}
    >
      {icon}
      {children}
    </button>
  );
}

const ACTION_TITLES: Record<OrderAction, string> = {
  DEPOSIT_AND_SEND: "รับมัดจำ & ส่งให้คลัง",
  FULL_PAYMENT_AND_SEND: "รับชำระเต็ม & ส่งให้คลัง",
  SEND_TO_WH: "ส่งออเดอร์ให้คลัง (เครดิต)",
  ISSUE_INVOICE_FULL: "ออกใบแจ้งหนี้จ่ายเต็ม",
  ISSUE_INVOICE_DEPOSIT: "ออกใบแจ้งหนี้ค่ามัดจำ",
  PAY_BALANCE: "ชำระยอดค้าง",
  FULL_PAYMENT_LATER: "ชำระเต็มจำนวน",
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
  const isDepositInvoice = action === "ISSUE_INVOICE_DEPOSIT"; // D45 — วางบิลมัดจำ (ยังไม่รับเงิน)
  const needsAmount = action === "DEPOSIT_AND_SEND" || isDepositInvoice;
  const needsMethod = ["DEPOSIT_AND_SEND", "FULL_PAYMENT_AND_SEND", "PAY_BALANCE", "FULL_PAYMENT_LATER"].includes(action);
  const target = order.netPayable || order.grandTotal;
  // ยอดมัดจำ default: ตามเงื่อนไข % ในใบเสนอราคา → ถ้าวางบิลมัดจำไว้แล้วใช้ยอดใบนั้น
  const depPct = order.isDeposit && order.depositPercent > 0 ? order.depositPercent : 50;
  const defaultDeposit = order.depInvAmount > 0 && !isDepositInvoice ? order.depInvAmount : roundTo2((target * depPct) / 100);
  const [amount, setAmount] = useState(needsAmount ? defaultDeposit : target);
  const [depositDays, setDepositDays] = useState(7); // ครบกำหนดชำระมัดจำ (แก้ได้)
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
      creditDays: isDepositInvoice ? depositDays : action === "DEPOSIT_AND_SEND" || action === "SEND_TO_WH" ? creditDays : undefined,
      amount: needsAmount ? amount : action === "PAY_BALANCE" || action === "FULL_PAYMENT_LATER" ? order.outstandingBalance : undefined,
    };
    run(() => processOrderActionAction(order.quNo, action, payload), "", (data) => {
      const d = data as { warning?: string };
      onDone(d.warning ? `บันทึกแล้ว — ${d.warning}` : "อัปเดตสถานะเรียบร้อย");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">{ACTION_TITLES[action]}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-faint hover:text-crit">
            &times;
          </button>
        </div>
        <Msg msg={msg} />
        <div className="space-y-3 text-sm">
          <div className="rounded bg-raised p-2 text-muted">
            {order.quNo} · {order.customerName}
            <br />
            {action === "PAY_BALANCE" || action === "FULL_PAYMENT_LATER" ? (
              <>ยอดที่ต้องชำระ (Net): <b className="text-brand">฿{fmt(order.outstandingBalance)}</b></>
            ) : (
              <>ยอดสุทธิทั้งบิล (Net): <b className="text-brand">฿{fmt(target)}</b></>
            )}
          </div>

          {needsAmount && (
            <label className="block">
              <span className="mb-1 block font-bold text-muted">
                {isDepositInvoice ? `ยอดมัดจำที่เรียกเก็บ${order.isDeposit && order.depositPercent > 0 ? ` (${order.depositPercent}% ตามใบเสนอราคา)` : ""}` : "ยอดเงินมัดจำที่รับ"}
              </span>
              <input type="number" step="0.01" min={0.01} max={target} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} className="w-full rounded-lg border border-line p-2 outline-none focus:border-brand" />
            </label>
          )}

          {isDepositInvoice && (
            <>
              <label className="block">
                <span className="mb-1 block font-bold text-muted">ครบกำหนดชำระมัดจำภายใน (วัน)</span>
                <input type="number" min={0} value={depositDays} onChange={(e) => setDepositDays(Number(e.target.value) || 0)} className="w-full rounded-lg border border-line p-2 outline-none focus:border-brand" />
              </label>
              <div className="rounded border border-line bg-raised p-2 text-xs text-muted">
                ใบนี้เป็น<b>ใบแจ้งหนี้</b> ยังไม่ลงบัญชีรับเงิน — เมื่อลูกค้าโอนแล้วให้กด &ldquo;รับมัดจำ &amp; ส่งคลัง&rdquo; ระบบจะออก<b>ใบกำกับภาษี/ใบเสร็จค่ามัดจำ</b>และลงบัญชีให้
              </div>
            </>
          )}

          {needsMethod && (
            <label className="block">
              <span className="mb-1 block font-bold text-muted">ช่องทางการชำระ</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-lg border border-line p-2 outline-none focus:border-brand">
                <option>โอนเงิน</option>
                <option>เงินสด</option>
                <option>บัตรเครดิต</option>
                <option>เช็ค</option>
              </select>
            </label>
          )}
          {needsMethod && method === "เช็ค" && (
            <div className="space-y-2 rounded border border-line bg-raised p-2">
              <TextInput placeholder="ธนาคาร (เช่น กสิกรไทย)" value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} />
              <TextInput placeholder="เลขที่เช็ค" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
              <input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} className="w-full rounded-lg border border-line p-2 text-sm" />
            </div>
          )}

          {(action === "SEND_TO_WH" || action === "DEPOSIT_AND_SEND") && <div className="text-xs text-faint">เครดิตเทอมลูกค้า: {creditDays} วัน</div>}

          <label className="block">
            <span className="mb-1 block font-bold text-muted">วันที่ออกเอกสาร / วันที่รับเงิน</span>
            <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="w-full rounded-lg border border-line p-2 outline-none focus:border-brand" />
          </label>

          <button onClick={submit} disabled={pending} className="w-full rounded-lg bg-brand py-2 font-bold text-on-brand hover:opacity-90 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}
