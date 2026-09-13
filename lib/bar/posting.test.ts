import { describe, it, expect } from "vitest";
import { unpostedDays, unpostedTotal, unpostedText, thaiDay, type ClosedSale } from "./posting";
import { businessDate } from "./businessDate";

/** golden **B12** — ตามเก็บวันที่ยังไม่ได้ลงบัญชี (D96 ภาค 2 เฟส E) */

const sale = (businessDate: string, grandTotal: number): ClosedSale => ({ businessDate, grandTotal });

describe("unpostedDays — วันที่ขายแล้วแต่ยังไม่ลงบัญชี (golden B12)", () => {
  it("รวมยอดต่อวันและเรียงจากเก่าไปใหม่ (ค้างนานสุดขึ้นก่อน)", () => {
    const out = unpostedDays(
      [sale("2026-09-12", 380), sale("2026-09-10", 100), sale("2026-09-12", 96.5)],
      [],
      "2026-09-13",
    );
    expect(out).toEqual([
      { date: "2026-09-10", bills: 1, total: 100 },
      { date: "2026-09-12", bills: 2, total: 476.5 },
    ]);
  });

  it("วันที่ลงบัญชีไปแล้วต้องหายจากลิสต์", () => {
    const out = unpostedDays([sale("2026-09-10", 100), sale("2026-09-11", 200)], ["2026-09-10"], "2026-09-13");
    expect(out.map((d) => d.date)).toEqual(["2026-09-11"]);
  });

  it("🚨 วันขายของ **ตอนนี้** ต้องไม่ถูกเตือน — ร้านยังขายอยู่ ปิดยอดตอนนี้จะขาด", () => {
    const out = unpostedDays([sale("2026-09-13", 500), sale("2026-09-12", 380)], [], "2026-09-13");
    expect(out.map((d) => d.date)).toEqual(["2026-09-12"]);
  });

  it("🚨 วันขายที่อยู่ใน**อนาคต** ก็ต้องไม่ถูกเตือน (นาฬิกาเครื่องเพี้ยน/คีย์ย้อน)", () => {
    expect(unpostedDays([sale("2026-09-20", 500)], [], "2026-09-13")).toEqual([]);
  });

  it("บิลที่ยังเปิดอยู่ (ยังไม่มีวันขาย) ไม่นับเป็นของค้าง", () => {
    expect(unpostedDays([{ businessDate: "", grandTotal: 300 }], [], "2026-09-13")).toEqual([]);
  });

  it("ไม่มีอะไรค้าง → ลิสต์ว่าง (ไม่ใช่แถวปลอม)", () => {
    expect(unpostedDays([], [], "2026-09-13")).toEqual([]);
    expect(unpostedDays([sale("2026-09-12", 380)], ["2026-09-12"], "2026-09-13")).toEqual([]);
  });

  it("ยอดรวมปัด 2 ตำแหน่ง ไม่สะสมเศษทศนิยม", () => {
    const out = unpostedDays([sale("2026-09-12", 0.1), sale("2026-09-12", 0.2)], [], "2026-09-13");
    expect(out[0].total).toBe(0.3);
    expect(unpostedTotal(out)).toBe(0.3);
  });

  it("unpostedTotal รวมข้ามวัน", () => {
    const out = unpostedDays([sale("2026-09-10", 100), sale("2026-09-11", 250.25)], [], "2026-09-13");
    expect(unpostedTotal(out)).toBe(350.25);
  });
});

describe("unpostedText — ประโยคต้องตรงกับสิ่งที่ปุ่มจะทำ (D91/0059)", () => {
  it("ไม่มีอะไรค้าง → null (ห้าม render แถบเปล่า)", () => {
    expect(unpostedText([])).toBeNull();
  });

  it("บอกจำนวนวันและชื่อวันจากชุดเดียวกับที่ปุ่มจะลง", () => {
    const days = unpostedDays([sale("2026-09-10", 100), sale("2026-09-12", 380)], [], "2026-09-13");
    expect(unpostedText(days)).toBe("ยังไม่ได้ลงบัญชี 2 วัน (10 ก.ย., 12 ก.ย.)");
  });

  it("ค้างเยอะ → ตัดรายชื่อแล้วบอกว่าเหลืออีกกี่วัน (ไม่ให้แถบยาวจนอ่านไม่ไหว)", () => {
    const days = unpostedDays(
      ["01", "02", "03", "04", "05", "06", "07"].map((d) => sale(`2026-09-${d}`, 100)),
      [],
      "2026-09-13",
    );
    expect(unpostedText(days, 3)).toBe("ยังไม่ได้ลงบัญชี 7 วัน (1 ก.ย., 2 ก.ย., 3 ก.ย. และอีก 4 วัน)");
  });
});

describe("thaiDay", () => {
  it("แปลงเป็นวัน/เดือนไทยแบบสั้น", () => {
    expect(thaiDay("2026-09-12")).toBe("12 ก.ย.");
    expect(thaiDay("2026-01-01")).toBe("1 ม.ค.");
    expect(thaiDay("2026-12-31")).toBe("31 ธ.ค.");
  });
  it("ค่าที่ไม่ใช่วันที่ → คืนตามเดิม ไม่พังทั้งแถบ", () => {
    expect(thaiDay("")).toBe("");
    expect(thaiDay("ไม่ใช่วันที่")).toBe("ไม่ใช่วันที่");
  });
});

/**
 * 🚩 ข้อที่ผูกสองสูตรเข้าด้วยกัน — "วันขายของตอนนี้" ต้องมาจาก `businessDate()`
 *    ไม่ใช่วันปฏิทิน ไม่งั้นตอนตี 1 ของรอบ 18:00–03:00 จะเตือนให้ปิดยอดคืนที่ยังขายอยู่
 */
describe("🚩 เชื่อมกับรอบขาย — ตี 1 ยังอยู่ในวันขายของเมื่อวาน", () => {
  const win = { start: "18:00", end: "03:00" };

  it("ตี 1 ของวันที่ 14 → วันขายคือ 13 ⇒ ยอดของวันที่ 13 ต้องยังไม่ถูกเตือน", () => {
    const now = new Date("2026-09-14T01:00:00+07:00");
    const today = businessDate(now, win);
    expect(today).toBe("2026-09-13");
    expect(unpostedDays([sale("2026-09-13", 500), sale("2026-09-12", 380)], [], today).map((d) => d.date))
      .toEqual(["2026-09-12"]);
  });

  it("บ่ายสองของวันที่ 14 (พ้นรอบแล้ว) → วันขายคือ 14 ⇒ ยอดของวันที่ 13 กลายเป็นของค้าง", () => {
    const now = new Date("2026-09-14T14:00:00+07:00");
    const today = businessDate(now, win);
    expect(today).toBe("2026-09-14");
    expect(unpostedDays([sale("2026-09-13", 500)], [], today).map((d) => d.date)).toEqual(["2026-09-13"]);
  });
});
