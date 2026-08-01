"use client";

import { useState } from "react";
import { inVatFromExVat } from "@/lib/accounting/calc";
import { saveTransactionAction, type TxItemInput } from "../actions";
import type { Bootstrap } from "./types";
import { Card, Field, Msg, NumInput, SaveButton, TextInput, fmt, todayISO, useSaver } from "./ui";

type Item = { itemName: string; quantity: number; exVat: number };

export function PriceCheckTab({ boot, entityId }: { boot: Bootstrap; entityId: string }) {
  const { pending, msg, run, setMsg } = useSaver();
  const [date, setDate] = useState(todayISO());
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<Item[]>([{ itemName: "", quantity: 1, exVat: 0 }]);

  function doSave() {
    const valid = items.filter((it) => it.itemName);
    if (valid.length === 0) { setMsg({ ok: false, text: "เพิ่มรายการอย่างน้อย 1 รายการ" }); return; }
    const itemInputs: TxItemInput[] = valid.map((it) => ({
      item_name: it.itemName,
      quantity: it.quantity,
      in_vat: inVatFromExVat(it.exVat),
      ex_vat: it.exVat,
      total_price: 0,
    }));
    run(
      () =>
        saveTransactionAction(
          {
            transaction_date: date, type: "เช็คราคา", account_name: "", category: "เช็คราคา",
            contact_name: contact, description: note,
            base_amount: 0, discount: 0, amount_after_discount: 0, vat_amount: 0, wht_rate: 0, wht_amount: 0, net_amount: 0,
            entity_id: entityId,
          },
          itemInputs,
        ),
      "บันทึกการเช็คราคาเรียบร้อย (ไม่กระทบบัญชี/ภาษี)",
      () => setItems([{ itemName: "", quantity: 1, exVat: 0 }]),
    );
  }

  return (
    <Card title="เช็คราคา (เก็บประวัติราคา ไม่กระทบบัญชี/ภาษี)">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label="วันที่"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="คู่ค้า/ร้าน">
          <input list="pc-contact" value={contact} onChange={(e) => setContact(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 outline-none" />
          <datalist id="pc-contact">{boot.contacts.map((c) => <option key={c.contact_id} value={c.name} />)}</datalist>
        </Field>
        <Field label="หมายเหตุ"><TextInput value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <table className="tbl mt-3">
        <thead><tr className="text-left text-faint"><th>รายการ</th><th className="w-20">จำนวน</th><th className="w-28">ราคา(ex VAT)</th><th className="w-24 num">รวม VAT</th><th className="w-8"></th></tr></thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td><TextInput value={it.itemName} onChange={(e) => setItems((p) => p.map((x, idx) => idx === i ? { ...x, itemName: e.target.value } : x))} /></td>
              <td><NumInput value={it.quantity} onChange={(e) => setItems((p) => p.map((x, idx) => idx === i ? { ...x, quantity: Number(e.target.value) } : x))} /></td>
              <td><NumInput value={it.exVat || ""} onChange={(e) => setItems((p) => p.map((x, idx) => idx === i ? { ...x, exVat: Number(e.target.value) } : x))} /></td>
              <td className="num">{fmt(inVatFromExVat(it.exVat))}</td>
              <td><button onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))} className="text-crit">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => setItems((p) => [...p, { itemName: "", quantity: 1, exVat: 0 }])} className="mt-2 text-sm text-muted">+ เพิ่มรายการ</button>
      <div className="mt-3"><Msg msg={msg} /><SaveButton pending={pending} onClick={doSave}>บันทึกเช็คราคา</SaveButton></div>
    </Card>
  );
}
