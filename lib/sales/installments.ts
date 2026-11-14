/**
 * lib/sales/installments — แบ่งชำระหลายงวด (D145 · เฟส 3a · golden S16)
 *
 * ตาราง `sales_installments` (0101) = แผนงวดของออเดอร์ · การรับเงินจริงอยู่ที่ `sales_payments` (D143)
 * ผูกกันด้วย `sales_payments.installment_seq`
 *
 * กติกา (ผู้ใช้ตัดสิน · DB บังคับซ้ำใน fn_sales_set_plan / fn_apply_order_action):
 *   · รับเงินตามลำดับงวด — รับงวดหลังก่อนงวดก่อนไม่ได้
 *   · งวดที่รับเงินแล้วล็อก · งวดที่ออกใบแจ้งหนี้แล้วแก้ยอดไม่ได้ (ใบอยู่ในมือลูกค้า) — ทั้งสองแบบต้องอยู่ต้นแผนเสมอ
 *   · งวดที่ยังไม่รับต้องรวมได้เท่ายอดค้างพอดี — **งวดสุดท้ายรับส่วนที่เหลือเสมอ** (ไม่มีเศษสตางค์ตกหล่น)
 *   · ลูกค้าจ่ายไม่เท่ายอดงวด → รับตามจริง ส่วนต่างไปลงงวดสุดท้าย · แต่ **งวดสุดท้ายต้องรับเต็มยอดค้าง**
 *   · % คิดจากยอดสุทธิหลังหัก ณ ที่จ่าย (เหมือนมัดจำเดิม D45)
 *   · D164 — กรอกงวดเป็นจำนวนเงินได้ (ก่อน/รวม VAT) → ยอดชำระสุทธิตรึงไว้ที่ `amount` · % คิดกลับให้ไว้แสดง
 * 🚨 ไม่มีสูตรภาษีชุดใหม่ในไฟล์นี้ — ถอด VAT/WHT ใช้ `reverseVatWht` ตัวเดิม (processOrder · และตัวแปลงยอดที่กรอกด้านล่าง)
 */
import { reverseCalcPrint, reverseVatWht } from "./calc";

/** สถานะใหม่ — รับเงินแล้วบางงวด แต่ยังไม่ส่งของ (เช่น รับ 50% แล้วกำลังผลิต) */
export const STATUS_INSTALLMENT = "กำลังผ่อนชำระ";

/** สถานะที่ "ส่งคลังแล้ว" (รอคลังแพ็ค หรือส่งของไปแล้ว) — ส่งซ้ำไม่ได้ · ธงจุดส่งของไม่มีผลแล้ว */
const SENT_STATUSES = ["รอคลังจัดส่ง", "ส่งของแล้วรอชำระยอดค้าง", "ส่งของแล้วรอชำระเงิน", "ปิดการขาย"];
/** สถานะที่ "ของถึงลูกค้าแล้ว" */
const SHIPPED_STATUSES = ["ส่งของแล้วรอชำระยอดค้าง", "ส่งของแล้วรอชำระเงิน"];

export const isSent = (status: string) => SENT_STATUSES.includes(status);

export type Installment = {
  seq: number;
  label: string;
  /** % ที่ผู้ใช้กรอก (ไว้แสดง) · ยอดจริงคือ `amount` */
  percent: number | null;
  amount: number;
  dueDate: string;
  invNo: string;
  invDate: string;
  shipPoint: boolean;
  /** รับเงินงวดนี้แล้ว (มีแถว sales_payments ที่บิลยังไม่ถูกยกเลิก) */
  paid: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const money = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * ป้ายของงวดบนแถวการรับเงิน/ข้อความ LINE — "งวดที่ 2 (เริ่มบรรจุ)"
 * 🪤 ขึ้นต้นด้วย "งวดที่" เสมอ ไม่ใช้ชื่องวดเปล่า ๆ — ชื่องวด "มัดจำ" จะชนกับป้ายการรับเงินแบบเดิม
 *    (`PAY_LABEL.deposit`) แล้ว `paymentForDoc()` จับผิดใบ
 */
export function installmentLabel(i: { seq: number; label: string }): string {
  const name = i.label.trim();
  return name ? `งวดที่ ${i.seq} (${name})` : `งวดที่ ${i.seq}`;
}

/** งวดถัดไปที่รับได้ (ต่ำสุดที่ยังไม่รับ) · ไม่มี = null */
export function nextUnpaid(plan: Installment[]): Installment | null {
  return [...plan].filter((i) => !i.paid).sort((a, b) => a.seq - b.seq)[0] ?? null;
}

/** งวดที่ล็อก = รับแล้ว หรือออกใบแจ้งหนี้แล้ว — ปรับงวดแตะไม่ได้ */
export const isLocked = (i: Installment) => i.paid || !!i.invNo;

/**
 * ยอดของแต่ละงวดจาก % — ปัด 2 ตำแหน่งทุกงวด **ยกเว้นงวดสุดท้ายที่รับส่วนที่เหลือ**
 * @param net     ยอดสุทธิทั้งสัญญา (หลังหัก ณ ที่จ่าย) — ฐานของ %
 * @param remain  ยอดที่ต้องแบ่งให้งวดชุดนี้ (= ยอดค้าง − งวดที่ล็อกแต่ยังไม่รับ)
 */
export function planAmounts(net: number, percents: number[], remain: number): number[] {
  if (!percents.length) return [];
  const out = percents.map((p) => r2((net * p) / 100));
  out[out.length - 1] = r2(remain - out.slice(0, -1).reduce((s, a) => s + a, 0));
  return out;
}

export type PlanRowInput = {
  label: string;
  percent: number;
  shipPoint: boolean;
  dueDate?: string;
  /**
   * D164 — ผู้ใช้กรอกงวดนี้เป็นจำนวนเงิน: **ยอดก่อน VAT ที่ตรึงไว้** (ไม่จด VAT = ยอดก่อนหัก ณ ที่จ่าย) · ไม่ปัด
   * ไม่มีค่า = งวดที่กรอกเป็น % (แบบเดิม)
   * ★ เก็บเป็นยอดก่อน VAT ไม่ใช่ยอดชำระ — ติ๊ก/แก้ % หัก ณ ที่จ่ายทีหลัง ยอดบนใบแจ้งหนี้ที่ตกลงกับลูกค้าต้องไม่ขยับ
   *   (ยอดชำระสุทธิคิดใหม่จาก VAT/WHT ปัจจุบันทุกครั้ง)
   * 🪤 ห้ามแปลงเป็น % แล้วคิดกลับ — % เก็บได้ 4 ตำแหน่ง: 30,000 จากยอด 107,000 = 28.0374% → 30,000.02
   */
  exVat?: number;
};

/**
 * ฐานของจำนวนเงินที่ผู้ใช้กรอกในงวด (D164)
 *   incl = รวม VAT ก่อนหัก ณ ที่จ่าย (ยอดบนใบแจ้งหนี้) · ex = ก่อน VAT
 *   ไม่จด VAT → สองแบบเท่ากัน (ยอดก่อนหัก ณ ที่จ่าย)
 */
export type AmountBasis = "incl" | "ex";
/** VAT/หัก ณ ที่จ่ายของออเดอร์ — แปลงยอดก่อน VAT ↔ ยอดชำระสุทธิ */
export type VatCtx = { isVat: boolean; whtPct: number };

const isFixed = (r: PlanRowInput) => r.exVat != null;
const vatOf = (ctx: VatCtx) => (ctx.isVat ? 0.07 : 0);

/**
 * ยอดก่อน VAT → ยอดชำระสุทธิ (หลังหัก ณ ที่จ่าย) — ทิศกลับของ `reverseVatWht`
 *   ยอดชำระ = ก่อน VAT × (1 + VAT − WHT)
 */
export function netFromExVat(exVat: number, ctx: VatCtx): number {
  return r2(exVat * (1 + vatOf(ctx) - (ctx.whtPct || 0) / 100));
}

/** ยอดชำระสุทธิ → ยอดก่อน VAT (ไม่ปัด) — `reverseVatWht` ตัวเดียวกับตอนออกเอกสารงวด */
export function exVatFromNet(net: number, ctx: VatCtx): number {
  return reverseVatWht(net, ctx.whtPct || 0, false, ctx.isVat).preVat;
}

/** ตัวเลขที่ผู้ใช้พิมพ์ในฐานที่เลือก → ยอดก่อน VAT (ไม่ปัด · ปัดครั้งเดียวตอนคิดยอดชำระ) */
export function exVatFromInput(value: number, basis: AmountBasis, ctx: VatCtx): number {
  return basis === "incl" ? value / (1 + vatOf(ctx)) : value;
}

/** ยอดก่อน VAT → ตัวเลขที่แสดงในฐานที่เลือก */
export function inputFromExVat(exVat: number, basis: AmountBasis, ctx: VatCtx): number {
  return r2(basis === "incl" ? exVat * (1 + vatOf(ctx)) : exVat);
}

/** ยอดชำระที่ผู้ใช้ตั้งใจของงวด (ก่อนให้งวดสุดท้ายรับเศษ) */
export function intendedNet(r: PlanRowInput, net: number, ctx: VatCtx): number {
  return isFixed(r) ? netFromExVat(Number(r.exVat), ctx) : r2((net * (r.percent || 0)) / 100);
}

/**
 * ยอดชำระสุทธิของแต่ละงวด (D164) — งวดที่กรอกเป็นเงินคิดจากยอดก่อน VAT · งวดที่กรอก % คิดแบบ `planAmounts`
 * **งวดสุดท้ายรับส่วนที่เหลือเสมอ**
 * ★ server ใช้ตัวนี้ส่งยอดเข้า RPC · จอใช้ตัวนี้แสดง — เห็นอย่างไร บันทึกอย่างนั้น
 * ★ ไม่มีงวดกรอกเป็นเงิน = ผลเท่า `planAmounts` เป๊ะ
 */
export function planRowAmounts(net: number, rows: PlanRowInput[], remain: number, ctx: VatCtx): number[] {
  if (!rows.length) return [];
  const out = rows.map((r) => intendedNet(r, net, ctx));
  out[out.length - 1] = r2(remain - out.slice(0, -1).reduce((s, a) => s + a, 0));
  return out;
}

/** % ของงวดไว้แสดง — งวดที่กรอกเป็นเงินคิดกลับจากยอดชำระ (2 ตำแหน่ง) */
export function rowPercent(r: PlanRowInput, net: number, ctx: VatCtx): number {
  if (!isFixed(r)) return r.percent || 0;
  return net > 0 ? r2((intendedNet(r, net, ctx) / net) * 100) : 0;
}

/** % ที่เก็บลง `sales_installments.percent` (numeric 7,4 · ไว้แสดงเท่านั้น) — งวดที่กรอกเป็นเงินคิดกลับ 4 ตำแหน่ง */
export function percentToStore(r: PlanRowInput, net: number, ctx: VatCtx): number {
  if (!isFixed(r)) return r.percent;
  return net > 0 ? r4((intendedNet(r, net, ctx) / net) * 100) : 0;
}

/**
 * ผลรวมของแผนเทียบกับยอดที่ต้องได้ (D164)
 *   · ไม่มีงวดกรอกเป็นเงิน → เทียบ % แบบเดิม (คลาดได้ 0.01%)
 *   · มีงวดกรอกเป็นเงิน → เทียบเป็นบาท (ยอดชำระ) · คลาดได้งวดละ 1 สตางค์ (แปลงเป็นยอดชำระแล้วปัดทีละงวด)
 *     + 0.01% ของยอดสุทธิถ้ายังมีงวดที่กรอก % ปนอยู่
 * ★ งวดสุดท้ายรับเศษเสมอ — ตรงนี้มีไว้จับการกรอกผิดของคน ไม่ใช่เศษสตางค์จากการปัด
 */
export function planSum(rows: PlanRowInput[], net: number, remain: number, ctx: VatCtx) {
  const fixed = rows.some(isFixed);
  const need = net > 0 ? r2((remain / net) * 100) : 0;
  const intended = r2(rows.reduce((s, r) => s + intendedNet(r, net, ctx), 0));
  if (!fixed) {
    const sumPct = r2(rows.reduce((s, r) => s + (r.percent || 0), 0));
    return { fixed, sumPct, need, intended, ok: Math.abs(sumPct - need) <= 0.01 };
  }
  const nFixed = rows.filter(isFixed).length;
  const tol = 0.005 + 0.01 * nFixed + (nFixed < rows.length ? net * 0.0001 : 0);
  return { fixed, sumPct: net > 0 ? r2((intended / net) * 100) : 0, need, intended, ok: Math.abs(intended - remain) <= tol };
}

/**
 * ปรับงวดสุดท้ายให้แผนรวมได้พอดี (ปุ่มใต้ข้อความเตือน · D164) — null = ทำไม่ได้ (งวดก่อนหน้ากินยอดหมดแล้ว)
 *   · มีงวดกรอกเป็นเงิน → งวดสุดท้ายเป็นเงิน (ยอดที่ขาดพอดี ไม่ผ่าน %)
 *   · แผน % ล้วน → งวดสุดท้ายเป็น % ที่ขาด (แบบเดิม)
 */
export function fillLastRow(rows: PlanRowInput[], net: number, remain: number, ctx: VatCtx): PlanRowInput[] | null {
  if (!rows.length || !(net > 0)) return null;
  const others = rows.slice(0, -1);
  const last = rows[rows.length - 1];
  if (others.some(isFixed) || isFixed(last)) {
    const gap = r2(remain - others.reduce((s, r) => s + intendedNet(r, net, ctx), 0));
    if (!(gap > 0)) return null;
    return [...others, { ...last, exVat: exVatFromNet(gap, ctx) }];
  }
  const pct = r2(r2((remain / net) * 100) - others.reduce((s, r) => s + (r.percent || 0), 0));
  if (!(pct > 0)) return null;
  return [...others, { ...last, percent: pct }];
}

/**
 * แผนงวดที่บันทึกไว้ → แถวในตัวแก้ (D164 · ใช้ทั้งแก้ใบเสนอราคาและปรับงวด)
 * ★ งวดที่ยอดไม่ตรงกับ % (= กรอกเป็นเงินไว้) โหลดกลับเป็นงวดกรอกเป็นเงิน — ไม่งั้นเปิดแก้แล้วกดบันทึก
 *   ยอด 30,000 จะกลายเป็น 28.0374% = 30,000.02 เงียบ ๆ
 * ★ งวดสุดท้ายรับเศษเสมอ — โหลดเป็น % (ปัด 2 ตำแหน่ง)
 */
export function rowsFromPlan(list: Installment[], net: number, ctx: VatCtx, sent = false): PlanRowInput[] {
  return list.map((i, k) => {
    const pct = i.percent ?? (net > 0 ? r2((i.amount / net) * 100) : 0);
    const last = k === list.length - 1;
    const row: PlanRowInput = { label: i.label, percent: last ? r2(pct) : pct, shipPoint: sent ? false : i.shipPoint, dueDate: i.dueDate };
    if (!last && r2((net * pct) / 100) !== r2(i.amount)) row.exVat = exVatFromNet(i.amount, ctx);
    return row;
  });
}

/**
 * ตรวจแผนงวดใหม่ (เฉพาะงวดที่ยังไม่ล็อก) ก่อนส่งไปบันทึก — null = ใช้ได้
 * ★ คลาดได้ 0.01% — ยอดค้างที่เกิดจากลูกค้าจ่ายไม่เท่างวดอาจเป็น % ไม่ลงตัว
 * @param ctx VAT/หัก ณ ที่จ่ายของออเดอร์ — ต้องส่งเมื่อมีงวดกรอกเป็นเงิน (D164)
 *   🚨 ไม่ส่งแล้วมีงวดกรอกเป็นเงิน = ไม่ให้บันทึก (เดา VAT = ยอดงวดผิดเงียบ ๆ)
 */
export function planError(rows: PlanRowInput[], net: number, remain: number, sent: boolean, ctx?: VatCtx): string | null {
  if (remain <= 0) return rows.length ? "รับเงินครบแล้ว — ไม่มีงวดให้แบ่ง" : null;
  if (!rows.length) return "ต้องมีอย่างน้อย 1 งวด";
  if (rows.some((r) => !r.label.trim())) return "ทุกงวดต้องมีชื่อ";
  if (rows.some(isFixed) && !ctx) return "ระบบไม่ทราบ VAT/หัก ณ ที่จ่ายของออเดอร์ — คิดยอดงวดที่กรอกเป็นเงินไม่ได้";
  const c = ctx ?? { isVat: true, whtPct: 0 }; // ถึงตรงนี้โดยไม่มี ctx = ไม่มีงวดกรอกเป็นเงิน → ค่านี้ไม่ถูกใช้คิดอะไร
  if (rows.some((r) => isFixed(r) && !(Number(r.exVat) > 0))) return "ทุกงวดต้องมียอดมากกว่า 0";
  if (rows.some((r) => !isFixed(r) && !(r.percent > 0))) return "ทุกงวดต้องมี % มากกว่า 0";
  const s = planSum(rows, net, remain, c);
  // 🪤 ประโยคเดียวใช้ทั้งใบเสนอราคาใหม่ (ยังไม่มีเงินเข้า · ต้องได้ 100%) และปรับงวด (ต้องได้เท่ายอดค้าง)
  //    เทสเบราว์เซอร์เจอ: เดิมพูดว่า "งวดที่ยังไม่รับ … ยอดค้าง" บนใบเสนอราคาใหม่ = ไม่เข้ากับสิ่งที่ผู้ใช้กำลังทำ
  if (!s.ok) {
    const tail = s.need < 100 ? " (เท่ายอดค้าง)" : "";
    // D164 — มีงวดกรอกเป็นเงิน → บอกเป็นบาทของยอดชำระ ไม่ใช่ % ที่ผู้ใช้ไม่ได้กรอก
    return s.fixed
      ? `ยอดชำระรวมได้ ${money(s.intended)} บาท แต่ต้องได้ ${money(remain)} บาท${tail}`
      : `งวดรวมได้ ${s.sumPct}% แต่ต้องได้ ${s.need}%${tail}`;
  }
  const amts = planRowAmounts(net, rows, remain, c);
  if (amts.some((a) => a <= 0)) return `งวดสุดท้ายเหลือยอดไม่ถึง 0.01 บาท — ลด${s.fixed ? "ยอด" : " %"}ของงวดก่อนหน้า`;
  if (rows.filter((r) => r.shipPoint).length > 1) return "จุดส่งของเลือกได้งวดเดียว";
  if (sent && rows.some((r) => r.shipPoint)) return "ส่งคลังไปแล้ว — ไม่ต้องเลือกจุดส่งของ";
  return null;
}

/**
 * ตรวจยอดที่รับในงวดนี้ — null = รับได้
 * ★ จ่ายไม่เท่ายอดงวดได้ (ส่วนต่างไปลงงวดสุดท้าย) · 🚨 แต่งวดสุดท้ายต้องเต็มยอดค้าง ไม่งั้นยอดค้างไม่มีงวดรองรับ
 */
export function receiveAmountError(plan: Installment[], seq: number, amount: number, outstanding: number): string | null {
  const next = nextUnpaid(plan);
  if (!next) return "รับเงินครบทุกงวดแล้ว";
  if (seq !== next.seq) return `ต้องรับงวดที่ ${next.seq} ก่อน (รับตามลำดับงวด)`;
  if (!(amount > 0)) return "ยอดที่รับต้องมากกว่า 0";
  if (r2(amount) > r2(outstanding)) return `ยอดที่รับเกินยอดค้าง (${r2(outstanding)})`;
  const unpaid = plan.filter((i) => !i.paid);
  if (unpaid.length === 1 && r2(amount) !== r2(outstanding)) {
    return `งวดสุดท้ายต้องรับเต็มยอดค้าง ${r2(outstanding)} — ถ้าลูกค้าจ่ายไม่ครบ ให้ปรับงวดเพิ่มงวดก่อน`;
  }
  return null;
}

/**
 * สถานะหลังรับเงินงวดหนึ่ง — ส่งคลังเมื่อถึงจุดส่งของ หรือเมื่อรับครบทุกงวดแล้ว
 * @returns status ใหม่ · nextStatus (สถานะหลังคลังยืนยันจัดส่ง) · ship = ครั้งนี้ส่งคลังด้วย (ต้องมีเลขใบแจ้งหนี้/ใบส่งสินค้า)
 */
export function statusAfterInstallment(
  current: string,
  shipPoint: boolean,
  outstandingAfter: number,
): { status: string; nextStatus?: string; ship: boolean } {
  const done = r2(outstandingAfter) <= 0;
  const afterShip = done ? "ปิดการขาย" : "ส่งของแล้วรอชำระยอดค้าง";
  if (SHIPPED_STATUSES.includes(current)) return { status: done ? "ปิดการขาย" : current, ship: false };
  if (current === "รอคลังจัดส่ง") return { status: current, nextStatus: afterShip, ship: false };
  if (shipPoint || done) return { status: "รอคลังจัดส่ง", nextStatus: afterShip, ship: true };
  return { status: STATUS_INSTALLMENT, ship: false };
}

/**
 * แผนตั้งต้นตอนเปิด "แบ่งชำระเป็นงวด" ในใบเสนอราคา — มัดจำ x% แล้วส่งของ (= โฟลว์มัดจำเดิม D45)
 * ★ ใบเสนอราคาเดิมที่ติ๊กมัดจำไว้ (ยังไม่มีแผน) แปลงเป็นแผนนี้ตอนเปิดแก้
 */
export function defaultPlanRows(depositPct = 50): PlanRowInput[] {
  const p = depositPct > 0 && depositPct < 100 ? depositPct : 50;
  return [
    { label: "มัดจำ", percent: p, shipPoint: true },
    { label: "ส่วนที่เหลือ", percent: r2(100 - p), shipPoint: false },
  ];
}

/**
 * บรรทัดเงื่อนไขการชำระบนใบเสนอราคา
 * ★ ใช้ทั้งพรีวิวในหน้าสร้างใบเสนอราคาและตอนพิมพ์ (ประโยคเดียวกัน)
 *
 * D169 — กิจการที่จด VAT: บอกมูลค่าก่อน VAT ทุกงวด (ลูกค้าบางเจ้าตั้งงบ/PO เป็นยอดก่อน VAT)
 *   "งวดที่ 1 มัดจำ 50% — ก่อน VAT 50,000.00 · VAT 3,500.00 · รวม 53,500.00 บาท"
 *   มีหัก ณ ที่จ่าย: "… · VAT 3,500.00 · หัก ณ ที่จ่าย 1,500.00 · ชำระ 52,000.00 บาท"
 * 🚨 ตัวเลขก่อน VAT/VAT/หัก ณ ที่จ่าย ถอดด้วย `reverseCalcPrint()` **ตัวเดียวกับใบกำกับภาษีของงวดนั้น** (print.ts)
 *    ⇒ ลูกค้าเทียบใบเสนอราคากับใบกำกับที่ได้ทีหลังแล้วตรงกันทุกตัว · ยอดท้ายบรรทัด = ยอดงวดที่บันทึกจริง
 *    ★ คั่นด้วย "·" ไม่ใช่ + − = เพราะแต่ละตัวปัดแยกกัน (เหมือนบนใบกำกับ) บางงวดบวกลบแล้วคลาด 1 สตางค์
 * ★ ไม่จด VAT: ไม่มีอะไรให้ถอด → "งวดที่ 1 มัดจำ 50% = 5,000.00 บาท" เหมือนเดิม
 * ★ ตัดวงเล็บ "(ส่งสินค้าหลังรับงวดนี้)" ออก (ผู้ใช้สั่ง) — งานบริการ/ค่าที่ปรึกษาไม่มีการส่งของ
 *   จุดส่งของยังทำงานเหมือนเดิม (ship_point คุมการส่งคลัง) แค่ไม่พิมพ์บนใบเสนอราคา
 */
export function planTermsLines(
  rows: { seq: number; label: string; percent: number | null; amount: number }[],
  ctx: VatCtx,
): string[] {
  const wht = ctx.whtPct || 0;
  return rows.map((r) => {
    // D164 — งวดที่กรอกเป็นเงินเก็บ % ไว้ 4 ตำแหน่ง → พิมพ์ 2 ตำแหน่ง
    const head = `งวดที่ ${r.seq} ${r.label.trim()}${r.percent != null ? ` ${r2(r.percent)}%` : ""}`;
    if (!ctx.isVat) return `${head} = ${money(r.amount)} บาท`;
    const v = reverseCalcPrint(r.amount, wht, true);
    return `${head} — ก่อน VAT ${money(v.preVat)} · VAT ${money(v.vat)}` +
      (wht > 0 ? ` · หัก ณ ที่จ่าย ${money(v.wht)} · ชำระ ${money(r.amount)} บาท` : ` · รวม ${money(r.amount)} บาท`);
  });
}

/**
 * ตัวเลขบนใบแจ้งหนี้/ใบเสร็จของงวด k (D147 · เฟส 3c)
 *   ยอดตามสัญญา · รับไปแล้วก่อนหน้า · งวดนี้ · คงเหลือหลังงวดนี้ · "งวดที่ k/n"
 * ★ "รับไปแล้วก่อนหน้า" = งวดที่เลขน้อยกว่า k ที่รับแล้ว (ยอดจริงของงวด — เก็บยอดที่รับจริงตั้งแต่ 0101)
 * ★ คงเหลือ = ยอดตามสัญญา − รับก่อนหน้า − งวดนี้ (ไม่อ่านยอดค้างปัจจุบัน — พิมพ์ซ้ำทีหลังต้องได้เลขเดิม)
 */
export function installmentDocFigures(plan: Installment[], seq: number, net: number) {
  const sorted = [...plan].sort((a, b) => a.seq - b.seq);
  const me = sorted.find((i) => i.seq === seq);
  const paidBefore = r2(sorted.filter((i) => i.seq < seq && i.paid).reduce((s, i) => s + i.amount, 0));
  const amount = me ? r2(me.amount) : 0;
  return {
    k: seq,
    n: sorted.length,
    label: me?.label ?? "",
    contract: r2(net),
    paidBefore,
    amount,
    remaining: r2(net - paidBefore - amount),
  };
}

/** action ของออเดอร์แบ่งงวด — ปุ่มแบบเดิม (มัดจำ/ยอดค้าง/จ่ายเต็ม/ส่งเครดิต) ใช้กับออเดอร์ที่มีแผนไม่ได้ */
const PLAN_ACTIONS = ["RECEIVE_INSTALLMENT", "SHIP_PLAN"];

/**
 * action นี้ใช้กับออเดอร์นี้ได้ไหม — null = ได้
 * 🚨 ออเดอร์มีแผนงวดแล้วกดปุ่มแบบเดิม = เงินเข้าโดยไม่ผูกงวด → แผนกับยอดค้างไม่ตรงกันเงียบ ๆ
 *    และกลับกัน ออเดอร์แบบเดิมไม่มีงวดให้รับ
 */
export function planActionError(action: string, hasPlan: boolean): string | null {
  const planAction = PLAN_ACTIONS.includes(action);
  if (hasPlan && !planAction) return "ออเดอร์นี้แบ่งชำระเป็นงวด — ใช้ปุ่มรับชำระงวด / ส่งคลังตอนนี้";
  if (!hasPlan && planAction) return "ออเดอร์นี้ไม่มีแผนงวด — ใช้ปุ่มรับเงินแบบเดิม";
  return null;
}

/** ส่งคลังตอนนี้ (ก่อนถึงจุดส่งของ) — ส่งได้ครั้งเดียว */
export function shipNowError(status: string): string | null {
  if (status === "ยกเลิก") return "ออเดอร์ถูกยกเลิกแล้ว";
  if (isSent(status)) return "ส่งคลังไปแล้ว";
  return null;
}
export function statusAfterShipNow(outstanding: number): { status: string; nextStatus: string } {
  return { status: "รอคลังจัดส่ง", nextStatus: r2(outstanding) <= 0 ? "ปิดการขาย" : "ส่งของแล้วรอชำระยอดค้าง" };
}
