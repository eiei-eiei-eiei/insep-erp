"use client";

import { useEffect, useState } from "react";
import type { SalesBoot, CustomerRow, MenuRow, OrderRow, OrderItem } from "./types";
import { Card, Combobox, Msg, NumBox, NumInput, Select, TextInput, useSaver, fmt } from "./ui";
import { quotationTotals, inclFromExVat } from "@/lib/sales/calc";
import {
  saveQuotationAction,
  updateQuotationAction,
  getOrderItemsAction,
  saveCustomerAction,
  type QuotationPayload,
} from "../actions";
import { printQuotation, openPrintWindow } from "./print";

const REVENUE_CATS = ["รายได้ค่าสินค้า", "รายได้ค่าบริการ", "รายได้ค่าที่ปรึกษา", "รายได้อื่น ๆ"];

export function QuotationTab({
  boot,
  canWrite,
  editOrder,
  onDoneEdit,
}: {
  boot: SalesBoot;
  canWrite: boolean;
  editOrder: OrderRow | null;
  onDoneEdit: () => void;
}) {
  const [customers, setCustomers] = useState<CustomerRow[]>(boot.customers);
  const [selCustId, setSelCustId] = useState("");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [category, setCategory] = useState("รายได้ค่าสินค้า");
  const [isWht, setIsWht] = useState(false);
  const [whtPct, setWhtPct] = useState(3);
  const [isDeposit, setIsDeposit] = useState(false);
  const [depositPct, setDepositPct] = useState(50);
  const [remarks, setRemarks] = useState("");
  const [saleName, setSaleName] = useState("");
  const [showAddCust, setShowAddCust] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const { pending, msg, run, setMsg } = useSaver();

  const customer = customers.find((c) => c.id === selCustId);

  // โหลดออเดอร์ที่จะแก้ไข → prefill
  useEffect(() => {
    if (!editOrder) return;
    setMsg(null);
    setSelCustId(editOrder.customerId);
    setDiscount(editOrder.discount || 0);
    setCategory(editOrder.category || "รายได้ค่าสินค้า");
    setRemarks(editOrder.remarks || "");
    setIsWht((editOrder.whtPercent || 0) > 0);
    setWhtPct(editOrder.whtPercent > 0 ? editOrder.whtPercent : 3);
    getOrderItemsAction(editOrder.quNo).then((its) => setItems(its.map((i) => ({ ...i }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOrder?.quNo]);

  useEffect(() => {
    if (customer && !saleName) setSaleName(customer.saleName || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selCustId]);

  const totals = quotationTotals({ items, discount, isWhtRequired: isWht, whtPercent: whtPct, isDepositRequired: isDeposit, depositPercent: depositPct });

  function addRawItem(name: string, price: number) {
    setItems((prev) => {
      const ex = prev.find((i) => i.name === name);
      if (ex) return prev.map((i) => (i.name === name ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { name, price, qty: 1 }];
    });
  }
  function addToCart(m: MenuRow) {
    if (m.stockQty === 0) return;
    addRawItem(m.name, m.price);
  }

  function reset() {
    setItems([]);
    setDiscount(0);
    setRemarks("");
    setIsWht(false);
    setIsDeposit(false);
    setSelCustId("");
    setCategory("รายได้ค่าสินค้า");
    onDoneEdit();
  }

  function submit() {
    if (!customer || items.length === 0 || !saleName.trim()) return;
    const payload: QuotationPayload = {
      customer: { id: customer.id, name: customer.name, address: customer.address, taxId: customer.taxId, branch: customer.branch, creditTerm: customer.creditTerm },
      items,
      discount,
      isWhtRequired: isWht,
      whtPercent: whtPct,
      isDepositRequired: isDeposit,
      depositPercent: depositPct,
      saleName,
      category,
      remarks,
    };
    const snapItems = [...items];
    if (editOrder) {
      run(() => updateQuotationAction(editOrder.quNo, payload), `อัปเดต ${editOrder.quNo} แล้ว`, () => reset());
    } else {
      const w = openPrintWindow(); // เปิดก่อน await กัน popup blocker (มือถือ/iPad)
      run(() => saveQuotationAction(payload), "สร้างใบเสนอราคาแล้ว", (data) => {
        const res = data as { qu_no: string; qu_expire: string };
        printQuotation({
          quNo: res.qu_no,
          date: new Date().toLocaleDateString("th-TH"),
          quExp: res.qu_expire,
          customerName: customer.name,
          customerAddress: customer.address,
          customerTaxId: customer.taxId,
          customerBranch: customer.branch,
          creditTerm: customer.creditTerm,
          items: snapItems,
          subTotal: totals.subTotal,
          discount: Math.round(discount * 100) / 100,
          subDiscount: totals.subDiscount,
          vat: totals.vatAmount,
          grandTotal: totals.grandTotal,
          whtPercent: isWht ? whtPct : 0,
          whtAmount: totals.whtAmount,
          netPayable: totals.netPayable,
          remarks,
          saleName,
        }, w);
        reset();
      });
    }
  }

  if (!canWrite) return <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">ไม่มีสิทธิ์สร้างใบเสนอราคา</div>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      {/* ซ้าย: ลูกค้า + เมนู */}
      <div className="space-y-4">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">🏢 เลือกลูกค้า</h2>
            <button onClick={() => setShowAddCust(true)} className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100">
              ➕ เพิ่มลูกค้าใหม่
            </button>
          </div>
          <Combobox
            value={selCustId}
            onChange={setSelCustId}
            placeholder="พิมพ์ชื่อ/รหัสลูกค้าเพื่อค้นหา…"
            options={customers.map((c) => ({ value: c.id, label: `${c.id} | ${c.name}` }))}
          />
          {customer && (
            <div className="mt-2 text-xs text-slate-600">
              Tax ID: {customer.taxId || "-"} · เครดิต {customer.creditTerm} วัน {customer.isExport && <span className="text-amber-700">· 🌍 ส่งออก</span>}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">รายการสินค้า (ราคารวม VAT)</h2>
            <button
              onClick={() => setShowCustom(true)}
              disabled={!selCustId}
              className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              ➕ สินค้านอกระบบ/สั่งทำ
            </button>
          </div>
          {!selCustId ? (
            <div className="py-8 text-center text-sm text-slate-400">เลือกลูกค้าก่อนเพื่อเริ่มจัดออเดอร์</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {boot.menu.map((m) => (
                <button
                  key={m.name}
                  onClick={() => addToCart(m)}
                  disabled={m.stockQty === 0}
                  className={`flex h-24 flex-col justify-between rounded-xl border p-3 text-left transition ${m.stockQty === 0 ? "cursor-not-allowed border-slate-200 bg-slate-100 opacity-60" : "border-slate-200 bg-white hover:border-amber-400 hover:shadow"}`}
                >
                  <div className="line-clamp-2 text-xs font-medium text-slate-800">{m.name}</div>
                  <div className="flex items-end justify-between">
                    <span className="text-sm font-bold text-amber-600">฿{fmt(m.price)}</span>
                    {m.stockQty !== null && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${m.stockQty === 0 ? "bg-red-100 text-red-600" : m.stockQty <= 5 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>
                        {m.stockQty === 0 ? "หมด" : m.stockQty}
                        {m.isLive && m.stockQty !== 0 && " 🏭"}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ขวา: ตะกร้า + สรุป */}
      <Card className="h-fit">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-amber-900">ออเดอร์ (B2B)</h2>
          {editOrder && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">✏️ แก้ไข {editOrder.quNo}</span>}
        </div>
        <Msg msg={msg} />
        <div className="mb-3 max-h-56 overflow-y-auto">
          {items.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">ยังไม่มีรายการ</div>
          ) : (
            items.map((it, i) => (
              <div key={i} className="flex items-center gap-2 border-b py-2 text-sm">
                <div className="flex-1">
                  <div className="whitespace-pre-wrap font-medium text-slate-800">{it.name}</div>
                  <div className="text-xs text-slate-500">฿{fmt(it.price)} / หน่วย</div>
                </div>
                <input
                  type="number"
                  min={1}
                  value={it.qty}
                  onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))}
                  className="w-14 rounded border bg-slate-50 p-1 text-center text-sm font-bold outline-none"
                />
                <div className="w-20 text-right text-sm font-semibold">฿{fmt(it.price * it.qty)}</div>
                <button onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-700">ประเภทรายได้ (สำหรับบัญชี)</span>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {REVENUE_CATS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </label>

          <label className="flex items-center gap-2 border-t pt-2 text-sm font-bold text-slate-700">
            <input type="checkbox" checked={isDeposit} onChange={(e) => setIsDeposit(e.target.checked)} /> กำหนดเงื่อนไขมัดจำ
          </label>
          {isDeposit && (
            <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs">
              <span>% มัดจำ:</span>
              <input type="number" min={0} max={100} value={depositPct} onChange={(e) => setDepositPct(Number(e.target.value) || 0)} className="w-16 rounded border p-1 text-center" />
              <span className="ml-auto font-bold text-amber-900">= ฿{fmt(totals.expectedDeposit)}</span>
            </div>
          )}

          <label className="flex items-center gap-2 border-t pt-2 text-sm font-bold text-slate-700">
            <input type="checkbox" checked={isWht} onChange={(e) => setIsWht(e.target.checked)} /> หัก ณ ที่จ่าย (WHT)
          </label>
          {isWht && (
            <div className="flex items-center gap-2 rounded border border-blue-200 bg-blue-50 p-2 text-xs">
              <span>% หัก:</span>
              <input type="number" min={0} max={100} value={whtPct} onChange={(e) => setWhtPct(Number(e.target.value) || 0)} className="w-16 rounded border p-1 text-center" />
              <span className="ml-auto font-bold text-blue-900">- ฿{fmt(totals.whtAmount)}</span>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">หมายเหตุ / เงื่อนไข</span>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 p-2 text-sm outline-none focus:border-amber-500" />
          </label>

          <div className="flex items-center justify-between">
            <span className="text-slate-600">ผู้เสนอราคา</span>
            <TextInput value={saleName} onChange={(e) => setSaleName(e.target.value)} className="w-40" placeholder="ชื่อผู้ขาย" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-600">ส่วนลดพิเศษ (บาท, รวม VAT)</span>
            <NumBox value={discount} blankZero onChange={(v) => setDiscount(v === "" ? 0 : v)} className="w-28 text-right" />
          </div>

          <div className="space-y-1 border-t pt-2 text-slate-600">
            <Row label="รวมเป็นเงิน (รวม VAT)" value={totals.grandIncl} />
            {discount > 0 && <Row label="หักส่วนลด (รวม VAT)" value={-discount} />}
            <Row label="มูลค่าก่อน VAT" value={totals.subDiscount} />
            <Row label="VAT 7% (รวมในราคาแล้ว)" value={totals.vatAmount} />
            <div className="flex justify-between border-t pt-1 font-bold text-slate-800">
              <span>ยอดรวมทั้งสิ้น</span>
              <span>฿{fmt(totals.grandTotal)}</span>
            </div>
            {isWht && (
              <>
                <Row label={`หัก ณ ที่จ่าย ${whtPct}%`} value={-totals.whtAmount} tone="blue" />
                <div className="flex justify-between border-t pt-1 text-base font-bold text-amber-900">
                  <span>ยอดชำระสุทธิ</span>
                  <span>฿{fmt(totals.netPayable)}</span>
                </div>
              </>
            )}
          </div>

          <button
            onClick={submit}
            disabled={pending || items.length === 0 || !selCustId || !saleName.trim()}
            className={`w-full rounded-xl py-3 font-bold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300 ${editOrder ? "bg-teal-600 hover:bg-teal-700" : "bg-amber-600 hover:bg-amber-700"}`}
          >
            {pending ? "กำลังทำงาน…" : editOrder ? "💾 อัปเดตใบเสนอราคา" : "📄 ออกใบเสนอราคา (A4)"}
          </button>
          {editOrder && (
            <button onClick={reset} className="w-full rounded-lg border border-slate-300 py-2 text-sm text-slate-600 hover:bg-slate-50">
              ✕ ยกเลิกการแก้ไข
            </button>
          )}
        </div>
      </Card>

      {showAddCust && (
        <AddCustomerModal
          onClose={() => setShowAddCust(false)}
          onAdded={(c) => {
            setCustomers((prev) => [...prev, c]);
            setSelCustId(c.id);
            setShowAddCust(false);
          }}
        />
      )}

      {showCustom && (
        <CustomItemModal
          onClose={() => setShowCustom(false)}
          onAdd={(name, price) => {
            addRawItem(name, price);
            setShowCustom(false);
          }}
        />
      )}
    </div>
  );
}

function CustomItemModal({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string, priceIncl: number) => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [vatType, setVatType] = useState<"incl" | "excl">("incl");
  const [err, setErr] = useState("");

  // แปลงเป็นราคารวม VAT ก่อนใส่ตะกร้า (ระบบทำงานแบบ inclusive)
  const priceIncl = price === "" ? 0 : vatType === "excl" ? inclFromExVat(Number(price)) : Number(price);

  function add() {
    const p = Number(price);
    if (!name.trim() || isNaN(p) || p <= 0) { setErr("กรอกรายละเอียดสินค้า + ราคาให้ถูกต้อง (มากกว่า 0)"); return; }
    onAdd(name.trim(), priceIncl);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">➕ เพิ่มสินค้านอกระบบ / สั่งทำ</h2>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-red-500">
            &times;
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block font-bold text-slate-700">รายละเอียดสินค้า/บริการ</span>
            <textarea value={name} onChange={(e) => setName(e.target.value)} rows={4} placeholder="ระบุรายละเอียด (ขึ้นบรรทัดใหม่ได้)" className="w-full rounded-lg border border-slate-300 p-2 outline-none focus:border-amber-500" />
          </label>
          <div>
            <span className="mb-1 block font-bold text-slate-700">ราคาต่อหน่วย (บาท)</span>
            <div className="flex gap-2">
              <NumBox value={price} blankZero onChange={(v) => setPrice(v)} className="flex-1" />
              <select value={vatType} onChange={(e) => setVatType(e.target.value as "incl" | "excl")} className="rounded-lg border border-slate-300 px-2 outline-none focus:border-amber-500">
                <option value="incl">รวม VAT แล้ว</option>
                <option value="excl">ก่อน VAT</option>
              </select>
            </div>
            {price !== "" && vatType === "excl" && <div className="mt-1 text-xs text-slate-500">= รวม VAT ฿{fmt(priceIncl)} (จะใส่ราคานี้ลงตะกร้า)</div>}
          </div>
          <div className="text-xs text-slate-400">สินค้านอกระบบไม่ตัดสต็อก (ไม่มีใน sale_menu) — ใช้กับงานสั่งทำ/บริการ</div>
          {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</div>}
          <button onClick={add} className="w-full rounded-lg bg-blue-600 py-2 font-bold text-white hover:bg-blue-700">
            เพิ่มลงตะกร้า
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: number; tone?: "blue" }) {
  return (
    <div className={`flex justify-between text-sm ${tone === "blue" ? "font-bold text-blue-600" : ""}`}>
      <span>{label}</span>
      <span>฿{fmt(value)}</span>
    </div>
  );
}

function AddCustomerModal({ onClose, onAdded }: { onClose: () => void; onAdded: (c: CustomerRow) => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [branchMode, setBranchMode] = useState<"hq" | "branch">("hq");
  const [branchNumber, setBranchNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [creditTerm, setCreditTerm] = useState(0);
  const [isExport, setIsExport] = useState(false);
  const { pending, msg, run, setMsg } = useSaver();

  function save() {
    const branch = branchMode === "hq" ? "สำนักงานใหญ่" : branchNumber.padStart(5, "0");
    if (!name.trim()) { setMsg({ ok: false, text: "กรอกชื่อลูกค้า" }); return; }
    if (!/^\d{13}$/.test(taxId)) { setMsg({ ok: false, text: "เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก" }); return; }
    if (branchMode === "branch" && !/^\d{5}$/.test(branch)) { setMsg({ ok: false, text: "เลขสาขาต้องเป็นตัวเลข 5 หลัก" }); return; }
    run(
      () => saveCustomerAction({ name, address, taxId, branch, phone, creditTerm, isExport }),
      "เพิ่มลูกค้าแล้ว",
      (data) => {
        const { id } = data as { id: string };
        onAdded({ id, name, address, taxId, branch, phone, creditTerm, saleName: "", isExport });
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">➕ เพิ่มลูกค้าใหม่</h2>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-red-500">
            &times;
          </button>
        </div>
        <Msg msg={msg} />
        <div className="space-y-3">
          <TextInput placeholder="ชื่อบริษัท / ลูกค้า *" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea placeholder="ที่อยู่จดทะเบียน *" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 p-2 text-sm outline-none focus:border-amber-500" />
          <div className="grid grid-cols-2 gap-3">
            <TextInput placeholder="เลขผู้เสียภาษี 13 หลัก *" maxLength={13} value={taxId} onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ""))} />
            <div className="text-sm">
              <label className="mr-3">
                <input type="radio" checked={branchMode === "hq"} onChange={() => setBranchMode("hq")} /> สนญ.
              </label>
              <label>
                <input type="radio" checked={branchMode === "branch"} onChange={() => setBranchMode("branch")} /> สาขา
              </label>
              {branchMode === "branch" && <TextInput placeholder="00001" maxLength={5} value={branchNumber} onChange={(e) => setBranchNumber(e.target.value.replace(/\D/g, ""))} className="mt-1" />}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextInput placeholder="เบอร์โทร" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <NumInput placeholder="เครดิต (วัน)" value={creditTerm || ""} onChange={(e) => setCreditTerm(Number(e.target.value) || 0)} />
          </div>
          <label className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <input type="checkbox" checked={isExport} onChange={(e) => setIsExport(e.target.checked)} />
            <span>
              <b className="text-amber-700">ลูกค้าจำหน่ายต่างประเทศ (Export)</b> — ส่งข้อมูลให้แอปผลิตเป็น &quot;จำหน่ายต่างประเทศ&quot;
            </span>
          </label>
          <button onClick={save} disabled={pending} className="w-full rounded-lg bg-amber-600 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : "บันทึกข้อมูลลูกค้า"}
          </button>
        </div>
      </div>
    </div>
  );
}
