import { describe, it, expect } from "vitest";
import {
  TAX_KINDS,
  TAX_KIND_LABEL,
  TAX_KIND_FULL,
  TAX_REPORT_KEY,
  DEFAULT_TAX_CAT,
  DEFAULT_SURCHARGE_CAT,
  dueDateOf,
  remindDateOf,
  nextMonth,
  prevMonth,
  daysBetween,
  reminderLine,
  taxTxDescription,
  surchargeTxDescription,
  taxDueBoard,
  canPay,
  canUnpay,
  type TaxBoardInput,
  type TaxPaymentRow,
} from "./taxPay";

/**
 * golden A17 — ชำระภาษี (D88)
 *
 * 🚨 กติกาที่เทสชุดนี้ล็อกไว้ ห้ามให้หลุดโดยไม่มีใครรู้:
 *   · กำหนดยื่นของแต่ละแบบ (พลาด = เตือนช้า = เบี้ยปรับของจริง)
 *   · ภงด.1/สปส. **ต้องไม่อยู่ในลิสต์** (อยู่ในโมดูลเงินเดือนแล้ว — ซ้ำ = ลงรายจ่าย 2 รอบ)
 *   · กิจการไม่จด VAT ต้องไม่มีแถว ภพ.30 แต่ **ต้องมี ภงด.3/53 ครบ**
 */

const base: TaxBoardInput = {
  period: "2026-08",
  isVat: true,
  summaryNetPayable: null,
  summaryCarry: null,
  liveVatPayable: 0,
  liveVatCarry: 0,
  livePnd3: 0,
  livePnd53: 0,
  runs: {},
  payments: [],
};
const make = (o: Partial<TaxBoardInput>): TaxBoardInput => ({ ...base, ...o });
const find = (rows: ReturnType<typeof taxDueBoard>, k: string) => rows.find((r) => r.kind === k)!;

const paid = (o: Partial<TaxPaymentRow> = {}): TaxPaymentRow => ({
  kind: "vat",
  period: "2026-08",
  amount: 1000,
  surcharge: 0,
  computed_amount: 1000,
  pay_date: "2026-09-14",
  tx_id: "TR-1",
  surcharge_tx_id: null,
  account_name: "บัญชีบริษัท",
  category: "ภาษีมูลค่าเพิ่มนำส่ง",
  contact_name: "กรมสรรพากร",
  status: "ปกติ",
  tx_status: "ปกติ",
  ...o,
});

describe("ขอบเขต — มีแค่ 3 แบบที่หน้าบัญชีเป็นเจ้าของ", () => {
  it("🚨 ไม่มี ภงด.1 / สปส. ในลิสต์ (โมดูลเงินเดือนลงบัญชีให้แล้วผ่านขาลงบัญชี D67)", () => {
    expect([...TAX_KINDS]).toEqual(["vat", "pnd3", "pnd53"]);
    const labels = TAX_KINDS.map((k) => TAX_KIND_LABEL[k]).join(" ");
    expect(labels).not.toContain("ภงด.1");
    expect(labels).not.toContain("สปส");
  });

  it("ทุก kind มีชื่อ · ชื่อเต็ม · report_key · หมวดปริยาย ครบ (ลืมเติม = build ไม่ผ่าน)", () => {
    for (const k of TAX_KINDS) {
      expect(TAX_KIND_LABEL[k]).toBeTruthy();
      expect(TAX_KIND_FULL[k]).toBeTruthy();
      expect(TAX_REPORT_KEY[k]).toBeTruthy();
      expect(DEFAULT_TAX_CAT[k]).toBeTruthy();
    }
  });

  it("ภงด.3 กับ ภงด.53 ใช้ปุ่มสร้างแบบเดียวกัน → report_key เดียวกัน", () => {
    expect(TAX_REPORT_KEY.pnd3).toBe(TAX_REPORT_KEY.pnd53);
    expect(TAX_REPORT_KEY.vat).not.toBe(TAX_REPORT_KEY.pnd3);
  });

  it("🚨 หมวดเบี้ยปรับต้องคนละหมวดกับตัวภาษี (รายจ่ายต้องห้าม ต้องบวกกลับสิ้นปี)", () => {
    for (const k of TAX_KINDS) expect(DEFAULT_SURCHARGE_CAT).not.toBe(DEFAULT_TAX_CAT[k]);
  });
});

describe("กำหนดยื่น", () => {
  it("ภพ.30 = วันที่ 15 ของเดือนถัดไป · ออนไลน์ถึงวันที่ 23", () => {
    expect(dueDateOf("vat", "2026-08")).toEqual({ paper: "2026-09-15", efiling: "2026-09-23" });
  });

  it("ภงด.3/53 = วันที่ 7 ของเดือนถัดไป · ออนไลน์ถึงวันที่ 15", () => {
    expect(dueDateOf("pnd3", "2026-08")).toEqual({ paper: "2026-09-07", efiling: "2026-09-15" });
    expect(dueDateOf("pnd53", "2026-08")).toEqual({ paper: "2026-09-07", efiling: "2026-09-15" });
  });

  it("งวดธันวาคม → ข้ามปีถูกต้อง", () => {
    expect(dueDateOf("vat", "2026-12").paper).toBe("2027-01-15");
    expect(dueDateOf("pnd3", "2026-12").paper).toBe("2027-01-07");
  });

  it("เดือนถัดไป/ก่อนหน้า ข้ามปีถูก", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(prevMonth("2027-01")).toBe("2026-12");
    expect(nextMonth("2026-01")).toBe("2026-02");
    expect(prevMonth("2026-02")).toBe("2026-01");
  });
});

describe("วันที่ต้องยิงเตือน (ล่วงหน้า 3 วันจากกำหนดยื่นกระดาษ)", () => {
  it("ภพ.30 งวด ส.ค. → เตือน 12 ก.ย.", () => {
    expect(remindDateOf("vat", "2026-08")).toBe("2026-09-12");
  });

  it("ภงด.3/53 งวด ส.ค. → เตือน 4 ก.ย.", () => {
    expect(remindDateOf("pnd3", "2026-08")).toBe("2026-09-04");
    expect(remindDateOf("pnd53", "2026-08")).toBe("2026-09-04");
  });

  it("🪤 ถอยข้ามเดือนได้ (ภงด. งวด ก.พ. → เตือน 4 มี.ค. ไม่ใช่ 4 ก.พ.)", () => {
    expect(remindDateOf("pnd3", "2026-02")).toBe("2026-03-04");
  });

  it("ถอยข้ามปีได้ — ภงด. งวด ธ.ค. เตือน 4 ม.ค. ปีถัดไป", () => {
    expect(remindDateOf("pnd3", "2026-12")).toBe("2027-01-04");
  });

  it("เตือนล่วงหน้ากี่วันก็ปรับได้ และเป็นวันก่อนกำหนดเสมอ", () => {
    expect(daysBetween(remindDateOf("vat", "2026-08", 7), dueDateOf("vat", "2026-08").paper)).toBe(7);
    expect(daysBetween(remindDateOf("vat", "2026-08"), dueDateOf("vat", "2026-08").paper)).toBe(3);
  });
});

describe("ข้อความเตือน", () => {
  const line = reminderLine("vat", "2026-08");

  it("บอกว่าต้องยื่นอะไร งวดไหน ภายในวันไหน", () => {
    expect(line).toContain("ภพ.30");
    expect(line).toContain("ส.ค. 2569");
    expect(line).toContain("15 ก.ย.");
  });

  it("★ บอกกำหนดยื่นออนไลน์ด้วย — ระบบไม่รู้ว่ากิจการนี้ยื่นแบบไหน เขียนข้างเดียวแล้วผิด", () => {
    expect(line).toContain("23 ก.ย.");
  });

  it("🚨 ห้ามมีตัวเลขยอดเงินในข้อความ (กลุ่ม LINE มีคนนอกฝ่ายบัญชี)", () => {
    const l = reminderLine("pnd53", "2026-12");
    expect(l).not.toMatch(/\d{1,3},\d{3}/);
    expect(l).toContain("7 ม.ค.");
  });

  it("คำอธิบายบนบิลบอกงวดเป็นเดือนไทย + ปี พ.ศ.", () => {
    expect(taxTxDescription("vat", "2026-08")).toBe("ภพ.30 งวด ส.ค. 2569");
    expect(surchargeTxDescription("pnd3", "2026-08")).toContain("เบี้ยปรับ");
  });
});

describe("กระดานชำระภาษี — กิจการที่จด VAT", () => {
  it("ยังไม่กดสร้าง ภพ.30 → กดจ่ายไม่ได้ และบอกว่าต้องไปกดปุ่มไหน", () => {
    const r = find(taxDueBoard(make({ liveVatPayable: 5000 })), "vat");
    expect(canPay(r)).toBe(false);
    expect(r.blocked).toContain("สร้าง ภพ.30");
  });

  it("สร้างแล้วและมียอด → กดจ่ายได้ ยอดมาจากที่แช่ไว้ ไม่ใช่ยอดสด", () => {
    const r = find(
      taxDueBoard(
        make({
          runs: { phor_por_30: "2026-09-01" },
          summaryNetPayable: 4200.5,
          liveVatPayable: 9999,
        }),
      ),
      "vat",
    );
    expect(canPay(r)).toBe(true);
    expect(r.amount).toBe(4200.5);
    expect(r.liveAmount).toBe(9999);
  });

  it("🚨 ยอดที่แช่ไว้ ≠ ยอดสด → ติดธง drifted (หน้าจอต้องโชว์ทั้งคู่ ห้ามเลือกข้างให้ · D75)", () => {
    const runs = { phor_por_30: "2026-09-01" };
    const drift = find(taxDueBoard(make({ runs, summaryNetPayable: 4200, liveVatPayable: 4500 })), "vat");
    const same = find(taxDueBoard(make({ runs, summaryNetPayable: 4200, liveVatPayable: 4200 })), "vat");
    expect(drift.drifted).toBe(true);
    expect(same.drifted).toBe(false);
  });

  it("ภาษีซื้อมากกว่าภาษีขาย → ไม่มีอะไรต้องจ่าย และบอกยอดที่ยกไปเดือนหน้า", () => {
    const r = find(
      taxDueBoard(make({ runs: { phor_por_30: "2026-09-01" }, summaryNetPayable: -1500, summaryCarry: 1500, liveVatCarry: 1500 })),
      "vat",
    );
    expect(canPay(r)).toBe(false);
    expect(r.amount).toBe(0);
    expect(r.blocked).toContain("ยกไปเดือนหน้า");
    expect(r.blocked).toContain("1,500.00");
  });

  it("🚨 ยอดยกไปต้องเป็นค่าที่ **แช่ไว้ตอนสร้างแบบ** ไม่ใช่ค่าที่คำนวณสด (D75)", () => {
    // เดือนที่ยื่นไปแล้วยกไป 658.46 · หลังจากนั้นมีบิลเพิ่ม ทำให้ค่าสดกลายเป็น 629.02
    // ค่าที่ *มีผลจริง* คือค่าที่แช่ไว้ — เดือนถัดไปอ่านค่านั้นไปเป็น "ภาษีซื้อยกมา"
    const r = find(
      taxDueBoard(make({
        runs: { phor_por_30: "2026-09-01" },
        summaryNetPayable: -658.46, summaryCarry: 658.46, liveVatCarry: 629.02,
      })),
      "vat",
    );
    expect(r.blocked).toContain("658.46");
    expect(r.blocked).not.toContain("629.02");
  });

  it("🪤 ยังไม่ได้สร้างแบบ = ยังไม่มียอดที่ยื่นไว้ → ห้ามติดธง drifted (จะกลายเป็นคำโกหก)", () => {
    const r = find(taxDueBoard(make({ liveVatPayable: 391.54 })), "vat");
    expect(r.filed).toBe(false);
    expect(r.drifted).toBe(false);
    expect(r.badge).toBe("unfiled");
    expect(r.liveAmount).toBe(391.54);
  });

  it("กดสร้างแบบแล้วแต่ยังไม่มีแถวยอดที่แช่ไว้ = ยังไม่ถือว่าสร้าง (ผู้ใช้ลบแถวยอดทิ้งได้)", () => {
    const r = find(taxDueBoard(make({ runs: { phor_por_30: "2026-09-01" }, summaryNetPayable: null })), "vat");
    expect(r.filed).toBe(false);
    expect(canPay(r)).toBe(false);
  });
});

describe("กระดานชำระภาษี — กิจการที่ไม่จด VAT (D55)", () => {
  const rows = taxDueBoard(make({ isVat: false, runs: { pnd_3_53: "2026-09-01" }, livePnd3: 300 }));

  it("ไม่มีแถว ภพ.30 เลย (ไม่ใช่โชว์แล้วเทา — ไม่มีหน้าที่ยื่นจริง ๆ)", () => {
    expect(rows.find((r) => r.kind === "vat")).toBeUndefined();
  });

  it("🚨 ภงด.3/53 ยังต้องมีครบ — หัก ณ ที่จ่ายไม่เกี่ยวกับการจด VAT", () => {
    expect(rows.map((r) => r.kind)).toEqual(["pnd3", "pnd53"]);
    expect(canPay(find(rows, "pnd3"))).toBe(true);
  });
});

describe("กระดานชำระภาษี — ภงด.3/53", () => {
  it("ไม่มีการหัก ณ ที่จ่ายเดือนนี้ → ไม่ต้องยื่นและไม่ต้องจ่าย", () => {
    const r = find(taxDueBoard(make({ runs: { pnd_3_53: "2026-09-01" } })), "pnd53");
    expect(canPay(r)).toBe(false);
    expect(r.blocked).toContain("ไม่มีการหักภาษี");
  });

  it("ภงด.3 มียอด แต่ ภงด.53 ไม่มี → จ่ายได้เฉพาะ ภงด.3 (คนละแบบ คนละใบ)", () => {
    const rows = taxDueBoard(make({ runs: { pnd_3_53: "2026-09-01" }, livePnd3: 1200, livePnd53: 0 }));
    expect(canPay(find(rows, "pnd3"))).toBe(true);
    expect(canPay(find(rows, "pnd53"))).toBe(false);
  });
});

describe("จ่ายแล้ว / ถอน / บิลถูกยกเลิกจากหน้าอื่น", () => {
  const runs = { phor_por_30: "2026-09-01" };

  it("จ่ายแล้ว → ไม่ขึ้นเหตุผลว่าขาดอะไร และกดจ่ายซ้ำไม่ได้", () => {
    const r = find(
      taxDueBoard(make({ runs, summaryNetPayable: 1000, payments: [paid()] })),
      "vat",
    );
    expect(r.payment?.tx_id).toBe("TR-1");
    expect(r.blocked).toBeNull();
    expect(canPay(r)).toBe(false);
  });

  it("แถวที่ถูกถอนแล้ว ('ยกเลิก') ไม่นับ → กดจ่ายใหม่ได้", () => {
    const r = find(
      taxDueBoard(make({ runs, summaryNetPayable: 1000, payments: [paid({ status: "ยกเลิก" })] })),
      "vat",
    );
    expect(r.payment).toBeNull();
    expect(canPay(r)).toBe(true);
  });

  it("🚨 บิลถูกยกเลิกจากหน้าค้นบิล → **ยังกดจ่ายซ้ำไม่ได้** ต้องถอนก่อน (ไม่งั้นเจอทางตัน)", () => {
    // 🪤 เจอตอนเทสเบราว์เซอร์ 2026-08-31: เคยเปิดให้กดจ่ายได้ แต่ unique index ฝั่ง DB
    //    ยังกันอยู่ (แถว tax_payments ยังเป็น "ปกติ") → เด้งแดง แถมปุ่มถอนก็หายไปด้วย
    //    = กดอะไรไม่ได้เลยทั้งแถว
    const r = find(
      taxDueBoard(make({ runs, summaryNetPayable: 1000, payments: [paid({ tx_status: "ยกเลิก" })] })),
      "vat",
    );
    expect(r.billVoided).toBe(true);
    expect(r.badge).toBe("voided");
    expect(canPay(r)).toBe(false);
    expect(r.blocked).toContain("ถอนการบันทึกจ่าย");
    // ★ ต้องมีทางออก — ปุ่มถอนต้องยังกดได้
    expect(canUnpay(r)).toBe(true);
  });

  it("ป้ายสถานะครบทุกกรณี (หน้าจอไม่ต้องคิดเงื่อนไขซ้ำเอง)", () => {
    const filedRuns = { phor_por_30: "2026-09-01" };
    expect(find(taxDueBoard(make({ liveVatPayable: 100 })), "vat").badge).toBe("unfiled");
    expect(find(taxDueBoard(make({ runs: filedRuns, summaryNetPayable: 100 })), "vat").badge).toBe("due");
    expect(find(taxDueBoard(make({ runs: filedRuns, summaryNetPayable: 0, summaryCarry: 0 })), "vat").badge).toBe("none");
    expect(find(taxDueBoard(make({ runs: filedRuns, summaryNetPayable: 100, payments: [paid()] })), "vat").badge).toBe("paid");
  });

  it("ยังไม่มีการจ่าย = ไม่มีอะไรให้ถอน", () => {
    expect(canUnpay(find(taxDueBoard(make({ liveVatPayable: 100 })), "vat"))).toBe(false);
  });

  it("แถวจ่ายของงวดอื่นไม่ปนกัน", () => {
    const r = find(
      taxDueBoard(make({ runs, summaryNetPayable: 1000, payments: [paid({ period: "2026-07" })] })),
      "vat",
    );
    expect(r.payment).toBeNull();
  });

  it("แถวจ่ายของแบบอื่นไม่ปนกัน (จ่าย ภงด.3 แล้ว ไม่ทำให้ ภงด.53 เป็นจ่ายแล้ว)", () => {
    const rows = taxDueBoard(
      make({
        runs: { pnd_3_53: "2026-09-01" },
        livePnd3: 100,
        livePnd53: 200,
        payments: [paid({ kind: "pnd3", amount: 100 })],
      }),
    );
    expect(find(rows, "pnd3").payment).not.toBeNull();
    expect(find(rows, "pnd53").payment).toBeNull();
  });
});
