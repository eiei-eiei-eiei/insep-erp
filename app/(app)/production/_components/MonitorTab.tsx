"use client";

import { useCallback, useEffect, useState } from "react";
import { getFermentMonitorAction, saveFermentMonitorAction, updateFermentMonitorAction, deleteFermentMonitorAction } from "../actions";
import { Card, Field, MissingHint, Msg, NumInput, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import { LineChart } from "./LineChart";
import { chartColor } from "@/lib/shared/chart";
import type { PendingBatch } from "./types";
import { IconEdit, IconTrash } from "@/lib/shared/icons";

type MonitorRow = {
  id: number;
  measure_date: string;
  measure_time: string | null;
  ph: number | null;
  brix: number | null;
  temp: number | null;
  note: string | null;
};
type EditFields = { measureDate: string; measureTime: string; ph: string; brix: string; temp: string; note: string };

export function MonitorTab({
  pending: batches,
  batch,
  onBatchChange,
}: {
  pending: PendingBatch[];
  batch: string;              // batch ร่วมของ workspace (เลือกครั้งเดียวใช้ทุกแท็บ)
  onBatchChange: (b: string) => void;
}) {
  const { pending, msg, run } = useSaver();
  const setBatch = onBatchChange;
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("");
  const [ph, setPh] = useState("");
  const [brix, setBrix] = useState("");
  const [temp, setTemp] = useState("");
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<MonitorRow[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<EditFields>({ measureDate: "", measureTime: "", ph: "", brix: "", temp: "", note: "" });

  const productName = batches.find((b) => b.batch === batch)?.productName ?? "";

  const load = useCallback(async (b: string) => {
    if (!b) { setHistory([]); return; }
    setHistory((await getFermentMonitorAction(b)) as MonitorRow[]);
  }, []);

  useEffect(() => { load(batch); }, [batch, load]);

  function submit() {
    if (!batch) return;
    run(
      () =>
        saveFermentMonitorAction({
          date, time, batch, productName,
          ph: ph ? parseFloat(ph) : null,
          brix: brix ? parseFloat(brix) : null,
          temp: temp ? parseFloat(temp) : null,
          note,
        }),
      "บันทึกค่าติดตามหมักเรียบร้อย",
      () => { setPh(""); setBrix(""); setTemp(""); setNote(""); load(batch); },
    );
  }

  function startEdit(r: MonitorRow) {
    setEditId(r.id);
    setEdit({
      measureDate: String(r.measure_date).slice(0, 10),
      measureTime: r.measure_time?.slice(0, 5) ?? "",
      ph: r.ph?.toString() ?? "", brix: r.brix?.toString() ?? "", temp: r.temp?.toString() ?? "", note: r.note ?? "",
    });
  }
  function saveEdit() {
    if (editId == null) return;
    run(
      () => updateFermentMonitorAction(editId, {
        measureDate: edit.measureDate, measureTime: edit.measureTime || null,
        ph: edit.ph ? parseFloat(edit.ph) : null, brix: edit.brix ? parseFloat(edit.brix) : null, temp: edit.temp ? parseFloat(edit.temp) : null,
        note: edit.note,
      }),
      "แก้ไขค่าวัดเรียบร้อย",
      () => { setEditId(null); load(batch); },
    );
  }
  function del(r: MonitorRow) {
    if (!confirm("ลบค่าวัดแถวนี้?")) return;
    run(() => deleteFermentMonitorAction(r.id), "ลบค่าวัดเรียบร้อย", () => load(batch));
  }

  const labels = history.map((r) => `${String(r.measure_date).slice(5)}${r.measure_time ? " " + r.measure_time.slice(0, 5) : ""}`);

  return (
    <div className="space-y-5">
      <Card title="ติดตามการหมัก (pH / Brix / อุณหภูมิ)">
        <Msg msg={msg} />
        {batches.length === 0 && (
          <p className="mb-3 text-sm text-warn">ยังไม่มี batch ที่กำลังหมัก (ลงหมักก่อน)</p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Batch">
            <Select value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">-- เลือก batch --</option>
              {batches.map((b) => (
                <option key={b.batch} value={b.batch}>{b.batch} ({b.productName})</option>
              ))}
            </Select>
          </Field>
          <Field label="วันที่"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="เวลา"><TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="pH"><NumInput value={ph} onChange={(e) => setPh(e.target.value)} /></Field>
          <Field label="Brix"><NumInput value={brix} onChange={(e) => setBrix(e.target.value)} /></Field>
          <Field label="อุณหภูมิ (°C)"><NumInput value={temp} onChange={(e) => setTemp(e.target.value)} /></Field>
          <Field label="หมายเหตุ"><TextInput value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <div className="mt-4">
          <SaveButton pending={pending} onClick={submit} disabled={!batch}>บันทึกค่าวัด</SaveButton>
          <MissingHint checks={[{ label: "Batch", ok: !!batch }]} prefix="ยังเลือกไม่ครบ" />
        </div>
      </Card>

      {batch && (
        <Card title={`กราฟแนวโน้มการหมัก — ${batch}`}>
          {history.length === 0 ? (
            <p className="text-sm text-faint">ยังไม่มีค่าวัดของ batch นี้</p>
          ) : (
            <>
              <LineChart
                labels={labels}
                xLabel="ครั้งที่วัด (เก่า→ใหม่)"
                series={[
                  { name: "pH", color: chartColor(0), axis: "L", values: history.map((r) => r.ph) },
                  { name: "Brix", color: chartColor(1), axis: "R", values: history.map((r) => r.brix) },
                  { name: "อุณหภูมิ °C", color: chartColor(2), axis: "R", values: history.map((r) => r.temp) },
                ]}
              />
              <div className="mt-4 overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr><th>วันที่/เวลา</th><th>pH</th><th>Brix</th><th>°C</th><th>หมายเหตุ</th><th></th></tr>
                  </thead>
                  <tbody>
                    {history.map((r) => (
                      editId === r.id ? (
                        <tr key={r.id} className="editing">
                          <td><div className="flex gap-1"><TextInput type="date" value={edit.measureDate} onChange={(e) => setEdit({ ...edit, measureDate: e.target.value })} className="w-32" /><TextInput type="time" value={edit.measureTime} onChange={(e) => setEdit({ ...edit, measureTime: e.target.value })} className="w-24" /></div></td>
                          <td><NumInput value={edit.ph} onChange={(e) => setEdit({ ...edit, ph: e.target.value })} className="w-16" /></td>
                          <td><NumInput value={edit.brix} onChange={(e) => setEdit({ ...edit, brix: e.target.value })} className="w-16" /></td>
                          <td><NumInput value={edit.temp} onChange={(e) => setEdit({ ...edit, temp: e.target.value })} className="w-16" /></td>
                          <td><TextInput value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></td>
                          <td className="whitespace-nowrap"><button onClick={saveEdit} disabled={pending} className="rounded border border-ok-line px-2 py-1 text-xs text-ok hover:bg-ok-bg">บันทึก</button><button onClick={() => setEditId(null)} className="ml-1 rounded border border-line px-2 py-1 text-xs text-muted hover:bg-raised">ยกเลิก</button></td>
                        </tr>
                      ) : (
                        <tr key={r.id}>
                          <td>{String(r.measure_date).slice(5)} {r.measure_time?.slice(0, 5) ?? ""}</td>
                          <td>{r.ph ?? "—"}</td>
                          <td>{r.brix ?? "—"}</td>
                          <td>{r.temp ?? "—"}</td>
                          <td className="text-faint">{r.note ?? ""}</td>
                          <td className="whitespace-nowrap"><button onClick={() => startEdit(r)} className="text-muted hover:text-ink" title="แก้ไข"><IconEdit size={16} /></button><button onClick={() => del(r)} className="ml-2 text-crit hover:text-crit" title="ลบ"><IconTrash size={16} /></button></td>
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
