/**
 * lib/production/redistill — กลั่นหลายรอบ (แช่สมุนไพรแล้วกลั่นซ้ำ) · D94
 *
 * 🎯 หมัก → กลั่นรอบแรก (ต่อ batch) → **เทรวมถัง** → ยกออกมา x ลิตร → แช่ → กลั่นซ้ำ
 *    → (รอบ 3, 4 ได้อีก) → ปรับดีกรี → บรรจุ
 *
 * 🚨 ฟอร์ม ภส.๐๗-๐๒/๑(๑) ไม่มีคอลัมน์รับการกลั่นรอบสอง → การกลั่นซ้ำถูกกลืนเข้า
 *    **ขั้นการปรุง** แล้วอธิบายด้วยหมายเหตุ ⇒ ไฟล์นี้ไม่มีอะไรพิมพ์ลงฟอร์มโดยตรง
 *    สิ่งที่ไปโผล่บนฟอร์มคือแถว `log_dilute` ที่ `dilutePlan()` สั่งให้เขียน
 *
 * ★ ทุกอย่างในไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ (ไม่มี IO) — RPC ฝั่ง SQL แค่เก็บค่าตามที่สั่ง
 *   ห้ามย้ายการตัดสินใจไปอยู่ในคอมโพเนนต์หรือใน SQL (บทเรียน D79/D84/D86/D88)
 */
import { fmtIsoDMY } from "./reports";

// ── types ──────────────────────────────────────────────────────────────────────
export type RedistillLot = {
  lot_no: string;
  product_name: string;
  draw_date: string;
  draw_vol: number | string;
  draw_abv: number | string;
  dilute_date?: string | null;
  water?: number | string | null;
  final_vol?: number | string | null;
  final_abv?: number | string | null;
  note?: string | null;
};

export type RedistillRound = {
  lot_no: string;
  round_no: number;
  soak_date?: string | null;
  distill_date?: string | null;
  start_vol?: number | string | null;
  start_abv?: number | string | null;
  end_vol?: number | string | null;
  end_abv?: number | string | null;
  note?: string | null;
};

export type DiluteLeg = "ยกไปปรุง" | "ปรุงเสร็จ";

const num = (v: unknown): number => parseFloat(String(v ?? "")) || 0;
const has = (v: unknown): boolean => v !== null && v !== undefined && v !== "" && !isNaN(Number(v));
const f2 = (n: number): string => n.toFixed(2);

/** ดีกรีพิมพ์แบบไม่ลากศูนย์ท้าย (65 ไม่ใช่ 65.00 · 42.5 ยังเป็น 42.5) */
const fabv = (n: number): string => String(Math.round(n * 100) / 100);

// ── เลขล็อต ────────────────────────────────────────────────────────────────────
/**
 * เลขล็อตถัดไป `S{n}/{ปีพ.ศ.2หลัก}` — คู่แฝดของ `nextBatchNumber` (P12) แต่ **คนละชุดเลข**
 *
 * 🪤 คิดจากล็อตทั้ง tenant ไม่แยกกิจการ — ตรงกับ unique key `(tenant_id, lot_no)` ใน 0061
 *    (ต่างจาก batch ที่คีย์เป็น "ต่อโรง" ตั้งแต่ 0027 เพราะเป็นเลขที่มีข้อมูลเดิมอยู่แล้ว)
 */
export function nextLotNumber(
  dateISO: string | null | undefined,
  existingLots: (string | null)[],
): string {
  if (!dateISO) return "";
  const y = new Date(dateISO).getFullYear();
  if (isNaN(y)) return "";
  const suffix = String(y + 543).slice(-2);
  let max = 0;
  for (const raw of existingLots) {
    const lot = String(raw ?? "");
    if (!lot.startsWith("S") || !lot.endsWith("/" + suffix)) continue;
    const n = parseInt(lot.slice(1).split("/")[0], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return "S" + (max + 1) + "/" + suffix;
}

/** รอบถัดไปของล็อต — รอบแรกของการกลั่นซ้ำคือ **รอบที่ 2** (รอบ 1 = กลั่นจากน้ำส่า) */
export function nextRoundNo(rounds: RedistillRound[]): number {
  let max = 1;
  for (const r of rounds) if (Number(r.round_no) > max) max = Number(r.round_no);
  return max + 1;
}

/**
 * เลขอ้างอิงที่ใช้ตัดวัตถุดิบของรอบนั้น — ไปโผล่ในคอลัมน์ "รายการ" ของ ภส.๐๗-๐๑/๑
 * ต่อท้ายชื่อวัตถุดิบ เช่น `จูนิเปอร์ S1/69 รอบ 2`
 *
 * 🚨 รูปแบบนี้ถูก **ตรวจซ้ำใน `fn_save_redistill_round`** ก่อนใช้ลบ/เขียน `log_material`
 *    เพราะฟังก์ชันนั้นลบด้วย `doc_ref` — รับค่าอะไรก็ได้แล้วส่งเลข batch มา =
 *    ลบวัตถุดิบที่เบิกไปหมักทิ้งทั้งชุดโดยไม่มีอะไรฟ้อง
 */
export function materialDocRef(lotNo: string, roundNo: number): string {
  return `${lotNo} รอบ ${roundNo}`;
}

// ── สรุปล็อต ───────────────────────────────────────────────────────────────────
export type LotSummary = {
  lotNo: string;
  productName: string;
  drawVol: number;
  drawAbv: number;
  /** ยอด/ดีกรีที่ออกจากรอบสุดท้ายที่บันทึกผลไว้ (0 = ยังไม่มีรอบไหนจบ) */
  lastVol: number;
  lastAbv: number;
  lastRoundNo: number;
  roundsDone: number;
  roundsTotal: number;
  closed: boolean;
  finalVol: number;
  finalAbv: number;
  /** ลิตรแอลกอฮอล์บริสุทธิ์ (LPA) เข้า/ออก — ตัวเลขที่เจ้าหน้าที่จะไล่ดูบนฟอร์ม */
  lpaIn: number;
  lpaOut: number;
  /**
   * % แอลกอฮอล์ที่หายไประหว่างกลั่นซ้ำ (คิดจาก LPA ไม่ใช่จากลิตร)
   *
   * 🚨 `null` = **ยังไม่มีอะไรให้เทียบ** (เปิดล็อตแล้วแต่ยังไม่บันทึกผลรอบไหนเลย)
   *    ห้ามคืน 100 — ของยังอยู่ในถังครบ ยังไม่หายไปไหน · เจอตอนเทสในเบราว์เซอร์:
   *    การ์ดสรุปขึ้น *"หายระหว่างทาง 100.00%"* ทันทีที่เปิดล็อต ซึ่งเป็นตัวเลขที่ไม่จริง
   *    (ตระกูล D91/0059 — ตรรกะถูก แต่ตัวเลข/ประโยคที่ผู้ใช้อ่านผิด)
   */
  lpaLossPct: number | null;
};

export function lotSummary(lot: RedistillLot, rounds: RedistillRound[]): LotSummary {
  const drawVol = num(lot.draw_vol);
  const drawAbv = num(lot.draw_abv);
  const done = rounds
    .filter((r) => has(r.end_vol))
    .sort((a, b) => Number(a.round_no) - Number(b.round_no));
  const last = done.length ? done[done.length - 1] : null;
  const closed = has(lot.final_vol) && !!lot.dilute_date;
  const finalVol = num(lot.final_vol);
  const finalAbv = num(lot.final_abv);

  const lastVol = last ? num(last.end_vol) : 0;
  const lastAbv = last ? num(last.end_abv) : 0;

  const lpaIn = (drawVol * drawAbv) / 100;
  // ยังไม่ปิดล็อต → เทียบกับรอบสุดท้ายที่จบแล้ว (การปรับดีกรีไม่เปลี่ยน LPA อยู่แล้ว)
  const lpaOut = closed ? (finalVol * finalAbv) / 100 : (lastVol * lastAbv) / 100;

  return {
    lotNo: lot.lot_no,
    productName: lot.product_name,
    drawVol,
    drawAbv,
    lastVol,
    lastAbv,
    lastRoundNo: last ? Number(last.round_no) : 0,
    roundsDone: done.length,
    roundsTotal: rounds.length,
    closed,
    finalVol,
    finalAbv,
    lpaIn,
    lpaOut,
    // ★ มีตัวเลขให้เทียบก็ต่อเมื่อมีรอบที่บันทึกผลแล้ว หรือปิดล็อตแล้วเท่านั้น
    lpaLossPct: lpaIn > 0 && (done.length > 0 || closed) ? ((lpaIn - lpaOut) / lpaIn) * 100 : null,
  };
}

// ── ตรวจความต่อเนื่องของรอบ — **เตือน ไม่บล็อก** ────────────────────────────────
/**
 * ผู้ใช้ย้ายมาจาก Sheets ที่แก้มือได้ทุกอย่าง (CLAUDE.md) → ห้ามบล็อก
 * แต่ **ต้องบอกทุกครั้งที่ตัวเลขไม่ต่อกัน** ไม่งั้นยอดบนฟอร์มเพี้ยนเงียบ ๆ
 *
 * 🪤 เทียบด้วย epsilon 0.005 (ครึ่งหน่วยสุดท้ายของทศนิยม 2 ตำแหน่งที่หน้าจอโชว์)
 *    ไม่งั้นเศษลอยตัวจะทำให้ขึ้นเตือนทั้งที่ผู้ใช้กรอกตรงกันเป๊ะ = เตือนจนคนเลิกอ่าน
 */
const EPS = 0.005;

export function roundIssues(lot: RedistillLot, rounds: RedistillRound[]): string[] {
  const out: string[] = [];
  const sorted = [...rounds].sort((a, b) => Number(a.round_no) - Number(b.round_no));
  if (sorted.length === 0) return out;

  // รอบต้องเรียงต่อกันไม่ข้ามเลข (2,3,4…) — ข้ามเลขแปลว่ามีรอบที่ลืมบันทึก
  const first = Number(sorted[0].round_no);
  if (first !== 2) out.push(`รอบแรกของการกลั่นซ้ำควรเป็นรอบที่ 2 (พบรอบที่ ${first})`);
  for (let i = 1; i < sorted.length; i++) {
    const prev = Number(sorted[i - 1].round_no);
    const cur = Number(sorted[i].round_no);
    if (cur !== prev + 1) out.push(`เลขรอบข้าม: รอบที่ ${prev} → รอบที่ ${cur}`);
  }

  const drawVol = num(lot.draw_vol);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const rn = Number(r.round_no);

    if (has(r.start_vol)) {
      const startVol = num(r.start_vol);
      const expect = i === 0 ? drawVol : has(sorted[i - 1].end_vol) ? num(sorted[i - 1].end_vol) : null;
      if (expect !== null && Math.abs(startVol - expect) > EPS) {
        out.push(
          i === 0
            ? `รอบที่ ${rn} เริ่มที่ ${f2(startVol)} ล. แต่ยกออกจากถัง ${f2(expect)} ล.`
            : `รอบที่ ${rn} เริ่มที่ ${f2(startVol)} ล. แต่รอบที่ ${rn - 1} จบที่ ${f2(expect)} ล.`,
        );
      }
    }

    // กลั่นแล้วปริมาณต้องลด — เพิ่มขึ้นแปลว่ากรอกสลับช่อง
    if (has(r.start_vol) && has(r.end_vol) && num(r.end_vol) > num(r.start_vol) + EPS) {
      out.push(`รอบที่ ${rn} ได้ ${f2(num(r.end_vol))} ล. มากกว่าที่เข้ารอบ ${f2(num(r.start_vol))} ล.`);
    }

    if (!has(r.end_vol)) out.push(`รอบที่ ${rn} ยังไม่ได้บันทึกผลที่กลั่นได้`);
  }
  return out;
}

// ── 🔴 จุดตัดสินเดียวว่าฟอร์มจะเห็นอะไร ─────────────────────────────────────────
export type DiluteRowPlan = {
  leg: DiluteLeg;
  date: string;
  startVol: number | null;
  startAbv: number | null;
  water: number | null;
  finalVol: number | null;
  finalAbv: number | null;
  note: string;
};

export type CloseInput = {
  diluteDate: string;
  water?: number | null;
  finalVol: number;
  finalAbv: number;
};

/**
 * 🔴🔴 **จุดเดียวของทั้งระบบที่ตัดสินว่าล็อตกลั่นซ้ำจะปรากฏบนฟอร์ม ภส. อย่างไร**
 *
 * ตอนนี้: **แยก 2 ท่อน คนละวัน** (ผู้ใช้ตัดสิน D94)
 *   ท่อน 'ยกไปปรุง'  วันเริ่มแช่   → `start_vol` = ยอดยกออกจากถัง (คอลัมน์ "นำไปปรุง")
 *   ท่อน 'ปรุงเสร็จ' วันปรับดีกรี → `final_vol` = ยอดพร้อมบรรจุ (ดัน "คงเหลือสุราปรุง")
 *
 * เหตุผล: วันตัดสมุนไพร (ฟอร์ม ๐๗-๐๑/๑) กับวันยกไปปรุง (ฟอร์ม ๐๗-๐๒/๑(๑)) ตกวันเดียวกัน
 * ⇒ เจ้าหน้าที่เปิดสองใบมาเทียบแล้วเห็นภาพจบในตัวว่า 240 ล. อยู่ในถังแช่กับสมุนไพรชุดนั้น
 * และยอดคงเหลือถูก **ทุกวัน** ไม่ใช่แค่ถูกสิ้นเดือน (บัญชีประจำวันถูกขอดูได้ทุกเมื่อ — D91)
 *
 * ⚠️ ถ้าสรรพสามิตตอบกลับมาว่าอยากเห็น **แถวเดียวตอนปรับดีกรี** ให้แก้ที่ฟังก์ชันนี้
 *    จุดเดียว (คืนแถวเดียวที่มีทั้ง startVol และ finalVol ลงวัน `diluteDate`)
 *    — แพตเทิร์นเดียวกับ `drawnVol()` ของ D78 · ห้ามไปเติมเงื่อนไขในคอมโพเนนต์
 */
export function dilutePlan(
  lot: RedistillLot,
  rounds: RedistillRound[],
  close?: CloseInput,
): DiluteRowPlan[] {
  const notes = lotNoteText(lot, rounds, close);
  const plan: DiluteRowPlan[] = [
    {
      leg: "ยกไปปรุง",
      date: String(lot.draw_date).slice(0, 10),
      startVol: num(lot.draw_vol),
      startAbv: num(lot.draw_abv),
      water: null,
      finalVol: null,
      finalAbv: null,
      note: notes.draw,
    },
  ];
  if (close) {
    plan.push({
      leg: "ปรุงเสร็จ",
      date: String(close.diluteDate).slice(0, 10),
      startVol: null,
      startAbv: null,
      water: close.water ?? null,
      finalVol: close.finalVol,
      finalAbv: close.finalAbv,
      note: notes.final,
    });
  }
  return plan;
}

// ── ข้อความหมายเหตุที่พิมพ์ลงฟอร์มจริง ──────────────────────────────────────────
/**
 * 🚨 หมายเหตุคือ **หลักฐานเดียว**ที่อธิบายว่าสุรา 240 ล. หายไปไหนระหว่างสองแถว
 *    ⇒ เป็นส่วนที่ต้องอ่านรู้เรื่องโดยไม่ต้องเปิดระบบ ห้ามย่อจนเหลือแต่เลขล็อต
 *
 * 🪤 คำว่า "แช่" ตัดสินจาก `soak_date` ของรอบจริง **ไม่ฮาร์ดโค้ด** — วอดก้ากลั่น 3 รอบ
 *    ไม่ใส่สมุนไพรเลย เขียนว่า "ยกไปแช่" ก็เป็นคำโกหกบนเอกสารราชการ
 */
export function lotNoteText(
  lot: RedistillLot,
  rounds: RedistillRound[],
  close?: CloseInput,
): { draw: string; final: string } {
  const soaked = rounds.some((r) => !!r.soak_date);
  const verb = soaked ? "ยกไปแช่สมุนไพรและกลั่นซ้ำ" : "ยกไปกลั่นซ้ำ";
  const s = lotSummary(lot, rounds);

  const draw = close
    ? `${lot.lot_no} ปรับดีกรีเสร็จ ${fmtIsoDMY(close.diluteDate)}`
    : `${verb} ${lot.lot_no} (อยู่ระหว่างดำเนินการ)`;

  if (!close) return { draw, final: "" };

  const parts = [lot.lot_no];
  if (s.roundsDone > 0) parts.push(`ได้ ${f2(s.lastVol)} ล. ${fabv(s.lastAbv)} ดีกรี`);
  parts.push(`ปรับดีกรี ${fabv(close.finalAbv)} ได้ปริมาณ ${f2(close.finalVol)} ลิตร`);
  // ★ ท่อนแรกเป็นเลขล็อต ไม่ใช่ประโยค → ต่อด้วยช่องว่าง ที่เหลือคั่นด้วย ·
  return { draw, final: parts[0] + " " + parts.slice(1).join(" · ") };
}

// ── ป้ายสถานะ — ตัดสินใน lib ที่มีเทสคุม ห้ามตัดสินในคอมโพเนนต์ (D84/D88) ─────────
export type LotBadge = { text: string; tone: "ok" | "warn" | "info" };

export function lotBadge(lot: RedistillLot, rounds: RedistillRound[]): LotBadge {
  const s = lotSummary(lot, rounds);
  if (s.closed) return { text: "ปิดล็อตแล้ว", tone: "ok" };
  if (s.roundsTotal === 0) return { text: "ยังไม่มีรอบกลั่น", tone: "warn" };
  if (s.roundsDone < s.roundsTotal) return { text: "กำลังกลั่น", tone: "info" };
  return { text: "รอปรับดีกรี", tone: "warn" };
}

/**
 * ล็อตที่ **กลั่นซ้ำเสร็จแล้วแต่ยังไม่ปรับดีกรี** ณ สิ้นเดือนที่กำลังจะปิด
 *
 * 🚨 ช่วงนี้คือช่วงเดียวที่บัญชีห่างจากของจริง: ฟอร์มบอกว่าสุรากลั่นถูกยกไปปรุงหมดแล้ว
 *    (คงเหลือลดไปแล้ว) แต่ยอดที่จะกลายเป็นสุราปรุงยังไม่เข้าบัญชี ⇒ ต้องบอกผู้ใช้
 *    ก่อนกดปิดเดือน ไม่ใช่ปล่อยให้ไปเจอตอนเจ้าหน้าที่มาตรวจ
 *    (กติกา: ทุกครั้งที่ระบบไม่ทำอะไรให้ ต้องบอกว่าทำไม — D92)
 */
export function lotsPendingAtMonthEnd(
  lots: RedistillLot[],
  roundsByLot: Record<string, RedistillRound[]>,
  monthStr: string,
): { lotNo: string; productName: string; vol: number; abv: number }[] {
  const out: { lotNo: string; productName: string; vol: number; abv: number }[] = [];
  for (const lot of lots) {
    const drawMonth = String(lot.draw_date).slice(0, 7);
    if (drawMonth > monthStr) continue;               // ยังไม่เกิดในเดือนนี้
    // ปิดล็อตภายในเดือนนี้หรือก่อนหน้า = ไม่ค้าง
    if (lot.dilute_date && String(lot.dilute_date).slice(0, 7) <= monthStr) continue;
    const rounds = roundsByLot[lot.lot_no] ?? [];
    const s = lotSummary(lot, rounds);
    if (s.roundsDone === 0) continue;                 // ยังไม่กลั่น = ของยังอยู่ในถังแช่ครบ
    // 🪤 ต้องกลั่นซ้ำ **เสร็จภายในเดือนนี้** ถึงจะค้าง — ถ้ายังไม่ได้กลั่น ณ สิ้นเดือน
    //    สุราก็ยังนอนอยู่ในถังแช่ครบ 240 ล. ตรงกับที่บัญชีบอกพอดี ไม่ต้องเตือน
    const lastDone = rounds
      .filter((r) => has(r.end_vol) && !!r.distill_date)
      .sort((a, b) => Number(a.round_no) - Number(b.round_no))
      .pop();
    if (!lastDone || String(lastDone.distill_date).slice(0, 7) > monthStr) continue;
    out.push({ lotNo: lot.lot_no, productName: lot.product_name, vol: s.lastVol, abv: s.lastAbv });
  }
  return out;
}
