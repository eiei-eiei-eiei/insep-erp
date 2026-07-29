"use client";

import { useEffect, useMemo, useState } from "react";
import { searchBillsAction, getBillDetailAction, voidTransactionAction, updateTransactionAction } from "../actions";
import {
  entryCalc, itemTotal, itemDiscBahtFromPct, inVatFromExVat, exVatFromInVat, round2,
} from "@/lib/accounting/calc";
import type { Bootstrap } from "./types";
import { Card, Field, Msg, NumInput, SaveButton, Select, TextInput, fmt, useSaver } from "./ui";

type Bills = Awaited<ReturnType<typeof searchBillsAction>>;
type Detail = Awaited<ReturnType<typeof getBillDetailAction>>;
// searchBills คืน Tx[] แต่ raw มีคอลัมน์เพิ่ม (po_group_id/transfer_id ฯลฯ) — cast เพื่ออ่านตอนคุมสิทธิ์แก้
type BillRow = Bills[number] & { po_group_id?: string | null; transfer_id?: string | null; installment_no?: number | null };

const canEdit = (r: BillRow) =>
  r.status !== "ยกเลิก" && (r.type === "รายรับ" || r.type === "รายจ่าย") && !r.po_group_id && !r.transfer_id;

export function BillsTab({ boot, period, entityId }: { boot: Bootstrap; period: string; entityId: string }) {
  const [rows, setRows] = useState<Bills>([]);
  const [text, setText] = useState("");
  const [type, setType] = useState("");
  const [contact, setContact] = useState("");
  const [useMonth, setUseMonth] = useState(true);
  const [includeVoid, setIncludeVoid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { pending, msg, run } = useSaver();

  // ดึงข้อมูลใหม่เมื่อฟิลเตอร์ (ที่ไม่ใช่ข้อความ) เปลี่ยน — ข้อความกรอง live ฝั่ง client
  useEffect(() => {
    let alive = true;
    setLoading(true);
    searchBillsAction({ entityId, month: useMonth ? period : undefined, type: type || undefined, contact: contact || undefined, includeVoid })
      .then((r) => { if (alive) { setRows(r); setLoading(false); } });
    return () => { alive = false; };
  }, [entityId, period, type, contact, useMonth, includeVoid, reloadKey]);

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
                    <td className="p-1 whitespace-nowrap">
                      <button onClick={() => openDetail(r.tx_id)} className="text-slate-700 hover:underline">ดู</button>
                      {canEdit(r as BillRow) && <button onClick={() => setEditId(r.tx_id)} disabled={pending} className="ml-2 text-blue-600 hover:underline">แก้ไข</button>}
                      {r.status !== "ยกเลิก" && <button onClick={() => doVoid(r.tx_id)} disabled={pending} className="ml-2 text-red-500 hover:underline">ยกเลิก</button>}
                    </td>
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

      {editId && (
        <EditBillModal
          txId={editId}
          boot={boot}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); setDetail(null); setReloadKey((k) => k + 1); }}
        />
      )}
    </div>
  );

  function Info({ k, v }: { k: string; v: string }) { return <div><span className="text-slate-500">{k}: </span><span className="text-slate-800">{v}</span></div>; }
}

// ── แก้ไขบิลเดี่ยว (โหลด detail → ฟอร์มแก้ไข → fn_edit_transaction) ────────────────
type Qty = number | "";
type EItem = { itemName: string; itemCategory: string; itemJob: string; quantity: Qty; exVat: number; inVat: number; discPct: number; discBaht: number };
const qn = (q: Qty): number => (q === "" ? 0 : q);

function EditBillModal({ txId, boot, onClose, onSaved }: { txId: string; boot: Bootstrap; onClose: () => void; onSaved: () => void }) {
  const { pending, msg, run, setMsg } = useSaver();
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<"รายรับ" | "รายจ่าย">("รายจ่าย");
  const [category, setCategory] = useState("");
  const [accountName, setAccountName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactId, setContactId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [txDate, setTxDate] = useState("");
  const [taxInvoiceNo, setTaxInvoiceNo] = useState("");
  const [taxInvoiceDate, setTaxInvoiceDate] = useState("");
  const [entId, setEntId] = useState("");
  const [discount, setDiscount] = useState(0);
  const [hasVat, setHasVat] = useState(false);
  const [hasWht, setHasWht] = useState(false);
  const [whtRate, setWhtRate] = useState(0);
  const [items, setItems] = useState<EItem[]>([]);

  useEffect(() => {
    let alive = true;
    getBillDetailAction(txId).then((d) => {
      if (!alive || !d.tx) { if (alive) { setLoading(false); setMsg({ ok: false, text: "ไม่พบบิล" }); } return; }
      const tx = d.tx as unknown as Record<string, unknown>;
      setType((tx.type as "รายรับ" | "รายจ่าย") ?? "รายจ่าย");
      setCategory((tx.category as string) ?? "");
      setAccountName((tx.account_name as string) ?? "");
      setContactName((tx.contact_name as string) ?? "");
      setContactId((tx.contact_id as string) ?? "");
      setDescription((tx.description as string) ?? "");
      setTxDate(((tx.transaction_date as string) ?? "").substring(0, 10));
      setTaxInvoiceNo((tx.tax_invoice_no as string) ?? "");
      setTaxInvoiceDate(((tx.tax_invoice_date as string) ?? "").substring(0, 10) || "");
      setEntId((tx.entity_id as string) ?? "");
      setDiscount(Number(tx.discount) || 0);
      setHasVat((Number(tx.vat_amount) || 0) > 0);
      setHasWht((Number(tx.wht_amount) || 0) > 0 || (Number(tx.wht_rate) || 0) > 0);
      setWhtRate(Number(tx.wht_rate) || 0);
      setItems((d.items ?? []).map((it) => {
        const r = it as Record<string, unknown>;
        return {
          itemName: (r.item_name as string) ?? "", itemCategory: (r.item_category as string) ?? "", itemJob: (r.item_job as string) ?? "",
          quantity: Number(r.quantity) || 1, exVat: Number(r.ex_vat) || 0, inVat: Number(r.in_vat) || 0,
          discPct: Number(r.discount_pct) || 0, discBaht: Number(r.discount_baht) || 0,
        };
      }));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [txId, setMsg]);

  const cats = type === "รายรับ" ? boot.incomeCats : boot.expenseCats;
  const accountOptions = boot.accounts.filter((a) => { const ids = a.entity_ids ?? []; return ids.length === 0 || ids.includes(entId); });
  const norm = (s: string) => s.trim().toLowerCase();
  const nameMatches = boot.contacts.filter((c) => norm(c.name) === norm(contactName));
  const multiBranch = nameMatches.length > 1;
  const effBranchId = multiBranch ? (nameMatches.some((c) => c.contact_id === contactId) ? contactId : nameMatches[0].contact_id) : "";
  const resolvedContactId = nameMatches.length === 1 ? nameMatches[0].contact_id : multiBranch ? effBranchId : (contactId || undefined);

  const calc = useMemo(
    () => entryCalc({ items: items.map((it) => ({ quantity: qn(it.quantity), exVat: it.exVat, discBaht: it.discBaht })), discount, hasVat, hasWht, whtRate }),
    [items, discount, hasVat, hasWht, whtRate],
  );

  function setItem(i: number, patch: Partial<EItem>) { setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it))); }
  function onExVat(i: number, v: number) { setItem(i, { exVat: v, inVat: inVatFromExVat(v), discBaht: round2(v * qn(items[i].quantity) * items[i].discPct / 100) }); }
  function onInVat(i: number, v: number) { const ex = exVatFromInVat(v); setItem(i, { inVat: v, exVat: ex, discBaht: round2(ex * qn(items[i].quantity) * items[i].discPct / 100) }); }
  function onQty(i: number, raw: string) { const q: Qty = raw === "" ? "" : Number(raw); setItem(i, { quantity: q, discBaht: itemDiscBahtFromPct(qn(q), items[i].exVat, items[i].discPct) }); }
  function onDiscPct(i: number, v: number) { setItem(i, { discPct: v, discBaht: itemDiscBahtFromPct(qn(items[i].quantity), items[i].exVat, v) }); }
  function onDiscBaht(i: number, v: number) { const gross = qn(items[i].quantity) * items[i].exVat; setItem(i, { discBaht: v, discPct: gross > 0 ? round2((v / gross) * 100) : 0 }); }
  function addItem() { setItems((p) => [...p, { itemName: "", itemCategory: "", itemJob: "", quantity: 1, exVat: 0, inVat: 0, discPct: 0, discBaht: 0 }]); }

  function save() {
    if (!category) { setMsg({ ok: false, text: "เลือกหมวดหมู่" }); return; }
    if (items.every((it) => !it.itemName && !it.exVat)) { setMsg({ ok: false, text: "ต้องมีรายการอย่างน้อย 1 รายการ" }); return; }
    const itemInputs = items.filter((it) => it.itemName || it.exVat).map((it) => {
      const q = it.quantity === "" ? 1 : it.quantity;
      return {
        item_name: it.itemName, quantity: q, in_vat: it.inVat || inVatFromExVat(it.exVat), ex_vat: it.exVat,
        total_price: itemTotal(q, it.exVat, it.discBaht), discount_pct: it.discPct, discount_baht: it.discBaht,
        item_category: it.itemCategory, item_job: it.itemJob,
      };
    });
    run(() => updateTransactionAction(txId, {
      transaction_date: txDate, type, account_name: accountName, category, contact_name: contactName, contact_id: resolvedContactId, description,
      base_amount: calc.baseAmount, discount, amount_after_discount: calc.amountAfterDiscount, vat_amount: calc.vatAmount,
      wht_rate: calc.whtRate, wht_amount: calc.whtAmount, net_amount: calc.netAmount,
      tax_invoice_no: taxInvoiceNo, tax_invoice_date: taxInvoiceDate, entity_id: entId,
    }, itemInputs), "แก้ไขบิลเรียบร้อย", onSaved);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-3xl rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-semibold text-slate-800">แก้ไขบิล {txId}</h3>
        {loading ? <p className="text-slate-400">กำลังโหลด…</p> : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="ประเภท"><Select value={type} onChange={(e) => setType(e.target.value as "รายรับ" | "รายจ่าย")}><option value="รายจ่าย">รายจ่าย</option><option value="รายรับ">รายรับ</option></Select></Field>
              <Field label="หมวดหมู่">
                <input list="edit-cat-list" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" />
                <datalist id="edit-cat-list">{cats.map((c) => (<option key={c} value={c} />))}{type === "รายจ่าย" && !cats.includes("ต้นทุนสุรา") && <option value="ต้นทุนสุรา" />}</datalist>
              </Field>
              <Field label="บัญชี"><Select value={accountName} onChange={(e) => setAccountName(e.target.value)}><option value="">— เลือก —</option>{accountOptions.map((a) => (<option key={a.account_name} value={a.account_name}>{a.account_name}</option>))}</Select></Field>
              <Field label="คู่ค้า">
                <input list="edit-contact-list" value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none" />
                <datalist id="edit-contact-list">{boot.contacts.map((c) => (<option key={c.contact_id} value={c.name} />))}</datalist>
                {multiBranch && (
                  <Select value={effBranchId} onChange={(e) => setContactId(e.target.value)} className="mt-1">
                    {nameMatches.map((c) => (<option key={c.contact_id} value={c.contact_id}>สาขา {c.branch || "สำนักงานใหญ่"}</option>))}
                  </Select>
                )}
              </Field>
              <Field label="วันที่รายการ"><TextInput type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} /></Field>
              <Field label="เลขที่ใบกำกับภาษี"><TextInput value={taxInvoiceNo} onChange={(e) => { setTaxInvoiceNo(e.target.value); setHasVat(e.target.value.trim() !== ""); }} /></Field>
              <Field label="วันที่ใบกำกับ"><TextInput type="date" value={taxInvoiceDate} onChange={(e) => setTaxInvoiceDate(e.target.value)} /></Field>
              <div className="col-span-2 md:col-span-3"><Field label="รายละเอียด"><TextInput value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-slate-500"><th className="p-1">ชื่อรายการ</th><th className="p-1 w-16">จำนวน</th><th className="p-1 w-28">รวม VAT</th><th className="p-1 w-28">ไม่รวม VAT</th><th className="p-1 w-16">ลด %</th><th className="p-1 w-24">ลด บาท</th><th className="p-1 w-28 text-right">รวม</th><th className="p-1 w-8"></th></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="p-1"><TextInput value={it.itemName} onChange={(e) => setItem(i, { itemName: e.target.value })} placeholder="ชื่อสินค้า/บริการ" /></td>
                      <td className="p-1"><NumInput value={it.quantity} onChange={(e) => onQty(i, e.target.value)} /></td>
                      <td className="p-1"><NumInput value={it.inVat || ""} onChange={(e) => onInVat(i, Number(e.target.value))} /></td>
                      <td className="p-1"><NumInput value={it.exVat || ""} onChange={(e) => onExVat(i, Number(e.target.value))} /></td>
                      <td className="p-1"><NumInput value={it.discPct || ""} onChange={(e) => onDiscPct(i, Number(e.target.value))} /></td>
                      <td className="p-1"><NumInput value={it.discBaht || ""} onChange={(e) => onDiscBaht(i, Number(e.target.value))} /></td>
                      <td className="p-1 text-right font-medium">{fmt(itemTotal(qn(it.quantity), it.exVat, it.discBaht))}</td>
                      <td className="p-1"><button type="button" onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={addItem} className="mt-2 text-sm text-slate-600 hover:text-slate-800">+ เพิ่มรายการ</button>

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="ส่วนลดบิล"><NumInput value={discount || ""} onChange={(e) => setDiscount(Number(e.target.value))} /></Field>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={hasVat} onChange={(e) => setHasVat(e.target.checked)} /> มี VAT 7%</label>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={hasWht} onChange={(e) => setHasWht(e.target.checked)} /> หัก ณ ที่จ่าย</label>
              {hasWht && <Field label="อัตรา WHT (%)"><NumInput value={whtRate || ""} onChange={(e) => setWhtRate(Number(e.target.value))} /></Field>}
            </div>

            <dl className="mt-3 space-y-1 text-sm">
              <ERow k="ยอดหลังหักส่วนลด" v={fmt(calc.amountAfterDiscount)} />
              <ERow k="VAT" v={fmt(calc.vatAmount)} />
              <ERow k="หัก ณ ที่จ่าย" v={fmt(calc.whtAmount)} />
              <ERow k="ยอดสุทธิ" v={fmt(calc.netAmount)} bold />
            </dl>

            <p className="mt-2 text-xs text-slate-400">* คงสถานะชำระ (AP/AR) และกลุ่มงวด/โอนไว้เดิม · การแก้จะถูกบันทึกใน edit_log</p>
            <Msg msg={msg} />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">ยกเลิก</button>
              <SaveButton pending={pending} onClick={save}>บันทึกการแก้ไข</SaveButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ERow({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "border-t border-slate-200 pt-1 font-semibold text-slate-800" : "text-slate-600"}`}><dt>{k}</dt><dd>{v}</dd></div>;
}
