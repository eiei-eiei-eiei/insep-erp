"use client";

import { salesProductionText, type SalesProductionText } from "@/lib/sales/productionText";
import { useEffect, useRef, useState } from "react";
import type { WarehouseOrder, StockItem } from "./types";
import { Badge, Card, Combobox, NumInput, Select, TextInput, fmt, useSaver, LoadError } from "./ui";
import { getPendingWarehouseAction, getWarehouseStockAction, confirmFulfillmentAction, manualStockMoveAction } from "../actions";
import { printSalesDocs, type CompanyInfo, type OrderLike } from "./print";
import { can, toRole } from "@/lib/shared/roles";
import { Modal, ModalCancel, todayISO } from "@/lib/shared/ui";
import { useDateFmt } from "@/lib/shared/dateFormatContext";
import { shipDateError, shipDateNote } from "@/lib/sales/backdate";
import { Button, SkeletonCard, SkeletonTable } from "@/lib/shared/page";

export function WarehouseTab({ role, company, active, hasProduction }: { role: string; company: CompanyInfo; active: boolean; hasProduction: boolean }) {
  // D133 — ไม่มีโมดูลผลิต = ประโยคไม่พูดถึงสุรา/ฟอร์ม ภส./โรงกลั่น
  const txt = salesProductionText(hasProduction);
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
      {sub === "orders" ? <PendingOrders canWrite={canWrite} company={company} active={active} txt={txt} /> : <StockPanel canWrite={canWrite} active={active} txt={txt} />}
    </div>
  );
}

function PendingOrders({ canWrite, company, active, txt }: { canWrite: boolean; company: CompanyInfo; active: boolean; txt: SalesProductionText }) {
  const d = useDateFmt();
  const [orders, setOrders] = useState<WarehouseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const { setMsg } = useSaver();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const firstLoad = useRef(true);

  function refresh() {
    if (firstLoad.current) setLoading(true);
    setErr(false);
    getPendingWarehouseAction()
      .then((d) => {
        setOrders(d);
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
  useEffect(() => {
    if (active) refresh();
  }, [active]);

  /**
   * ยืนยันจัดส่ง — กล่องในแอป (ไม่ใช่ window.confirm ที่เบราว์เซอร์บางตัวบล็อกแล้วคืน false เงียบ ๆ · D96)
   * + วันที่ส่งของ (D100 เฟส 3) ที่ลงฟอร์ม ภส. — ลงย้อนหลังได้ ล่วงหน้าไม่ได้
   */
  const [ask, setAsk] = useState<WarehouseOrder | null>(null);
  const [shipDate, setShipDate] = useState(todayISO());
  const shipErr = shipDateError(shipDate, todayISO());
  const shipNote = shipDateNote(shipDate, todayISO(), d.date);

  function openConfirm(o: WarehouseOrder) {
    setShipDate(todayISO());
    setAsk(o);
  }

  function confirmShip(o: WarehouseOrder, date: string) {
    setAsk(null);
    setMsg(null);
    setBusy(o.quNo);
    confirmFulfillmentAction(o.quNo, "warehouse", date).then((r) => {
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

  if (loading) return <SkeletonCard rows={4} cols={5} what="คลัง" />;
  if (err) return <LoadError err onRetry={refresh} what="คิวออเดอร์รอจัดส่ง" />;

  return (
    <div className="space-y-3">
      {ask && (
        // ยืนยันจัดส่ง = ตัดสต็อก (+ลงฟอร์ม ภส.) ห้ามส่ง onSubmit (กฎข้อ 3)
        <Modal
          title={<>ยืนยันจัดส่ง {ask.orderNo}?</>}
          onClose={() => setAsk(null)}
          size="sm"
          footer={
            <>
              <ModalCancel onClick={() => setAsk(null)} />
              <Button
                type="button"
                data-autofocus
                disabled={!!shipErr}
                onClick={() => confirmShip(ask, shipDate)}
                tone="primary"
              >
                ยืนยันจัดส่ง &amp; ตัดสต็อก
              </Button>
            </>
          }
        >
          <div>
            <p className="text-sm text-muted">{txt.shipConfirm}</p>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-bold text-muted">วันที่ส่งของ</span>
              <TextInput type="date" value={shipDate} max={todayISO()} onChange={(e) => setShipDate(e.target.value)} />
            </label>
            {shipErr && <p className="mt-1 text-xs text-crit">{shipErr}</p>}
            {shipNote && <p className="mt-1 text-xs text-warn">{shipNote}</p>}
          </div>
        </Modal>
      )}
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
          <div className="overflow-x-auto">
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
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => printDoc(o)} className="rounded border border-line px-3 py-1.5 text-sm text-muted hover:bg-raised">
              พิมพ์เอกสาร
            </button>
            {canWrite && (
              <Button onClick={() => openConfirm(o)} disabled={busy === o.quNo} tone="primary">
                {busy === o.quNo ? "กำลังตัดสต็อก…" : "ยืนยันจัดส่ง & ตัดสต็อก"}
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function StockPanel({ canWrite, active, txt }: { canWrite: boolean; active: boolean; txt: SalesProductionText }) {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ itemCode: "", actionType: "IN" as "IN" | "OUT" | "ADJUST", qty: 1, refNo: "", remarks: "" });
  const { setMsg } = useSaver();
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState(false);
  const firstLoad = useRef(true);

  function refresh() {
    if (firstLoad.current) setLoading(true);
    setErr(false);
    getWarehouseStockAction()
      .then((d) => {
        setStock(d);
        setLoading(false);
        firstLoad.current = false;
      })
      .catch(() => {
        // 🚨 D89 — สต็อกที่โหลดไม่สำเร็จต้องไม่โชว์เป็น 0 เงียบ ๆ
        setErr(true);
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
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Combobox
              options={general.map((s) => ({ value: s.itemCode, label: `${s.itemCode} | ${s.itemName}` }))}
              value={form.itemCode}
              onChange={(v) => setForm({ ...form, itemCode: v })}
              placeholder="— เลือกสินค้าทั่วไป —"
            />
            <Select value={form.actionType} onChange={(e) => setForm({ ...form, actionType: e.target.value as "IN" | "OUT" | "ADJUST" })}>
              <option value="IN">รับเข้า (IN)</option>
              <option value="OUT">จ่ายออก (OUT)</option>
              <option value="ADJUST">ปรับยอด (ADJUST +/-)</option>
            </Select>
            <NumInput placeholder="จำนวน" value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) || 0 })} />
            <TextInput placeholder="อ้างอิง" value={form.refNo} onChange={(e) => setForm({ ...form, refNo: e.target.value })} />
            <Button onClick={submit} disabled={pending} tone="primary">
              {pending ? "…" : "บันทึก"}
            </Button>
          </div>
          {txt.manualStockNote && <div className="mt-2 text-xs text-faint">{txt.manualStockNote}</div>}
        </Card>
      )}

      <Card title={txt.stockTitle}>
        <TextInput placeholder="ค้นหา" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3 max-w-xs" />
        {loading ? (
          <SkeletonTable rows={5} cols={6} what="ความเคลื่อนไหวสต็อก" />
        ) : err ? (
          <LoadError err onRetry={refresh} what="สต็อก" />
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
