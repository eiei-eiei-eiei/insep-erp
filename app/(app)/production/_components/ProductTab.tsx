"use client";

import { useEffect, useState } from "react";
import { saveProductAction, getRecentProductsAction, deleteProductLogAction } from "../actions";
import { Card, Field, Msg, NumInput, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import { PRODUCT_TYPES, type Product } from "./types";

type RecentProduct = Awaited<ReturnType<typeof getRecentProductsAction>>[number];

export function ProductTab({ products }: { products: Product[] }) {
  const { pending, msg, run } = useSaver();
  const [date, setDate] = useState(todayISO());
  const [transType, setTransType] = useState<string>("รับ");
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [recent, setRecent] = useState<RecentProduct[]>([]);
  const prodName = (id: string) => products.find((p) => p.product_id === id)?.name ?? id;

  function loadRecent() { getRecentProductsAction().then((r) => setRecent(r as RecentProduct[])); }
  useEffect(() => { loadRecent(); }, []);

  function submit() {
    if (!productId || !amount) return;
    run(
      () =>
        saveProductAction({
          date,
          transType,
          productId,
          amount: parseFloat(amount),
          note,
        }),
      "บันทึกขวดเรียบร้อย (สต็อกอัปเดตแล้ว)",
      () => {
        setAmount("");
        setNote("");
        loadRecent();
      },
    );
  }
  function del(r: RecentProduct) {
    if (!confirm(`ลบรายการ ${prodName(r.product_id as string)} (${r.trans_type} ${r.amount} ขวด)? สต็อกจะปรับให้`)) return;
    run(() => deleteProductLogAction(r.id as number), "ลบรายการเรียบร้อย (สต็อกอัปเดตแล้ว)", loadRecent);
  }

  return (
    <div className="space-y-5">
    <Card title="บรรจุ / จ่ายขวด (Log_Product → สต็อก)">
      <Msg msg={msg} />
      <p className="mb-3 text-xs text-slate-500">
        &quot;รับ&quot; = บรรจุเข้าสต็อก (+) · ประเภทอื่นทั้งหมด = จ่ายออก (−)
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="วันที่">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="ประเภท">
          <Select value={transType} onChange={(e) => setTransType(e.target.value)}>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="สินค้า">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">-- เลือกสินค้า --</option>
            {products.map((p) => (
              <option key={p.product_id} value={p.product_id}>
                {p.name} {p.degree ? `${p.degree}°` : ""} {p.bottle_size_l ? `${p.bottle_size_l}ล.` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="จำนวน (ขวด)">
          <NumInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="หมายเหตุ / ลูกค้า">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4">
        <SaveButton pending={pending} onClick={submit} disabled={!productId || !amount}>
          บันทึกขวด
        </SaveButton>
      </div>
    </Card>

    <Card title="รายการล่าสุด (แก้ = ลบแล้วบันทึกใหม่)">
      {recent.length === 0 ? <p className="text-sm text-slate-400">— ยังไม่มีรายการ —</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500"><tr><th className="px-2 py-1">วันที่</th><th className="px-2 py-1">ประเภท</th><th className="px-2 py-1">สินค้า</th><th className="px-2 py-1 text-right">ขวด</th><th className="px-2 py-1">หมายเหตุ</th><th className="px-2 py-1"></th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id as number} className="border-b border-slate-100">
                  <td className="whitespace-nowrap px-2 py-1">{String(r.doc_date).slice(0, 10)}</td>
                  <td className="px-2 py-1">{r.trans_type as string}</td>
                  <td className="px-2 py-1">{prodName(r.product_id as string)}</td>
                  <td className="px-2 py-1 text-right">{r.amount as number}</td>
                  <td className="px-2 py-1 text-slate-500">{(r.note as string) ?? ""}</td>
                  <td className="px-2 py-1"><button onClick={() => del(r)} disabled={pending} className="text-red-500 hover:text-red-700" title="ลบ">🗑️</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-400">แสดง 30 รายการล่าสุด · ลบแล้วสต็อกสินค้าปรับให้อัตโนมัติ (trigger)</p>
        </div>
      )}
    </Card>
    </div>
  );
}
