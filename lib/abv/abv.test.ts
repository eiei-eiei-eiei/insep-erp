import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { correctAbvTo20C } from "./index";

/**
 * P1 golden test — เทียบฟังก์ชันที่ port กับผลลัพธ์จากฟังก์ชัน "เดิม" (สกัดจาก legacy)
 * golden สร้างโดย scripts/gen-abv.mjs · ต้องตรง 100% รวมกรณี null
 */
const golden = JSON.parse(
  readFileSync(new URL("./__golden__/abv-vectors.json", import.meta.url), "utf8"),
) as { abvSteps: number; tempSteps: number; step: number; values: (number | null)[] };

describe("correctAbvTo20C — golden vectors (~16k จุด)", () => {
  it("ตรงกับระบบเดิมทุกจุด รวม null", () => {
    let idx = 0;
    let mismatches = 0;
    const samples: string[] = [];
    for (let ti = 0; ti < golden.tempSteps; ti++) {
      const temp = ti * golden.step;
      for (let ai = 0; ai < golden.abvSteps; ai++) {
        const abv = ai * golden.step;
        const got = correctAbvTo20C(abv, temp);
        const want = golden.values[idx++];
        if (got !== want) {
          mismatches++;
          if (samples.length < 10)
            samples.push(`abv=${abv} temp=${temp}: got ${got} want ${want}`);
        }
      }
    }
    expect(mismatches, samples.join(" | ")).toBe(0);
  });

  it("จำนวนจุดตรงกับ grid", () => {
    expect(golden.values.length).toBe(golden.abvSteps * golden.tempSteps);
  });
});

describe("correctAbvTo20C — กรณีเฉพาะ", () => {
  it("temp=20°C = ค่าอ่านตรง ๆ (แถว identity ในตาราง)", () => {
    expect(correctAbvTo20C(40, 20)).toBe(40);
    expect(correctAbvTo20C(75, 20)).toBe(75);
    expect(correctAbvTo20C(99, 20)).toBe(99);
  });

  it("abv=0 temp=20 → null (partner interpolation แถว temp=21 ช่อง abv=0 ว่าง — พฤติกรรมเดิม)", () => {
    expect(correctAbvTo20C(0, 20)).toBeNull();
  });

  it("นอกช่วง → null", () => {
    expect(correctAbvTo20C(-1, 20)).toBeNull();
    expect(correctAbvTo20C(101, 20)).toBeNull();
    expect(correctAbvTo20C(50, -1)).toBeNull();
    expect(correctAbvTo20C(50, 41)).toBeNull();
  });

  it("input ไม่ใช่ตัวเลข → null", () => {
    expect(correctAbvTo20C("", 20)).toBeNull();
    expect(correctAbvTo20C("abc", 20)).toBeNull();
    expect(correctAbvTo20C(50, "")).toBeNull();
  });

  it("มุมตารางที่เป็นค่าว่าง (ดีกรีต่ำ+อุณหภูมิสูง) → null", () => {
    // temp=40, abv=0-2 เป็น "" ในตาราง (แถวสุดท้าย ช่องแรก ๆ ว่าง)
    expect(correctAbvTo20C(0, 40)).toBeNull();
    expect(correctAbvTo20C(1, 40)).toBeNull();
  });

  it("รับ string ได้ (เหมือน DOM value เดิม)", () => {
    expect(correctAbvTo20C("40", "20")).toBe(40);
  });
});
