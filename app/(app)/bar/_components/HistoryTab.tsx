"use client";

import { Fragment, useEffect, useState } from "react";
import type { BarBoot } from "../data";
import type { CartLine } from "@/lib/bar/types";
import { barTotals } from "@/lib/bar/totals";
import { buildReceipt } from "@/lib/bar/receipt";
import { Card, Msg, TextInput, Field, Badge, Empty, fmt, useSaver, useConfirm, todayISO } from "@/lib/shared/ui";
import { searchSalesAction, issueReceiptAction, voidSaleAction, voidLineAction } from "../actions";

type SaleRow = {
  sale_no: string;
  status: "เปิดอยู่" | "ปกติ" | "ยกเลิก";
  tab_name: string | null;
  customer_id: string | null;
  channel: string;
  opened_at: string;
  closed_at: string | null;
  business_date: string | null;
  method: string | null;
  sub_total: number;
  discount: number;
  rounding: number;
  grand_total: number;
  rcpt_no: string | null;
};

type LineRow = {
  sale_no: string;
  line_no: number;
  menu_id: string | null;
  menu_name: string;
  qty: number;
  price: number;
  line_discount: number;
  is_comp: boolean;
  amount: number;
  voided_at: string | null;
};

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/**
 * ประวัติบิล (D96)
 *
 * ── สิ่งที่ทำได้ตามสถานะบิล (กติกาข้อ D ของแผน) ──────────────────────────
 * · ยังไม่ออกใบเสร็จ + ยังไม่ลงบัญชี → ยกเลิกรายการทีละแถวได้
 * · 🚨 ออกใบเสร็จแล้ว **หรือ** ลงบัญชีแล้ว → DB บล็อก · ต้องยกเลิกทั้งบิลแล้วออกใหม่
 *   หน้าจอขึ้นปุ่มเทาพร้อมบอกว่าต้องกดอะไรแทน (ซ่อนปุ่มแย่กว่าปุ่มเทา · D86)
 */
export function HistoryTab({ boot, onReload }: { boot: BarBoot; onReload: () => Promise<void> }) {
  const { msg, setMsg } = useSaver();
  const { confirmNode, ask } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState("");
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function search() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await searchSalesAction({ from, to, q });
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "ค้นไม่สำเร็จ" });
        return;
      }
      const d = r.data as { sales: SaleRow[]; lines: LineRow[] };
      setSales(d.sales);
      setLines(d.lines);
      setLoaded(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void search();
    // โหลดครั้งแรกครั้งเดียว — หลังจากนั้นผู้ใช้กดค้นเอง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "ทำรายการไม่สำเร็จ" });
        return null;
      }
      await Promise.all([search(), onReload()]);
      setMsg({ ok: true, text: okText });
      return r;
    } finally {
      setBusy(false);
    }
  }

  async function reprint(s: SaleRow, wantReceipt: boolean) {
    if (!boot.seller) {
      setMsg({ ok: false, text: "ยังไม่ได้ตั้งกิจการของบาร์ — พิมพ์เอกสารไม่ได้" });
      return;
    }
    const ls: (CartLine & { voidedAt?: string | null })[] = lines
      .filter((l) => l.sale_no === s.sale_no)
      .map((l) => ({
        menuId: l.menu_id,
        menuName: l.menu_name,
        qty: Number(l.qty),
        price: Number(l.price),
        lineDiscount: Number(l.line_discount),
        isComp: l.is_comp,
        voidedAt: l.voided_at,
      }));
    const t = barTotals(ls.filter((l) => !l.voidedAt), { discount: Number(s.discount) });
    const cust = boot.customers.find((c) => c.customerId === s.customer_id) ?? null;
    const doc = buildReceipt({
      status: s.status,
      saleNo: s.sale_no,
      rcptNo: s.rcpt_no,
      wantReceipt,
      lines: ls,
      totals: t,
      seller: boot.seller,
      buyer: cust ? { name: cust.name, address: cust.address, taxId: cust.taxId, branch: cust.branch } : null,
      method: s.method,
      closedAt: s.closed_at ? new Date(s.closed_at).toLocaleString("th-TH") : null,
      printedAt: new Date().toLocaleString("th-TH"),
      footer: boot.settings.footer,
      // 🚨 บิลที่ปิดแล้วจะไม่มี QR อยู่แล้วเพราะ `receipt.ts` ตัดสินจาก status
      //    ส่ง payload มาก็ถูกทิ้ง — เขียนแบบนี้เพื่อให้กติกาอยู่ที่เดียวจริง ๆ
      qrPayload: null,
      layout: boot.layout,
      channel: s.channel,
    });
    const { receiptHtml, openPrint80, receiptCss } = await import("@/lib/bar/print80");
    if (!openPrint80(receiptHtml(doc, null), doc.title, receiptCss(doc.layout.paper, doc.layout.fontLarge))) {
      setMsg({ ok: false, text: "เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต pop-up ให้เว็บนี้ก่อน" });
    }
  }

  if (!boot.entityId) return null;

  return (
    <div className="space-y-4">
      {confirmNode}
      <Msg msg={msg} />

      <Card title="ค้นบิล">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="ตั้งแต่ (วันขาย)">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="ถึง">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="ค้น (เลขบิล · ชื่อโต๊ะ · ช่องทาง)">
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <button
            type="button"
            disabled={busy}
            onClick={search}
            className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
          >
            ค้น
          </button>
        </div>
        <p className="mt-1 text-xs text-faint">
          กรองด้วย <b>วันขาย</b> (คิดจากรอบขายที่ตั้งไว้) ไม่ใช่เวลาเปิดบิล — บิลที่ข้ามเที่ยงคืนจึงอยู่กับคืนที่มันเกิด
          {/* 🚨 บิลที่ยังเปิดอยู่ **ยังไม่มีวันขาย** (เซ็ตตอนปิดบิล) จึงไม่มีวันโผล่ในลิสต์นี้
              ไม่บอกไว้ = ผู้ใช้จะสรุปว่าบิลหาย แล้วไปเปิดใหม่จนได้บิลซ้ำ (ตระกูล D86 ข้อ 2) */}
          <br />
          บิลที่ <b>ยังเปิดอยู่</b> จะยังไม่มีวันขาย จึงไม่อยู่ในลิสต์นี้ — ดูได้ที่แท็บ <b>ขาย</b>
        </p>
      </Card>

      <Card title={`บิล ${sales.length} ใบ`}>
        {loaded && sales.length === 0 && <Empty>— ไม่พบบิลในช่วงนี้ —</Empty>}
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>วันขาย</th>
                <th>โต๊ะ/ช่องทาง</th>
                <th>รับเงิน</th>
                <th className="text-right">ยอดสุทธิ</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const mine = lines.filter((l) => l.sale_no === s.sale_no);
                const canEditLines = s.status === "ปกติ" && !s.rcpt_no;
                return (
                  // 🐛 D96 — เดิม map คืน <> ซึ่ง **ใส่ key ไม่ได้** → React ฟ้อง
                  //    "unique key prop" ทุกครั้งที่เปิดแท็บนี้ · key ที่ใส่ไว้อยู่ที่ลูก ไม่ใช่ตัวนอกสุด
                  //    (อาการเดียวกับที่ D81 เจอ — คีย์ซ้ำ/หายทำให้ React reuse แถวผิดตัวได้)
                  <Fragment key={s.sale_no}>
                    <tr>
                      <td className="font-medium text-ink">{s.sale_no}</td>
                      <td className="text-sm">{s.business_date ?? "—"}</td>
                      <td className="text-sm">
                        {s.tab_name || "—"}
                        <div className="text-xs text-faint">{s.channel}</div>
                      </td>
                      <td className="text-sm">{s.method ?? "—"}</td>
                      <td className="text-right">{fmt(Number(s.grand_total))}</td>
                      <td>
                        <Badge tone={s.status === "ยกเลิก" ? "crit" : s.status === "เปิดอยู่" ? "warn" : "neutral"}>
                          {s.status}
                        </Badge>
                        {s.rcpt_no && <div className="text-xs text-muted">ใบเสร็จ {s.rcpt_no}</div>}
                      </td>
                      <td className="text-right text-xs">
                        <button type="button" onClick={() => setOpen(open === s.sale_no ? null : s.sale_no)} className="text-muted underline">
                          รายการ
                        </button>
                      </td>
                    </tr>
                    {open === s.sale_no && (
                      <tr>
                        <td colSpan={7}>
                          <div className="rounded-lg bg-raised p-3">
                            {mine.map((l) => (
                              <div key={l.line_no} className="flex items-center gap-2 py-0.5 text-sm">
                                <span className="w-8 text-muted">{l.qty}×</span>
                                <span className={`flex-1 ${l.voided_at ? "text-faint line-through" : "text-ink"}`}>
                                  {l.menu_name}
                                  {l.is_comp && <span className="ml-1 text-xs text-muted">(แถม)</span>}
                                </span>
                                <span className="text-ink">{l.is_comp ? "—" : fmt(Number(l.amount))}</span>
                                {!l.voided_at && boot.canWrite && (
                                  <button
                                    type="button"
                                    disabled={busy || !canEditLines}
                                    title={
                                      canEditLines
                                        ? undefined
                                        : s.rcpt_no
                                          ? "ออกใบเสร็จไปแล้ว — ใบอยู่ในมือลูกค้า ต้องยกเลิกทั้งบิลแล้วออกใหม่"
                                          : "บิลนี้ยังไม่ปิด หรือถูกยกเลิกไปแล้ว"
                                    }
                                    onClick={() =>
                                      run(() => voidLineAction({ saleNo: s.sale_no, lineNo: l.line_no }), "ยกเลิกรายการแล้ว")
                                    }
                                    className="text-xs text-crit underline disabled:opacity-40"
                                  >
                                    ยกเลิกรายการ
                                  </button>
                                )}
                              </div>
                            ))}

                            {/* 🚨 ทุกครั้งที่ปิดปุ่ม ต้องบอกว่าผู้ใช้ต้องกดอะไรแทน (D88) */}
                            {s.status === "ปกติ" && s.rcpt_no && (
                              <p className="mt-2 text-xs text-warn">
                                ออกใบเสร็จเลขที่ <b>{s.rcpt_no}</b> ไปแล้ว — แก้รายการไม่ได้เพราะใบอยู่ในมือลูกค้า ·
                                ถ้าผิดจริงต้อง <b>ยกเลิกทั้งบิล</b> แล้วเปิดใหม่
                              </p>
                            )}

                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => reprint(s, false)}
                                className="rounded-lg bg-card px-3 py-1.5 text-sm text-ink disabled:opacity-50"
                              >
                                พิมพ์ซ้ำ
                              </button>
                              {s.status === "ปกติ" && (
                                <button
                                  type="button"
                                  disabled={busy || !boot.canWrite}
                                  onClick={async () => {
                                    const r = await run(() => issueReceiptAction(s.sale_no), "ออกใบเสร็จแล้ว");
                                    if (r) await reprint({ ...s, rcpt_no: (r.data as { rcpt_no?: string })?.rcpt_no ?? null }, true);
                                  }}
                                  className="rounded-lg bg-card px-3 py-1.5 text-sm text-ink disabled:opacity-50"
                                >
                                  {s.rcpt_no ? "พิมพ์ใบเสร็จซ้ำ" : "ออกใบเสร็จรับเงิน"}
                                </button>
                              )}
                              {s.status !== "ยกเลิก" && (
                                <button
                                  type="button"
                                  disabled={busy || !boot.canConfig}
                                  title={boot.canConfig ? undefined : "ยกเลิกทั้งบิลเป็นสิทธิ์ระดับเจ้าของ"}
                                  onClick={async () => {
                                    const ok = await ask({
                                      title: `ยกเลิกบิล ${s.sale_no} ทั้งใบ?`,
                                      detail: "สต็อกจะถูกคืนกลับทุกรายการ · บิลถูกทำเครื่องหมายว่ายกเลิก ไม่ได้ลบทิ้ง",
                                      confirmText: "ยกเลิกทั้งบิล",
                                      danger: true,
                                    });
                                    if (ok) void run(() => voidSaleAction(s.sale_no), "ยกเลิกบิลแล้ว");
                                  }}
                                  className="rounded-lg bg-card px-3 py-1.5 text-sm text-crit disabled:opacity-40"
                                >
                                  ยกเลิกทั้งบิล
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
