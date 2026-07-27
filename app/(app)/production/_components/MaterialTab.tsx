"use client";

import { useState } from "react";
import { saveMaterialAction } from "../actions";
import { Card, Field, Msg, NumInput, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import { MATERIAL_TYPES, type Material } from "./types";

export function MaterialTab({ materials }: { materials: Material[] }) {
  const { pending, msg, run } = useSaver();
  const [date, setDate] = useState(todayISO());
  const [transType, setTransType] = useState<string>("รับ");
  const [materialId, setMaterialId] = useState("");
  const [amount, setAmount] = useState("");
  const [docRef, setDocRef] = useState("");
  const [note, setNote] = useState("");

  function submit() {
    if (!materialId || !amount) return;
    run(
      () =>
        saveMaterialAction({
          date,
          transType,
          materialId,
          amount: parseFloat(amount),
          docRef,
          note,
        }),
      "บันทึกวัตถุดิบเรียบร้อย",
      () => {
        setAmount("");
        setDocRef("");
        setNote("");
      },
    );
  }

  return (
    <Card title="บันทึกวัตถุดิบ (รับ/จ่าย)">
      <Msg msg={msg} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="วันที่">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="ประเภท">
          <Select value={transType} onChange={(e) => setTransType(e.target.value)}>
            {MATERIAL_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="วัตถุดิบ">
          <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
            <option value="">-- เลือกวัตถุดิบ --</option>
            {materials.map((m) => (
              <option key={m.material_id} value={m.material_id}>
                {m.name} {m.unit ? `(${m.unit})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="จำนวน">
          <NumInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="หลักฐานเลขที่ (ถ้ามี)">
          <TextInput value={docRef} onChange={(e) => setDocRef(e.target.value)} />
        </Field>
        <Field label="หมายเหตุ">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4">
        <SaveButton pending={pending} onClick={submit} disabled={!materialId || !amount}>
          บันทึกวัตถุดิบ
        </SaveButton>
      </div>
    </Card>
  );
}
