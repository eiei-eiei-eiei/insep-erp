"use client";

import { useEffect, useMemo, useState } from "react";
import { searchBillsAction, getBillDetailAction, voidTransactionAction } from "../actions";
import type { Bootstrap } from "./types";
import { Card, Field, Msg, Select, TextInput, fmt, useSaver } from "./ui";

type Bills = Awaited<ReturnType<typeof searchBillsAction>>;
type Detail = Awaited<ReturnType<typeof getBillDetailAction>>;

export function BillsTab({ boot, period, entityId }: { boot: Bootstrap; period: string; entityId: string }) {
  const [rows, setRows] = useState<Bills>([]);
  const [text, setText] = useState("");
  const [type, setType] = useState("");
  const [contact, setContact] = useState("");
  const [useMonth, setUseMonth] = useState(true);
  const [includeVoid, setIncludeVoid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const { pending, msg, run } = useSaver();

  // ดึงข้อมูลใหม่เมื่อฟิลเตอร์ (ที่ไม่ใช่ข้อความ) เปลี่ยน — ข้อความกรอง live ฝั่ง client
  useEffect(() => {
    let alive = true;
    setLoading(true);
    searchBillsAction({ entityId, month: useMonth ? period : undefined, type: type || undefined, contact: contact || undefined, includeVoid })
      .then((r) => { if (alive) { setRows(r); setLoading(false); } });
    return () => { alive = false; };
  }, [entityId, period, type, contact, useMonth, includeVoid]);

  // กรอง live จากรายละเอียดบิล (พิมพ์แล้วกรองทันที ไม่ต้องกดค้นหา)
  const shown = useMemo(() => {
    const t = text.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => (r.description ?? "").toLowerCase().includes(t));
  }, [rows, text]);

  async function openDetail(txId: string) { setDetail(null); setDetail(await getBillDetailAction(txId)); }
  function doVoid(txId: string) {
    if (!confirm("ยกเลิกบิลนี้? (soft-delete ทั้งกลุ่มถ้าเป็นงวด/โอน)")) return;
    run(() => voidTransactionAction(txId), "ยกเลิกเรียบร้อย", () => { setDetail(null); setRows((p) => p.map((r) => r.tx_id === txId ? { ...r, status: "ยกเลิก" } : r)); });
  }

  return (
    <div className="space-y-4">
      <Card title="ค้นบิล">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="ค้นจากรายละเอียดบิล"><TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="พิมพ์เพื่อกรองทันที…" /></Field>
          <Field label="คู่ค้า">
            <Select value={contact} onChange={(e) => setContact(e.target.value)}><option value="">ทั้งหมด</option>{boot.contacts.map((c) => <option key={c.contact_id} value={c.name}>{c.name}</option>)}</Select>
          </Field>
          <Field label="ประเภท"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="">ทั้งหมด</option><option>รายรับ</option><option>รายจ่าย</option><option>โอนระหว่างบัญชี</option><option>เช็คราคา</option></Select></Field>
          <div className="flex flex-col justify-end gap-1 text-sm">
            <label className="flex items-center gap-1"><input type="checkbox" checked={useMonth} onChange={(e) => setUseMonth(e.target.checked)} /> เฉพาะเดือน {period}</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={includeVoid} onChange={(e) => setIncludeVoid(e.target.checked)} /> รวมที่ยกเลิก</label>
          </div>
        </div>
        <Msg msg={msg} />
      </Card>

      <Card title={`ผลลัพธ์ (${shown.length})`}>
        {loading ? <p className="text-slate-400">กำลังโหลด…</p> : shown.length === 0 ? <p className="text-sm text-slate-400">— ไม่มีรายการ —</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="p-1">วันที่</th><th className="p-1">เลขที่</th><th className="p-1">ประเภท</th><th className="p-1">คู่ค้า</th><th className="p-1">รายละเอียด</th><th className="p-1 text-right">สุทธิ</th><th className="p-1">สถานะ</th><th className="p-1"></th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.tx_id} className="border-t border-slate-100">
                    <td className="p-1 whitespace-nowrap">{r.transaction_date}</td><td className="p-1">{r.tx_id}</td><td className="p-1">{r.type}</td>
                    <td className="p-1">{r.contact_name}</td><td className="p-1">{r.description}</td><td className="p-1 text-right">{fmt(r.net_amount as number)}</td>
                    <td className="p-1">{r.status}{r.ap_ar_status ? ` (${r.ap_ar_status})` : ""}</td>
                    <td className="p-1 whitespace-nowrap"><button onClick={() => openDetail(r.tx_id)} className="text-slate-700 hover:underline">ดู</button>{r.status !== "ยกเลิก" && <button onClick={() => doVoid(r.tx_id)} disabled={pending} className="ml-2 text-red-500 hover:underline">ยกเลิก</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {detail?.tx && (
        <Card title={`รายละเอียดบิล ${detail.tx.tx_id}`}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
            <Info k="ประเภท" v={detail.tx.type} /><Info k="หมวดหมู่" v={detail.tx.category ?? "-"} /><Info k="บัญชี" v={detail.tx.account_name ?? "-"} />
            <Info k="คู่ค้า" v={detail.tx.contact_name ?? "-"} /><Info k="ใบกำกับ" v={detail.tx.tax_invoice_no ?? "-"} /><Info k="วันที่ใบกำกับ" v={detail.tx.tax_invoice_date ?? "-"} />
            <Info k="ยอดก่อนหัก" v={fmt(detail.tx.amount_after_discount as number)} /><Info k="VAT" v={fmt(detail.tx.vat_amount as number)} /><Info k="สุทธิ" v={fmt(detail.tx.net_amount as number)} />
          </div>
          {detail.items.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="p-1">รายการ</th><th className="p-1">หมวด</th><th className="p-1 text-right">จำนวน</th><th className="p-1 text-right">ราคา(ex)</th><th className="p-1 text-right">รวม</th></tr></thead>
              <tbody>
                {detail.items.map((it) => (
                  <tr key={it.item_id as string} className="border-t border-slate-100"><td className="p-1">{it.item_name as string}</td><td className="p-1">{(it.item_category as string) ?? ""}</td><td className="p-1 text-right">{fmt(it.quantity as number)}</td><td className="p-1 text-right">{fmt(it.ex_vat as number)}</td><td className="p-1 text-right">{fmt(it.total_price as number)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );

  function Info({ k, v }: { k: string; v: string }) { return <div><span className="text-slate-500">{k}: </span><span className="text-slate-800">{v}</span></div>; }
}
