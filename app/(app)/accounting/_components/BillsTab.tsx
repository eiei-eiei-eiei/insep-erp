"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { searchBillsAction, getBillDetailAction, voidTransactionAction, updateTransactionAction, getItemHistoryAction } from "../actions";
import { entryCalc, itemTotal } from "@/lib/accounting/calc";
import { qn, emptyItem, makeItemHandlers, buildItemInputs, useBillAmounts, type BillItem } from "./billItems";
import type { Bootstrap } from "./types";
import { Card, Field, Msg, NumBox, SaveButton, Select, TextInput, fmt, useSaver, EscToClose } from "./ui";

type Bills = Awaited<ReturnType<typeof searchBillsAction>>;
type Detail = Awaited<ReturnType<typeof getBillDetailAction>>;
// searchBills คืน Tx[] แต่ raw มีคอลัมน์เพิ่ม (po_group_id/transfer_id ฯลฯ) — cast เพื่ออ่านตอนคุมสิทธิ์แก้
type BillRow = Bills[number] & { po_group_id?: string | null; transfer_id?: string | null; installment_no?: number | null };

const canEdit = (r: BillRow) =>
  r.status !== "ยกเลิก" && (r.type === "รายรับ" || r.type === "รายจ่าย") && !r.po_group_id && !r.transfer_id;

export function BillsTab({ boot, period, entityId, active }: { boot: Bootstrap; period: string; entityId: string; active: boolean }) {
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
  const readOnly = boot.role !== "main"; // viewer/sale/warehouse: ดูได้ แต่ซ่อนปุ่มแก้/ยกเลิก (กัน RLS error)

  // ดึงข้อมูลใหม่เมื่อฟิลเตอร์เปลี่ยน/กลับเข้าแท็บ — โชว์ผลเดิมค้างระหว่างโหลด (loading เฉพาะครั้งแรก)
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    if (firstLoad.current) setLoading(true);
    searchBillsAction({ entityId, month: useMonth ? period : undefined, type: type || undefined, contact: contact || undefined, includeVoid })
      .then((r) => { if (alive) { setRows(r); setLoading(false); firstLoad.current = false; } });
    return () => { alive = false; };
  }, [entityId, period, type, contact, useMonth, includeVoid, reloadKey, active]);

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

  // ปุ่มต่อบิล (ใช้ร่วมทั้งตาราง desktop และการ์ด mobile)
  // มือถือ: touch target ≥ 44px + เว้น "ยกเลิก" ออกจาก "แก้ไข" (กดพลาดแล้วบิลถูก void)
  const actBtn = "min-h-[44px] rounded border px-3 sm:min-h-0 sm:py-1";
  const billActions = (r: Bills[number]) => (
    <>
      <button onClick={() => openDetail(r.tx_id)} className={`${actBtn} border-line text-muted hover:bg-raised`}>ดู</button>
      {!readOnly && canEdit(r as BillRow) && <button onClick={() => setEditId(r.tx_id)} disabled={pending} className={`${actBtn} border-brand-line text-brand hover:bg-brand-soft disabled:opacity-50`}>แก้ไข</button>}
      {!readOnly && r.status !== "ยกเลิก" && <button onClick={() => doVoid(r.tx_id)} disabled={pending} className={`${actBtn} ml-auto border-crit-line text-crit hover:bg-crit-bg disabled:opacity-50 sm:ml-2`}>ยกเลิก</button>}
    </>
  );

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
        {rows.length >= 500 && <p className="mb-2 text-xs text-warn">แสดง 500 รายการแรก — ถ้าไม่เจอที่ต้องการ ให้แคบด้วยเดือน/คู่ค้า/ประเภท</p>}
        {loading ? <p className="text-faint">กำลังโหลด…</p> : shown.length === 0 ? <p className="text-sm text-faint">— ไม่มีรายการ —</p> : (
          <>
            {/* Desktop: ตาราง */}
            <div className="hidden overflow-x-auto md:block">
              <table className="tbl">
                <thead><tr className="text-left text-faint"><th>วันที่</th><th>เลขที่</th><th>ประเภท</th><th>คู่ค้า</th><th>รายละเอียด</th><th className="num">สุทธิ</th><th>สถานะ</th><th></th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.tx_id}>
                      <td className="whitespace-nowrap">{r.transaction_date}</td><td>{r.tx_id}</td><td>{r.type}</td>
                      <td>{r.contact_name}</td><td>{r.description}</td><td className="num">{fmt(r.net_amount as number)}</td>
                      <td>{r.status}{r.ap_ar_status ? ` (${r.ap_ar_status})` : ""}</td>
                      <td className="whitespace-nowrap"><div className="flex gap-1">{billActions(r)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: การ์ด */}
            <div className="space-y-2 md:hidden">
              {shown.map((r) => (
                <div key={r.tx_id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs text-faint">{r.transaction_date} · {r.tx_id}</div>
                      <div className="truncate text-sm font-medium text-ink">{r.contact_name || "—"}</div>
                      <div className="truncate text-xs text-faint">{r.type} · {r.description}</div>
                    </div>
                    <div className="whitespace-nowrap text-right">
                      <div className="font-semibold text-ink">฿{fmt(r.net_amount as number)}</div>
                      <div className="text-[10px] text-faint">{r.status}{r.ap_ar_status ? ` (${r.ap_ar_status})` : ""}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-1.5">{billActions(r)}</div>
                </div>
              ))}
            </div>
          </>
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
            <table className="tbl mt-3">
              <thead><tr className="text-left text-faint"><th>รายการ</th><th>หมวด</th><th>งาน</th><th className="num">จำนวน</th><th className="num">ราคา(ex)</th><th className="num">รวม</th></tr></thead>
              <tbody>
                {detail.items.map((it) => (
                  <tr key={it.item_id as string}><td>{it.item_name as string}</td><td>{(it.item_category as string) ?? ""}</td><td>{(it.item_job as string) ?? ""}</td><td className="num">{fmt(it.quantity as number)}</td><td className="num">{fmt(it.ex_vat as number)}</td><td className="num">{fmt(it.total_price as number)}</td></tr>
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

  function Info({ k, v }: { k: string; v: string }) { return <div><span className="text-faint">{k}: </span><span className="text-ink">{v}</span></div>; }
}

// ── แก้ไขบิลเดี่ยว (โหลด detail → ฟอร์มแก้ไข → fn_edit_transaction) ────────────────
// รายการสินค้า/ยอด ใช้ตรรกะชุดเดียวกับฟอร์มบันทึก (billItems.ts) — กันเลขตอนแก้ ≠ ตอนสร้าง
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
  const [items, setItems] = useState<BillItem[]>([]);
  const [itemHist, setItemHist] = useState<{ itemNames: string[]; itemCategories: string[]; itemJobs: string[] }>({ itemNames: [], itemCategories: [], itemJobs: [] });
  const [bulkCat, setBulkCat] = useState("");
  const [bulkJob, setBulkJob] = useState("");
  const amt = useBillAmounts({ items, discount, hasVat, hasWht, whtRate });
  const { calc, manualAmt, effAfterDisc, effVat, effWht, effNet, unlockAmounts, lockAmounts } = amt;
  // setter ล่าสุดสำหรับใช้ใน effect โหลดบิล (ไม่ต้องใส่ทุกตัวใน deps)
  const amtRef = useRef(amt);
  amtRef.current = amt;

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
      const loadedItems: BillItem[] = (d.items ?? []).map((it) => {
        const r = it as Record<string, unknown>;
        return {
          itemName: (r.item_name as string) ?? "", itemCategory: (r.item_category as string) ?? "", itemJob: (r.item_job as string) ?? "",
          quantity: Number(r.quantity) || 1, exVat: Number(r.ex_vat) || 0, inVat: Number(r.in_vat) || 0,
          discPct: Number(r.discount_pct) || 0, discBaht: Number(r.discount_baht) || 0,
        };
      });
      setItems(loadedItems);
      // ยอดที่บันทึกไว้ (บิลเจ้าอื่นอาจมีทศนิยมไม่ตรงสูตร) — เก็บไว้เป็นค่าแก้เอง
      const sAfter = Number(tx.amount_after_discount) || 0, sVat = Number(tx.vat_amount) || 0, sWht = Number(tx.wht_amount) || 0;
      amtRef.current.setOvAfterDisc(sAfter); amtRef.current.setOvVat(sVat); amtRef.current.setOvWht(sWht);
      // ถ้ายอดที่บันทึกต่างจากสูตร (ปัดทศนิยม) → เปิดโหมดแก้เองไว้เลย เพื่อคงเลขเดิม
      const computed = entryCalc({ items: loadedItems.map((it) => ({ quantity: qn(it.quantity), exVat: it.exVat, discBaht: it.discBaht })), discount: Number(tx.discount) || 0, hasVat: sVat > 0, hasWht: sWht > 0 || (Number(tx.wht_rate) || 0) > 0, whtRate: Number(tx.wht_rate) || 0 });
      const odd = Math.abs(computed.amountAfterDiscount - sAfter) > 0.005 || Math.abs(computed.vatAmount - sVat) > 0.005 || Math.abs(computed.whtAmount - sWht) > 0.005;
      amtRef.current.setManualAmt(odd);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [txId, setMsg]);

  // ประวัติหมวดหมู่/งานของรายการ → เติมดรอปดาวน์ช่วยกรอก (entId รู้ค่าหลังโหลดบิลเสร็จ)
  useEffect(() => {
    if (!entId) return;
    let alive = true;
    getItemHistoryAction(entId).then((h) => { if (alive) setItemHist(h); });
    return () => { alive = false; };
  }, [entId]);

  const cats = type === "รายรับ" ? boot.incomeCats : boot.expenseCats;
  const itemCatOptions = useMemo(() => [...new Set([...itemHist.itemCategories, ...items.map((it) => it.itemCategory).filter(Boolean)])], [itemHist.itemCategories, items]);
  const itemJobOptions = useMemo(() => [...new Set([...itemHist.itemJobs, ...items.map((it) => it.itemJob).filter(Boolean)])], [itemHist.itemJobs, items]);
  const accountOptions = boot.accounts.filter((a) => { const ids = a.entity_ids ?? []; return ids.length === 0 || ids.includes(entId); });
  const norm = (s: string) => s.trim().toLowerCase();
  const nameMatches = boot.contacts.filter((c) => norm(c.name) === norm(contactName));
  const multiBranch = nameMatches.length > 1;
  const effBranchId = multiBranch ? (nameMatches.some((c) => c.contact_id === contactId) ? contactId : nameMatches[0].contact_id) : "";
  const resolvedContactId = nameMatches.length === 1 ? nameMatches[0].contact_id : multiBranch ? effBranchId : (contactId || undefined);

  const { setItem, onExVat, onInVat, onQty, onDiscPct, onDiscBaht, removeItem } = makeItemHandlers(items, setItems);
  // แถวใหม่ก๊อปหมวด/งานจากแถวสุดท้าย (บิลเดียวกันมักเป็นงานเดียวกัน) — เหมือน EntryTab
  function addItem() { const last = items[items.length - 1]; setItems((p) => [...p, emptyItem(last?.itemCategory ?? "", last?.itemJob ?? "")]); }
  function fillAll(patch: Partial<BillItem>) { setItems((p) => p.map((it) => ({ ...it, ...patch }))); }

  function save() {
    if (!category) { setMsg({ ok: false, text: "เลือกหมวดหมู่" }); return; }
    if (items.every((it) => !it.itemName && !it.exVat)) { setMsg({ ok: false, text: "ต้องมีรายการอย่างน้อย 1 รายการ" }); return; }
    const itemInputs = buildItemInputs(items);
    run(() => updateTransactionAction(txId, {
      transaction_date: txDate, type, account_name: accountName, category, contact_name: contactName, contact_id: resolvedContactId, description,
      base_amount: calc.baseAmount, discount, amount_after_discount: effAfterDisc, vat_amount: effVat,
      wht_rate: calc.whtRate, wht_amount: effWht, net_amount: effNet,
      tax_invoice_no: taxInvoiceNo, tax_invoice_date: taxInvoiceDate, entity_id: entId,
    }, itemInputs), "แก้ไขบิลเรียบร้อย", onSaved);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay/30 p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <EscToClose onClose={() => { onClose(); }} />
      <div className="min-h-dvh w-full rounded-none bg-card p-5 sm:my-8 sm:min-h-0 sm:max-w-5xl sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-semibold text-ink">แก้ไขบิล {txId}</h3>
        {loading ? <p className="text-faint">กำลังโหลด…</p> : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="ประเภท"><Select value={type} onChange={(e) => setType(e.target.value as "รายรับ" | "รายจ่าย")}><option value="รายจ่าย">รายจ่าย</option><option value="รายรับ">รายรับ</option></Select></Field>
              <Field label="หมวดหมู่">
                <input list="edit-cat-list" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft" />
                <datalist id="edit-cat-list">{cats.map((c) => (<option key={c} value={c} />))}{type === "รายจ่าย" && !cats.includes("ต้นทุนสุรา") && <option value="ต้นทุนสุรา" />}</datalist>
              </Field>
              <Field label="บัญชี"><Select value={accountName} onChange={(e) => setAccountName(e.target.value)}><option value="">— เลือก —</option>{accountOptions.map((a) => (<option key={a.account_name} value={a.account_name}>{a.account_name}</option>))}</Select></Field>
              <Field label="คู่ค้า">
                <input list="edit-contact-list" value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-ink outline-none" />
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
              <table className="tbl">
                <thead><tr className="text-left text-faint"><th>ชื่อรายการ</th><th className="w-28">หมวดหมู่</th><th className="w-24">งาน</th><th className="w-16">จำนวน</th><th className="w-28">รวม VAT</th><th className="w-28">ไม่รวม VAT</th><th className="w-16">ลด %</th><th className="w-24">ลด บาท</th><th className="w-28 num">รวม</th><th className="w-8"></th></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td><TextInput value={it.itemName} onChange={(e) => setItem(i, { itemName: e.target.value })} placeholder="ชื่อสินค้า/บริการ" /></td>
                      <td><TextInput list="edit-item-cats" value={it.itemCategory} onChange={(e) => setItem(i, { itemCategory: e.target.value })} placeholder="หมวดหมู่" /></td>
                      <td><TextInput list="edit-item-jobs" value={it.itemJob} onChange={(e) => setItem(i, { itemJob: e.target.value })} placeholder="งาน" /></td>
                      <td><NumBox value={it.quantity} onChange={(v) => onQty(i, v)} /></td>
                      <td><NumBox value={it.inVat} blankZero onChange={(v) => onInVat(i, v === "" ? 0 : v)} /></td>
                      <td><NumBox value={it.exVat} blankZero onChange={(v) => onExVat(i, v === "" ? 0 : v)} /></td>
                      <td><NumBox value={it.discPct} blankZero onChange={(v) => onDiscPct(i, v === "" ? 0 : v)} /></td>
                      <td><NumBox value={it.discBaht} blankZero onChange={(v) => onDiscBaht(i, v === "" ? 0 : v)} /></td>
                      <td className="font-medium num">{fmt(itemTotal(qn(it.quantity), it.exVat, it.discBaht))}</td>
                      <td><button type="button" onClick={() => removeItem(i)} title="ลบรายการนี้" className="text-crit hover:text-crit">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* id ต้องไม่ซ้ำกับ EntryTab (hist-item-*) — แท็บบัญชี mount ค้างพร้อมกัน id ซ้ำ = ผูก list ผิดตัวเงียบ ๆ */}
            <datalist id="edit-item-cats">{itemCatOptions.map((v) => (<option key={v} value={v} />))}</datalist>
            <datalist id="edit-item-jobs">{itemJobOptions.map((v) => (<option key={v} value={v} />))}</datalist>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button type="button" onClick={addItem} className="text-sm text-muted hover:text-ink">+ เพิ่มรายการ</button>
              {/* ทั้งบิลมักเป็นงานเดียวกัน — เติมทีเดียวแทนไล่พิมพ์ทีละแถว (ปุ่มปิดเมื่อช่องว่าง กันล้างค่าเดิมทั้งบิล) */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
                <span>เติมทุกแถว:</span>
                <div className="w-32"><TextInput list="edit-item-cats" value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} placeholder="หมวดหมู่" className="py-1 text-sm" /></div>
                <button type="button" onClick={() => fillAll({ itemCategory: bulkCat.trim() })} disabled={!bulkCat.trim()} className="rounded border border-line px-2 py-1 text-muted hover:bg-raised disabled:opacity-40">เติม</button>
                <div className="w-32"><TextInput list="edit-item-jobs" value={bulkJob} onChange={(e) => setBulkJob(e.target.value)} placeholder="งาน" className="py-1 text-sm" /></div>
                <button type="button" onClick={() => fillAll({ itemJob: bulkJob.trim() })} disabled={!bulkJob.trim()} className="rounded border border-line px-2 py-1 text-muted hover:bg-raised disabled:opacity-40">เติม</button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="ส่วนลดบิล"><NumBox value={discount} blankZero onChange={(v) => setDiscount(v === "" ? 0 : v)} /></Field>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={hasVat} onChange={(e) => setHasVat(e.target.checked)} /> มี VAT 7%</label>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={hasWht} onChange={(e) => setHasWht(e.target.checked)} /> หัก ณ ที่จ่าย</label>
              {hasWht && <Field label="อัตรา WHT (%)"><NumBox value={whtRate} blankZero onChange={(v) => setWhtRate(v === "" ? 0 : v)} /></Field>}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-faint">ยอดคำนวณ</span>
              {manualAmt
                ? <button type="button" onClick={lockAmounts} className="text-xs text-faint hover:underline">กลับไปคำนวณอัตโนมัติ</button>
                : <button type="button" onClick={unlockAmounts} className="text-xs text-brand hover:underline">แก้ยอดเอง</button>}
            </div>
            <dl className="mt-1 space-y-1 text-sm">
              {manualAmt ? (
                <>
                  <ERowEdit k="ยอดหลังหักส่วนลด" value={amt.ovAfterDisc} onChange={amt.setOvAfterDisc} />
                  <ERowEdit k="VAT" value={amt.ovVat} onChange={amt.setOvVat} />
                  <ERowEdit k="หัก ณ ที่จ่าย" value={amt.ovWht} onChange={amt.setOvWht} />
                </>
              ) : (
                <>
                  <ERow k="ยอดหลังหักส่วนลด" v={fmt(effAfterDisc)} />
                  <ERow k="VAT" v={fmt(effVat)} />
                  <ERow k="หัก ณ ที่จ่าย" v={fmt(effWht)} />
                </>
              )}
              <ERow k="ยอดสุทธิ" v={fmt(effNet)} bold />
            </dl>
            {manualAmt && <p className="mt-1 text-xs text-warn">โหมดแก้ยอดเอง — 3 ค่านี้จะไม่คำนวณอัตโนมัติจนกดกลับ (ยอดสุทธิ = หลังหักส่วนลด + VAT − หัก ณ ที่จ่าย)</p>}

            <p className="mt-2 text-xs text-faint">* คงสถานะชำระ (AP/AR) และกลุ่มงวด/โอนไว้เดิม · การแก้จะถูกบันทึกใน edit_log</p>
            <Msg msg={msg} />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">ยกเลิก</button>
              <SaveButton pending={pending} onClick={save}>บันทึกการแก้ไข</SaveButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ERow({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "border-t border-line pt-1 font-semibold text-ink" : "text-muted"}`}><dt>{k}</dt><dd>{v}</dd></div>;
}
function ERowEdit({ k, value, onChange }: { k: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="w-32"><NumBox value={value} onChange={(v) => onChange(v === "" ? 0 : v)} className="py-1 text-right" /></dd>
    </div>
  );
}
