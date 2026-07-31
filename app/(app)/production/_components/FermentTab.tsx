"use client";

import { useEffect, useState } from "react";
import { getNextBatchNumberAction, saveFermentAction, getRecentFermentsAction, deleteFermentBatchAction } from "../actions";
import { Card, Field, Msg, NumInput, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import type { Container, Material, Product } from "./types";

type MatRow = { material_id: string; amount: string };
type RecentFerment = Awaited<ReturnType<typeof getRecentFermentsAction>>[number];

export function FermentTab({
  materials,
  containers,
  products,
}: {
  materials: Material[];
  containers: Container[];
  products: Product[];
}) {
  const { pending, msg, run } = useSaver();
  const [date, setDate] = useState(todayISO());
  const [productName, setProductName] = useState("");
  const [batch, setBatch] = useState("");
  const [containerId, setContainerId] = useState("");
  const [volPerTank, setVolPerTank] = useState(""); // ปริมาณต่อถัง (ล.) — เติมจากความจุภาชนะ แก้ได้
  const [containerQty, setContainerQty] = useState("");
  const [rows, setRows] = useState<MatRow[]>([{ material_id: "", amount: "" }]);
  const [recent, setRecent] = useState<RecentFerment[]>([]);

  // ชื่อสุราไม่ซ้ำ
  const productNames = Array.from(new Set(products.map((p) => p.name)));

  function loadRecent() { getRecentFermentsAction().then(setRecent); }
  useEffect(() => { loadRecent(); }, []);

  // ★ วัตถุดิบหลัก (แถวแรก) = ปริมาณต่อถัง × จำนวนถัง (เหมือนแอปเดิม calculateMainMaterial) — แก้ทับเองได้
  function recalcMain(vol: string, qty: string) {
    const v = parseFloat(vol) || 0, q = parseFloat(qty) || 0;
    if (v > 0 && q > 0) setRows((prev) => prev.map((r, i) => (i === 0 ? { ...r, amount: (v * q).toFixed(2) } : r)));
  }
  function del(r: RecentFerment) {
    if (!confirm(`ลบ batch หมัก "${r.batch}" (${r.productName})?\nระบบจะคืนวัตถุดิบที่เบิก + ลบค่าติดตามหมัก · ถ้ากลั่นไปแล้วจะลบไม่ได้`)) return;
    run(() => deleteFermentBatchAction(r.batch), `ลบ batch ${r.batch} + คืนวัตถุดิบเรียบร้อย`, loadRecent);
  }

  // เลข batch อัตโนมัติจากวันที่ (ปรับได้)
  useEffect(() => {
    let active = true;
    getNextBatchNumberAction(date).then((b) => {
      if (active) setBatch(b);
    });
    return () => {
      active = false;
    };
  }, [date]);

  const validRows = rows.filter((r) => r.material_id && r.amount);

  function submit() {
    if (!productName || !batch || validRows.length === 0) return;
    run(
      () =>
        saveFermentAction({
          date,
          productName,
          batch,
          containerId: containerId || null,
          containerQty: containerQty ? parseFloat(containerQty) : null,
          materials: validRows.map((r) => ({
            material_id: r.material_id,
            amount: parseFloat(r.amount),
          })),
        }),
      `ลงหมัก batch ${batch} เรียบร้อย (เบิกวัตถุดิบอัตโนมัติแล้ว)`,
      () => {
        setRows([{ material_id: "", amount: "" }]);
        setContainerQty("");
        setVolPerTank("");
        getNextBatchNumberAction(date).then(setBatch);
        loadRecent();
      },
    );
  }

  return (
    <div className="space-y-5">
    <Card title="ลงหมัก (Log_Ferment + เบิกวัตถุดิบอัตโนมัติ)">
      <Msg msg={msg} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="วันที่ลงหมัก">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="ชื่อสุรา">
          <Select value={productName} onChange={(e) => setProductName(e.target.value)}>
            <option value="">-- เลือกชื่อสุรา --</option>
            {productNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </Field>
        <Field label="รหัส Batch (อัตโนมัติ ปรับได้)">
          <TextInput value={batch} onChange={(e) => setBatch(e.target.value)} />
        </Field>
        <Field label="ภาชนะ">
          <Select value={containerId} onChange={(e) => {
            setContainerId(e.target.value);
            const c = containers.find((x) => x.container_id === e.target.value);
            if (c?.capacity_l) { const v = String(c.capacity_l); setVolPerTank(v); recalcMain(v, containerQty); }
          }}>
            <option value="">-- เลือกภาชนะ --</option>
            {containers.map((c) => (
              <option key={c.container_id} value={c.container_id}>
                {c.container_type} {c.capacity_l ? `(${c.capacity_l}ล.)` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ปริมาณต่อถัง (ล.) — แก้ไขได้">
          <NumInput value={volPerTank} onChange={(e) => { setVolPerTank(e.target.value); recalcMain(e.target.value, containerQty); }} />
        </Field>
        <Field label="จำนวนภาชนะ">
          <NumInput value={containerQty} onChange={(e) => { setContainerQty(e.target.value); recalcMain(volPerTank, e.target.value); }} />
        </Field>
      </div>
      <p className="mt-1 text-xs text-slate-400">ปริมาณต่อถัง × จำนวนภาชนะ = วัตถุดิบหลัก (แถวแรก) อัตโนมัติ — แก้ทับเองได้ · เลือกภาชนะแล้วเติมความจุให้</p>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">
            วัตถุดิบที่ใช้ <span className="text-xs text-slate-400">(แถวแรก = วัตถุดิบหลัก = ฐานคิดส่า)</span>
          </span>
          <button
            type="button"
            onClick={() => setRows([...rows, { material_id: "", amount: "" }])}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
          >
            + เพิ่มวัตถุดิบ
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <div className="flex-1">
                <Select
                  value={r.material_id}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...next[i], material_id: e.target.value };
                    setRows(next);
                  }}
                >
                  <option value="">
                    {i === 0 ? "-- วัตถุดิบหลัก --" : "-- วัตถุดิบ --"}
                  </option>
                  {materials.map((m) => (
                    <option key={m.material_id} value={m.material_id}>
                      {m.name} {m.unit ? `(${m.unit})` : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-32">
                <NumInput
                  placeholder="จำนวน"
                  value={r.amount}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...next[i], amount: e.target.value };
                    setRows(next);
                  }}
                />
              </div>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  className="rounded-lg border border-red-200 px-3 text-red-500 hover:bg-red-50"
                >
                  ลบ
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <SaveButton
          pending={pending}
          onClick={submit}
          disabled={!productName || !batch || validRows.length === 0}
        >
          ลงหมัก
        </SaveButton>
      </div>
    </Card>

    <Card title="batch หมักล่าสุด">
      {recent.length === 0 ? <p className="text-sm text-slate-400">— ยังไม่มี batch —</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500"><tr><th className="px-2 py-1">วันที่</th><th className="px-2 py-1">Batch</th><th className="px-2 py-1">ชื่อสุรา</th><th className="px-2 py-1 text-right">ถัง</th><th className="px-2 py-1 text-right">ต่อถัง (ล.)</th><th className="px-2 py-1"></th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.batch} className="border-b border-slate-100">
                  <td className="whitespace-nowrap px-2 py-1">{String(r.fermentDate).slice(0, 10)}</td>
                  <td className="px-2 py-1 font-medium text-slate-800">{r.batch}</td>
                  <td className="px-2 py-1">{r.productName}</td>
                  <td className="px-2 py-1 text-right">{r.tanks || "—"}</td>
                  <td className="px-2 py-1 text-right">{r.volPerTank ?? "—"}</td>
                  <td className="px-2 py-1"><button onClick={() => del(r)} disabled={pending} className="text-red-500 hover:text-red-700" title="ลบ batch">🗑️</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-400">ลบ batch = คืนวัตถุดิบที่เบิก + ลบค่าติดตามหมัก · batch ที่กลั่นแล้วลบไม่ได้ (กันข้อมูล ภส. หาย)</p>
        </div>
      )}
    </Card>
    </div>
  );
}
