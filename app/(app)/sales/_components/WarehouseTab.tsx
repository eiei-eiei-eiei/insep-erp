"use client";

import { useEffect, useRef, useState } from "react";
import type { WarehouseOrder, StockItem } from "./types";
import { Card, Msg, NumInput, Select, TextInput, useSaver, fmt } from "./ui";
import { getPendingWarehouseAction, getWarehouseStockAction, confirmFulfillmentAction, manualStockMoveAction } from "../actions";
import { printSalesDocs, type OrderLike } from "./print";

export function WarehouseTab({ role, active }: { role: string; active: boolean }) {
  const [sub, setSub] = useState<"orders" | "stock">("orders");
  const canWrite = role === "main" || role === "warehouse";
  return (
    <div>
      <div className="mb-4 flex gap-1">
        <button onClick={() => setSub("orders")} className={`rounded px-3 py-1.5 text-sm font-bold ${sub === "orders" ? "bg-amber-100 text-amber-700" : "text-slate-500"}`}>
          📦 ออเดอร์รอจัดส่ง
        </button>
        <button onClick={() => setSub("stock")} className={`rounded px-3 py-1.5 text-sm font-bold ${sub === "stock" ? "bg-amber-100 text-amber-700" : "text-slate-500"}`}>
          📊 สต็อกรวม
        </button>
      </div>
      {sub === "orders" ? <PendingOrders canWrite={canWrite} active={active} /> : <StockPanel canWrite={canWrite} active={active} />}
    </div>
  );
}

function PendingOrders({ canWrite, active }: { canWrite: boolean; active: boolean }) {
  const [orders, setOrders] = useState<WarehouseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const { msg, setMsg } = useSaver();
  const [busy, setBusy] = useState<string | null>(null);
  const firstLoad = useRef(true);

  function refresh() {
    if (firstLoad.current) setLoading(true);
    getPendingWarehouseAction().then((d) => {
      setOrders(d);
      setLoading(false);
      firstLoad.current = false;
    });
  }
  useEffect(() => {
    if (active) refresh();
  }, [active]);

  function confirm(o: WarehouseOrder) {
    if (!window.confirm(`ยืนยันจัดส่ง ${o.orderNo}? ระบบจะตัดสต็อกทันที`)) return;
    setMsg(null);
    setBusy(o.quNo);
    confirmFulfillmentAction(o.quNo, "warehouse").then((r) => {
      setBusy(null);
      if (r.ok) {
        setMsg({ ok: true, text: `จัดส่ง ${o.orderNo} + ตัดสต็อกเรียบร้อย` });
        refresh();
      } else setMsg({ ok: false, text: r.error ?? "จัดส่งไม่สำเร็จ" });
    });
  }

  function printDoc(o: WarehouseOrder) {
    const docTypes = o.docToPrint ? o.docToPrint.split(",") : ["invoice"];
    printSalesDocs(o as OrderLike, o.items, docTypes);
  }

  if (loading) return <div className="py-10 text-center text-slate-400">กำลังโหลด…</div>;

  return (
    <div className="space-y-3">
      <Msg msg={msg} />
      {orders.length === 0 && <div className="rounded-lg bg-slate-50 py-8 text-center text-sm text-slate-400">ไม่มีออเดอร์รอจัดส่ง</div>}
      {orders.map((o) => (
        <Card key={o.quNo}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-bold text-slate-800">
                {o.orderNo} <span className="text-xs font-normal text-slate-400">({o.quNo})</span>
              </div>
              <div className="text-sm text-slate-600">{o.customerName}</div>
              <div className="mt-1 text-xs text-slate-500">{o.customerAddress}</div>
            </div>
            <div className="text-right text-sm">
              <div className="text-slate-500">ยอดสุทธิ ฿{fmt(o.netPayable)}</div>
              {o.outstandingBalance > 0 && <div className="text-red-500">ค้าง ฿{fmt(o.outstandingBalance)}</div>}
            </div>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="p-1 text-left">รายการ</th>
                <th className="p-1 text-center">จำนวน</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((it, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1">{it.name}</td>
                  <td className="p-1 text-center">{it.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <button onClick={() => printDoc(o)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
              🖨️ พิมพ์เอกสาร
            </button>
            {canWrite && (
              <button onClick={() => confirm(o)} disabled={busy === o.quNo} className="rounded bg-teal-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50">
                {busy === o.quNo ? "กำลังตัดสต็อก…" : "✅ ยืนยันจัดส่ง & ตัดสต็อก"}
              </button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function StockPanel({ canWrite, active }: { canWrite: boolean; active: boolean }) {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ itemCode: "", actionType: "IN" as "IN" | "OUT" | "ADJUST", qty: 1, refNo: "", remarks: "" });
  const { msg, setMsg } = useSaver();
  const [pending, setPending] = useState(false);
  const firstLoad = useRef(true);

  function refresh() {
    if (firstLoad.current) setLoading(true);
    getWarehouseStockAction().then((d) => {
      setStock(d);
      setLoading(false);
      firstLoad.current = false;
    });
  }
  useEffect(() => {
    if (active) refresh();
  }, [active]);

  const general = stock.filter((s) => !s.isLive);
  const filtered = stock.filter((s) => !search || (s.itemCode + s.itemName + s.category).toLowerCase().includes(search.toLowerCase()));

  function submit() {
    if (!form.itemCode || !form.qty) return setMsg({ ok: false, text: "เลือกสินค้า + ระบุจำนวน" });
    setMsg(null);
    setPending(true);
    manualStockMoveAction(form, "warehouse").then((r) => {
      setPending(false);
      if (r.ok) {
        const d = r.data as { newStock: number };
        setMsg({ ok: true, text: `อัปเดตยอดคงเหลือเป็น ${d.newStock}` });
        setForm({ itemCode: "", actionType: "IN", qty: 1, refNo: "", remarks: "" });
        refresh();
      } else setMsg({ ok: false, text: r.error ?? "ปรับสต็อกไม่สำเร็จ" });
    });
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <Card title="ปรับสต็อกทั่วไป (manual)">
          <Msg msg={msg} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Select value={form.itemCode} onChange={(e) => setForm({ ...form, itemCode: e.target.value })}>
              <option value="">— เลือกสินค้าทั่วไป —</option>
              {general.map((s) => (
                <option key={s.itemCode} value={s.itemCode}>
                  {s.itemCode} | {s.itemName}
                </option>
              ))}
            </Select>
            <Select value={form.actionType} onChange={(e) => setForm({ ...form, actionType: e.target.value as "IN" | "OUT" | "ADJUST" })}>
              <option value="IN">รับเข้า (IN)</option>
              <option value="OUT">จ่ายออก (OUT)</option>
              <option value="ADJUST">ปรับยอด (ADJUST +/-)</option>
            </Select>
            <NumInput placeholder="จำนวน" value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) || 0 })} />
            <TextInput placeholder="อ้างอิง" value={form.refNo} onChange={(e) => setForm({ ...form, refNo: e.target.value })} />
            <button onClick={submit} disabled={pending} className="rounded-lg bg-slate-800 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50">
              {pending ? "…" : "บันทึก"}
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-400">สุราตัดสต็อกอัตโนมัติจากการขาย (ผ่านแอปผลิต) — ปรับ manual ได้เฉพาะสินค้าทั่วไป</div>
        </Card>
      )}

      <Card title="สต็อกรวม (สุรา 🏭 + ทั่วไป)">
        <TextInput placeholder="🔍 ค้นหา" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3 max-w-xs" />
        {loading ? (
          <div className="py-8 text-center text-slate-400">กำลังโหลด…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-slate-100 text-xs text-slate-600">
                <tr>
                  <th className="p-2">รหัส</th>
                  <th className="p-2">ชื่อสินค้า</th>
                  <th className="p-2">ประเภท</th>
                  <th className="p-2 text-right">คงเหลือ</th>
                  <th className="p-2">หน่วย</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={`${s.category}-${s.itemCode}`} className="border-b">
                    <td className="p-2 font-medium text-slate-700">{s.itemCode}</td>
                    <td className="p-2">
                      {s.itemName} {s.isLive && <span className="text-[10px] text-amber-600">🏭 Live</span>}
                    </td>
                    <td className="p-2 text-slate-500">{s.category}</td>
                    <td className={`p-2 text-right font-semibold ${s.currentStock <= 0 ? "text-red-500" : "text-slate-800"}`}>{fmt(s.currentStock)}</td>
                    <td className="p-2 text-slate-500">{s.unit}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">
                      ไม่พบสินค้า
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
