"use client";

import { useCallback, useEffect, useState } from "react";
import { correctAbvTo20C } from "@/lib/abv";
import { closeBatchSummary } from "@/lib/production/calc";
import {
  closeBatchAction,
  getDistillRunsAction,
  saveDistillReadingAction,
  startDistillRunAction,
  deleteDistillRunAction,
} from "../actions";
import { Card, Field, Msg, NumInput, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import { LineChart } from "./LineChart";
import { chartColor } from "@/lib/shared/chart";
import { DISTILL_PHASES, type PendingBatch } from "./types";
import { IconTrash } from "@/lib/shared/icons";

type RunRow = {
  id: number;
  run_id: string;
  pot_no: number;
  phase: string | null;
  minute: number | null;
  abv_obs: number | null;
  temp_spirit: number | null;
  abv20: number | null;
  cum_vol: number | null;
  vapor_temp: number | null;
  /** D80 — น้ำหมักที่เข้าหม้อ (มีเฉพาะแถว "เริ่มกลั่น") · ฐานของ Yield */
  ferm_charge: number | null;
  note: string | null;
};

export function DistillTab({
  pending: allBatches,
  batch,
  onBatchChange,
}: {
  pending: PendingBatch[];
  batch: string;              // batch ร่วมของ workspace (เลือกครั้งเดียวใช้ทุกแท็บ)
  onBatchChange: (b: string) => void;
}) {
  /**
   * D80 — batch ของ **สุราแช่** ต้องไม่โผล่ที่นี่
   *
   * 🚨 ของเดิมเสนอให้เลือกได้ทั้งหมด และปิด batch ได้จริง → ได้แถวใน `log_distill`
   *    ของสินค้าสุราแช่ = ยอดไปโผล่ในฟอร์ม **บัญชีผลิตสุรากลั่น** ผิดใบ โดยไม่มีอะไรเตือน
   *    (ฝั่งแท็บ "รินน้ำสุราแช่" กรองถูกอยู่แล้วตั้งแต่ D78 — ขาดแค่ด้านนี้)
   * ★ กรองที่นี่ ไม่ใช่ที่ getPendingBatches — ฟังก์ชันนั้นใช้ร่วมกับแท็บติดตามหมักด้วย
   */
  const batches = allBatches.filter((b) => !b.fermented);
  const { pending, msg, run, setMsg } = useSaver();
  const setBatch = onBatchChange;
  const [readings, setReadings] = useState<RunRow[]>([]);
  const [activeRun, setActiveRun] = useState<{ runId: string; potNo: number } | null>(null);

  // reading form
  const [phase, setPhase] = useState<string>("กลาง");
  const [minute, setMinute] = useState("");
  const [abvObs, setAbvObs] = useState("");
  const [tempSpirit, setTempSpirit] = useState("");
  const [cumVol, setCumVol] = useState("");
  const [vaporTemp, setVaporTemp] = useState("");
  const [note, setNote] = useState("");
  // D80 — น้ำหมักที่เข้าหม้อ (ferm_charge) · ฐานของ Yield ในหน้าประวัติ/เทียบ
  const [fermCharge, setFermCharge] = useState("");

  // close batch
  const [closeDate, setCloseDate] = useState(todayISO());
  const [closeVol, setCloseVol] = useState("");
  const [closeAbv, setCloseAbv] = useState("");

  const productName = batches.find((b) => b.batch === batch)?.productName ?? "";

  const abv20 = (() => {
    if (!abvObs || !tempSpirit) return null;
    return correctAbvTo20C(abvObs, tempSpirit);
  })();

  const loadReadings = useCallback(async (b: string) => {
    if (!b) {
      setReadings([]);
      setActiveRun(null);
      return;
    }
    const rows = (await getDistillRunsAction(b)) as RunRow[];
    setReadings(rows);
    // resume: หม้อล่าสุดที่ยังไม่มีแถว "จบหม้อ" = กำลังกลั่นอยู่ → ตั้ง activeRun อัตโนมัติ
    // (กันหม้อ phantom เมื่อรีเฟรช/สลับ browser ระหว่างกลั่น — ใช้ข้อมูลที่มีอยู่ ไม่แตะสูตร P8)
    const maxPot = rows.reduce((m, r) => Math.max(m, Number(r.pot_no) || 0), 0);
    if (maxPot > 0) {
      const potRows = rows.filter((r) => r.pot_no === maxPot);
      const finished = potRows.some((r) => r.phase === "จบหม้อ");
      setActiveRun(finished ? null : { runId: potRows[0].run_id, potNo: maxPot });
    } else {
      setActiveRun(null);
    }
  }, []);

  useEffect(() => {
    loadReadings(batch);
  }, [batch, loadReadings]);

  function delReading(r: RunRow) {
    if (!confirm(`ลบค่าที่บันทึก (หม้อ ${r.pot_no} · ${r.phase ?? ""})?`)) return;
    run(() => deleteDistillRunAction(r.id), "ลบค่าเรียบร้อย", () => loadReadings(batch));
  }

  // สรุปปิด batch จากแถว 'จบหม้อ'
  const finishRows = readings
    .filter((r) => r.phase === "จบหม้อ")
    .map((r) => ({ cumVol: r.cum_vol ?? 0, abv20: r.abv20 ?? 0 }));
  const summary = closeBatchSummary(finishRows);

  function startPot() {
    if (!batch) return;
    run(
      async () => {
        const res = await startDistillRunAction({
          batch,
          productName,
          fermCharge: fermCharge ? parseFloat(fermCharge) : null,
        });
        if (res.ok) {
          const d = res.data as { runId: string; potNo: number };
          setActiveRun(d);
          setFermCharge("");
          await loadReadings(batch);
        }
        return res;
      },
      "เริ่มหม้อใหม่แล้ว",
    );
  }

  function saveReading() {
    if (!activeRun) return;
    run(
      async () => {
        const res = await saveDistillReadingAction({
          runId: activeRun.runId,
          potNo: activeRun.potNo,
          batch,
          productName,
          phase,
          minute: minute ? parseFloat(minute) : null,
          abvObs: abvObs ? parseFloat(abvObs) : null,
          tempSpirit: tempSpirit ? parseFloat(tempSpirit) : null,
          abv20: abv20,
          cumVol: cumVol ? parseFloat(cumVol) : null,
          vaporTemp: vaporTemp ? parseFloat(vaporTemp) : null,
          note,
        });
        if (res.ok) {
          setMinute(""); setAbvObs(""); setTempSpirit(""); setCumVol(""); setVaporTemp(""); setNote("");
          await loadReadings(batch);
        }
        return res;
      },
      `บันทึก reading (${phase}) แล้ว`,
    );
  }

  function prefillClose() {
    setCloseVol(summary.totalVol.toFixed(3));
    setCloseAbv(summary.totalAbv.toFixed(2));
  }

  function doClose() {
    if (!batch || !closeVol || !closeAbv) return;
    run(
      async () => {
        const res = await closeBatchAction({
          date: closeDate,
          productName,
          batch,
          vol: parseFloat(closeVol),
          abv: parseFloat(closeAbv),
        });
        if (res.ok) {
          setBatch("");
          setReadings([]);
        }
        return res;
      },
      `ปิด batch ${batch} แล้ว (log_distill 1 แถว)`,
    );
  }

  return (
    <div className="space-y-5">
      <Card title="กลั่น — เลือก batch">
        <Msg msg={msg} />
        {batches.length === 0 && (
          <p className="text-sm text-warn">ไม่มี batch รอกลั่น (ลงหมักก่อน)</p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Batch ที่จะกลั่น">
            <Select value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">-- เลือก batch --</option>
              {batches.map((b) => (
                <option key={b.batch} value={b.batch}>
                  {b.batch} ({b.productName})
                </option>
              ))}
            </Select>
          </Field>
          {/*
            D80 — ช่องนี้เคย "ไม่มีอยู่จริง" สำหรับผู้ใช้: คอลัมน์ `log_distill_run.ferm_charge` มี ·
            `startDistillRunAction` รับพารามิเตอร์ `fermCharge` และเขียนลงแถว "เริ่มกลั่น" อยู่แล้ว ·
            สูตร Yield อ่านค่านี้ · golden test มี — **แต่หน้าจอไม่เคยส่งค่านี้เลยสักครั้ง**
            → คอลัมน์ Yield ในหน้า ประวัติ/เทียบ ขึ้น "—" ตลอดกาลสำหรับทุกคน (ตระกูล D74/D77)
            ★ อยู่คู่ปุ่มเริ่มหม้อ เพราะแถว "เริ่มกลั่น" ถูกสร้างตอนกดปุ่มนี้ (ไม่ใช่จากฟอร์มบันทึกค่า)
              และเป็นจังหวะที่ผู้ใช้รู้ปริมาณน้ำหมักที่เทเข้าหม้อพอดี
          */}
          {batch && (
            <Field label="น้ำหมักที่เข้าหม้อ (ล.) — ไม่บังคับ">
              <NumInput value={fermCharge} onChange={(e) => setFermCharge(e.target.value)} />
            </Field>
          )}
          {batch && (
            <div className="flex items-end">
              <SaveButton pending={pending} onClick={startPot}>
                + เริ่มหม้อใหม่
              </SaveButton>
              {activeRun && (
                <span className="ml-3 self-center text-sm text-ok">
                  ● กำลังกลั่นหม้อที่ {activeRun.potNo} — บันทึกค่าต่อได้เลย
                </span>
              )}
            </div>
          )}
        </div>
        {batch && (
          <p className="mt-2 text-xs text-faint">
            กรอก <b>น้ำหมักที่เข้าหม้อ</b> ก่อนกดเริ่มหม้อ เพื่อให้หน้า <b>ประวัติ/เทียบ</b> คำนวณ Yield ให้ได้
            (ไม่กรอกก็กลั่นได้ตามปกติ — แค่ช่อง Yield จะว่าง)
          </p>
        )}
      </Card>

      {batch && activeRun && (
        <Card title={`บันทึกค่าระหว่างกลั่น — หม้อ ${activeRun.potNo}`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="ช่วง">
              <Select value={phase} onChange={(e) => setPhase(e.target.value)}>
                {DISTILL_PHASES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Field label="นาทีที่">
              <NumInput value={minute} onChange={(e) => setMinute(e.target.value)} />
            </Field>
            <Field label="ดีกรีที่อ่าน (%)">
              <NumInput value={abvObs} onChange={(e) => setAbvObs(e.target.value)} />
            </Field>
            <Field label="อุณหภูมิสุรา (°C)">
              <NumInput value={tempSpirit} onChange={(e) => setTempSpirit(e.target.value)} />
            </Field>
            <Field label="อุณหภูมิไอ (°C)">
              <NumInput value={vaporTemp} onChange={(e) => setVaporTemp(e.target.value)} />
            </Field>
            <Field label="ดีกรี@20°C (คำนวณ)">
              <div className="rounded-lg border border-line bg-raised px-3 py-2 text-muted">
                {abvObs && tempSpirit
                  ? abv20 === null
                    ? "นอกช่วงตาราง"
                    : abv20.toFixed(2)
                  : "—"}
              </div>
            </Field>
            <Field label="ปริมาณสะสม (ล.)">
              <NumInput value={cumVol} onChange={(e) => setCumVol(e.target.value)} />
            </Field>
            <Field label="หมายเหตุ">
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <p className="mt-2 text-xs text-faint">
            บันทึกช่วง &quot;จบหม้อ&quot; พร้อมปริมาณสะสม+ดีกรี เพื่อใช้สรุปปิด batch
          </p>
          <div className="mt-3">
            <SaveButton pending={pending} onClick={saveReading}>
              บันทึกค่า
            </SaveButton>
          </div>
        </Card>
      )}

      {batch && (
        <Card title="ค่าที่บันทึกไว้ของ batch นี้">
          {readings.length === 0 ? (
            <p className="text-sm text-faint">ยังไม่มีค่า</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>หม้อ</th>
                    <th>ช่วง</th>
                    <th>ดีกรีอ่าน</th>
                    <th>อุณหภูมิ</th>
                    <th>ดีกรี@20</th>
                    <th>สะสม</th>
                    <th>น้ำหมักเข้าหม้อ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {readings.map((r) => (
                    <tr key={r.id}>
                      <td>{r.pot_no}</td>
                      <td>{r.phase}</td>
                      <td>{r.abv_obs ?? "—"}</td>
                      <td>{r.temp_spirit ?? "—"}</td>
                      <td>{r.abv20 ?? "—"}</td>
                      <td>{r.cum_vol ?? "—"}</td>
                      <td>{r.ferm_charge ?? "—"}</td>
                      <td><button onClick={() => delReading(r)} className="text-crit hover:text-crit" title="ลบค่านี้"><IconTrash size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {batch && readings.length > 0 && (
        <Card title="กราฟการกลั่น — ดีกรี@20 + อุณหภูมิไอ">
          <LineChart
            labels={readings.map((r, i) => (r.minute != null ? `${r.minute}′` : `#${i + 1}`))}
            xLabel="นาทีที่ / ลำดับที่บันทึก"
            series={[
              { name: "ดีกรี@20", color: chartColor(3), axis: "L", values: readings.map((r) => r.abv20) },
              { name: "อุณหภูมิไอ °C", color: chartColor(2), axis: "R", values: readings.map((r) => r.vapor_temp) },
            ]}
          />
        </Card>
      )}

      {batch && (
        <Card title="ปิด Batch (log_distill 1 แถว — กฎ ภส.)">
          <p className="mb-3 text-sm text-muted">
            สรุปจากค่าจบหม้อ {summary.count} หม้อ — ปริมาณหัวใจ{" "}
            <b>{summary.totalVol.toFixed(2)}</b> ล. · ดีกรี@20 เฉลี่ยถ่วงน้ำหนัก{" "}
            <b>{summary.totalAbv.toFixed(2)}</b>%
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="วันที่กลั่นเสร็จ">
              <TextInput type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
            </Field>
            <Field label="ปริมาณน้ำสุรา (ล.)">
              <NumInput value={closeVol} onChange={(e) => setCloseVol(e.target.value)} />
            </Field>
            <Field label="ดีกรี@20°C">
              <NumInput value={closeAbv} onChange={(e) => setCloseAbv(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <button
                type="button"
                onClick={prefillClose}
                className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:bg-raised"
              >
                ใช้ค่าสรุป
              </button>
            </div>
          </div>
          <div className="mt-4">
            <SaveButton
              pending={pending}
              onClick={() => {
                if (!closeVol || !closeAbv) {
                  setMsg({ ok: false, text: "กรอกปริมาณและดีกรีก่อนปิด batch (กด 'ใช้ค่าสรุป' ได้)" });
                  return;
                }
                doClose();
              }}
            >
              ปิด Batch
            </SaveButton>
          </div>
        </Card>
      )}
    </div>
  );
}
