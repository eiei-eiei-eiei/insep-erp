import { describe, it, expect } from "vitest";
import {
  fermentSummary,
  fermentSeriesPoints,
  distillSummary,
  potHearts,
  equivVol,
  globalCum,
} from "./history";

const ferm = [
  { measure_date: "2026-07-06", measure_time: "08:00", ph: 4.5, brix: 12, temp: 28 },
  { measure_date: "2026-07-08", measure_time: "08:00", ph: 4.0, brix: 8, temp: 32 },
  { measure_date: "2026-07-10", measure_time: "08:00", ph: 3.8, brix: 5, temp: 30 },
];

describe("fermentSummary", () => {
  const s = fermentSummary(ferm, "2026-07-06");
  it("Brix เริ่ม→จบ + attenuation + ~ABV", () => {
    expect(s.firstBrix).toBe(12);
    expect(s.lastBrix).toBe(5);
    expect(s.atten).toBeCloseTo(58.3333, 3); // (12-5)/12*100
    expect(s.estAbv).toBeCloseTo(3.85, 5); // (12-5)*0.55
  });
  it("pH / temp พีค / วันหมัก", () => {
    expect(s.firstPh).toBe(4.5);
    expect(s.lastPh).toBe(3.8);
    expect(s.tempPeak).toBe(32);
    expect(s.days).toBeCloseTo(4.3333, 3); // 4 วัน 8 ชม.
  });
  it("จุดกราฟ x=วันจากเริ่มหมัก", () => {
    const pts = fermentSeriesPoints(ferm, "2026-07-06", "brix");
    expect(pts[0].x).toBeCloseTo(0.3333, 3); // 8 ชม.
    expect(pts[0].y).toBe(12);
  });
});

describe("distill history", () => {
  const reads = [
    { pot_no: 1, phase: "เริ่มกลั่น", minute: 0, abv20: null, cum_vol: null, vapor_temp: null, ferm_charge: 100 },
    { pot_no: 1, phase: "กลาง", minute: 10, abv20: 78, cum_vol: 5, vapor_temp: 95, ferm_charge: null },
    { pot_no: 1, phase: "กลาง", minute: 20, abv20: 76, cum_vol: 10, vapor_temp: 96, ferm_charge: null },
    { pot_no: 1, phase: "จบหม้อ", minute: 20, abv20: 76, cum_vol: 10, vapor_temp: null, ferm_charge: null },
  ];
  it("potHearts ใช้ค่าจบหม้อ (วัดจริง)", () => {
    expect(potHearts(reads)).toEqual({ vol: 10, abv: 76, src: "วัด" });
  });
  it("distillSummary รวมหม้อ + charge + เวลา", () => {
    const s = distillSummary(reads);
    expect(s.totalVol).toBe(10);
    expect(s.abv).toBe(76);
    expect(s.charge).toBe(100);
    expect(s.potCount).toBe(1);
    expect(s.totalMinutes).toBe(20);
  });
  it("equivVol แปลงที่ดีกรีเป้าหมาย", () => {
    expect(equivVol(10, 76, 40)).toBe(19); // 10*76/40
  });
  it("globalCum สะสมข้ามช่วง", () => {
    const g = globalCum(reads);
    expect(g[g.length - 1].globalCum).toBeGreaterThan(0);
  });
});
