"use client";

import { useEffect, useState } from "react";
import { saveMaterialAction, getRecentMaterialsAction, deleteMaterialLogAction } from "../actions";
import { Card, Field, Msg, NumInput, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import { MATERIAL_TYPES, type Material } from "./types";

type RecentMaterial = Awaited<ReturnType<typeof getRecentMaterialsAction>>[number];

export function MaterialTab({ materials }: { materials: Material[] }) {
  const { pending, msg, run } = useSaver();
  const [date, setDate] = useState(todayISO());
  const [transType, setTransType] = useState<string>("รับ");
  const [materialId, setMaterialId] = useState("");
  const [amount, setAmount] = useState("");
  const [docRef, setDocRef] = useState("");
  const [note, setNote] = useState("");
  const [recent, setRecent] = useState<RecentMaterial[]>([]);
  const matName = (id: string) => materials.find((m) => m.material_id === id)?.name ?? id;

  function loadRecent() { getRecentMaterialsAction().then((r) => setRecent(r as RecentMaterial[])); }
  useEffect(() => { loadRecent(); }, []);

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
        loadRecent();
      },
    );
  }
  function del(r: RecentMaterial) {
    if (!confirm(`ลบรายการ ${matName(r.material_id as string)} (${r.trans_type} ${r.amount})?`)) return;
    run(() => deleteMaterialLogAction(r.id as number), "ลบรายการเรียบร้อย", loadRecent);
  }

  return (
    <div className="space-y-5">
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

    <Card title="รายการล่าสุด (แก้ = ลบแล้วบันทึกใหม่)">
      {recent.length === 0 ? <p className="text-sm text-slate-400">— ยังไม่มีรายการ —</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500"><tr><th className="px-2 py-1">วันที่</th><th className="px-2 py-1">ประเภท</th><th className="px-2 py-1">วัตถุดิบ</th><th className="px-2 py-1 text-right">จำนวน</th><th className="px-2 py-1">หลักฐาน/หมายเหตุ</th><th className="px-2 py-1"></th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id as number} className="border-b border-slate-100">
                  <td className="whitespace-nowrap px-2 py-1">{String(r.doc_date).slice(0, 10)}</td>
                  <td className="px-2 py-1">{r.trans_type as string}</td>
                  <td className="px-2 py-1">{matName(r.material_id as string)}</td>
                  <td className="px-2 py-1 text-right">{r.amount as number}</td>
                  <td className="px-2 py-1 text-slate-500">{[r.doc_ref, r.note].filter(Boolean).join(" · ")}</td>
                  <td className="px-2 py-1"><button onClick={() => del(r)} disabled={pending} className="text-red-500 hover:text-red-700" title="ลบ">🗑️</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-400">แสดง 30 รายการล่าสุด · ลบแล้วสต็อกวัตถุดิบปรับให้อัตโนมัติ</p>
        </div>
      )}
    </Card>
    </div>
  );
}
