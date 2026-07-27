"use client";

import { useState } from "react";
import { saveProductAction } from "../actions";
import { Card, Field, Msg, NumInput, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import { PRODUCT_TYPES, type Product } from "./types";

export function ProductTab({ products }: { products: Product[] }) {
  const { pending, msg, run } = useSaver();
  const [date, setDate] = useState(todayISO());
  const [transType, setTransType] = useState<string>("รับ");
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

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
      },
    );
  }

  return (
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
  );
}
