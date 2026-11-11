import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  planAmounts, planRowAmounts, planError, planSum, rowPercent, percentToStore, rowsFromPlan,
  netFromExVat, exVatFromNet, exVatFromInput, inputFromExVat, planTermsLines, fillLastRow,
  type Installment, type PlanRowInput, type VatCtx,
} from "./installments";
import { quotationTotals } from "./calc";

/**
 * golden S24 — กรอกงวดเป็นจำนวนเงิน (D164)
 *
 * ผู้ใช้กรอกงวดเป็น % (แบบเดิม) หรือเป็นจำนวนเงิน "รวม VAT" / "ก่อน VAT" ก็ได้ — กรอกเงินแล้วคิดกลับเป็น % ให้
 * ★ งวดที่กรอกเป็นเงินเก็บยอดก่อน VAT ไว้ (ไม่ปัด) · ยอดชำระคิดใหม่จาก VAT/หัก ณ ที่จ่ายปัจจุบัน
 * ★ ไม่มีงวดกรอกเป็นเงิน = ผลเท่าเส้นทางเดิม (planAmounts) เป๊ะ
 */

const VAT: VatCtx = { isVat: true, whtPct: 0 };
const VAT_WHT3: VatCtx = { isVat: true, whtPct: 3 };
const NOVAT: VatCtx = { isVat: false, whtPct: 0 };
const NOVAT_WHT3: VatCtx = { isVat: false, whtPct: 3 };

const pct = (percent: number, o: Partial<PlanRowInput> = {}): PlanRowInput => ({ label: "งวด", percent, shipPoint: false, ...o });
/** งวดที่ผู้ใช้พิมพ์เป็นเงินในฐานที่เลือก */
const money = (value: number, basis: "incl" | "ex", ctx: VatCtx, o: Partial<PlanRowInput> = {}): PlanRowInput =>
  ({ label: "งวด", percent: 0, shipPoint: false, exVat: exVatFromInput(value, basis, ctx), ...o });

describe("S24 เส้นทาง % เดิมไม่ขยับ", () => {
  it("ไม่มีงวดกรอกเป็นเงิน → planRowAmounts = planAmounts ทุกกรณี (ทุก ctx)", () => {
    const cases: [number, number[], number][] = [
      [100000, [50, 20, 30], 100000],
      [1070, [33.33, 33.33, 33.34], 1070],
      [100000, [50], 50000],
      [100000, [30, 20], 50000],
      [97196.26, [12.5, 37.5, 50], 97196.26],
    ];
    for (const [net, ps, remain] of cases) {
      for (const ctx of [VAT, VAT_WHT3, NOVAT, NOVAT_WHT3]) {
        expect(planRowAmounts(net, ps.map((p) => pct(p)), remain, ctx)).toEqual(planAmounts(net, ps, remain));
      }
    }
  });
  it("planError ของแผน % ไม่ส่ง ctx ก็ได้ (ผลเท่าเดิม)", () => {
    expect(planError([pct(30), pct(30)], 100000, 50000, false)).toBe("งวดรวมได้ 60% แต่ต้องได้ 50% (เท่ายอดค้าง)");
    expect(planError([pct(30), pct(20)], 100000, 50000, false)).toBeNull();
    expect(planError([pct(30), pct(20)], 100000, 50000, false, VAT_WHT3)).toBeNull();
  });
});

describe("S24 แปลงยอดที่กรอก ↔ ยอดชำระ", () => {
  it("จด VAT ไม่มีหัก ณ ที่จ่าย: รวม VAT = ยอดชำระ · ก่อน VAT × 1.07", () => {
    expect(netFromExVat(exVatFromInput(30000, "incl", VAT), VAT)).toBe(30000);
    expect(netFromExVat(exVatFromInput(10000, "ex", VAT), VAT)).toBe(10700);
    expect(inputFromExVat(exVatFromInput(30000, "incl", VAT), "ex", VAT)).toBe(28037.38);
  });
  it("หัก ณ ที่จ่าย 3%: ก่อน VAT 10,000 = รวม VAT 10,700 = ลูกค้าจ่าย 10,400", () => {
    expect(netFromExVat(10000, VAT_WHT3)).toBe(10400);
    expect(netFromExVat(exVatFromInput(10700, "incl", VAT_WHT3), VAT_WHT3)).toBe(10400);
    expect(inputFromExVat(exVatFromNet(10400, VAT_WHT3), "incl", VAT_WHT3)).toBe(10700);
    expect(inputFromExVat(exVatFromNet(10400, VAT_WHT3), "ex", VAT_WHT3)).toBe(10000);
  });
  it("ไม่จด VAT: รวม/ก่อน VAT เท่ากัน · หัก ณ ที่จ่าย 3% จาก 10,000 = 9,700", () => {
    expect(netFromExVat(exVatFromInput(10000, "incl", NOVAT), NOVAT)).toBe(10000);
    expect(netFromExVat(exVatFromInput(10000, "ex", NOVAT), NOVAT)).toBe(10000);
    expect(netFromExVat(exVatFromInput(10000, "incl", NOVAT_WHT3), NOVAT_WHT3)).toBe(9700);
    expect(inputFromExVat(exVatFromNet(9700, NOVAT_WHT3), "incl", NOVAT_WHT3)).toBe(10000);
  });
  it("ติ๊กหัก ณ ที่จ่ายทีหลัง → ยอดรวม VAT ที่ตกลงไว้ไม่ขยับ (ยอดชำระคิดใหม่)", () => {
    const ex = exVatFromInput(30000, "incl", VAT); // พิมพ์ตอนยังไม่หัก
    expect(inputFromExVat(ex, "incl", VAT_WHT3)).toBe(30000);
    expect(netFromExVat(ex, VAT)).toBe(30000);
    expect(netFromExVat(ex, VAT_WHT3)).toBe(29158.88); // 30,000 − 3% ของ 28,037.38
  });
});

describe("S24 แผนที่มีงวดกรอกเป็นเงิน", () => {
  it("30,000 จาก 107,000 ได้ 30,000 เป๊ะ (ถ้าแปลงเป็น % แล้วคิดกลับจะได้ 30,000.02)", () => {
    const rows = [money(30000, "incl", VAT), pct(71.96)];
    expect(planRowAmounts(107000, rows, 107000, VAT)).toEqual([30000, 77000]);
    expect(planAmounts(107000, [28.0374, 71.9626], 107000)[0]).toBe(30000.02); // เหตุผลที่ไม่เก็บเป็น %
    expect(rowPercent(rows[0], 107000, VAT)).toBe(28.04);
    expect(percentToStore(rows[0], 107000, VAT)).toBe(28.0374);
    expect(planError(rows, 107000, 107000, false, VAT)).toBeNull();
  });
  it("กรอกเป็นเงินทุกงวดรวมเท่ายอด → ผ่าน · ขาด 1 บาท → บอกเป็นบาท", () => {
    expect(planError([money(30000, "incl", VAT), money(77000, "incl", VAT)], 107000, 107000, false, VAT)).toBeNull();
    expect(planError([money(30000, "incl", VAT), money(76999, "incl", VAT)], 107000, 107000, false, VAT))
      .toBe("ยอดชำระรวมได้ 106,999.00 บาท แต่ต้องได้ 107,000.00 บาท");
  });
  it("ปรับงวด (ยอดค้าง < ยอดสุทธิ) — บอกว่าเท่ายอดค้าง", () => {
    expect(planError([money(20000, "incl", VAT)], 107000, 50000, false, VAT))
      .toBe("ยอดชำระรวมได้ 20,000.00 บาท แต่ต้องได้ 50,000.00 บาท (เท่ายอดค้าง)");
  });
  it("ยอด 0 / ไม่ส่ง ctx = ไม่ให้บันทึก (ห้ามเดา VAT)", () => {
    expect(planError([money(0, "incl", VAT), pct(100)], 107000, 107000, false, VAT)).toBe("ทุกงวดต้องมียอดมากกว่า 0");
    expect(planError([money(30000, "incl", VAT), pct(71.96)], 107000, 107000, false)).toMatch(/ระบบไม่ทราบ VAT/);
  });
  it("งวดสุดท้ายกลายเป็น 0 → บอกให้ลดยอด", () => {
    expect(planError([money(107000, "incl", VAT), pct(0.001)], 107000, 107000, false, VAT)).toBe("งวดสุดท้ายเหลือยอดไม่ถึง 0.01 บาท — ลดยอดของงวดก่อนหน้า");
  });
  it("พิมพ์รวม VAT ให้รวมเท่ายอดรวมบนใบเสนอราคา → ไม่ติดเศษสตางค์ (ไล่ยอด × หัก ณ ที่จ่าย 0/1/3/5%)", () => {
    for (const w of [0, 1, 3, 5]) {
      const ctx: VatCtx = { isVat: true, whtPct: w };
      for (let grand = 1001; grand < 250000; grand += 7919.37) {
        const g = Math.round(grand * 100) / 100;
        const t = quotationTotals({ items: [{ name: "x", price: g, qty: 1 }], discount: 0, isWhtRequired: w > 0, whtPercent: w, isDepositRequired: false, depositPercent: 0 }, true);
        const a = Math.round(g * 0.3 * 100) / 100;
        const b = Math.round(g * 0.45 * 100) / 100;
        const c = Math.round((g - a - b) * 100) / 100;
        const rows = [money(a, "incl", ctx), money(b, "incl", ctx), money(c, "incl", ctx)];
        expect(planError(rows, t.netPayable, t.netPayable, false, ctx)).toBeNull();
        const amts = planRowAmounts(t.netPayable, rows, t.netPayable, ctx);
        expect(Math.round(amts.reduce((s, x) => s + x, 0) * 100) / 100).toBe(t.netPayable);
      }
    }
  });
  it("ผลรวมของแผน: แผน % ไม่บอกยอด · แผนมีเงิน บอก % ที่คิดกลับ", () => {
    expect(planSum([pct(50), pct(50)], 100000, 100000, VAT)).toMatchObject({ fixed: false, sumPct: 100, ok: true });
    expect(planSum([money(30000, "incl", VAT), money(77000, "incl", VAT)], 107000, 107000, VAT)).toMatchObject({ fixed: true, sumPct: 100, intended: 107000, ok: true });
  });
  it("ปุ่มปรับงวดสุดท้ายให้ครบ: มีงวดเงิน → งวดสุดท้ายเป็นเงินที่ขาดพอดี · แผน % → % ที่ขาด", () => {
    const fixed = fillLastRow([money(30000, "incl", VAT), pct(50)], 107000, 107000, VAT)!;
    expect(planRowAmounts(107000, fixed, 107000, VAT)).toEqual([30000, 77000]);
    expect(planError(fixed, 107000, 107000, false, VAT)).toBeNull();
    expect(fillLastRow([pct(30), pct(50)], 100000, 100000, VAT)!.map((r) => r.percent)).toEqual([30, 70]);
    expect(fillLastRow([pct(30), pct(50)], 100000, 100000, VAT)![1].exVat).toBeUndefined();
    // มีหัก ณ ที่จ่าย: ยอดที่ขาดคิดเป็นยอดชำระ
    const w = fillLastRow([money(30000, "incl", VAT_WHT3), pct(1)], 104000, 104000, VAT_WHT3)!;
    expect(planRowAmounts(104000, w, 104000, VAT_WHT3)).toEqual([29158.88, 74841.12]);
    // งวดก่อนหน้ากินยอดหมดแล้ว → ทำไม่ได้
    expect(fillLastRow([money(107000, "incl", VAT), pct(5)], 107000, 107000, VAT)).toBeNull();
  });
  it("พิมพ์ % 4 ตำแหน่งบนใบเสนอราคาเป็น 2 ตำแหน่ง", () => {
    expect(planTermsLines([{ seq: 1, label: "มัดจำ", percent: 28.0374, amount: 30000, shipPoint: false }])).toEqual(["งวดที่ 1 มัดจำ 28.04% = 30,000.00 บาท"]);
  });
});

describe("S24 เปิดแผนที่บันทึกไว้มาแก้", () => {
  const inst = (seq: number, amount: number, percent: number | null, o: Partial<Installment> = {}): Installment => ({
    seq, label: `งวด ${seq}`, percent, amount, dueDate: "", invNo: "", invDate: "", shipPoint: false, paid: false, ...o,
  });
  it("งวดที่กรอกเป็นเงินโหลดกลับเป็นเงิน → กดบันทึกซ้ำได้ยอดเดิมเป๊ะ", () => {
    const saved = [inst(1, 30000, 28.0374, { shipPoint: true }), inst(2, 77000, 71.9626)];
    const rows = rowsFromPlan(saved, 107000, VAT);
    expect(rows[0].exVat).toBeDefined();
    expect(rows[0].shipPoint).toBe(true);
    expect(rows[1].exVat).toBeUndefined();
    expect(rows[1].percent).toBe(71.96); // งวดสุดท้ายรับเศษ — % ปัด 2 ตำแหน่ง
    expect(planError(rows, 107000, 107000, false, VAT)).toBeNull();
    expect(planRowAmounts(107000, rows, 107000, VAT)).toEqual([30000, 77000]);
  });
  it("มีหัก ณ ที่จ่าย — ยอดชำระเดิมคืนมาเป๊ะ", () => {
    const saved = [inst(1, 29158.88, 28.0374), inst(2, 74841.12, 71.9626)];
    const rows = rowsFromPlan(saved, 104000, VAT_WHT3);
    expect(planRowAmounts(104000, rows, 104000, VAT_WHT3)).toEqual([29158.88, 74841.12]);
    expect(inputFromExVat(Number(rows[0].exVat), "incl", VAT_WHT3)).toBe(30000);
  });
  it("แผน % ล้วน (ของเดิม) โหลดกลับเป็น % ไม่มีงวดกลายเป็นเงิน", () => {
    const rows = rowsFromPlan([inst(1, 50000, 50), inst(2, 50000, 50)], 100000, VAT);
    expect(rows.every((r) => r.exVat === undefined)).toBe(true);
    expect(rows.map((r) => r.percent)).toEqual([50, 50]);
  });
  it("ส่งคลังแล้ว → ล้างจุดส่งของ (เหมือนเดิม)", () => {
    expect(rowsFromPlan([inst(1, 50000, 50, { shipPoint: true }), inst(2, 50000, 50)], 100000, VAT, true)[0].shipPoint).toBe(false);
  });
});

describe("S24 ทุกจุดส่ง VAT/หัก ณ ที่จ่ายของออเดอร์ (อ่านซอร์ส)", () => {
  it("server: ตรวจ + คิดยอด + เก็บ % ด้วย ctx เดียวกัน", () => {
    const src = readFileSync("app/(app)/sales/actions.ts", "utf8");
    expect(src).toContain("planError(rows, net, remain, isSent(order.status), ctx)");
    expect(src).toContain("planRowAmounts(net, rows, remain, ctx)");
    expect(src).toContain("percent: percentToStore(r, net, ctx)");
    expect(src).toContain("planError(input.plan, net, net, false, ctx)");
    expect(src).not.toMatch(/planAmounts\(net, rows\.map/); // เส้นทางเก่าที่ทิ้งยอดที่กรอกเป็นเงิน
  });
  it("จอ: ตัวแก้งวด + ใบเสนอราคา + ปรับงวด ส่ง ctx และโหลดแผนด้วย rowsFromPlan", () => {
    const ed = readFileSync("app/(app)/sales/_components/InstallmentEditor.tsx", "utf8");
    expect(ed).toContain("planRowAmounts(net, rows, remain, ctx)");
    expect(ed).toContain("planError(rows, net, remain, sent, ctx)");
    const qu = readFileSync("app/(app)/sales/_components/QuotationTab.tsx", "utf8");
    expect(qu).toContain("ctx={planCtx}");
    expect(qu).toContain("rowsFromPlan(plan, net,");
    expect(qu).toContain("planRowAmounts(totals.netPayable, plan, totals.netPayable, planCtx)");
    const pp = readFileSync("app/(app)/sales/_components/PlanPanel.tsx", "utf8");
    expect(pp).toContain("ctx={ctx}");
    expect(pp).toContain("rowsFromPlan(plan.filter((i) => !isLocked(i)), net, ctx, sent)");
  });
});
