"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { correctAbvTo20C } from "@/lib/abv";
import { closeBatchSummary } from "@/lib/production/calc";
import {
  lotSummary, roundIssues, nextRoundNo, lotBadge, materialDocRef,
  type RedistillLot, type RedistillRound,
} from "@/lib/production/redistill";
import {
  getRedistillLotsAction, getRedistillMaterialsAction, getNextLotNumberAction,
  openRedistillLotAction, saveRedistillRoundAction, deleteRedistillRoundAction,
  closeRedistillLotAction, reopenRedistillLotAction, deleteRedistillLotAction,
  getRemainingDistillVolAction, getDistillRunsAction,
  startDistillRunAction, saveDistillReadingAction, deleteDistillRunAction,
} from "../actions";
import {
  Card, Field, MissingHint, Msg, NumInput, RowBtn, SaveButton, Select, TextInput, todayISO, useSaver,
} from "./ui";
import { DISTILL_PHASES, type Material, type Product } from "./types";
import { IconTrash } from "@/lib/shared/icons";
import { isFermented } from "@/lib/production/calc";

type RunRow = {
  id: number; run_id: string; pot_no: number; phase: string | null; minute: number | null;
  abv_obs: number | null; temp_spirit: number | null; abv20: number | null;
  cum_vol: number | null; vapor_temp: number | null; ferm_charge: number | null; note: string | null;
};
type MatRow = { material_id: string; amount: string };

const n = (v: string) => (v === "" ? null : parseFloat(v));
const f2 = (v: number) => v.toFixed(2);

/**
 * D94 — แท็บ "กลั่นซ้ำ"
 *
 * โฟลว์ 3 จังหวะ ตรงกับ 3 การ์ด:
 *   1. เปิดล็อต   — ยกสุราออกจากถังรวม (เขียนแถว "ยกไปปรุง" ลงฟอร์ม ภส. ทันที)
 *   2. รอบกลั่น   — แช่สมุนไพร (ตัดวัตถุดิบ) + เก็บค่าระหว่างกลั่น + สรุปผลรอบ · ทำซ้ำได้ N รอบ
 *   3. ปิดล็อต    — ปรับดีกรี (เขียนแถว "ปรุงเสร็จ" ลงฟอร์ม)
 *
 * 🚨 ตัวเลข/ข้อความทุกอย่างที่ไปโผล่บนฟอร์มถูกตัดสินใน `lib/production/redistill.ts`
 *    ไฟล์นี้แค่รับค่าและแสดงผล — ห้ามคำนวณหรือแต่งประโยคเองที่นี่ (D84/D88)
 */
export function RedistillTab({ products, materials }: { products: Product[]; materials: Material[] }) {
  const { pending, msg, run, setMsg } = useSaver();

  const [lots, setLots] = useState<RedistillLot[]>([]);
  const [rounds, setRounds] = useState<RedistillRound[]>([]);
  const [lotNo, setLotNo] = useState("");
  const [mats, setMats] = useState<Record<string, MatRow[]>>({});

  // ── ฟอร์มเปิดล็อต ──
  const [newLot, setNewLot] = useState("");
  const [drawDate, setDrawDate] = useState(todayISO());
  const [productName, setProductName] = useState("");
  const [drawVol, setDrawVol] = useState("");
  const [drawAbv, setDrawAbv] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);

  // ── ฟอร์มรอบ ──
  const [rSoak, setRSoak] = useState(todayISO());
  const [rDistill, setRDistill] = useState("");
  const [rStartVol, setRStartVol] = useState("");
  const [rStartAbv, setRStartAbv] = useState("");
  const [rEndVol, setREndVol] = useState("");
  const [rEndAbv, setREndAbv] = useState("");
  const [rNote, setRNote] = useState("");
  const [rMats, setRMats] = useState<MatRow[]>([{ material_id: "", amount: "" }]);
  const [editRound, setEditRound] = useState<number | null>(null);

  // ── ค่าระหว่างกลั่น (ใช้ log_distill_run ตัวเดิม ธง is_redistill) ──
  const [readings, setReadings] = useState<RunRow[]>([]);
  const [activeRun, setActiveRun] = useState<{ runId: string; potNo: number } | null>(null);
  const [phase, setPhase] = useState<string>("กลาง");
  const [minute, setMinute] = useState("");
  const [abvObs, setAbvObs] = useState("");
  const [tempSpirit, setTempSpirit] = useState("");
  const [cumVol, setCumVol] = useState("");
  const [vaporTemp, setVaporTemp] = useState("");
  const [runNote, setRunNote] = useState("");
  const [potCharge, setPotCharge] = useState("");

  // ── ฟอร์มปิดล็อต ──
  const [cDate, setCDate] = useState(todayISO());
  const [cWater, setCWater] = useState("");
  const [cVol, setCVol] = useState("");
  const [cAbv, setCAbv] = useState("");

  // 🪤 สุราแช่ไม่มีการกลั่น → ไม่มีทางมาเข้ารอบกลั่นซ้ำได้ (หลักเดียวกับ DiluteTab D78)
  const productNames = useMemo(
    () => Array.from(new Set(products.filter((p) => !isFermented(p.liquor_type)).map((p) => p.name))),
    [products],
  );

  const lot = lots.find((l) => l.lot_no === lotNo) ?? null;
  const lotRounds = useMemo(
    () => rounds.filter((r) => r.lot_no === lotNo).sort((a, b) => a.round_no - b.round_no),
    [rounds, lotNo],
  );
  const summary = lot ? lotSummary(lot, lotRounds) : null;
  const issues = lot ? roundIssues(lot, lotRounds) : [];
  const closed = !!summary?.closed;

  const load = useCallback(async () => {
    const r = await getRedistillLotsAction();
    setLots(r.lots as unknown as RedistillLot[]);
    setRounds(r.rounds as unknown as RedistillRound[]);
    const refs = (r.rounds as unknown as RedistillRound[]).map((x) => materialDocRef(x.lot_no, x.round_no));
    if (refs.length) {
      const m = await getRedistillMaterialsAction(refs);
      setMats(
        Object.fromEntries(
          Object.entries(m).map(([k, v]) => [k, v.map((x) => ({ material_id: x.material_id, amount: String(x.amount) }))]),
        ),
      );
    } else setMats({});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getNextLotNumberAction(drawDate).then(setNewLot).catch(() => setNewLot("")); }, [drawDate]);
  useEffect(() => {
    if (!productName) { setRemaining(null); return; }
    let live = true;
    getRemainingDistillVolAction(productName)
      .then((v) => { if (live) setRemaining(v); })
      .catch(() => { if (live) setRemaining(null); });
    return () => { live = false; };
  }, [productName, lots]);

  const loadReadings = useCallback(async (l: string) => {
    if (!l) { setReadings([]); setActiveRun(null); return; }
    const rows = (await getDistillRunsAction(l, true)) as RunRow[];
    setReadings(rows);
    const maxPot = rows.reduce((m, r) => Math.max(m, Number(r.pot_no) || 0), 0);
    if (maxPot > 0) {
      const potRows = rows.filter((r) => r.pot_no === maxPot);
      setActiveRun(potRows.some((r) => r.phase === "จบหม้อ") ? null : { runId: potRows[0].run_id, potNo: maxPot });
    } else setActiveRun(null);
  }, []);
  useEffect(() => { loadReadings(lotNo); }, [lotNo, loadReadings]);

  const abv20 = abvObs && tempSpirit ? correctAbvTo20C(abvObs, tempSpirit) : null;
  const potSummary = closeBatchSummary(
    readings.filter((r) => r.phase === "จบหม้อ").map((r) => ({ cumVol: r.cum_vol ?? 0, abv20: r.abv20 ?? 0 })),
  );

  // ── actions ────────────────────────────────────────────────────────────────
  function openLot() {
    run(
      async () => {
        const res = await openRedistillLotAction({
          lotNo: newLot, productName, drawDate,
          drawVol: parseFloat(drawVol), drawAbv: parseFloat(drawAbv),
        });
        if (res.ok) { setDrawVol(""); setDrawAbv(""); await load(); setLotNo(newLot); }
        return res;
      },
      `เปิดล็อต ${newLot} แล้ว — ยอด ${drawVol} ล. ลงฟอร์มช่อง "นำไปปรุง" วันที่ยกออกเรียบร้อย`,
    );
  }

  function startRoundEdit(r: RedistillRound) {
    setEditRound(r.round_no);
    setRSoak(r.soak_date ? String(r.soak_date).slice(0, 10) : "");
    setRDistill(r.distill_date ? String(r.distill_date).slice(0, 10) : "");
    setRStartVol(r.start_vol == null ? "" : String(r.start_vol));
    setRStartAbv(r.start_abv == null ? "" : String(r.start_abv));
    setREndVol(r.end_vol == null ? "" : String(r.end_vol));
    setREndAbv(r.end_abv == null ? "" : String(r.end_abv));
    setRNote(r.note ?? "");
    const m = mats[materialDocRef(r.lot_no, r.round_no)] ?? [];
    setRMats(m.length ? m : [{ material_id: "", amount: "" }]);
  }

  function resetRoundForm() {
    setEditRound(null);
    setRSoak(todayISO()); setRDistill(""); setRStartVol(""); setRStartAbv("");
    setREndVol(""); setREndAbv(""); setRNote("");
    setRMats([{ material_id: "", amount: "" }]);
  }

  const roundNo = editRound ?? nextRoundNo(lotRounds);

  function saveRound() {
    if (!lot) return;
    // ★ ชุดรอบ **หลังบันทึกแล้ว** — ส่งไปให้ action คิดหมายเหตุที่จะพิมพ์ลงฟอร์ม
    //   (แช่รอบไหนก็ตาม หมายเหตุต้องเปลี่ยนเป็น "ยกไปแช่สมุนไพรและกลั่นซ้ำ" ทันที · 0062)
    const after: RedistillRound[] = [
      ...lotRounds.filter((r) => r.round_no !== roundNo),
      { lot_no: lot.lot_no, round_no: roundNo, soak_date: rSoak || null, distill_date: rDistill || null,
        start_vol: n(rStartVol), start_abv: n(rStartAbv), end_vol: n(rEndVol), end_abv: n(rEndAbv) },
    ];
    run(
      async () => {
        const res = await saveRedistillRoundAction({
          lot, rounds: after,
          lotNo: lot.lot_no, roundNo,
          soakDate: rSoak || null, distillDate: rDistill || null,
          startVol: n(rStartVol), startAbv: n(rStartAbv),
          endVol: n(rEndVol), endAbv: n(rEndAbv), note: rNote || null,
          materials: rMats
            .filter((m) => m.material_id && m.amount !== "")
            .map((m) => ({ material_id: m.material_id, amount: parseFloat(m.amount) })),
        });
        if (res.ok) { resetRoundForm(); await load(); }
        return res;
      },
      `บันทึกรอบที่ ${roundNo} แล้ว`,
    );
  }

  function delRound(r: RedistillRound) {
    if (!lot) return;
    if (!confirm(`ลบรอบที่ ${r.round_no} ของล็อต ${r.lot_no}? (วัตถุดิบที่ตัดไว้จะถูกคืนด้วย)`)) return;
    const after = lotRounds.filter((x) => x.round_no !== r.round_no);
    run(
      () => deleteRedistillRoundAction({ lot, rounds: after, roundNo: r.round_no }),
      "ลบรอบเรียบร้อย",
      () => { resetRoundForm(); load(); },
    );
  }

  function startPot() {
    if (!lot) return;
    run(
      async () => {
        const res = await startDistillRunAction({
          batch: lot.lot_no, productName: lot.product_name,
          fermCharge: potCharge ? parseFloat(potCharge) : null,
          isRedistill: true,
        });
        if (res.ok) {
          setActiveRun(res.data as { runId: string; potNo: number });
          setPotCharge("");
          await loadReadings(lot.lot_no);
        }
        return res;
      },
      "เริ่มหม้อใหม่แล้ว",
    );
  }

  function saveReading() {
    if (!activeRun || !lot) return;
    run(
      async () => {
        const res = await saveDistillReadingAction({
          runId: activeRun.runId, potNo: activeRun.potNo,
          batch: lot.lot_no, productName: lot.product_name, isRedistill: true,
          phase, minute: n(minute), abvObs: n(abvObs), tempSpirit: n(tempSpirit),
          abv20, cumVol: n(cumVol), vaporTemp: n(vaporTemp), note: runNote,
        });
        if (res.ok) {
          setMinute(""); setAbvObs(""); setTempSpirit(""); setCumVol(""); setVaporTemp(""); setRunNote("");
          await loadReadings(lot.lot_no);
        }
        return res;
      },
      `บันทึกค่า (${phase}) แล้ว`,
    );
  }

  function closeLot() {
    if (!lot) return;
    run(
      async () => {
        const res = await closeRedistillLotAction({
          lot, rounds: lotRounds, diluteDate: cDate,
          water: n(cWater), finalVol: parseFloat(cVol), finalAbv: parseFloat(cAbv),
        });
        if (res.ok) { setCWater(""); setCVol(""); setCAbv(""); await load(); }
        return res;
      },
      `ปิดล็อต ${lot.lot_no} แล้ว — ยอด ${cVol} ล. เข้าช่อง "คงเหลือสุราปรุง" ของฟอร์ม`,
    );
  }

  function reopenLot() {
    if (!lot) return;
    if (!confirm(`ถอนการปิดล็อต ${lot.lot_no}? แถว "ปรุงเสร็จ" จะถูกลบออกจากฟอร์ม ภส.`)) return;
    run(() => reopenRedistillLotAction({ lot, rounds: lotRounds }), "ถอนการปิดล็อตแล้ว", load);
  }

  function delLot() {
    if (!lot) return;
    if (!confirm(`ลบล็อต ${lot.lot_no} ทั้งก้อน?\nจะลบรอบกลั่น · ค่าระหว่างกลั่น · วัตถุดิบที่ตัดไว้ · และแถวปรุงทั้ง 2 ท่อนบนฟอร์ม ภส.`)) return;
    run(() => deleteRedistillLotAction(lot.lot_no), "ลบล็อตเรียบร้อย", () => { setLotNo(""); load(); });
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <Card title="กลั่นซ้ำ — เปิดล็อตใหม่ (ยกสุราออกจากถัง)">
        <Msg msg={msg} />
        <p className="mb-3 text-xs text-faint">
          ยอดที่กรอกตรงนี้คือตัวเลขที่จะไปลงช่อง <b>&quot;ปริมาณที่นำไปปรุง&quot;</b> ของฟอร์ม ภส.๐๗-๐๒/๑(๑)
          ในวันที่ยกออก — ไม่ใช่ยอดที่ได้หลังกลั่นซ้ำ
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="เลขล็อต (ระบบตั้งให้)">
            <TextInput value={newLot} readOnly />
          </Field>
          <Field label="วันที่ยกออก / เริ่มแช่">
            <input type="date" value={drawDate} onChange={(e) => setDrawDate(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink" />
          </Field>
          <Field label="ชื่อสุรา">
            <Select value={productName} onChange={(e) => setProductName(e.target.value)}>
              <option value="">-- เลือกสุรา --</option>
              {productNames.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="ปริมาณที่ยกออก (ล.)">
            <NumInput value={drawVol} onChange={(e) => setDrawVol(e.target.value)} />
          </Field>
          <Field label="ดีกรีตอนยกออก">
            <NumInput value={drawAbv} onChange={(e) => setDrawAbv(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <span className="text-sm text-muted">
              สุรากลั่นคงเหลือ:{" "}
              <b className="text-ink">{remaining == null ? "—" : f2(remaining)}</b> ล.
            </span>
          </div>
        </div>
        <div className="mt-3">
          <SaveButton pending={pending} onClick={openLot}
            disabled={!newLot || !productName || !drawVol || !drawAbv}>
            เปิดล็อต
          </SaveButton>
          <MissingHint checks={[
            { label: "ชื่อสุรา", ok: !!productName },
            { label: "ปริมาณที่ยกออก", ok: !!drawVol },
            { label: "ดีกรีตอนยกออก", ok: !!drawAbv },
          ]} />
        </div>
      </Card>

      <Card title="ล็อตกลั่นซ้ำ">
        {lots.length === 0 ? (
          <p className="text-sm text-faint">ยังไม่มีล็อต</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>ล็อต</th><th>สุรา</th><th>ยกออก</th><th>ปริมาณ</th><th>ดีกรี</th>
                  <th>รอบ</th><th>ผลล่าสุด</th><th>สถานะ</th><th></th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => {
                  const rs = rounds.filter((x) => x.lot_no === l.lot_no);
                  const s = lotSummary(l, rs);
                  const b = lotBadge(l, rs);
                  return (
                    <tr key={l.lot_no} className={l.lot_no === lotNo ? "bg-raised" : ""}>
                      <td className="font-medium">{l.lot_no}</td>
                      <td>{l.product_name}</td>
                      <td>{String(l.draw_date).slice(0, 10)}</td>
                      <td className="text-right">{f2(s.drawVol)}</td>
                      <td className="text-right">{s.drawAbv}</td>
                      <td className="text-right">{s.roundsDone}/{s.roundsTotal}</td>
                      <td className="text-right">{s.lastVol ? `${f2(s.lastVol)} ล. ${s.lastAbv}°` : "—"}</td>
                      <td className={b.tone === "ok" ? "text-ok" : b.tone === "warn" ? "text-warn" : "text-muted"}>
                        {b.text}
                      </td>
                      <td>
                        <RowBtn tone="slate" onClick={() => { setLotNo(l.lot_no); resetRoundForm(); setMsg(null); }}>
                          เปิด
                        </RowBtn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {lot && summary && (
        <>
          <Card title={`ล็อต ${lot.lot_no} — ${lot.product_name}`}>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><div className="text-faint">ยกออก</div><div className="text-ink">{f2(summary.drawVol)} ล. {summary.drawAbv}°</div></div>
              <div><div className="text-faint">ผลรอบล่าสุด</div><div className="text-ink">{summary.lastVol ? `${f2(summary.lastVol)} ล. ${summary.lastAbv}°` : "—"}</div></div>
              <div><div className="text-faint">แอลกอฮอล์ (LPA)</div><div className="text-ink">{f2(summary.lpaIn)} → {f2(summary.lpaOut)}</div></div>
              {/* 🚨 ยังไม่มีรอบไหนบันทึกผล = ยังไม่มีอะไรให้เทียบ — ห้ามโชว์ 100% (ของยังอยู่ในถังครบ) */}
              <div><div className="text-faint">หายระหว่างทาง</div><div className="text-ink">{summary.lpaLossPct == null ? "—" : `${f2(summary.lpaLossPct)}%`}</div></div>
            </div>
            {issues.length > 0 && (
              <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
                {issues.map((m, i) => <div key={i}>⚠ {m}</div>)}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              {closed && <RowBtn tone="brand" onClick={reopenLot} disabled={pending}>ถอนการปิดล็อต</RowBtn>}
              <RowBtn tone="red" onClick={delLot} disabled={pending}>ลบล็อตทั้งก้อน</RowBtn>
            </div>
          </Card>

          <Card title={`รอบกลั่นซ้ำของล็อต ${lot.lot_no}`}>
            {lotRounds.length > 0 && (
              <div className="mb-4 overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr><th>รอบ</th><th>เริ่มแช่</th><th>วันกลั่น</th><th>เข้า</th><th>ออก</th><th>สมุนไพร</th><th></th></tr>
                  </thead>
                  <tbody>
                    {lotRounds.map((r) => {
                      const m = mats[materialDocRef(r.lot_no, r.round_no)] ?? [];
                      return (
                        <tr key={r.round_no}>
                          <td>{r.round_no}</td>
                          <td>{r.soak_date ? String(r.soak_date).slice(0, 10) : "—"}</td>
                          <td>{r.distill_date ? String(r.distill_date).slice(0, 10) : "—"}</td>
                          <td className="text-right">{r.start_vol == null ? "—" : `${r.start_vol} ล. ${r.start_abv ?? ""}°`}</td>
                          <td className="text-right">{r.end_vol == null ? "—" : `${r.end_vol} ล. ${r.end_abv ?? ""}°`}</td>
                          <td>{m.length ? `${m.length} รายการ` : "—"}</td>
                          <td>
                            {!closed && (
                              <>
                                <RowBtn tone="slate" onClick={() => startRoundEdit(r)}>แก้</RowBtn>
                                <button onClick={() => delRound(r)} disabled={pending}
                                  className="ml-2 text-crit hover:text-crit" title="ลบรอบ">
                                  <IconTrash size={16} />
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {closed ? (
              <p className="text-sm text-warn">ล็อตปิดแล้ว — กด <b>ถอนการปิดล็อต</b> ก่อนถึงจะแก้รอบได้</p>
            ) : (
              <>
                <div className="mb-2 text-sm text-muted">
                  {editRound ? `กำลังแก้รอบที่ ${editRound}` : `เพิ่มรอบที่ ${roundNo}`}
                  {editRound && (
                    <RowBtn tone="slate" onClick={resetRoundForm} className="ml-2">เลิกแก้</RowBtn>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="วันเริ่มแช่ (วันตัดวัตถุดิบ)">
                    <input type="date" value={rSoak} onChange={(e) => setRSoak(e.target.value)}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink" />
                  </Field>
                  <Field label="วันที่กลั่นรอบนี้">
                    <input type="date" value={rDistill} onChange={(e) => setRDistill(e.target.value)}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink" />
                  </Field>
                  <div />
                  <Field label="ปริมาณเข้ารอบ (ล.)">
                    <NumInput value={rStartVol} onChange={(e) => setRStartVol(e.target.value)} />
                  </Field>
                  <Field label="ดีกรีเข้ารอบ">
                    <NumInput value={rStartAbv} onChange={(e) => setRStartAbv(e.target.value)} />
                  </Field>
                  <div />
                  <Field label="ปริมาณที่กลั่นได้ (ล.)">
                    <NumInput value={rEndVol} onChange={(e) => setREndVol(e.target.value)} />
                  </Field>
                  <Field label="ดีกรีที่ได้">
                    <NumInput value={rEndAbv} onChange={(e) => setREndAbv(e.target.value)} />
                  </Field>
                  <Field label="หมายเหตุ (ในระบบเท่านั้น)">
                    <TextInput value={rNote} onChange={(e) => setRNote(e.target.value)} />
                  </Field>
                </div>

                <div className="mt-4">
                  <div className="mb-1 text-sm font-medium text-ink">สมุนไพร/วัตถุดิบที่ใส่รอบนี้</div>
                  <p className="mb-2 text-xs text-faint">
                    ตัดออกจากบัญชีวัตถุดิบ <b>วันเดียวกับวันเริ่มแช่</b> แล้วขึ้นฟอร์ม ภส.๐๗-๐๑/๑ เอง
                    (เลขอ้างอิง {materialDocRef(lot.lot_no, roundNo)}) · รอบที่ไม่ใส่อะไรเลยก็ปล่อยว่างได้
                  </p>
                  {rMats.map((m, i) => (
                    <div key={i} className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_auto]">
                      <Select value={m.material_id}
                        onChange={(e) => setRMats(rMats.map((x, k) => (k === i ? { ...x, material_id: e.target.value } : x)))}>
                        <option value="">-- เลือกวัตถุดิบ --</option>
                        {materials.map((mm) => (
                          <option key={mm.material_id} value={mm.material_id}>
                            {mm.material_id} — {mm.name}
                          </option>
                        ))}
                      </Select>
                      <NumInput value={m.amount} placeholder="จำนวน"
                        onChange={(e) => setRMats(rMats.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} />
                      <RowBtn tone="slate" onClick={() => setRMats(rMats.filter((_, k) => k !== i))}>ลบ</RowBtn>
                    </div>
                  ))}
                  <RowBtn tone="slate" onClick={() => setRMats([...rMats, { material_id: "", amount: "" }])}>
                    + เพิ่มวัตถุดิบ
                  </RowBtn>
                  {materials.length === 0 && (
                    <p className="mt-2 text-sm text-warn">
                      ยังไม่มีวัตถุดิบในทะเบียน — ไปเพิ่มที่แท็บ <b>จัดการข้อมูล</b> ก่อน
                      (สมุนไพรต้องขึ้นทะเบียนถึงจะตัดเข้าบัญชี ภส.๐๗-๐๑/๑ ได้)
                    </p>
                  )}
                </div>

                <div className="mt-3">
                  <SaveButton pending={pending} onClick={saveRound}>
                    {editRound ? "บันทึกการแก้ไข" : `บันทึกรอบที่ ${roundNo}`}
                  </SaveButton>
                </div>
              </>
            )}
          </Card>

          {!closed && (
            <Card title={`ค่าระหว่างกลั่นซ้ำ — ล็อต ${lot.lot_no}`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="ปริมาณที่เข้าหม้อ (ล.) — ไม่บังคับ">
                  <NumInput value={potCharge} onChange={(e) => setPotCharge(e.target.value)} />
                </Field>
                <div className="flex items-end">
                  <SaveButton pending={pending} onClick={startPot}>+ เริ่มหม้อใหม่</SaveButton>
                  {activeRun && (
                    <span className="ml-3 self-center text-sm text-ok">● กำลังกลั่นหม้อที่ {activeRun.potNo}</span>
                  )}
                </div>
              </div>

              {activeRun && (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="ช่วง">
                    <Select value={phase} onChange={(e) => setPhase(e.target.value)}>
                      {DISTILL_PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </Field>
                  <Field label="นาทีที่"><NumInput value={minute} onChange={(e) => setMinute(e.target.value)} /></Field>
                  <Field label="ดีกรีที่อ่าน (%)"><NumInput value={abvObs} onChange={(e) => setAbvObs(e.target.value)} /></Field>
                  <Field label="อุณหภูมิสุรา (°C)"><NumInput value={tempSpirit} onChange={(e) => setTempSpirit(e.target.value)} /></Field>
                  <Field label="อุณหภูมิไอ (°C)"><NumInput value={vaporTemp} onChange={(e) => setVaporTemp(e.target.value)} /></Field>
                  <Field label="ดีกรี@20°C (คำนวณ)">
                    <div className="rounded-lg border border-line bg-raised px-3 py-2 text-muted">
                      {abvObs && tempSpirit ? (abv20 === null ? "นอกช่วงตาราง" : abv20.toFixed(2)) : "—"}
                    </div>
                  </Field>
                  <Field label="ปริมาณสะสม (ล.)"><NumInput value={cumVol} onChange={(e) => setCumVol(e.target.value)} /></Field>
                  <Field label="หมายเหตุ"><TextInput value={runNote} onChange={(e) => setRunNote(e.target.value)} /></Field>
                  <div className="flex items-end">
                    <SaveButton pending={pending} onClick={saveReading}>บันทึกค่า</SaveButton>
                  </div>
                </div>
              )}

              {readings.length > 0 && (
                <>
                  <div className="mt-4 overflow-x-auto">
                    <table className="tbl">
                      <thead>
                        <tr><th>หม้อ</th><th>ช่วง</th><th>ดีกรีอ่าน</th><th>อุณหภูมิ</th><th>ดีกรี@20</th><th>สะสม</th><th>เข้าหม้อ</th><th></th></tr>
                      </thead>
                      <tbody>
                        {readings.map((r) => (
                          <tr key={r.id}>
                            <td>{r.pot_no}</td><td>{r.phase}</td><td>{r.abv_obs ?? "—"}</td>
                            <td>{r.temp_spirit ?? "—"}</td><td>{r.abv20 ?? "—"}</td>
                            <td>{r.cum_vol ?? "—"}</td><td>{r.ferm_charge ?? "—"}</td>
                            <td>
                              <button
                                onClick={() => {
                                  if (!confirm(`ลบค่าที่บันทึก (หม้อ ${r.pot_no} · ${r.phase ?? ""})?`)) return;
                                  run(() => deleteDistillRunAction(r.id), "ลบค่าเรียบร้อย", () => loadReadings(lot.lot_no));
                                }}
                                disabled={pending} className="text-crit hover:text-crit" title="ลบ">
                                <IconTrash size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {potSummary.count > 0 && (
                    <p className="mt-2 text-sm text-muted">
                      สรุปจากแถว &quot;จบหม้อ&quot; {potSummary.count} หม้อ:{" "}
                      <b className="text-ink">{potSummary.totalVol.toFixed(3)} ล.</b>{" "}
                      ดีกรีเฉลี่ย <b className="text-ink">{potSummary.totalAbv.toFixed(2)}</b>
                      <RowBtn tone="slate" className="ml-2"
                        onClick={() => { setREndVol(potSummary.totalVol.toFixed(3)); setREndAbv(potSummary.totalAbv.toFixed(2)); }}>
                        เติมลงช่อง &quot;ปริมาณที่กลั่นได้&quot;
                      </RowBtn>
                    </p>
                  )}
                </>
              )}
            </Card>
          )}

          <Card title={`ปิดล็อต ${lot.lot_no} — ปรับดีกรีให้พร้อมบรรจุ`}>
            {closed ? (
              <p className="text-sm text-ok">
                ปิดแล้วเมื่อ {String(lot.dilute_date).slice(0, 10)} — ได้ {f2(summary.finalVol)} ล. {summary.finalAbv}°
                <span className="block text-faint">
                  แถวปรุงทั้ง 2 ท่อนถูกเขียนลงฟอร์ม ภส. แล้ว (ยกไปปรุง {f2(summary.drawVol)} ล. วันที่ยกออก ·
                  ได้สุราปรุง {f2(summary.finalVol)} ล. วันที่ปรับดีกรี)
                </span>
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-faint">
                  ยอดที่กรอกจะไปเพิ่มใน <b>&quot;คงเหลือสุราปรุง&quot;</b> ของฟอร์ม ณ วันที่ปรับดีกรี ·
                  ไม่เติมน้ำก็ใส่ 0 ได้
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="วันที่ปรับดีกรีเสร็จ">
                    <input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink" />
                  </Field>
                  <Field label="น้ำที่เติม (ล.)"><NumInput value={cWater} onChange={(e) => setCWater(e.target.value)} /></Field>
                  <Field label="ปริมาณที่ได้ (ล.)"><NumInput value={cVol} onChange={(e) => setCVol(e.target.value)} /></Field>
                  <Field label="ดีกรีสุดท้าย"><NumInput value={cAbv} onChange={(e) => setCAbv(e.target.value)} /></Field>
                </div>
                <div className="mt-3">
                  <SaveButton pending={pending} onClick={closeLot}
                    disabled={!cDate || !cVol || !cAbv || summary.roundsDone === 0}>
                    ปิดล็อต
                  </SaveButton>
                  <MissingHint checks={[
                    { label: "ปริมาณที่ได้", ok: !!cVol },
                    { label: "ดีกรีสุดท้าย", ok: !!cAbv },
                    { label: "รอบกลั่นที่บันทึกผลแล้ว", ok: summary.roundsDone > 0 },
                  ]} />
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
