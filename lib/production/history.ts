/**
 * lib/production/history — สรุป/คำนวณหน้าประวัติเทียบหลาย batch (port จาก _js_history.html)
 * ค่าเชิงสรุป (attenuation, est ABV, hearts, yield) — เป็นตัวช่วยวิเคราะห์ ไม่ใช่ตัวเลขราชการ
 * แต่ port สูตรตามเดิมเพื่อผลตรงกัน · unit test = history.test.ts
 */

export const DISTILL_READ_PHASES = ["เริ่มกลั่น", "หัว", "กลาง", "หาง", "จบหม้อ"];

// ── ประวัติหมัก ────────────────────────────────────────────────────────────────
export type FermentRead = {
  measure_date: string;
  measure_time: string | null;
  ph: number | null;
  brix: number | null;
  temp: number | null;
};

const numOr = (v: unknown): number => {
  const n = parseFloat(String(v));
  return isNaN(n) ? NaN : n;
};
const tms = (date: string, time: string | null) =>
  new Date(`${date}T${time || "00:00"}`).getTime();

/** สรุปต่อ batch: วันหมัก / Brix เริ่ม-จบ / attenuation / ~ABV / pH / temp พีค */
export function fermentSummary(reads: FermentRead[], startDate: string | null) {
  const sorted = reads
    .slice()
    .sort((a, b) =>
      `${a.measure_date} ${a.measure_time}`.localeCompare(`${b.measure_date} ${b.measure_time}`),
    );
  const firstOf = (arr: (number | null)[]) => {
    const v = arr.find((x) => x != null && !isNaN(numOr(x)));
    return v == null ? NaN : numOr(v);
  };
  const lastOf = (arr: (number | null)[]) => {
    const f = arr.filter((x) => x != null && !isNaN(numOr(x)));
    return f.length ? numOr(f[f.length - 1]) : NaN;
  };
  const brixArr = sorted.map((r) => r.brix);
  const phArr = sorted.map((r) => r.ph);
  const tempArr = sorted.map((r) => numOr(r.temp)).filter((v) => !isNaN(v));
  const firstBrix = firstOf(brixArr);
  const lastBrix = lastOf(brixArr);
  let days = NaN;
  if (sorted.length) {
    const t0 = new Date(`${startDate || sorted[0].measure_date}T00:00`).getTime();
    const tEnd = tms(sorted[sorted.length - 1].measure_date, sorted[sorted.length - 1].measure_time);
    if (!isNaN(t0) && !isNaN(tEnd)) days = (tEnd - t0) / 86400000;
  }
  const atten =
    !isNaN(firstBrix) && !isNaN(lastBrix) && firstBrix > 0
      ? ((firstBrix - lastBrix) / firstBrix) * 100
      : NaN;
  const estAbv = !isNaN(firstBrix) && !isNaN(lastBrix) ? (firstBrix - lastBrix) * 0.55 : NaN;
  return {
    days, firstBrix, lastBrix, atten, estAbv,
    firstPh: firstOf(phArr), lastPh: lastOf(phArr),
    tempPeak: tempArr.length ? Math.max(...tempArr) : NaN,
  };
}

/** จุด (x=วันจากเริ่มหมัก, y=ค่า metric) สำหรับกราฟ overlay */
export function fermentSeriesPoints(
  reads: FermentRead[],
  startDate: string | null,
  metric: "ph" | "brix" | "temp",
): { x: number; y: number | null }[] {
  const sorted = reads
    .slice()
    .sort((a, b) =>
      `${a.measure_date} ${a.measure_time}`.localeCompare(`${b.measure_date} ${b.measure_time}`),
    );
  const t0 = new Date(`${startDate || (sorted[0] && sorted[0].measure_date)}T00:00`).getTime();
  return sorted
    .map((r) => {
      const t = tms(r.measure_date, r.measure_time);
      const yv = r[metric];
      return { x: isNaN(t) ? NaN : (t - t0) / 86400000, y: yv == null ? null : numOr(yv) };
    })
    .filter((p) => !isNaN(p.x));
}

// ── ประวัติกลั่น ────────────────────────────────────────────────────────────────
export type DistillRead = {
  pot_no: number | null;
  phase: string | null;
  minute: number | null;
  abv20: number | null;
  cum_vol: number | null;
  vapor_temp: number | null;
  ferm_charge: number | null;
};

export function groupPots(reads: DistillRead[]): Record<number, DistillRead[]> {
  const pots: Record<number, DistillRead[]> = {};
  for (const r of reads) {
    const p = parseInt(String(r.pot_no), 10) || 0;
    (pots[p] = pots[p] || []).push(r);
  }
  return pots;
}

/** reconstruct ปริมาณสะสมต่อเนื่องทั้งหม้อ (carry ข้ามช่วง เพราะ cum_vol รีเซ็ตต่อช่วง) */
export function globalCum(potRows: DistillRead[]): (DistillRead & { globalCum: number })[] {
  const rows = potRows
    .filter((r) => r.phase != null && DISTILL_READ_PHASES.includes(r.phase))
    .sort((a, b) => (numOr(a.minute) || 0) - (numOr(b.minute) || 0));
  let carry = 0, lastPhase: string | null = null, lastCumInPhase = 0;
  return rows.map((r) => {
    const cum = numOr(r.cum_vol);
    if (r.phase !== lastPhase) {
      if (lastPhase !== null) carry += lastCumInPhase;
      lastPhase = r.phase;
      lastCumInPhase = 0;
    }
    const c = isNaN(cum) ? lastCumInPhase : cum;
    if (!isNaN(cum)) lastCumInPhase = cum;
    return { ...r, globalCum: carry + c };
  });
}

/** ค่าหัวใจต่อหม้อ: ใช้ค่าวัดจริงจากแถวจบหม้อถ้ามี ไม่งั้นคำนวณจากช่วงกลาง (ถ่วงน้ำหนัก) */
export function potHearts(potRows: DistillRead[]): { vol: number; abv: number; src: "วัด" | "คำนวณ" } {
  const fin = potRows.find((r) => r.phase === "จบหม้อ");
  if (fin && numOr(fin.cum_vol) > 0) {
    return { vol: numOr(fin.cum_vol) || 0, abv: numOr(fin.abv20) || 0, src: "วัด" };
  }
  const hearts = potRows
    .filter((r) => r.phase === "กลาง")
    .sort((a, b) => (numOr(a.minute) || 0) - (numOr(b.minute) || 0));
  let prev = 0, vol = 0, ws = 0;
  for (const r of hearts) {
    const cum = numOr(r.cum_vol);
    if (isNaN(cum)) continue;
    let d = cum - prev;
    if (d < 0) d = 0;
    prev = cum;
    const a = numOr(r.abv20);
    vol += d;
    if (!isNaN(a)) ws += d * a;
  }
  return { vol, abv: vol > 0 ? ws / vol : 0, src: "คำนวณ" };
}

/** สรุปกลั่นต่อ batch */
export function distillSummary(reads: DistillRead[]) {
  const pots = groupPots(reads);
  let totalVol = 0, totalWsum = 0, charge = 0, potCount = 0, totalMinutes = 0;
  for (const potRows of Object.values(pots)) {
    const h = potHearts(potRows);
    if (h.vol > 0) { totalVol += h.vol; totalWsum += h.vol * h.abv; potCount++; }
    const marker = potRows.find((r) => r.phase === "เริ่มกลั่น");
    if (marker) { const c = numOr(marker.ferm_charge); if (!isNaN(c)) charge += c; }
    let mx = 0;
    for (const r of potRows) { const m = numOr(r.minute); if (!isNaN(m) && m > mx) mx = m; }
    totalMinutes += mx;
  }
  return { totalVol, abv: totalVol > 0 ? totalWsum / totalVol : 0, charge, potCount, totalMinutes };
}

/** ปริมาณหัวใจ@ดีกรีจริง → ปริมาณเทียบที่ดีกรีเป้าหมาย (อนุรักษ์แอลกอฮอล์บริสุทธิ์) */
export function equivVol(totalVol: number, abv: number, target: number): number {
  return abv > 0 && !isNaN(target) && target > 0 ? (totalVol * abv) / target : NaN;
}
