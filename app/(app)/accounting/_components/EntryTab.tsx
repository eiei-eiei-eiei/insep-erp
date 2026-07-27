"use client";

import { useMemo, useRef, useState } from "react";
import {
  entryCalc,
  itemTotal,
  itemDiscBahtFromPct,
  inVatFromExVat,
  exVatFromInVat,
  reverseWht,
  splitInstallments,
  round2,
} from "@/lib/accounting/calc";
import {
  saveTransactionAction,
  saveInstallmentsAction,
  scanReceiptAction,
  addContactAction,
  type TxItemInput,
} from "../actions";
import type { Bootstrap, Contact } from "./types";
import { Card, Field, Msg, NumInput, SaveButton, Select, TextInput, fmt, todayISO, useSaver } from "./ui";

type Item = {
  itemName: string;
  itemCategory: string;
  itemJob: string;
  quantity: number;
  exVat: number;
  inVat: number;
  discPct: number;
  discBaht: number;
};
type Inst = { percent: number; dueDate: string };

const emptyItem = (cat = "", job = ""): Item => ({ itemName: "", itemCategory: cat, itemJob: job, quantity: 1, exVat: 0, inVat: 0, discPct: 0, discBaht: 0 });

export function EntryTab({ boot, entityId }: { boot: Bootstrap; entityId: string }) {
  const { pending, msg, run, setMsg } = useSaver();
  const [type, setType] = useState<"รายรับ" | "รายจ่าย">("รายจ่าย");
  const [category, setCategory] = useState("");
  const [accountName, setAccountName] = useState("");
  const [contactName, setContactName] = useState("");
  const [description, setDescription] = useState("");
  const [txDate, setTxDate] = useState(todayISO());
  const [taxInvoiceNo, setTaxInvoiceNo] = useState("");
  const [taxInvoiceDate, setTaxInvoiceDate] = useState("");
  const [discount, setDiscount] = useState(0);
  const [hasVat, setHasVat] = useState(true);
  const [hasWht, setHasWht] = useState(false);
  const [whtRate, setWhtRate] = useState(0);
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [isApAr, setIsApAr] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [isInst, setIsInst] = useState(false);
  const [insts, setInsts] = useState<Inst[]>([{ percent: 50, dueDate: "" }, { percent: 50, dueDate: "" }]);
  const [showOpt, setShowOpt] = useState(false);

  // คู่ค้า (state ท้องถิ่น — เพิ่มใหม่ได้ทันที)
  const [contacts, setContacts] = useState<Contact[]>(boot.contacts);
  const [showContactModal, setShowContactModal] = useState(false);
  const [branchId, setBranchId] = useState(""); // สาขาที่เลือก (เมื่อชื่อซ้ำหลายสาขา, D30)

  // reverse WHT
  const [revNet, setRevNet] = useState(0);
  const [revRate, setRevRate] = useState(3);
  const rev = useMemo(() => reverseWht(revNet, revRate), [revNet, revRate]);

  const isCost = type === "รายจ่าย" && category === "ต้นทุนสุรา";
  const cats = type === "รายรับ" ? boot.incomeCats : boot.expenseCats;

  // บัญชี: แสดงเฉพาะที่ผูกกับกิจการนี้ (entity_ids ว่าง = ใช้ร่วมทุกกิจการ)
  const accountOptions = boot.accounts.filter((a) => {
    const ids = a.entity_ids ?? [];
    return ids.length === 0 || ids.includes(entityId);
  });
  // คู่ค้า: รายรับ→ลูกค้า, รายจ่าย→ผู้ขาย · เว้นว่าง/"ทั้งสอง" = โผล่ทั้งคู่
  const contactOptions = contacts.filter((c) => {
    const t = (c.contact_type ?? "").trim();
    if (!t || t === "ทั้งสอง") return true;
    return type === "รายรับ" ? t === "ลูกค้า" : t === "ผู้ขาย";
  });
  // multi-branch (D30): คู่ค้าที่ชื่อตรงกับที่พิมพ์ — ถ้ามีหลายสาขาให้เลือกสาขา → ส่ง contact_id ที่แน่นอน
  const norm = (s: string) => s.trim().toLowerCase();
  const nameMatches = contacts.filter((c) => norm(c.name) === norm(contactName));
  const multiBranch = nameMatches.length > 1;
  const effBranchId = multiBranch
    ? (nameMatches.some((c) => c.contact_id === branchId) ? branchId : nameMatches[0].contact_id)
    : "";
  const resolvedContactId =
    nameMatches.length === 1 ? nameMatches[0].contact_id : multiBranch ? effBranchId : undefined;

  const calc = useMemo(
    () => entryCalc({ items: items.map((it) => ({ quantity: it.quantity, exVat: it.exVat, discBaht: it.discBaht })), discount, hasVat, hasWht, whtRate }),
    [items, discount, hasVat, hasWht, whtRate],
  );
  const instRows = useMemo(() => splitInstallments(calc.amountAfterDiscount, insts, hasVat, hasWht ? whtRate : 0), [calc.amountAfterDiscount, insts, hasVat, hasWht, whtRate]);
  const instSumPct = insts.reduce((s, i) => s + (Number(i.percent) || 0), 0);

  function setItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  // แก้ราคา: in↔ex VAT สลับกัน · ส่วนลด %↔บาท
  function onExVat(i: number, v: number) { setItem(i, { exVat: v, inVat: inVatFromExVat(v), discBaht: round2(v * items[i].quantity * items[i].discPct / 100) }); }
  function onInVat(i: number, v: number) { const ex = exVatFromInVat(v); setItem(i, { inVat: v, exVat: ex, discBaht: round2(ex * items[i].quantity * items[i].discPct / 100) }); }
  function onQty(i: number, v: number) { setItem(i, { quantity: v, discBaht: itemDiscBahtFromPct(v, items[i].exVat, items[i].discPct) }); }
  function onDiscPct(i: number, v: number) { setItem(i, { discPct: v, discBaht: itemDiscBahtFromPct(items[i].quantity, items[i].exVat, v) }); }
  function onDiscBaht(i: number, v: number) { const gross = items[i].quantity * items[i].exVat; setItem(i, { discBaht: v, discPct: gross > 0 ? round2((v / gross) * 100) : 0 }); }
  function addItem() { const last = items[items.length - 1]; setItems((p) => [...p, emptyItem(last?.itemCategory ?? "", last?.itemJob ?? "")]); }

  function buildItemInputs(): TxItemInput[] {
    return items
      .filter((it) => it.itemName || it.exVat)
      .map((it) => ({
        item_name: it.itemName,
        quantity: it.quantity,
        in_vat: it.inVat || inVatFromExVat(it.exVat),
        ex_vat: it.exVat,
        total_price: itemTotal(it.quantity, it.exVat, it.discBaht),
        discount_pct: it.discPct,
        discount_baht: it.discBaht,
        item_category: it.itemCategory,
        item_job: it.itemJob,
      }));
  }

  function validate(): string | null {
    if (!entityId) return "เลือกกิจการก่อน";
    if (!category) return "เลือกหมวดหมู่";
    if (!isApAr && !isInst && !accountName && type !== "รายรับ") return "เลือกบัญชี (หรือติ๊กตั้งค้าง)";
    if (items.every((it) => !it.itemName && !it.exVat)) return "เพิ่มรายการอย่างน้อย 1 รายการ";
    return null;
  }

  function doSave() {
    const err = validate();
    if (err) { setMsg({ ok: false, text: err }); return; }
    const itemInputs = buildItemInputs();

    if (isInst) {
      if (Math.abs(instSumPct - 100) > 0.01) { setMsg({ ok: false, text: `ผลรวมงวด = ${instSumPct}% (ต้อง 100%)` }); return; }
      const rows = instRows.map((r) => ({ ...r, description: `${description}${description ? " " : ""}(งวด ${r.installmentNo}/${r.installmentTotal})` }));
      run(() => saveInstallmentsAction({ transaction_date: txDate, type, category, contact_name: contactName, contact_id: resolvedContactId, entity_id: entityId }, rows, itemInputs), `บันทึก ${rows.length} งวดเรียบร้อย (เป็นหนี้ค้างทั้งหมด)`, resetItems);
      return;
    }
    run(
      () => saveTransactionAction({
        transaction_date: txDate, type, account_name: isApAr ? "" : accountName, category, contact_name: contactName, contact_id: resolvedContactId, description,
        base_amount: calc.baseAmount, discount, amount_after_discount: calc.amountAfterDiscount, vat_amount: calc.vatAmount,
        wht_rate: calc.whtRate, wht_amount: calc.whtAmount, net_amount: calc.netAmount,
        tax_invoice_no: taxInvoiceNo, tax_invoice_date: taxInvoiceDate, entity_id: entityId,
        ap_ar_status: isApAr ? (type === "รายรับ" ? "AR" : "AP") : "", due_date: isApAr ? dueDate : "", forward_material: isCost,
      }, itemInputs),
      "บันทึกข้อมูลเรียบร้อยแล้ว",
      (data) => { const d = data as { warning?: string | null } | undefined; if (d?.warning) setMsg({ ok: true, text: d.warning }); resetItems(); },
    );
  }
  function resetItems() { setItems([emptyItem()]); setDescription(""); setTaxInvoiceNo(""); }

  // ── สแกนใบเสร็จ ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  async function onScan(file: File) {
    setScanning(true); setMsg(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const r = await scanReceiptAction(base64, file.type);
      setScanning(false);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? "สแกนไม่สำเร็จ" }); return; }
      const d = r.data as { taxInvoiceNo?: string; taxInvoiceDate?: string; description?: string; hasVat?: boolean; priceType?: string; items?: { itemName?: string | null; quantity?: number; scannedPrice?: number }[] };
      if (d.taxInvoiceNo) setTaxInvoiceNo(d.taxInvoiceNo);
      if (d.taxInvoiceDate) { setTaxInvoiceDate(d.taxInvoiceDate); if (!txDate) setTxDate(d.taxInvoiceDate); }
      if (d.description) setDescription(d.description);
      if (typeof d.hasVat === "boolean") setHasVat(d.hasVat);
      if (d.items?.length) {
        const inclVat = d.priceType === "incl_vat";
        setItems(d.items.map((it) => {
          const price = Number(it.scannedPrice) || 0;
          const ex = inclVat ? round2(price / 1.07) : price;
          return { ...emptyItem(), itemName: it.itemName ?? "", quantity: Number(it.quantity) || 1, exVat: ex, inVat: inVatFromExVat(ex) };
        }));
      }
      setMsg({ ok: true, text: "สแกนสำเร็จ — ตรวจทานตัวเลขก่อนบันทึก" });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title="ข้อมูลบิล">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="ประเภท">
              <Select value={type} onChange={(e) => { setType(e.target.value as "รายรับ" | "รายจ่าย"); setCategory(""); }}>
                <option value="รายจ่าย">รายจ่าย</option>
                <option value="รายรับ">รายรับ</option>
              </Select>
            </Field>
            <Field label="หมวดหมู่">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">— เลือก —</option>
                {cats.map((c) => (<option key={c} value={c}>{c}</option>))}
                {type === "รายจ่าย" && !cats.includes("ต้นทุนสุรา") && <option value="ต้นทุนสุรา">ต้นทุนสุรา</option>}
              </Select>
            </Field>
            <Field label="บัญชี">
              <Select value={accountName} onChange={(e) => setAccountName(e.target.value)} disabled={isApAr || isInst}>
                <option value="">{isApAr || isInst ? "(ตั้งค้าง — เติมตอนชำระ)" : "— เลือก —"}</option>
                {accountOptions.map((a) => (<option key={a.account_name} value={a.account_name}>{a.account_name}</option>))}
              </Select>
            </Field>
            <Field label="คู่ค้า">
              <div className="flex gap-1">
                <input list="contact-list" value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none" />
                <button type="button" onClick={() => setShowContactModal(true)} title="เพิ่มคู่ค้าใหม่" className="rounded-lg border border-slate-300 px-2 text-slate-600 hover:bg-slate-50">＋</button>
              </div>
              <datalist id="contact-list">{contactOptions.map((c) => (<option key={c.contact_id} value={c.name} />))}</datalist>
              {multiBranch && (
                <div className="mt-1">
                  <Select value={effBranchId} onChange={(e) => setBranchId(e.target.value)}>
                    {nameMatches.map((c) => (
                      <option key={c.contact_id} value={c.contact_id}>
                        สาขา {c.branch || "สำนักงานใหญ่"}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-0.5 text-xs text-amber-600">คู่ค้านี้มี {nameMatches.length} สาขา — เลือกสาขาให้ถูกก่อนบันทึก (ออกเอกสาร/ภพ.30 ตามสาขานี้)</p>
                </div>
              )}
            </Field>
            <Field label="วันที่รายการ"><TextInput type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} /></Field>
            <Field label="เลขที่ใบกำกับภาษี"><TextInput value={taxInvoiceNo} onChange={(e) => setTaxInvoiceNo(e.target.value)} /></Field>
            <Field label="วันที่ใบกำกับ"><TextInput type="date" value={taxInvoiceDate} onChange={(e) => setTaxInvoiceDate(e.target.value)} /></Field>
            <div className="col-span-2 md:col-span-3"><Field label="รายละเอียด"><TextInput value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={scanning} className="rounded-lg border border-purple-300 bg-purple-50 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50">{scanning ? "กำลังสแกน…" : "🔍 สแกนใบเสร็จด้วย AI"}</button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onScan(f); e.target.value = ""; }} />
            <button type="button" onClick={() => setShowOpt((v) => !v)} className="text-xs text-slate-500 hover:text-slate-700">{showOpt ? "🙈 ซ่อนคอลัมน์เสริม" : "👁️ แสดงคอลัมน์เสริม (หมวด/งาน/ส่วนลด)"}</button>
            {isCost && <span className="text-xs text-amber-600">ต้นทุนสุรา — จะรับวัตถุดิบเข้าสต็อกผลิตอัตโนมัติ (ชื่อรายการต้องตรง master)</span>}
          </div>
        </Card>

        <Card title="รายการสินค้า">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="p-1">ชื่อรายการ</th>
                  {showOpt && <th className="p-1 w-24">หมวดหมู่</th>}
                  {showOpt && <th className="p-1 w-20">งาน</th>}
                  <th className="p-1 w-14">จำนวน</th>
                  <th className="p-1 w-24">รวม VAT</th>
                  <th className="p-1 w-24">ไม่รวม VAT</th>
                  {showOpt && <th className="p-1 w-14">ลด %</th>}
                  {showOpt && <th className="p-1 w-20">ลด บาท</th>}
                  <th className="p-1 w-24 text-right">รวม</th>
                  <th className="p-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-1">
                      {isCost ? (
                        <Select value={it.itemName} onChange={(e) => setItem(i, { itemName: e.target.value })}>
                          <option value="">— เลือกวัตถุดิบ —</option>
                          {boot.materials.map((m) => (<option key={m.material_id} value={m.name}>{m.name}</option>))}
                        </Select>
                      ) : (
                        <TextInput value={it.itemName} onChange={(e) => setItem(i, { itemName: e.target.value })} placeholder="ชื่อสินค้า/บริการ" />
                      )}
                    </td>
                    {showOpt && <td className="p-1"><input list="cat-item-list" value={it.itemCategory} onChange={(e) => setItem(i, { itemCategory: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none" placeholder="หมวดหมู่" /></td>}
                    {showOpt && <td className="p-1"><TextInput value={it.itemJob} onChange={(e) => setItem(i, { itemJob: e.target.value })} placeholder="งาน" /></td>}
                    <td className="p-1"><NumInput value={it.quantity} onChange={(e) => onQty(i, Number(e.target.value))} /></td>
                    <td className="p-1"><NumInput value={it.inVat || ""} onChange={(e) => onInVat(i, Number(e.target.value))} /></td>
                    <td className="p-1"><NumInput value={it.exVat || ""} onChange={(e) => onExVat(i, Number(e.target.value))} /></td>
                    {showOpt && <td className="p-1"><NumInput value={it.discPct || ""} onChange={(e) => onDiscPct(i, Number(e.target.value))} /></td>}
                    {showOpt && <td className="p-1"><NumInput value={it.discBaht || ""} onChange={(e) => onDiscBaht(i, Number(e.target.value))} /></td>}
                    <td className="p-1 text-right font-medium">{fmt(itemTotal(it.quantity, it.exVat, it.discBaht))}</td>
                    <td className="p-1"><button type="button" onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="cat-item-list">{[...new Set(items.map((it) => it.itemCategory).filter(Boolean))].map((c) => (<option key={c} value={c} />))}</datalist>
          </div>
          <button type="button" onClick={addItem} className="mt-2 text-sm text-slate-600 hover:text-slate-800">+ เพิ่มรายการ</button>
          <p className="mt-1 text-xs text-slate-400">กรอกราคาช่องรวม VAT หรือ ไม่รวม VAT ช่องใดช่องหนึ่ง อีกช่องคำนวณให้ · ส่วนลด % ↔ บาท คิดจากราคาไม่รวม VAT × จำนวน</p>
        </Card>
      </div>

      {/* สรุป + ออปชัน */}
      <div className="space-y-4">
        <Card title="สรุปยอด">
          <div className="grid grid-cols-2 gap-2">
            <Field label="ยอดก่อนหักส่วนลดบิล"><TextInput readOnly value={fmt(calc.baseAmount)} /></Field>
            <Field label="ส่วนลดบิล"><NumInput value={discount || ""} onChange={(e) => setDiscount(Number(e.target.value))} /></Field>
          </div>
          <div className="mt-2 flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={hasVat} onChange={(e) => setHasVat(e.target.checked)} /> มี VAT 7%</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={hasWht} onChange={(e) => setHasWht(e.target.checked)} /> หัก ณ ที่จ่าย</label>
          </div>
          {hasWht && (
            <div className="mt-2"><Field label="อัตรา WHT (%)">
              <Select value={whtRate} onChange={(e) => setWhtRate(Number(e.target.value))}>
                <option value={0}>— เลือก —</option>
                {[...new Set([...boot.whtRates.map((r) => parseFloat(r)).filter((x) => !Number.isNaN(x)), 1, 2, 3, 5])].sort((a, b) => a - b).map((r) => (<option key={r} value={r}>{r}%</option>))}
              </Select>
            </Field></div>
          )}
          <dl className="mt-3 space-y-1 text-sm">
            <Row k="ยอดหลังหักส่วนลด" v={fmt(calc.amountAfterDiscount)} />
            <Row k="VAT" v={fmt(calc.vatAmount)} />
            <Row k="หัก ณ ที่จ่าย" v={fmt(calc.whtAmount)} />
            <Row k="ยอดสุทธิ" v={fmt(calc.netAmount)} bold />
          </dl>
        </Card>

        <Card title="ออปชัน">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isApAr} onChange={(e) => { setIsApAr(e.target.checked); if (e.target.checked) setIsInst(false); }} /> ตั้งเป็นบิลค้าง ({type === "รายรับ" ? "ลูกหนี้ AR" : "เจ้าหนี้ AP"})</label>
          {isApAr && <div className="mt-2"><Field label="วันครบกำหนด"><TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field></div>}
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={isInst} onChange={(e) => { setIsInst(e.target.checked); if (e.target.checked) setIsApAr(false); }} /> แบ่งจ่ายหลายงวด (ทุกงวดเป็นหนี้ค้าง)</label>
          {isInst && (
            <div className="mt-2 space-y-2">
              {insts.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <NumInput value={it.percent || ""} onChange={(e) => setInsts((p) => p.map((x, idx) => idx === i ? { ...x, percent: Number(e.target.value) } : x))} placeholder="%" className="w-20" />
                  <TextInput type="date" value={it.dueDate} onChange={(e) => setInsts((p) => p.map((x, idx) => idx === i ? { ...x, dueDate: e.target.value } : x))} />
                  <span className="w-24 text-right text-sm">{fmt(instRows[i]?.netAmount ?? 0)}</span>
                  <button type="button" onClick={() => setInsts((p) => p.filter((_, idx) => idx !== i))} className="text-red-500">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => setInsts((p) => [...p, { percent: 0, dueDate: "" }])} className="text-sm text-slate-600">+ เพิ่มงวด</button>
              <div className={`text-xs ${Math.abs(instSumPct - 100) < 0.01 ? "text-slate-400" : "text-red-500"}`}>รวม {instSumPct}% (ต้อง 100%)</div>
            </div>
          )}
          <div className="mt-4"><Msg msg={msg} /><SaveButton pending={pending} onClick={doSave}>บันทึก</SaveButton></div>
        </Card>

        <Card title="เครื่องคิดถอด WHT (จากยอดสุทธิ)">
          <div className="grid grid-cols-2 gap-2">
            <Field label="ยอดสุทธิที่จ่าย"><NumInput value={revNet || ""} onChange={(e) => setRevNet(Number(e.target.value))} /></Field>
            <Field label="อัตรา (%)"><NumInput value={revRate} onChange={(e) => setRevRate(Number(e.target.value))} /></Field>
          </div>
          <dl className="mt-2 space-y-1 text-sm"><Row k="ยอดก่อนหัก (ฐาน)" v={fmt(rev.base)} /><Row k="ภาษีหัก" v={fmt(rev.wht)} /></dl>
        </Card>
      </div>

      {showContactModal && (
        <ContactModal
          defaultName={contactName}
          onClose={() => setShowContactModal(false)}
          onSaved={(c) => { setContacts((p) => [...p, c]); setContactName(c.name); setShowContactModal(false); }}
        />
      )}
    </div>
  );

  function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
    return <div className={`flex justify-between ${bold ? "border-t border-slate-200 pt-1 font-semibold text-slate-800" : "text-slate-600"}`}><dt>{k}</dt><dd>{v}</dd></div>;
  }
}

function ContactModal({ defaultName, onClose, onSaved }: { defaultName: string; onClose: () => void; onSaved: (c: Contact) => void }) {
  const { pending, msg, run } = useSaver();
  const [name, setName] = useState(defaultName);
  const [taxId, setTaxId] = useState("");
  const [branch, setBranch] = useState("สำนักงานใหญ่");
  const [address, setAddress] = useState("");
  const [contactType, setContactType] = useState("ทั้งสอง");

  function save() {
    if (!name.trim()) return;
    run(() => addContactAction({ name: name.trim(), taxId, branch, address, contactType }), "เพิ่มคู่ค้าเรียบร้อย", (data) => {
      const id = (data as { contactId: string }).contactId;
      onSaved({ contact_id: id, name: name.trim(), tax_id: taxId, branch, address, contact_type: contactType, roles: [] });
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-semibold text-slate-800">เพิ่มคู่ค้าใหม่</h3>
        <div className="space-y-3">
          <Field label="ชื่อคู่ค้า"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="เลขภาษี"><TextInput value={taxId} onChange={(e) => setTaxId(e.target.value)} /></Field>
            <Field label="สาขา"><TextInput value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>
          </div>
          <Field label="ที่อยู่"><TextInput value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          <Field label="ประเภท"><Select value={contactType} onChange={(e) => setContactType(e.target.value)}><option>ทั้งสอง</option><option>ผู้ขาย</option><option>ลูกค้า</option></Select></Field>
        </div>
        <p className="mt-1 text-xs text-slate-400">“ทั้งสอง” = เป็นได้ทั้งผู้ขายและลูกค้า → โผล่ทั้งรายรับและรายจ่าย</p>
        <Msg msg={msg} />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">ยกเลิก</button>
          <SaveButton pending={pending} onClick={save}>เพิ่ม</SaveButton>
        </div>
      </div>
    </div>
  );
}
