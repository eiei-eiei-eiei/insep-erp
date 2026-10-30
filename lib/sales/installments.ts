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
 * 🚨 ไม่มีสูตรภาษีในไฟล์นี้ — ถอด VAT/WHT ต่องวดใช้ `reverseVatWht` ตัวเดิมใน processOrder
 */

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

export type PlanRowInput = { label: string; percent: number; shipPoint: boolean; dueDate?: string };

/**
 * ตรวจแผนงวดใหม่ (เฉพาะงวดที่ยังไม่ล็อก) ก่อนส่งไปบันทึก — null = ใช้ได้
 * @param remainPct % ที่งวดชุดนี้ต้องรวมให้ได้ (ยอดที่ต้องแบ่ง ÷ ยอดสุทธิ × 100)
 * ★ คลาดได้ 0.01% — ยอดค้างที่เกิดจากลูกค้าจ่ายไม่เท่างวดอาจเป็น % ไม่ลงตัว
 */
export function planError(rows: PlanRowInput[], net: number, remain: number, sent: boolean): string | null {
  if (remain <= 0) return rows.length ? "รับเงินครบแล้ว — ไม่มีงวดให้แบ่ง" : null;
  if (!rows.length) return "ต้องมีอย่างน้อย 1 งวด";
  if (rows.some((r) => !r.label.trim())) return "ทุกงวดต้องมีชื่อ";
  if (rows.some((r) => !(r.percent > 0))) return "ทุกงวดต้องมี % มากกว่า 0";
  const sum = r2(rows.reduce((s, r) => s + r.percent, 0));
  const need = r2((remain / net) * 100);
  // 🪤 ประโยคเดียวใช้ทั้งใบเสนอราคาใหม่ (ยังไม่มีเงินเข้า · ต้องได้ 100%) และปรับงวด (ต้องได้เท่ายอดค้าง)
  //    เทสเบราว์เซอร์เจอ: เดิมพูดว่า "งวดที่ยังไม่รับ … ยอดค้าง" บนใบเสนอราคาใหม่ = ไม่เข้ากับสิ่งที่ผู้ใช้กำลังทำ
  if (Math.abs(sum - need) > 0.01) {
    return `งวดรวมได้ ${sum}% แต่ต้องได้ ${need}%${need < 100 ? " (เท่ายอดค้าง)" : ""}`;
  }
  const amts = planAmounts(net, rows.map((r) => r.percent), remain);
  if (amts.some((a) => a <= 0)) return "งวดสุดท้ายเหลือยอดไม่ถึง 0.01 บาท — ลด % ของงวดก่อนหน้า";
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
 * บรรทัดเงื่อนไขการชำระบนใบเสนอราคา — "งวดที่ 1 มัดจำ 50% = 5,000.00 บาท (ส่งสินค้าหลังรับงวดนี้)"
 * ★ ใช้ทั้งพรีวิวในหน้าสร้างใบเสนอราคาและตอนพิมพ์ (ประโยคเดียวกัน)
 */
export function planTermsLines(rows: { seq: number; label: string; percent: number | null; amount: number; shipPoint: boolean }[]): string[] {
  const money = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return rows.map((r) =>
    `งวดที่ ${r.seq} ${r.label.trim()}${r.percent != null ? ` ${r.percent}%` : ""} = ${money(r.amount)} บาท` +
    (r.shipPoint ? " (ส่งสินค้าหลังรับงวดนี้)" : ""),
  );
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
