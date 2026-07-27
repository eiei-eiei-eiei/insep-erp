import { describe, it, expect } from "vitest";
import { whtDocPrefix, nextWhtDocNo, formatDateThai, buildWht50PrintData } from "./wht";

describe("A9 — เลข 50ทวิ running ต่อปี พ.ศ.", () => {
  it("prefix ปี พ.ศ. 2 หลัก", () => {
    expect(whtDocPrefix(2026)).toBe("69");
  });
  it("ใบแรกของปี", () => {
    expect(nextWhtDocNo([], 2026)).toBe("6901");
  });
  it("max + 1 (ข้ามเลขปีอื่น)", () => {
    expect(nextWhtDocNo(["6901", "6905", "7001"], 2026)).toBe("6906");
  });
  it("ทะลุ 99 → 3 หลัก", () => {
    expect(nextWhtDocNo(["6999"], 2026)).toBe("69100");
  });
});

describe("A9 — วันที่ไทย", () => {
  it("d ม.ค. 69 (ไม่ pad วัน)", () => {
    expect(formatDateThai("2026-07-08")).toBe("8 ก.ค. 69");
    expect(formatDateThai("2026-01-01")).toBe("1 ม.ค. 69");
    expect(formatDateThai(null)).toBe("-");
  });
});

describe("A9 — printData 50ทวิ", () => {
  it("วันจ่าย = payment_date, วันออกหนังสือ = transaction_date", () => {
    expect(buildWht50PrintData({ docNo: "6901", whtAmount: 60, transactionDate: "2026-07-08", paymentDate: "2026-07-20" })).toEqual({
      docNo: "6901",
      whtAmount: 60,
      paymentDate: "2026-07-20",
      issueDateISO: "2026-07-08",
      dateText: "20 ก.ค. 69",
      bahtText: "หกสิบบาทถ้วน",
    });
  });
  it("ไม่มี payment_date → ใช้ transaction_date", () => {
    const r = buildWht50PrintData({ docNo: "6902", whtAmount: 10, transactionDate: "2026-07-08" });
    expect(r.paymentDate).toBe("2026-07-08");
    expect(r.dateText).toBe("8 ก.ค. 69");
  });
});
