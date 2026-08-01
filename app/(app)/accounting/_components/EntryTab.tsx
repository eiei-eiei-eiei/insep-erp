"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  itemTotal,
  inVatFromExVat,
  reverseWht,
  splitInstallments,
  round2,
} from "@/lib/accounting/calc";
// ตรรกะแถวรายการ/ยอดบิล ใช้ร่วมกับฟอร์มแก้บิล (BillsTab → EditBillModal)
import { qn, emptyItem, makeItemHandlers, buildItemInputs, useBillAmounts, type BillItem } from "./billItems";
import {
  saveTransactionAction,
  saveInstallmentsAction,
  scanReceiptAction,
  addContactAction,
  getRecentBillsByContactAction,
  getItemHistoryAction,
} from "../actions";
import type { Bootstrap, Contact } from "./types";
import { Card, Field, Msg, NumBox, NumInput, SaveButton, Select, TextInput, cleanTaxId13, fmt, todayISO, useSaver } from "./ui";

type Item = BillItem;
type Inst = { percent: number; dueDate: string };
type RecentBill = Awaited<ReturnType<typeof getRecentBillsByContactAction>>[number];
type ItemHist = Awaited<ReturnType<typeof getItemHistoryAction>>;

const DRAFT_KEY = "acc-entry-draft-v1";
type Draft = {
  type: "รายรับ" | "รายจ่าย"; category: string; accountName: string; contactName: string; description: string;
  txDate: string; taxInvoiceNo: string; taxInvoiceDate: string; discount: number; hasVat: boolean; hasWht: boolean;
  whtRate: number; items: Item[]; isApAr: boolean; dueDate: string; isInst: boolean; insts: Inst[]; branchId: string;
  manualAmt: boolean; ovAfterDisc: number; ovVat: number; ovWht: number;
};

export function EntryTab({ boot, entityId, ambiguous }: { boot: Bootstrap; entityId: string; ambiguous: boolean }) {
  const { pending, msg, run, setMsg } = useSaver();
  // เมื่อ header เลือก "ทุกกิจการ" → กิจการปลายทางกำกวม ให้ผู้ใช้เลือกชัดเจนในฟอร์ม (กันบันทึกเข้ากิจการผิดเงียบ ๆ)
  const [pickedEntity, setPickedEntity] = useState(entityId);
  const effEntity = ambiguous ? (pickedEntity || entityId) : entityId;
  const effEntityName = boot.entities.find((e) => e.entity_id === effEntity)?.name ?? "";
  const [type, setType] = useState<"รายรับ" | "รายจ่าย">("รายจ่าย");
  const [category, setCategory] = useState("");
  const [accountName, setAccountName] = useState("");
  const [contactName, setContactName] = useState("");
  const [description, setDescription] = useState("");
  const [txDate, setTxDate] = useState(todayISO());
  const [taxInvoiceNo, setTaxInvoiceNo] = useState("");
  const [taxInvoiceDate, setTaxInvoiceDate] = useState("");
  const [discount, setDiscount] = useState(0);
  const [hasVat, setHasVat] = useState(false); // ออโต้ติ๊กเมื่อกรอกเลขใบกำกับ (ผู้ใช้ override เองได้)
  const [hasWht, setHasWht] = useState(false);
  const [whtRate, setWhtRate] = useState(0);
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [isApAr, setIsApAr] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [isInst, setIsInst] = useState(false);
  const [insts, setInsts] = useState<Inst[]>([{ percent: 50, dueDate: "" }, { percent: 50, dueDate: "" }]);
  const [showOpt, setShowOpt] = useState(false);

  // ยอดของบิล: ปกติคำนวณอัตโนมัติ · โหมด "แก้ยอดเอง" ล็อกไว้ ต้องกดปลดล็อกก่อนแก้ (กันเผลอ)
  // ตรรกะร่วมกับฟอร์มแก้บิล (billItems.ts) — สูตรจริงยังอยู่ lib/accounting/calc
  const amt = useBillAmounts({ items, discount, hasVat, hasWht, whtRate });
  const {
    calc, manualAmt, setManualAmt, ovAfterDisc, setOvAfterDisc, ovVat, setOvVat, ovWht, setOvWht,
    effAfterDisc, effVat, effWht, effNet, unlockAmounts, lockAmounts,
  } = amt;

  // คู่ค้า (state ท้องถิ่น — เพิ่มใหม่ได้ทันที)
  const [contacts, setContacts] = useState<Contact[]>(boot.contacts);
  const [showContactModal, setShowContactModal] = useState(false);
  const [branchId, setBranchId] = useState(""); // สาขาที่เลือก (เมื่อชื่อซ้ำหลายสาขา, D30)

  // ประวัติ (บิลล่าสุดของคู่ค้า + ค่าไม่ซ้ำของรายการสินค้า → ดรอปดาวน์)
  const [recentBills, setRecentBills] = useState<RecentBill[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [itemHist, setItemHist] = useState<ItemHist>({ itemNames: [], itemCategories: [], itemJobs: [] });

  // validate: ไฮไลต์ช่องที่ผิด + เลื่อนไปหา
  const [errField, setErrField] = useState<string | null>(null);
  const catRef = useRef<HTMLInputElement>(null);
  const billCardRef = useRef<HTMLDivElement>(null);
  const itemsCardRef = useRef<HTMLDivElement>(null);

  // reverse WHT
  const [revNet, setRevNet] = useState(0);
  const [revRate, setRevRate] = useState(3);
  const rev = useMemo(() => reverseWht(revNet, revRate), [revNet, revRate]);

  const isCost = type === "รายจ่าย" && category === "ต้นทุนสุรา";
  const cats = type === "รายรับ" ? boot.incomeCats : boot.expenseCats;

  // ── กู้/เก็บร่างที่ยังไม่บันทึก (localStorage) — สลับแท็บ/รีเฟรชแล้วข้อมูลไม่หาย ──
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<Draft>;
        if (d.type) setType(d.type);
        if (d.category != null) setCategory(d.category);
        if (d.accountName != null) setAccountName(d.accountName);
        if (d.contactName != null) setContactName(d.contactName);
        if (d.description != null) setDescription(d.description);
        if (d.txDate) setTxDate(d.txDate);
        if (d.taxInvoiceNo != null) setTaxInvoiceNo(d.taxInvoiceNo);
        if (d.taxInvoiceDate != null) setTaxInvoiceDate(d.taxInvoiceDate);
        if (d.discount != null) setDiscount(d.discount);
        if (d.hasVat != null) setHasVat(d.hasVat);
        if (d.hasWht != null) setHasWht(d.hasWht);
        if (d.whtRate != null) setWhtRate(d.whtRate);
        if (Array.isArray(d.items) && d.items.length) setItems(d.items);
        if (d.isApAr != null) setIsApAr(d.isApAr);
        if (d.dueDate != null) setDueDate(d.dueDate);
        if (d.isInst != null) setIsInst(d.isInst);
        if (Array.isArray(d.insts) && d.insts.length) setInsts(d.insts);
        if (d.branchId != null) setBranchId(d.branchId);
        if (d.manualAmt != null) setManualAmt(d.manualAmt);
        if (d.ovAfterDisc != null) setOvAfterDisc(d.ovAfterDisc);
        if (d.ovVat != null) setOvVat(d.ovVat);
        if (d.ovWht != null) setOvWht(d.ovWht);
      }
    } catch { /* ignore */ }
    setHydrated(true);
    // กู้ร่างครั้งเดียวตอน mount · setter จาก useBillAmounts เสถียร (useState) ไม่ต้องใส่ deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const draft: Draft = { type, category, accountName, contactName, description, txDate, taxInvoiceNo, taxInvoiceDate, discount, hasVat, hasWht, whtRate, items, isApAr, dueDate, isInst, insts, branchId, manualAmt, ovAfterDisc, ovVat, ovWht };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore */ }
  }, [hydrated, type, category, accountName, contactName, description, txDate, taxInvoiceNo, taxInvoiceDate, discount, hasVat, hasWht, whtRate, items, isApAr, dueDate, isInst, insts, branchId, manualAmt, ovAfterDisc, ovVat, ovWht]);
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
  function clearForm() {
    setType("รายจ่าย"); setCategory(""); setAccountName(""); setContactName(""); setDescription("");
    setTxDate(todayISO()); setTaxInvoiceNo(""); setTaxInvoiceDate(""); setDiscount(0); setHasVat(false);
    setHasWht(false); setWhtRate(0); setItems([emptyItem()]); setIsApAr(false); setDueDate("");
    setIsInst(false); setInsts([{ percent: 50, dueDate: "" }, { percent: 50, dueDate: "" }]); setBranchId("");
    setManualAmt(false); setOvAfterDisc(0); setOvVat(0); setOvWht(0);
    setRecentBills([]); setShowRecent(false); clearDraft(); setMsg(null);
  }

  // ── ประวัติค่าไม่ซ้ำของรายการสินค้า (โหลดตอนเข้า + รีเฟรชหลังบันทึกบิล) ──
  const refreshItemHist = useCallback(() => { getItemHistoryAction(effEntity).then(setItemHist); }, [effEntity]);
  useEffect(() => { refreshItemHist(); }, [refreshItemHist]);

  const norm = (s: string) => s.trim().toLowerCase();
  // multi-branch (D30): คู่ค้าที่ชื่อตรงกับที่พิมพ์ — ถ้ามีหลายสาขาให้เลือกสาขา → ส่ง contact_id ที่แน่นอน
  const nameMatches = contacts.filter((c) => norm(c.name) === norm(contactName));
  const multiBranch = nameMatches.length > 1;
  const effBranchId = multiBranch
    ? (nameMatches.some((c) => c.contact_id === branchId) ? branchId : nameMatches[0].contact_id)
    : "";
  const resolvedContactId =
    nameMatches.length === 1 ? nameMatches[0].contact_id : multiBranch ? effBranchId : undefined;

  // ── บิลล่าสุดของคู่ค้า (เมื่อชื่อตรงกับคู่ค้าในระบบ) — ผูกสาขาที่เลือกไว้ ไม่ปนสาขาอื่น ──
  useEffect(() => {
    const name = contactName.trim();
    if (!name || nameMatches.length === 0) { setRecentBills([]); setShowRecent(false); return; }
    let alive = true;
    const h = setTimeout(() => {
      getRecentBillsByContactAction(name, 5, effEntity, resolvedContactId).then((r) => { if (alive) { setRecentBills(r); setShowRecent(r.length > 0); } });
    }, 300);
    return () => { alive = false; clearTimeout(h); };
  }, [contactName, effEntity, nameMatches.length, resolvedContactId]);

  function applyRecentBill(b: RecentBill) {
    setDescription(b.description);
    if (b.category) setCategory(b.category);
    if (b.items.length) {
      setItems(b.items.map((it) => ({
        itemName: it.itemName, itemCategory: it.itemCategory, itemJob: it.itemJob,
        quantity: it.quantity || 1, exVat: it.exVat, inVat: it.inVat || inVatFromExVat(it.exVat),
        discPct: it.discountPct, discBaht: it.discountBaht,
      })));
    }
    setShowRecent(false);
  }

  // บัญชี: แสดงเฉพาะที่ผูกกับกิจการนี้ (entity_ids ว่าง = ใช้ร่วมทุกกิจการ)
  const accountOptions = boot.accounts.filter((a) => {
    const ids = a.entity_ids ?? [];
    return ids.length === 0 || ids.includes(effEntity);
  });
  // คู่ค้า: รายรับ→ลูกค้า, รายจ่าย→ผู้ขาย · เว้นว่าง/"ทั้งสอง" = โผล่ทั้งคู่
  const contactOptions = contacts.filter((c) => {
    const t = (c.contact_type ?? "").trim();
    if (!t || t === "ทั้งสอง") return true;
    return type === "รายรับ" ? t === "ลูกค้า" : t === "ผู้ขาย";
  });

  const instRows = useMemo(() => splitInstallments(effAfterDisc, insts, hasVat, hasWht ? whtRate : 0), [effAfterDisc, insts, hasVat, hasWht, whtRate]);
  const instSumPct = insts.reduce((s, i) => s + (Number(i.percent) || 0), 0);

  // แก้ราคา: in↔ex VAT สลับกัน · ส่วนลด %↔บาท (ตรรกะร่วมกับ EditBillModal — billItems.ts)
  const { setItem, onExVat, onInVat, onQty, onDiscPct, onDiscBaht, removeItem } = makeItemHandlers(items, setItems);
  function addItem() { const last = items[items.length - 1]; setItems((p) => [...p, emptyItem(last?.itemCategory ?? "", last?.itemJob ?? "")]); }
  // Enter ในช่องตัวเลข (ไม่ใช่ช่องมี datalist) = เพิ่มแถวใหม่ · Ctrl+Enter = บันทึก (จับที่ระดับบน)
  function onItemsKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLInputElement;
    if (t.tagName === "INPUT" && !t.getAttribute("list")) { e.preventDefault(); addItem(); }
  }

  type ErrField = "entity" | "category" | "account" | "items";
  function validate(): { text: string; field: ErrField } | null {
    if (!effEntity) return { text: "เลือกกิจการก่อน", field: "entity" };
    if (!category) return { text: "เลือกหมวดหมู่", field: "category" };
    if (!isApAr && !isInst && !accountName && type !== "รายรับ") return { text: "เลือกบัญชี (หรือติ๊กตั้งค้าง)", field: "account" };
    if (items.every((it) => !it.itemName && !it.exVat)) return { text: "เพิ่มรายการอย่างน้อย 1 รายการ", field: "items" };
    return null;
  }
  function flagError(field: ErrField) {
    setErrField(field);
    const target = field === "items" ? itemsCardRef.current : field === "category" ? catRef.current : billCardRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (field === "category") catRef.current?.focus();
  }

  function doSave() {
    const err = validate();
    if (err) { setMsg({ ok: false, text: err.text }); flagError(err.field); return; }
    const itemInputs = buildItemInputs(items);

    if (isInst) {
      if (Math.abs(instSumPct - 100) > 0.01) { setMsg({ ok: false, text: `ผลรวมงวด = ${instSumPct}% (ต้อง 100%)` }); return; }
      const rows = instRows.map((r) => ({ ...r, description: `${description}${description ? " " : ""}(งวด ${r.installmentNo}/${r.installmentTotal})` }));
      run(() => saveInstallmentsAction({ transaction_date: txDate, type, category, contact_name: contactName, contact_id: resolvedContactId, entity_id: effEntity }, rows, itemInputs), `บันทึก ${rows.length} งวดเรียบร้อย (เป็นหนี้ค้างทั้งหมด)`, () => { resetItems(); refreshItemHist(); });
      return;
    }
    run(
      () => saveTransactionAction({
        transaction_date: txDate, type, account_name: isApAr ? "" : accountName, category, contact_name: contactName, contact_id: resolvedContactId, description,
        base_amount: calc.baseAmount, discount, amount_after_discount: effAfterDisc, vat_amount: effVat,
        wht_rate: calc.whtRate, wht_amount: effWht, net_amount: effNet,
        tax_invoice_no: taxInvoiceNo, tax_invoice_date: taxInvoiceDate, entity_id: effEntity,
        ap_ar_status: isApAr ? (type === "รายรับ" ? "AR" : "AP") : "", due_date: isApAr ? dueDate : "", forward_material: isCost,
      }, itemInputs),
      "บันทึกข้อมูลเรียบร้อยแล้ว",
      (data) => { const d = data as { warning?: string | null } | undefined; if (d?.warning) setMsg({ ok: true, text: d.warning }); resetItems(); refreshItemHist(); },
    );
  }
  // หลังบันทึก: ล้างเฉพาะรายการ/รายละเอียด/เลขใบกำกับ (คงคู่ค้า/หมวดหมู่ไว้กรอกบิลถัดไปเร็วขึ้น)
  function resetItems() { setItems([emptyItem()]); setDescription(""); setTaxInvoiceNo(""); setHasVat(false); setManualAmt(false); setOvAfterDisc(0); setOvVat(0); setOvWht(0); setDiscount(0); }

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

  // ค่ารวมสำหรับดรอปดาวน์รายการสินค้า (ประวัติ + ที่กรอกในบิลปัจจุบัน)
  const itemCatOptions = useMemo(() => [...new Set([...itemHist.itemCategories, ...items.map((it) => it.itemCategory).filter(Boolean)])], [itemHist.itemCategories, items]);
  const itemJobOptions = useMemo(() => [...new Set([...itemHist.itemJobs, ...items.map((it) => it.itemJob).filter(Boolean)])], [itemHist.itemJobs, items]);

  return (
    <div className="space-y-4" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doSave(); } }}>
      <div ref={billCardRef}>
      <Card title="ข้อมูลบิล">
        {ambiguous ? (
          <div className={`mb-3 rounded-lg border p-2 ${errField === "entity" ? "border-crit-line bg-crit-bg" : "border-warn-line bg-warn-bg"}`}>
            <span className="mb-1 block text-xs font-medium text-warn">⚠️ ด้านบนเลือก “ทุกกิจการ” — เลือกกิจการที่จะบันทึกเข้าให้ชัดเจนก่อน</span>
            <Select value={effEntity} onChange={(e) => { setPickedEntity(e.target.value); setErrField(null); }}>
              {boot.entities.map((en) => (<option key={en.entity_id} value={en.entity_id}>{en.entity_id} — {en.name}</option>))}
            </Select>
          </div>
        ) : (
          <div className="mb-3 text-xs text-faint">📍 บันทึกเข้ากิจการ: <b className="text-muted">{effEntity}{effEntityName ? ` — ${effEntityName}` : ""}</b></div>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="ประเภท">
            <Select value={type} onChange={(e) => { setType(e.target.value as "รายรับ" | "รายจ่าย"); setCategory(""); }}>
              <option value="รายจ่าย">รายจ่าย</option>
              <option value="รายรับ">รายรับ</option>
            </Select>
          </Field>
          <Field label="หมวดหมู่">
            <input ref={catRef} list="bill-cat-list" value={category} onChange={(e) => { setCategory(e.target.value); setErrField(null); }} placeholder="พิมพ์เพื่อค้นหา / เลือก" className={`w-full rounded-lg border px-3 py-2 text-ink outline-none focus:ring-2 ${errField === "category" ? "border-crit-line ring-2 ring-crit-line" : "border-line focus:border-brand focus:ring-brand-soft"}`} />
            <datalist id="bill-cat-list">
              {cats.map((c) => (<option key={c} value={c} />))}
              {type === "รายจ่าย" && !cats.includes("ต้นทุนสุรา") && <option value="ต้นทุนสุรา" />}
            </datalist>
          </Field>
          <Field label="บัญชี">
            <Select value={accountName} onChange={(e) => { setAccountName(e.target.value); setErrField(null); }} disabled={isApAr || isInst} className={errField === "account" ? "border-crit-line ring-2 ring-crit-line" : ""}>
              <option value="">{isApAr || isInst ? "(ตั้งค้าง — เติมตอนชำระ)" : "— เลือก —"}</option>
              {accountOptions.map((a) => (<option key={a.account_name} value={a.account_name}>{a.account_name}</option>))}
            </Select>
          </Field>
          <Field label="คู่ค้า">
            <div className="flex gap-1">
              <input list="contact-list" value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-ink outline-none" />
              <button type="button" onClick={() => setShowContactModal(true)} title="เพิ่มคู่ค้าใหม่" className="rounded-lg border border-line px-2 text-muted hover:bg-raised">＋</button>
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
                <p className="mt-0.5 text-xs text-warn">คู่ค้านี้มี {nameMatches.length} สาขา — เลือกสาขาให้ถูกก่อนบันทึก (ออกเอกสาร/ภพ.30 ตามสาขานี้)</p>
              </div>
            )}
          </Field>
          <Field label="วันที่รายการ"><TextInput type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} /></Field>
          <Field label="เลขที่ใบกำกับภาษี"><TextInput value={taxInvoiceNo} onChange={(e) => { setTaxInvoiceNo(e.target.value); setHasVat(e.target.value.trim() !== ""); }} placeholder="มีเลข = ติ๊ก VAT อัตโนมัติ" /></Field>
          <Field label="วันที่ใบกำกับ"><TextInput type="date" value={taxInvoiceDate} onChange={(e) => setTaxInvoiceDate(e.target.value)} /></Field>
          <div className="col-span-2 md:col-span-3"><Field label="รายละเอียด"><TextInput value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
        </div>

        {showRecent && recentBills.length > 0 && (
          <div className="mt-3 rounded-lg border border-brand-line bg-brand-soft/50 p-2">
            <div className="mb-1 flex items-center justify-between text-xs text-brand">
              <span>📋 บิลล่าสุดของคู่ค้านี้ — กดเพื่อเติมรายละเอียด/หมวดหมู่/รายการ</span>
              <button type="button" onClick={() => setShowRecent(false)} className="text-brand hover:text-brand">ซ่อน</button>
            </div>
            <div className="divide-y divide-line-soft">
              {recentBills.map((b) => (
                <button key={b.txId} type="button" onClick={() => applyRecentBill(b)} className="flex w-full items-center gap-2 px-1 py-1.5 text-left text-xs hover:bg-brand-soft/60">
                  <span className="flex-shrink-0 text-faint">{b.date}</span>
                  <span className="flex-1 truncate font-medium text-muted">{b.description || "-"}</span>
                  <span className="flex-shrink-0 text-faint">{b.category}</span>
                  <span className="flex-shrink-0 font-semibold text-brand">฿{fmt(b.netAmount)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={scanning} className="rounded-lg border border-brand-line bg-brand px-3 py-2 text-sm font-medium text-brand hover:opacity-90 disabled:opacity-50">{scanning ? "กำลังสแกน…" : "🔍 สแกนใบเสร็จด้วย AI"}</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onScan(f); e.target.value = ""; }} />
          <button type="button" onClick={() => setShowOpt((v) => !v)} className="text-xs text-faint hover:text-ink">{showOpt ? "🙈 ซ่อนคอลัมน์เสริม" : "👁️ แสดงคอลัมน์เสริม (หมวด/งาน/ส่วนลด)"}</button>
          <button type="button" onClick={() => { if (confirm("ล้างฟอร์มทั้งหมด? (ข้อมูลที่กรอกค้างจะหาย)")) clearForm(); }} className="text-xs text-faint hover:text-crit">🗑️ ล้างฟอร์ม</button>
          {isCost && <span className="text-xs text-warn">ต้นทุนสุรา — จะรับวัตถุดิบเข้าสต็อกผลิตอัตโนมัติ (ชื่อรายการต้องตรง master)</span>}
        </div>
      </Card>
      </div>

      <div ref={itemsCardRef} onKeyDown={onItemsKeyDown}>
      <Card title="รายการสินค้า">
        {/* Desktop: ตาราง */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-faint">
                <th className="p-1">ชื่อรายการ</th>
                {showOpt && <th className="p-1 w-28">หมวดหมู่</th>}
                {showOpt && <th className="p-1 w-24">งาน</th>}
                <th className="p-1 w-16">จำนวน</th>
                <th className="p-1 w-28">รวม VAT</th>
                <th className="p-1 w-28">ไม่รวม VAT</th>
                {showOpt && <th className="p-1 w-16">ลด %</th>}
                {showOpt && <th className="p-1 w-24">ลด บาท</th>}
                <th className="p-1 w-28 text-right">รวม</th>
                <th className="p-1 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-line-soft">
                  <td className="p-1">
                    {isCost ? (
                      <Select value={it.itemName} onChange={(e) => setItem(i, { itemName: e.target.value })}>
                        <option value="">— เลือกวัตถุดิบ —</option>
                        {boot.materials.map((m) => (<option key={m.material_id} value={m.name}>{m.name}</option>))}
                      </Select>
                    ) : (
                      <TextInput list="hist-item-names" value={it.itemName} onChange={(e) => setItem(i, { itemName: e.target.value })} placeholder="ชื่อสินค้า/บริการ" />
                    )}
                  </td>
                  {showOpt && <td className="p-1"><TextInput list="hist-item-cats" value={it.itemCategory} onChange={(e) => setItem(i, { itemCategory: e.target.value })} placeholder="หมวดหมู่" /></td>}
                  {showOpt && <td className="p-1"><TextInput list="hist-item-jobs" value={it.itemJob} onChange={(e) => setItem(i, { itemJob: e.target.value })} placeholder="งาน" /></td>}
                  <td className="p-1"><NumBox value={it.quantity} onChange={(v) => onQty(i, v)} /></td>
                  <td className="p-1"><NumBox value={it.inVat} blankZero onChange={(v) => onInVat(i, v === "" ? 0 : v)} /></td>
                  <td className="p-1"><NumBox value={it.exVat} blankZero onChange={(v) => onExVat(i, v === "" ? 0 : v)} /></td>
                  {showOpt && <td className="p-1"><NumBox value={it.discPct} blankZero onChange={(v) => onDiscPct(i, v === "" ? 0 : v)} /></td>}
                  {showOpt && <td className="p-1"><NumBox value={it.discBaht} blankZero onChange={(v) => onDiscBaht(i, v === "" ? 0 : v)} /></td>}
                  <td className="p-1 text-right font-medium">{fmt(itemTotal(qn(it.quantity), it.exVat, it.discBaht))}</td>
                  <td className="p-1"><button type="button" onClick={() => removeItem(i)} title="ลบรายการนี้" className="text-crit hover:text-crit">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: การ์ดต่อรายการ */}
        <div className="space-y-3 md:hidden">
          {items.map((it, i) => (
            <div key={i} className="rounded-lg border border-line p-3">
              <div className="mb-2 flex items-start gap-2">
                <div className="flex-1">
                  {isCost ? (
                    <Select value={it.itemName} onChange={(e) => setItem(i, { itemName: e.target.value })}>
                      <option value="">— เลือกวัตถุดิบ —</option>
                      {boot.materials.map((m) => (<option key={m.material_id} value={m.name}>{m.name}</option>))}
                    </Select>
                  ) : (
                    <TextInput list="hist-item-names" value={it.itemName} onChange={(e) => setItem(i, { itemName: e.target.value })} placeholder="ชื่อสินค้า/บริการ" />
                  )}
                </div>
                <button type="button" onClick={() => removeItem(i)} title="ลบรายการนี้" className="px-2 py-1 text-crit hover:text-crit">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="block"><span className="mb-0.5 block text-faint">จำนวน</span><NumBox value={it.quantity} onChange={(v) => onQty(i, v)} /></label>
                <label className="block"><span className="mb-0.5 block text-faint">ราคา/หน่วย (รวม VAT)</span><NumBox value={it.inVat} blankZero onChange={(v) => onInVat(i, v === "" ? 0 : v)} /></label>
                <label className="col-span-2 block"><span className="mb-0.5 block text-faint">ราคา/หน่วย (ไม่รวม VAT)</span><NumBox value={it.exVat} blankZero onChange={(v) => onExVat(i, v === "" ? 0 : v)} /></label>
                {showOpt && <label className="block"><span className="mb-0.5 block text-faint">หมวดหมู่</span><TextInput list="hist-item-cats" value={it.itemCategory} onChange={(e) => setItem(i, { itemCategory: e.target.value })} /></label>}
                {showOpt && <label className="block"><span className="mb-0.5 block text-faint">งาน</span><TextInput list="hist-item-jobs" value={it.itemJob} onChange={(e) => setItem(i, { itemJob: e.target.value })} /></label>}
                {showOpt && <label className="block"><span className="mb-0.5 block text-faint">ลด %</span><NumBox value={it.discPct} blankZero onChange={(v) => onDiscPct(i, v === "" ? 0 : v)} /></label>}
                {showOpt && <label className="block"><span className="mb-0.5 block text-faint">ลด บาท</span><NumBox value={it.discBaht} blankZero onChange={(v) => onDiscBaht(i, v === "" ? 0 : v)} /></label>}
              </div>
              <div className="mt-2 text-right text-sm font-medium text-muted">รวม ฿{fmt(itemTotal(qn(it.quantity), it.exVat, it.discBaht))}</div>
            </div>
          ))}
        </div>

        <datalist id="hist-item-names">{itemHist.itemNames.map((v) => (<option key={v} value={v} />))}</datalist>
        <datalist id="hist-item-cats">{itemCatOptions.map((v) => (<option key={v} value={v} />))}</datalist>
        <datalist id="hist-item-jobs">{itemJobOptions.map((v) => (<option key={v} value={v} />))}</datalist>
        <button type="button" onClick={addItem} className="mt-2 text-sm text-muted hover:text-ink">+ เพิ่มรายการ</button>
        <p className="mt-1 text-xs text-faint">กรอกราคาช่องรวม VAT หรือ ไม่รวม VAT ช่องใดช่องหนึ่ง อีกช่องคำนวณให้ · ส่วนลด % ↔ บาท คิดจากราคาไม่รวม VAT × จำนวน · Enter ในช่องตัวเลข = เพิ่มแถว</p>
      </Card>
      </div>

      {/* สรุป + ออปชัน (ย้ายมาไว้ล่าง เพื่อให้ตารางรายการสินค้าเต็มความกว้าง) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="สรุปยอด">
          <div className="grid grid-cols-2 gap-2">
            <Field label="ยอดก่อนหักส่วนลดบิล"><TextInput readOnly value={fmt(calc.baseAmount)} /></Field>
            <Field label="ส่วนลดบิล"><NumBox value={discount} blankZero onChange={(v) => setDiscount(v === "" ? 0 : v)} /></Field>
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
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-faint">ยอดคำนวณ</span>
            {manualAmt
              ? <button type="button" onClick={lockAmounts} className="text-xs text-faint hover:underline">↩️ กลับไปคำนวณอัตโนมัติ</button>
              : <button type="button" onClick={unlockAmounts} className="text-xs text-brand hover:underline">✏️ แก้ยอดเอง</button>}
          </div>
          <dl className="mt-1 space-y-1 text-sm">
            {manualAmt ? (
              <>
                <RowEdit k="ยอดหลังหักส่วนลด" value={ovAfterDisc} onChange={setOvAfterDisc} />
                <RowEdit k="VAT" value={ovVat} onChange={setOvVat} />
                <RowEdit k="หัก ณ ที่จ่าย" value={ovWht} onChange={setOvWht} />
              </>
            ) : (
              <>
                <Row k="ยอดหลังหักส่วนลด" v={fmt(effAfterDisc)} />
                <Row k="VAT" v={fmt(effVat)} />
                <Row k="หัก ณ ที่จ่าย" v={fmt(effWht)} />
              </>
            )}
            <Row k="ยอดสุทธิ" v={fmt(effNet)} bold />
          </dl>
          {manualAmt && <p className="mt-1 text-xs text-warn">โหมดแก้ยอดเอง — 3 ค่านี้จะไม่คำนวณอัตโนมัติจนกดกลับ (ยอดสุทธิ = หลังหักส่วนลด + VAT − หัก ณ ที่จ่าย)</p>}
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
                  <button type="button" onClick={() => setInsts((p) => p.filter((_, idx) => idx !== i))} className="text-crit">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => setInsts((p) => [...p, { percent: 0, dueDate: "" }])} className="text-sm text-muted">+ เพิ่มงวด</button>
              <div className={`text-xs ${Math.abs(instSumPct - 100) < 0.01 ? "text-faint" : "text-crit"}`}>รวม {instSumPct}% (ต้อง 100%)</div>
            </div>
          )}
          <div className="mt-4"><Msg msg={msg} /><SaveButton pending={pending} onClick={doSave}>บันทึก</SaveButton><span className="ml-2 text-xs text-faint">หรือกด Ctrl+Enter</span></div>
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
    return <div className={`flex justify-between ${bold ? "border-t border-line pt-1 font-semibold text-ink" : "text-muted"}`}><dt>{k}</dt><dd>{v}</dd></div>;
  }
  function RowEdit({ k, value, onChange }: { k: string; value: number; onChange: (n: number) => void }) {
    return (
      <div className="flex items-center justify-between gap-2">
        <dt className="text-muted">{k}</dt>
        <dd className="w-32"><NumBox value={value} onChange={(v) => onChange(v === "" ? 0 : v)} className="py-1 text-right" /></dd>
      </div>
    );
  }
}

function ContactModal({ defaultName, onClose, onSaved }: { defaultName: string; onClose: () => void; onSaved: (c: Contact) => void }) {
  const { pending, msg, run, setMsg } = useSaver();
  const [name, setName] = useState(defaultName);
  const [taxId, setTaxId] = useState("");
  const [branch, setBranch] = useState("สำนักงานใหญ่");
  const [address, setAddress] = useState("");
  const [contactType, setContactType] = useState("ทั้งสอง");

  function save() {
    if (!name.trim()) { setMsg({ ok: false, text: "กรุณากรอกชื่อคู่ค้า" }); return; }
    const tax = cleanTaxId13(taxId);
    if (!tax) { setMsg({ ok: false, text: "เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก" }); return; }
    run(() => addContactAction({ name: name.trim(), taxId: tax, branch, address, contactType }), "เพิ่มคู่ค้าเรียบร้อย", (data) => {
      const id = (data as { contactId: string }).contactId;
      onSaved({ contact_id: id, name: name.trim(), tax_id: tax, branch, address, contact_type: contactType, roles: [] });
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-semibold text-ink">เพิ่มคู่ค้าใหม่</h3>
        <div className="space-y-3">
          <Field label="ชื่อคู่ค้า"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="เลขภาษี (13 หลัก)"><TextInput value={taxId} onChange={(e) => setTaxId(e.target.value)} inputMode="numeric" placeholder="เลข 13 หลัก" /></Field>
            <Field label="สาขา"><TextInput value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>
          </div>
          <Field label="ที่อยู่"><TextInput value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          <Field label="ประเภท"><Select value={contactType} onChange={(e) => setContactType(e.target.value)}><option>ทั้งสอง</option><option>ผู้ขาย</option><option>ลูกค้า</option></Select></Field>
        </div>
        <p className="mt-1 text-xs text-faint">“ทั้งสอง” = เป็นได้ทั้งผู้ขายและลูกค้า → โผล่ทั้งรายรับและรายจ่าย</p>
        <Msg msg={msg} />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">ยกเลิก</button>
          <SaveButton pending={pending} onClick={save}>เพิ่ม</SaveButton>
        </div>
      </div>
    </div>
  );
}
