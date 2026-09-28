import { describe, it, expect } from "vitest";
import {
  isRealISODate, docDateError, shipDateError, saleDateError, docDateNote, shipDateNote, saleDateNote,
  manualNoFields, manualNoError, actionPostsRevenue,
} from "./backdate";
import { neededSerials, type OrderAction, type OrderState } from "./orders";

const TODAY = "2026-09-28";
const order = (o: Partial<OrderState> = {}): OrderState => ({
  quNo: "QU1", orderNo: "ORD1", status: "รอคอนเฟิร์ม", deposit: 0, outstandingBalance: 100,
  subTotal: 100, discount: 0, whtPercent: 0, category: "", customerName: "",
  invNo: "", taxNo1: "", taxNo2: "", ...o,
});
const ACTIONS: OrderAction[] = [
  "DEPOSIT_AND_SEND", "FULL_PAYMENT_AND_SEND", "SEND_TO_WH", "ISSUE_INVOICE_FULL",
  "ISSUE_INVOICE_DEPOSIT", "PAY_BALANCE", "FULL_PAYMENT_LATER",
];

describe("วันที่ (D100 เฟส 3)", () => {
  it("วันที่จริงเท่านั้น", () => {
    expect(isRealISODate("2026-02-28")).toBe(true);
    expect(isRealISODate("2026-02-30")).toBe(false);
    expect(isRealISODate("28/09/2026")).toBe(false);
    expect(isRealISODate("")).toBe(false);
  });

  it("วันที่เอกสาร: ไม่ส่ง = วันนี้ (ผ่าน) · ล่วงหน้าได้ (ใบแจ้งหนี้วางบิลล่วงหน้า — ของเดิม) · รูปแบบผิด = error", () => {
    expect(docDateError(undefined)).toBeNull();
    expect(docDateError("")).toBeNull();
    expect(docDateError("2026-10-05")).toBeNull();
    expect(docDateError("2026-13-01")).toMatch(/ไม่ถูกต้อง/);
  });

  it("🚨 วันที่ส่งของ (ฟอร์ม ภส.) ห้ามล่วงหน้า · วันนี้และย้อนหลังได้", () => {
    expect(shipDateError(TODAY, TODAY)).toBeNull();
    expect(shipDateError("2026-09-25", TODAY)).toBeNull();
    expect(shipDateError("2026-09-29", TODAY)).toMatch(/เลยวันนี้ไม่ได้/);
    expect(shipDateError(undefined, TODAY)).toBeNull();
    expect(saleDateError("2026-09-29", TODAY)).toMatch(/^วันที่ขายเลยวันนี้ไม่ได้/);
    expect(saleDateError("2026-09-25", TODAY)).toBeNull();
  });

  it("วันนี้ = ไม่มีคำเตือน · ย้อนหลังบอกว่าอะไรจะเป็นของวันนั้น + เรื่องยื่นแบบเพิ่มเติม", () => {
    expect(docDateNote(TODAY, TODAY)).toBeNull();
    expect(docDateNote("2026-09-25", TODAY)).toMatch(/ย้อนหลัง.*25\/09\/2569.*ยื่นเพิ่มเติม/);
    expect(docDateNote("2026-10-05", TODAY)).toMatch(/ล่วงหน้า/);
    expect(shipDateNote(TODAY, TODAY)).toBeNull();
    expect(shipDateNote("2026-09-25", TODAY)).toMatch(/ภส\..*ปิดเดือน/);
    expect(shipDateNote("2026-09-29", TODAY)).toBeNull(); // ล่วงหน้าเป็น error ไม่ใช่คำเตือน
    // ขายหน้าร้าน = ใบเดียวครบ 3 อย่าง ต้องบอกครบทั้ง 3
    expect(saleDateNote("2026-09-25", TODAY)).toMatch(/ใบเสร็จ.*ภพ\.30.*ภส\./);
    expect(saleDateNote(TODAY, TODAY)).toBeNull();
  });
});

describe("ช่องกรอกเลขเอง — ต้องตรงกับเลขที่ server จะออกจริง (neededSerials)", () => {
  it("🚨 ทุก action × ทั้งสองโลก (จด/ไม่จด VAT): ช่องที่โชว์ = เลขที่จะถูกออก", () => {
    const states: Partial<OrderState>[] = [
      {}, { invNo: "INV1" }, { taxNo1: "TAX1" }, { rcptNo1: "RC1" }, { depInvNo: "INV2" },
      { invNo: "INV1", taxNo1: "TAX1" }, { invNo: "INV1", rcptNo1: "RC1" },
    ];
    for (const a of ACTIONS) {
      for (const s of states) {
        const o = order(s);
        const f = manualNoFields(a, o);
        // กิจการจริงอยู่โลกเดียว — ถ้าออเดอร์มีเลขของโลกนั้น ช่องต้องไม่โชว์ ไม่งั้นกรอกแล้ว server ปฏิเสธ
        const isVatWorld = !!(s.taxNo1 || s.taxNo2) || !(s.rcptNo1 || s.rcptNo2);
        const need = neededSerials(a, o, isVatWorld);
        const payNeed = !!(need.tax1 || need.tax2 || need.rcpt1 || need.rcpt2);
        expect(f.inv, `${a} ${JSON.stringify(s)} inv`).toBe(need.inv);
        expect(f.pay, `${a} ${JSON.stringify(s)} pay`).toBe(payNeed);
      }
    }
  });

  it("ส่งของเครดิต = มีแต่ใบแจ้งหนี้ · จ่ายเต็มส่งของ = มีแต่ใบกำกับ/ใบเสร็จ · มัดจำ = ทั้งคู่", () => {
    expect(manualNoFields("SEND_TO_WH", order())).toEqual({ inv: true, pay: false });
    expect(manualNoFields("FULL_PAYMENT_AND_SEND", order())).toEqual({ inv: false, pay: true });
    expect(manualNoFields("DEPOSIT_AND_SEND", order())).toEqual({ inv: true, pay: true });
  });

  it("เลขที่กรอกเอง: ห้ามว่าง · ห้ามเว้นวรรค · ≤ 30 ตัว", () => {
    expect(manualNoError("TAX260925-004")).toBeNull();
    expect(manualNoError("  ")).toMatch(/ยังไม่ได้กรอก/);
    expect(manualNoError("TAX 001")).toMatch(/ห้ามเว้นวรรค/);
    expect(manualNoError("X".repeat(31))).toMatch(/30/);
  });
});

describe("ประโยคลงย้อนหลังต้องตรงกับสิ่งที่ขั้นนั้นทำจริง (เจอจากเทสเบราว์เซอร์)", () => {
  it("action ที่ลงบัญชี = 4 ตัวที่รับเงิน · ออกใบแจ้งหนี้/ส่งเครดิตไม่ลงบัญชี", () => {
    const posts = ACTIONS.filter((a) => actionPostsRevenue(a));
    expect(posts.sort()).toEqual(["DEPOSIT_AND_SEND", "FULL_PAYMENT_AND_SEND", "FULL_PAYMENT_LATER", "PAY_BALANCE"].sort());
  });

  it("🚨 ขั้นที่ไม่ลงบัญชี ห้ามบอกว่าบัญชี/ภพ.30 จะเป็นของวันนั้น", () => {
    const n = docDateNote("2026-09-25", TODAY, false)!;
    expect(n).not.toMatch(/ภพ\.30/);
    expect(n).toMatch(/ยังไม่ลงบัญชี/);
    expect(docDateNote("2026-10-05", TODAY, false)).toMatch(/ยังไม่ลงบัญชี/);
  });

  it("ขั้นที่ลงบัญชี ยังบอกครบเหมือนเดิม (ค่าปริยาย = ลงบัญชี)", () => {
    expect(docDateNote("2026-09-25", TODAY, true)).toMatch(/บัญชี และ ภพ\.30/);
    expect(docDateNote("2026-09-25", TODAY)).toBe(docDateNote("2026-09-25", TODAY, true));
  });
});
