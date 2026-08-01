"use client";

import { useEffect, useMemo, useState } from "react";
import { searchPriceHistoryAction } from "../actions";
import type { Bootstrap } from "./types";
import { Card, Field, Select, TextInput, fmt } from "./ui";

type Hist = Awaited<ReturnType<typeof searchPriceHistoryAction>>;

export function HistoryTab({ boot, entityId }: { boot: Bootstrap; entityId: string }) {
  const [rows, setRows] = useState<Hist>([]);
  const [itemName, setItemName] = useState("");
  const [contact, setContact] = useState("");
  const [includePriceCheck, setIncludePriceCheck] = useState(true);
  const [loading, setLoading] = useState(false);

  // โหลดตาม entity/คู่ค้า/รวมเช็คราคา — ชื่อสินค้ากรอง live ฝั่ง client
  useEffect(() => {
    let alive = true;
    setLoading(true);
    searchPriceHistoryAction({ entityId, contact: contact || undefined, includePriceCheck })
      .then((r) => { if (alive) { setRows(r); setLoading(false); } });
    return () => { alive = false; };
  }, [entityId, contact, includePriceCheck]);

  const shown = useMemo(() => {
    const t = itemName.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => r.itemName.toLowerCase().includes(t));
  }, [rows, itemName]);

  return (
    <div className="space-y-4">
      <Card title="ค้นประวัติราคาสินค้า/วัตถุดิบ">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="ชื่อสินค้า (พิมพ์เพื่อกรองทันที)"><TextInput value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="พิมพ์ชื่อสินค้า…" /></Field>
          <Field label="คู่ค้า"><Select value={contact} onChange={(e) => setContact(e.target.value)}><option value="">ทั้งหมด</option>{boot.contacts.map((c) => <option key={c.contact_id} value={c.name}>{c.name}</option>)}</Select></Field>
          <div className="flex items-end pb-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includePriceCheck} onChange={(e) => setIncludePriceCheck(e.target.checked)} /> รวมใบเช็คราคา</label></div>
        </div>
        <p className="mt-1 text-xs text-faint">กรองตามกิจการที่เลือกด้านบน ({entityId === "ALL" ? "ทุกกิจการ" : entityId})</p>
      </Card>
      <Card title={`ผลลัพธ์ (${shown.length})`}>
        {loading ? <p className="text-faint">กำลังโหลด…</p> : shown.length === 0 ? <p className="text-sm text-faint">— ไม่มีรายการ —</p> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr className="text-left text-faint"><th>วันที่</th><th>รายการ</th><th>คู่ค้า</th><th>ประเภท</th><th className="num">จำนวน</th><th className="num">ราคา(ex)</th><th className="num">รวม</th></tr></thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.txId + i}><td className="whitespace-nowrap">{r.date}</td><td>{r.itemName}</td><td>{r.contactName}</td><td>{r.type}</td><td className="num">{fmt(r.quantity)}</td><td className="num">{fmt(r.exVat)}</td><td className="num">{fmt(r.totalPrice)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
