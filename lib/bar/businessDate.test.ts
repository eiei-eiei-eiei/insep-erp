import { describe, it, expect } from "vitest";
import {
  businessDate,
  isInSaleWindow,
  hasSaleWindow,
  minutesOfClock,
  shiftDateISO,
} from "./businessDate";
import type { SaleWindow } from "./types";

/**
 * golden **B6** — วันขายของบิล (D96)
 *
 * 🚩 คุณสมบัติที่ชุดนี้ล็อกไว้เหนืออย่างอื่น: **ฟังก์ชันต้อง total**
 *    ทุกเวลาต้องแมปไปวันใดวันหนึ่งเสมอ · ไม่มีบิลที่ไม่มีวัน · ไม่มี error
 */

/** เวลาไทยตามที่อ่านบนนาฬิกา → Date (UTC+7 คงที่ ไม่มี DST) */
const bkk = (iso: string) => new Date(iso + "+07:00");

const NIGHT: SaleWindow = { start: "18:00", end: "03:00" };
const DAY: SaleWindow = { start: "10:00", end: "22:00" };
const UNSET: SaleWindow = { start: "00:00", end: "00:00" };

describe("อ่านเวลาจากค่าตั้งค่า", () => {
  it("'18:00' → 1080 นาที", () => {
    expect(minutesOfClock("18:00")).toBe(1080);
    expect(minutesOfClock("00:00")).toBe(0);
    expect(minutesOfClock("23:59")).toBe(1439);
  });

  it("รูปแบบผิด = null (ไม่เดา)", () => {
    for (const bad of ["25:00", "18:60", "18", "หกโมง", "", null, undefined]) {
      expect(minutesOfClock(bad as string), String(bad)).toBeNull();
    }
  });

  it("start เท่ากับ end หรือกรอกผิด = ไม่ได้ตั้งรอบ", () => {
    expect(hasSaleWindow(UNSET)).toBe(false);
    expect(hasSaleWindow(null)).toBe(false);
    expect(hasSaleWindow({ start: "18:00", end: "ผิด" })).toBe(false);
    expect(hasSaleWindow(NIGHT)).toBe(true);
  });
});

describe("ไม่ได้ตั้งรอบ = พฤติกรรมเดิมเป๊ะ (วันตามปฏิทินไทย)", () => {
  it("ไม่ส่งรอบมาเลย", () => {
    expect(businessDate(bkk("2026-09-11T01:10:00"))).toBe("2026-09-11");
    expect(businessDate(bkk("2026-09-10T23:50:00"))).toBe("2026-09-10");
  });

  it("ตั้ง 00:00–00:00 ให้ผลเหมือนไม่ตั้ง", () => {
    expect(businessDate(bkk("2026-09-11T01:10:00"), UNSET)).toBe("2026-09-11");
  });

  it("🚨 ใช้เวลาไทยไม่ใช่ UTC — 06:00 ไทยของวันที่ 11 ต้องไม่กลายเป็นวันที่ 10", () => {
    // 2026-09-11T06:00+07:00 = 2026-09-10T23:00Z — ถ้าอ่าน UTC จะได้วันที่ 10
    expect(businessDate(bkk("2026-09-11T06:00:00"))).toBe("2026-09-11");
  });
});

describe("รอบข้ามเที่ยงคืน 18:00–03:00", () => {
  it("หัวคืนวันศุกร์ → ศุกร์", () => {
    expect(businessDate(bkk("2026-09-11T23:50:00"), NIGHT)).toBe("2026-09-11");
  });

  it("🎯 ตีหนึ่งวันเสาร์ → **ศุกร์** (รอบเดียวกับหัวคืน)", () => {
    expect(businessDate(bkk("2026-09-12T01:10:00"), NIGHT)).toBe("2026-09-11");
  });

  it("ขอบรอบพอดี: 18:00 = เข้ารอบแล้ว · 03:00 = พ้นรอบแล้ว", () => {
    expect(businessDate(bkk("2026-09-11T18:00:00"), NIGHT)).toBe("2026-09-11");
    expect(businessDate(bkk("2026-09-12T02:59:00"), NIGHT)).toBe("2026-09-11");
    expect(businessDate(bkk("2026-09-12T03:00:00"), NIGHT)).toBe("2026-09-12");
  });

  it("🚩 นอกรอบ (บูธกลางวัน) → วันตามปฏิทิน **ไม่ใช่ error ไม่ใช่หายไป**", () => {
    expect(businessDate(bkk("2026-09-12T14:00:00"), NIGHT)).toBe("2026-09-12");
  });

  it("ข้ามเดือน/ข้ามปีถูกต้อง", () => {
    expect(businessDate(bkk("2026-10-01T01:00:00"), NIGHT)).toBe("2026-09-30");
    expect(businessDate(bkk("2027-01-01T02:00:00"), NIGHT)).toBe("2026-12-31");
  });
});

describe("รอบในวันเดียว 10:00–22:00 — ไม่มีอะไรต้องเลื่อน", () => {
  it("ในรอบ = วันตามปฏิทิน", () => {
    expect(businessDate(bkk("2026-09-11T14:00:00"), DAY)).toBe("2026-09-11");
  });

  it("🚨 นอกรอบก็ยังเป็นวันตามปฏิทิน — ห้ามเลื่อนวันเด็ดขาด", () => {
    expect(businessDate(bkk("2026-09-11T23:00:00"), DAY)).toBe("2026-09-11");
    expect(businessDate(bkk("2026-09-11T02:00:00"), DAY)).toBe("2026-09-11");
  });
});

describe("total — ทุกเวลาต้องมีวันเสมอ", () => {
  it("สุ่มทั้งวันทุก 7 นาที ต้องได้วันที่รูปแบบถูกต้องเสมอ ไม่มี null/NaN", () => {
    for (let m = 0; m < 24 * 60; m += 7) {
      const h = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      for (const win of [NIGHT, DAY, UNSET, null]) {
        const got = businessDate(bkk(`2026-09-11T${h}:${mm}:00`), win);
        expect(got, `${h}:${mm}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe("อยู่ในรอบขายไหม — ใช้ขึ้นป้าย 'นอกเวลาทำการ' (เตือน ไม่บล็อก)", () => {
  it("รอบข้ามเที่ยงคืน", () => {
    expect(isInSaleWindow(bkk("2026-09-11T20:00:00"), NIGHT)).toBe(true);
    expect(isInSaleWindow(bkk("2026-09-12T01:00:00"), NIGHT)).toBe(true);
    expect(isInSaleWindow(bkk("2026-09-12T14:00:00"), NIGHT)).toBe(false);
  });

  it("ไม่ได้ตั้งรอบ = ถือว่าอยู่ในเวลาทำการเสมอ (ไม่เตือนพร่ำเพรื่อ)", () => {
    expect(isInSaleWindow(bkk("2026-09-12T04:00:00"), UNSET)).toBe(true);
    expect(isInSaleWindow(bkk("2026-09-12T04:00:00"), null)).toBe(true);
  });
});

describe("เลื่อนวันที่", () => {
  it("ข้ามเดือนและปีอธิกสุรทิน", () => {
    expect(shiftDateISO("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDateISO("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftDateISO("2026-12-31", 1)).toBe("2027-01-01");
  });
});
