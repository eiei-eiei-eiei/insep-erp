/**
 * lib/production/calc — สูตรคำนวณโดเมนผลิต (pure functions, port byte-compatible)
 * ที่มา: Stock.js, SheetData.js, Reports.js, _js_dilute_calc.html
 * ⚠️ ห้ามแก้สูตร — มี golden/unit test เทียบค่าเดิม (calc.test.ts)
 */

/** round แบบเดียวกับ .toFixed(2) เดิม (ค่าที่ถูกเก็บลงชีท) */
function round2(x: number): number {
  return Number(x.toFixed(2));
}

// ── P2: ทิศทาง stock (Stock.js isStockInbound_/computeStockDelta_) ────────────────
/** บวกเฉพาะ 'รับ' (trim แล้วเทียบ) — ที่เหลือลบหมด */
export function stockDelta(type: string, amount: number | string): number {
  const n = parseFloat(String(amount)) || 0;
  return String(type).trim() === "รับ" ? n : -n;
}

// ── P4: ฐานคิดส่า / ปริมาณน้ำหมัก (SheetData.js, Reports.js) ───────────────────────
/** ค่าแรกของ comma list ใน 'จำนวนวัตถุดิบที่ใช้' = วัตถุดิบหลัก = ฐานคิดส่า */
export function fermVolFromAmounts(materialAmounts: string | null | undefined): number {
  return parseFloat(String(materialAmounts ?? "").split(",")[0]) || 0;
}

/** รวม fermVol ต่อ batch (หลายแถวหมัก/batch → sum) */
export function sumFermVolByBatch(
  rows: { batch: string; materialAmounts: string | null }[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const f of rows) {
    const b = String(f.batch);
    map[b] = (map[b] || 0) + fermVolFromAmounts(f.materialAmounts);
  }
  return map;
}

/** volPerTank = totalSaa / จำนวนภาชนะ (q<=0 → 0) — Reports.js batchInfo */
export function volPerTank(totalSaa: number, qty: number): number {
  return qty > 0 ? totalSaa / qty : 0;
}

// ── P11: pendingBatches (SheetData.js getMasterAndInitialData) ─────────────────────
/** batch ที่หมักแล้วยังไม่มีใน log_distill · productName = แถวหมักล่าสุดของ batch · fermVol = sum */
export function pendingBatches(
  ferments: { batch: string; productName: string; materialAmounts: string | null }[],
  distilledBatches: Iterable<string>,
): { batch: string; productName: string; fermVol: number }[] {
  const fermVolMap = sumFermVolByBatch(ferments);
  const distilled = new Set([...distilledBatches].map(String));
  const map = new Map<string, { batch: string; productName: string; fermVol: number }>();
  for (const f of ferments) {
    const batch = String(f.batch);
    if (batch && !distilled.has(batch)) {
      map.set(batch, { batch, productName: f.productName, fermVol: fermVolMap[batch] || 0 });
    }
  }
  return Array.from(map.values());
}

// ── P12: เลข batch ถัดไป (SheetData.js getLatestBatchNumber) ───────────────────────
/** รูปแบบ N/ปีพ.ศ.2หลัก · หา max ของปีนั้น +1 · dateISO ว่าง → "" */
export function nextBatchNumber(
  dateISO: string | null | undefined,
  existingBatches: (string | null)[],
): string {
  if (!dateISO) return "";
  const date = new Date(dateISO);
  const thaiYear = date.getFullYear() + 543;
  const yearSuffix = String(thaiYear).slice(-2);
  let maxNum = 0;
  for (const raw of existingBatches) {
    const batch = String(raw ?? "");
    if (batch.endsWith("/" + yearSuffix)) {
      const num = parseInt(batch.split("/")[0], 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  return maxNum + 1 + "/" + yearSuffix;
}

// ── P9: ปริมาณสุราคงเหลือรอปรุง (SheetData.js getRemainingDistillVol) ──────────────
/** Σ ปริมาณกลั่น − Σ ปริมาณตั้งต้นที่ปรุงไปแล้ว (ต่อชื่อสุรา · ต่ำสุด 0) */
export function remainingDistillVol(
  distillVols: (number | string)[],
  diluteStartVols: (number | string)[],
): number {
  const sum = (arr: (number | string)[]) =>
    arr.reduce<number>((a, b) => a + (parseFloat(String(b)) || 0), 0);
  const remaining = sum(distillVols) - sum(diluteStartVols);
  return remaining > 0 ? remaining : 0;
}

// ── P8: สรุปปิด batch จากค่าจบหม้อ (_js_distill.html dtComputeBatchFromFinish) ──────
/** vol = Σ cumVol ของแถว 'จบหม้อ' (ต่อหม้อ) · abv = Σ(v·a)/Σv เฉลี่ยถ่วงน้ำหนักด้วยปริมาณ */
export function closeBatchSummary(
  finishRows: { cumVol: number | string; abv20: number | string }[],
): { totalVol: number; totalAbv: number; count: number } {
  let totalVol = 0;
  let totalWsum = 0;
  let count = 0;
  for (const r of finishRows) {
    const v = parseFloat(String(r.cumVol));
    const a = parseFloat(String(r.abv20));
    if (!isNaN(v) && v > 0) {
      totalVol += v;
      if (!isNaN(a)) totalWsum += v * a;
      count++;
    }
  }
  return { totalVol, totalAbv: totalVol > 0 ? totalWsum / totalVol : 0, count };
}

// ── P9: เครื่องคิดปรุง/ปรับดีกรี C1V1 = C2V2 (_js_dilute_calc.html runCalculator) ───
export type DiluteInput = { v1: number; c1: number; c2: number; v2: number };
export type DiluteResult = { v1: number; v2: number; water: number };

/**
 * source 'v1' (จากปริมาตรตั้งต้น): V2 = C1·V1/C2, water = V2−V1
 * source 'v2' (จากปริมาตรปลายทาง): V1 = C2·V2/C1, water = V2−V1
 * water ติดลบ → แสดง 0 · ผลปัดด้วย toFixed(2) เหมือนค่าที่ถูกเก็บเดิม
 */
export function diluteCalc(source: "v1" | "v2", p: DiluteInput): DiluteResult {
  let { v1, v2 } = p;
  const { c1, c2 } = p;
  let water = 0;
  if (source === "v2") {
    if (v2 > 0 && c1 > 0 && c2 > 0) {
      const calcV1 = (c2 * v2) / c1;
      const w = v2 - calcV1;
      v1 = round2(calcV1);
      water = w > 0 ? round2(w) : 0;
    }
  } else {
    if (v1 > 0 && c1 > 0 && c2 > 0) {
      const calcV2 = (c1 * v1) / c2;
      const w = calcV2 - v1;
      v2 = round2(calcV2);
      water = w > 0 ? round2(w) : 0;
    }
  }
  return { v1, v2, water };
}

// ── D78 สุราแช่ (เส้นทางผลิตที่ 2) ─────────────────────────────────────────────────
/** ประเภทสุราตามกฎหมายสรรพสามิต — **ชุดปิด** (ค่านี้พิมพ์ลงหัวฟอร์ม ภส. ช่อง "ประเภทสุรา") */
export const LIQUOR_PROCESS = ["สุรากลั่น", "สุราแช่"] as const;
export type LiquorProcess = (typeof LIQUOR_PROCESS)[number];

/** ค่านี้เป็นประเภทที่ระบบรู้จักไหม (ว่าง/พิมพ์อย่างอื่น = false → UI ต้องเตือน ห้ามเดา) */
export function isKnownProcess(liquorType: string | null | undefined): boolean {
  return (LIQUOR_PROCESS as readonly string[]).includes(String(liquorType ?? "").trim());
}
/** สุราแช่ไหม (ไม่ใช่ = กลั่น หรือ ยังไม่ได้ตั้ง — ผู้เรียกต้องเช็ค isKnownProcess ก่อนถ้าห้ามเดา) */
export function isFermented(liquorType: string | null | undefined): boolean {
  return String(liquorType ?? "").trim() === "สุราแช่";
}

/**
 * 🔴 จุดเดียวที่ตัดสินว่าคอลัมน์ "ปริมาณน้ำสุราแช่" บนฟอร์มคือยอดก่อนหรือหลังปรุง
 *    เลือก **หลังปรุง** เพราะหัวคอลัมน์เขียนว่า "ที่ผลิตได้และรอบรรจุ" และเป็นทางเดียวที่ยอด
 *    คงเหลือจะตรงกับยอดบรรจุ (ลง 160 แต่บรรจุ 200 = คงเหลือติดลบ) — D78 ข้อ "ต้องยืนยัน" ข้อ 1
 *    ถ้าสรรพสามิตตอบว่าให้ลงยอดก่อนปรุง แก้ที่ 2 ฟังก์ชันนี้จุดเดียว
 */
export function drawnVol(row: { vol: number | string; final_vol?: number | string | null }): number {
  const f = row.final_vol == null || row.final_vol === "" ? NaN : parseFloat(String(row.final_vol));
  return isNaN(f) ? parseFloat(String(row.vol)) || 0 : f;
}
export function drawnAbv(row: { abv: number | string; final_abv?: number | string | null }): number {
  const f = row.final_abv == null || row.final_abv === "" ? NaN : parseFloat(String(row.final_abv));
  return isNaN(f) ? parseFloat(String(row.abv)) || 0 : f;
}

/** ปริมาณน้ำสุราแช่คงเหลือรอบรรจุ ต่อชื่อสุรา (คู่แฝดของ remainingDistillVol · ต่ำสุด 0) */
export function remainingFermentedVol(
  drawRows: { vol: number | string; final_vol?: number | string | null }[],
  bottledVols: (number | string)[],
): number {
  const drawn = drawRows.reduce((a, r) => a + drawnVol(r), 0);
  const packed = bottledVols.reduce<number>((a, b) => a + (parseFloat(String(b)) || 0), 0);
  const remaining = drawn - packed;
  return remaining > 0 ? remaining : 0;
}

/**
 * ฟอร์ม "บัญชีผลิต" ที่สินค้าตัวนี้ต้องใช้ — ตัดสินจาก (ประเภทสุรา, ชนิดสุรา)
 * คืน null = ยังตั้งประเภทไม่ครบ/ไม่รู้จัก → **ห้ามเดา** ผู้เรียกต้องเตือนให้ไปตั้งค่าก่อน
 *
 * 📌 **เฟสเบียร์**: เบียร์เป็น *ชนิด* ของ *ประเภทสุราแช่* (ไม่ใช่ประเภทที่ 3) และใช้ฟอร์มอีกใบ
 *    → ตอนนั้นเพิ่ม branch **ที่ฟังก์ชันนี้ที่เดียว** (คืน "beer") ไม่ต้องไล่แก้ isFermented ทั้งแอป
 *    นี่คือเหตุผลที่รับ liquorKind เข้ามาด้วยทั้งที่ยังไม่ได้ใช้
 */
export function productionFormKind(
  liquorType: string | null | undefined,
  liquorKind?: string | null,
): "distilled" | "fermented" | null {
  void liquorKind;
  if (!isKnownProcess(liquorType)) return null;
  return isFermented(liquorType) ? "fermented" : "distilled";
}

/** ประเภทสุราที่มีสินค้าจริงในระบบ — ใช้ซ่อนแท็บของเส้นทางที่โรงนี้ไม่ได้ทำ (D78) */
export function processesOf(liquorTypes: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of liquorTypes) {
    const v = String(t ?? "").trim();
    if (isKnownProcess(v)) out.add(v);
  }
  return [...out];
}
