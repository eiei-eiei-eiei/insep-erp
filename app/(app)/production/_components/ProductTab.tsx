"use client";

import { useEffect, useState } from "react";
import { saveProductAction, getRecentProductsAction, deleteProductLogAction, updateProductLogAction } from "../actions";
import { Card, Field, Msg, NumInput, RowBtn, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import { PRODUCT_TYPES, type Product } from "./types";
import { IconEdit, IconTrash } from "@/lib/shared/icons";

type RecentProduct = Awaited<ReturnType<typeof getRecentProductsAction>>[number];
type EditFields = { date: string; transType: string; productId: string; amount: string; note: string };

export function ProductTab({ products }: { products: Product[] }) {
  const { pending, msg, run } = useSaver();
  const [date, setDate] = useState(todayISO());
  const [transType, setTransType] = useState<string>("รับ");
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [recent, setRecent] = useState<RecentProduct[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<EditFields>({ date: "", transType: "รับ", productId: "", amount: "", note: "" });
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
  function startEdit(r: RecentProduct) {
    setEditId(r.id as number);
    setEdit({
      date: String(r.doc_date).slice(0, 10),
      transType: (r.trans_type as string) ?? "รับ",
      productId: (r.product_id as string) ?? "",
      amount: String(r.amount ?? ""),
      note: (r.note as string) ?? "",
    });
  }
  function saveEdit() {
    if (editId == null) return;
    run(
      () => updateProductLogAction(editId, {
        date: edit.date, transType: edit.transType, productId: edit.productId,
        amount: parseFloat(edit.amount) || 0, note: edit.note,
      }),
      "แก้ไขรายการเรียบร้อย (สต็อกอัปเดตแล้ว)",
      () => { setEditId(null); loadRecent(); },
    );
  }

  return (
    <div className="space-y-5">
    <Card title="บรรจุ / จ่ายขวด (Log_Product → สต็อก)">
      <Msg msg={msg} />
      <p className="mb-3 text-xs text-faint">
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

    <Card title="รายการล่าสุด (แก้ไข / ลบ ได้จากแอป)">
      {recent.length === 0 ? <p className="text-sm text-faint">— ยังไม่มีรายการ —</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-faint"><tr><th className="px-2 py-1">วันที่</th><th className="px-2 py-1">ประเภท</th><th className="px-2 py-1">สินค้า</th><th className="px-2 py-1 text-right">ขวด</th><th className="px-2 py-1">หมายเหตุ</th><th className="px-2 py-1"></th></tr></thead>
            <tbody>
              {recent.map((r) => (
                editId === (r.id as number) ? (
                  <tr key={r.id as number} className="border-b border-line-soft bg-warn-bg">
                    <td className="px-1 py-1"><TextInput type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} className="w-36" /></td>
                    <td className="px-1 py-1"><Select value={edit.transType} onChange={(e) => setEdit({ ...edit, transType: e.target.value })} className="w-32">{PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></td>
                    <td className="px-1 py-1"><Select value={edit.productId} onChange={(e) => setEdit({ ...edit, productId: e.target.value })} className="w-48">{products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name} {p.degree ? `${p.degree}°` : ""}</option>)}</Select></td>
                    <td className="px-1 py-1"><NumInput value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} className="w-24 text-right" /></td>
                    <td className="px-1 py-1"><TextInput value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></td>
                    <td className="whitespace-nowrap px-1 py-1">
                      <RowBtn tone="green" onClick={saveEdit} disabled={pending || !edit.productId}>บันทึก</RowBtn>
                      <RowBtn onClick={() => setEditId(null)} className="ml-1">ยกเลิก</RowBtn>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id as number} className="border-b border-line-soft">
                    <td className="whitespace-nowrap px-2 py-1">{String(r.doc_date).slice(0, 10)}</td>
                    <td className="px-2 py-1">{r.trans_type as string}</td>
                    <td className="px-2 py-1">{prodName(r.product_id as string)}</td>
                    <td className="px-2 py-1 text-right">{r.amount as number}</td>
                    <td className="px-2 py-1 text-faint">{(r.note as string) ?? ""}</td>
                    <td className="whitespace-nowrap px-2 py-1">
                      <button onClick={() => startEdit(r)} disabled={pending} className="text-muted hover:text-ink" title="แก้ไข"><IconEdit size={16} /></button>
                      <button onClick={() => del(r)} disabled={pending} className="ml-2 text-crit hover:text-crit" title="ลบ"><IconTrash size={16} /></button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-faint">แสดง 30 รายการล่าสุด · แก้/ลบแล้วสต็อกสินค้าปรับให้อัตโนมัติ (trigger ครอบ UPDATE/DELETE)</p>
        </div>
      )}
    </Card>
    </div>
  );
}
