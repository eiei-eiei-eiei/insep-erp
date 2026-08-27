"use client";

import { useEffect, useRef, useState } from "react";
import type { WarehouseOrder, StockItem } from "./types";
import { Badge, Card, Msg, NumInput, Select, TextInput, fmt, useSaver } from "./ui";
import { getPendingWarehouseAction, getWarehouseStockAction, confirmFulfillmentAction, manualStockMoveAction } from "../actions";
import { printSalesDocs, type CompanyInfo, type OrderLike } from "./print";
import { can, toRole } from "@/lib/shared/roles";

export function WarehouseTab({ role, company, active }: { role: string; company: CompanyInfo; active: boolean }) {
  const [sub, setSub] = useState<"orders" | "stock">("orders");
  // ★ ขาย/คลัง เป็นบทบาทเดียวกันแล้ว (D85) — คนที่ออกใบเสนอราคาได้ ก็กดจัดส่งได้
  const canWrite = can(toRole(role), "sales.write");
  return (
    <div>
      <div className="mb-4 flex gap-1">
        <button onClick={() => setSub("orders")} className={`rounded px-3 py-1.5 text-sm font-bold ${sub === "orders" ? "bg-warn-bg text-warn" : "text-faint"}`}>
          ออเดอร์รอจัดส่ง
        </button>
        <button onClick={() => setSub("stock")} className={`rounded px-3 py-1.5 text-sm font-bold ${sub === "stock" ? "bg-warn-bg text-warn" : "text-faint"}`}>
          สต็อกรวม
        </button>
      </div>
      {sub === "orders" ? <PendingOrders canWrite={canWrite} company={company} active={active} /> : <StockPanel canWrite={canWrite} active={active} />}
    </div>
  );
}

function PendingOrders({ canWrite, company, active }: { canWrite: boolean; company: CompanyInfo; active: boolean }) {
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
    printSalesDocs(company, o as OrderLike, o.items, docTypes);
  }

  if (loading) return <div className="py-10 text-center text-faint">กำลังโหลด…</div>;

  return (
    <div className="space-y-3">
      <Msg msg={msg} />
      {orders.length === 0 && <div className="rounded-lg bg-raised py-8 text-center text-sm text-faint">ไม่มีออเดอร์รอจัดส่ง</div>}
      {orders.map((o) => (
        <Card key={o.quNo}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-bold text-ink">
                {o.orderNo} <span className="text-xs font-normal text-faint">({o.quNo})</span>
              </div>
              <div className="text-sm text-muted">{o.customerName}</div>
              <div className="mt-1 text-xs text-faint">{o.customerAddress}</div>
            </div>
            <div className="text-right text-sm">
              <div className="text-faint">ยอดสุทธิ ฿{fmt(o.netPayable)}</div>
              {o.outstandingBalance > 0 && <div className="text-crit">ค้าง ฿{fmt(o.outstandingBalance)}</div>}
            </div>
          </div>
          <table className="tbl mt-3">
            <thead>
              <tr>
                <th>รายการ</th>
                <th className="text-center">จำนวน</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((it, i) => (
                <tr key={i} className="border-t">
                  <td>{it.name}</td>
                  <td className="text-center">{it.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <button onClick={() => printDoc(o)} className="rounded border border-line px-3 py-1.5 text-sm text-muted hover:bg-raised">
              พิมพ์เอกสาร
            </button>
            {canWrite && (
              <button onClick={() => confirm(o)} disabled={busy === o.quNo} className="rounded bg-brand px-4 py-1.5 text-sm font-bold text-on-brand hover:opacity-90 disabled:opacity-50">
                {busy === o.quNo ? "กำลังตัดสต็อก…" : "ยืนยันจัดส่ง & ตัดสต็อก"}
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
            <button onClick={submit} disabled={pending} className="rounded-lg bg-brand px-4 py-2 font-medium text-on-brand hover:opacity-90 disabled:opacity-50">
              {pending ? "…" : "บันทึก"}
            </button>
          </div>
          <div className="mt-2 text-xs text-faint">สุราตัดสต็อกอัตโนมัติจากการขาย (ผ่านแอปผลิต) — ปรับ manual ได้เฉพาะสินค้าทั่วไป</div>
        </Card>
      )}

      <Card title="สต็อกรวม (สุราจากโรงกลั่น + สินค้าทั่วไป)">
        <TextInput placeholder="ค้นหา" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3 max-w-xs" />
        {loading ? (
          <div className="py-8 text-center text-faint">กำลังโหลด…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[560px]">
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อสินค้า</th>
                  <th>ประเภท</th>
                  <th className="num">คงเหลือ</th>
                  <th>หน่วย</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={`${s.category}-${s.itemCode}`} className="border-b">
                    <td className="font-medium text-muted">{s.itemCode}</td>
                    <td>
                      {s.itemName} {s.isLive && <Badge tone="brand">สด</Badge>}
                    </td>
                    <td className="text-faint">{s.category}</td>
                    <td className={`p-2 text-right font-semibold ${s.currentStock <= 0 ? "text-crit" : "text-ink"}`}>{fmt(s.currentStock)}</td>
                    <td className="text-faint">{s.unit}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-faint">
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
