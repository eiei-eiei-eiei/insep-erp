"use client";

import { useCallback, useEffect, useState } from "react";
import { getFermentMonitorAction, saveFermentMonitorAction } from "../actions";
import { Card, Field, Msg, NumInput, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import { LineChart } from "./LineChart";
import type { PendingBatch } from "./types";

type MonitorRow = {
  measure_date: string;
  measure_time: string | null;
  ph: number | null;
  brix: number | null;
  temp: number | null;
  note: string | null;
};

export function MonitorTab({ pending: batches }: { pending: PendingBatch[] }) {
  const { pending, msg, run } = useSaver();
  const [batch, setBatch] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("");
  const [ph, setPh] = useState("");
  const [brix, setBrix] = useState("");
  const [temp, setTemp] = useState("");
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<MonitorRow[]>([]);

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

  const labels = history.map((r) => `${String(r.measure_date).slice(5)}${r.measure_time ? " " + r.measure_time.slice(0, 5) : ""}`);

  return (
    <div className="space-y-5">
      <Card title="ติดตามการหมัก (pH / Brix / อุณหภูมิ)">
        <Msg msg={msg} />
        {batches.length === 0 && (
          <p className="mb-3 text-sm text-amber-600">ยังไม่มี batch ที่กำลังหมัก (ลงหมักก่อน)</p>
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
        </div>
      </Card>

      {batch && (
        <Card title={`กราฟแนวโน้มการหมัก — ${batch}`}>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">ยังไม่มีค่าวัดของ batch นี้</p>
          ) : (
            <>
              <LineChart
                labels={labels}
                xLabel="ครั้งที่วัด (เก่า→ใหม่)"
                series={[
                  { name: "pH", color: "#2563eb", axis: "L", values: history.map((r) => r.ph) },
                  { name: "Brix", color: "#16a34a", axis: "R", values: history.map((r) => r.brix) },
                  { name: "อุณหภูมิ °C", color: "#dc2626", axis: "R", values: history.map((r) => r.temp) },
                ]}
              />
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 text-left text-slate-500">
                    <tr><th className="px-2 py-1">วันที่/เวลา</th><th className="px-2 py-1">pH</th><th className="px-2 py-1">Brix</th><th className="px-2 py-1">°C</th><th className="px-2 py-1">หมายเหตุ</th></tr>
                  </thead>
                  <tbody>
                    {history.map((r, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="px-2 py-1">{String(r.measure_date).slice(5)} {r.measure_time?.slice(0, 5) ?? ""}</td>
                        <td className="px-2 py-1">{r.ph ?? "—"}</td>
                        <td className="px-2 py-1">{r.brix ?? "—"}</td>
                        <td className="px-2 py-1">{r.temp ?? "—"}</td>
                        <td className="px-2 py-1 text-slate-500">{r.note ?? ""}</td>
                      </tr>
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
