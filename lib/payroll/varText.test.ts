import { describe, it, expect } from "vitest";
import { variableFormulaText, variableWarnings } from "./varText";
import { resolveVariable, applyVarRounding } from "./calc";
import type { PayVariable } from "./types";
import type { VarContext as Ctx } from "./calc";

const CTX: Ctx = {
  baseWage: 18000,
  proratedBase: 16800,
  workDaysStd: 30,
  workDaysActual: 28,
  hoursPerDay: 9,
  values: { ot_h: 10, allow: 2000, zero: 0 },
};

const V = (p: Partial<PayVariable>): PayVariable =>
  ({ code: "v", name: "v", source: "base_wage", ...p }) as PayVariable;

describe("ตัวดำเนินการ 4 ตัว (D70)", () => {
  it("บวก / ลบ / คูณ / หาร ทำงานตามที่เลือก", () => {
    expect(resolveVariable(V({ steps: [{ op: "add", kind: "constant", value: 2000 }] }), CTX)).toBe(20000);
    expect(resolveVariable(V({ steps: [{ op: "sub", kind: "constant", value: 3000 }] }), CTX)).toBe(15000);
    expect(resolveVariable(V({ steps: [{ op: "mul", kind: "constant", value: 2 }] }), CTX)).toBe(36000);
    expect(resolveVariable(V({ steps: [{ op: "div", kind: "constant", value: 3 }] }), CTX)).toBe(6000);
  });

  it("🚨 คิดเรียงซ้ายไปขวา ไม่มีลำดับความสำคัญ — (ฐาน − A) ÷ B ไม่ใช่ ฐาน − (A ÷ B)", () => {
    const got = resolveVariable(
      V({ steps: [{ op: "sub", kind: "constant", value: 3000 }, { op: "div", kind: "constant", value: 3 }] }),
      CTX,
    );
    expect(got).toBe(5000); // (18000-3000)/3 · ถ้าเป็นกฎคณิตศาสตร์จะได้ 17000
  });

  it("หลายขั้นเรียงกันได้ตามลำดับ", () => {
    // ((18000 + 2000) ÷ 30) ÷ 9
    const got = resolveVariable(
      V({
        steps: [
          { op: "add", kind: "input", inputKey: "allow" },
          { op: "div", kind: "work_days_std" },
          { op: "div", kind: "hours_per_day" },
        ],
      }),
      CTX,
    );
    expect(got).toBeCloseTo(20000 / 30 / 9, 10);
  });
});

describe("🪤 หารด้วย 0 ข้าม · คูณด้วย 0 ไม่ข้าม", () => {
  it("หารด้วยช่องที่ยังไม่กรอก = ข้ามขั้นนั้น (ไม่ใช่ Infinity/NaN)", () => {
    const got = resolveVariable(V({ steps: [{ op: "div", kind: "input", inputKey: "zero" }] }), CTX);
    expect(got).toBe(18000);
  });

  it("คูณด้วย 0 ต้องได้ 0 — ข้ามแล้วยอดจะพองขึ้นเงียบ ๆ ซึ่งอันตรายกว่า", () => {
    const got = resolveVariable(V({ steps: [{ op: "mul", kind: "input", inputKey: "zero" }] }), CTX);
    expect(got).toBe(0);
  });

  it("ลบ/บวกด้วย 0 ไม่ต้องมีกรณีพิเศษ", () => {
    expect(resolveVariable(V({ steps: [{ op: "sub", kind: "input", inputKey: "zero" }] }), CTX)).toBe(18000);
    expect(resolveVariable(V({ steps: [{ op: "add", kind: "input", inputKey: "zero" }] }), CTX)).toBe(18000);
  });
});

describe("🚨 ความเข้ากันได้กับข้อมูลที่ตั้งไว้ก่อน D70", () => {
  it("ขั้นที่ไม่ระบุ op ต้องเป็นการหาร (ค่าปริยายนี้ห้ามเปลี่ยน)", () => {
    const old = V({ steps: [{ kind: "work_days_std" }, { kind: "hours_per_day" }] });
    expect(resolveVariable(old, CTX)).toBeCloseTo(18000 / 30 / 9, 10);
  });

  it("ไม่ระบุ rounding = ไม่ปัด (ค่าเต็มความละเอียดเหมือนเดิม)", () => {
    const v = V({ steps: [{ kind: "work_days_std" }, { kind: "hours_per_day" }] });
    expect(resolveVariable(v, CTX)).not.toBe(Math.round(resolveVariable(v, CTX)));
  });
});

describe("การปัดค่า", () => {
  it("จำนวนเต็ม", () => {
    const v = V({ steps: [{ kind: "work_days_std" }, { kind: "hours_per_day" }], rounding: "int" });
    expect(resolveVariable(v, CTX)).toBe(67); // 66.666… → 67
  });

  it("ทศนิยม 2 ตำแหน่ง", () => {
    const v = V({ steps: [{ kind: "work_days_std" }, { kind: "hours_per_day" }], rounding: "dec2" });
    expect(resolveVariable(v, CTX)).toBe(66.67);
  });

  it("applyVarRounding รับค่าที่ไม่ใช่ตัวเลขได้ (ไม่ปล่อย NaN ลง DB)", () => {
    expect(applyVarRounding(Number.NaN, "int")).toBe(0);
    expect(applyVarRounding(Number.POSITIVE_INFINITY, "none")).toBe(0);
  });
});

describe("สูตรที่คนอ่าน — ต้องมีวงเล็บตามลำดับที่คิดจริง", () => {
  it("ขั้นเดียวไม่ต้องมีวงเล็บ", () => {
    expect(variableFormulaText(V({ steps: [{ op: "div", kind: "hours_per_day" }] }))).toBe(
      "ฐานเงินเดือน ÷ ชม./วัน",
    );
  });

  it("🚨 หลายขั้นต้องครอบวงเล็บ ไม่งั้นอ่านเป็นกฎคณิตศาสตร์แล้วเข้าใจผิด", () => {
    const txt = variableFormulaText(
      V({ steps: [{ op: "sub", kind: "constant", value: 3000 }, { op: "div", kind: "constant", value: 3 }] }),
    );
    expect(txt).toBe("((ฐานเงินเดือน − 3000) ÷ 3)");
  });

  it("ช่องกรอกแสดงชื่อไทยถ้าส่ง labels มา", () => {
    const txt = variableFormulaText(
      V({ steps: [{ op: "mul", kind: "input", inputKey: "ot_h" }] }),
      { ot_h: "ชั่วโมง OT" },
    );
    expect(txt).toBe("ฐานเงินเดือน × ชั่วโมง OT");
  });

  it("บอกการปัดค่าต่อท้าย", () => {
    expect(variableFormulaText(V({ rounding: "int" }))).toContain("ปัดเป็นจำนวนเต็ม");
    expect(variableFormulaText(V({ rounding: "dec2" }))).toContain("ทศนิยม 2 ตำแหน่ง");
  });
});

describe("คำเตือน (เตือนไม่บล็อก)", () => {
  it("🚨 ปน +/− กับ ×/÷ ต้องเตือนเรื่องลำดับการคิด", () => {
    const w = variableWarnings(
      V({ steps: [{ op: "sub", kind: "constant", value: 1 }, { op: "div", kind: "constant", value: 2 }] }),
    );
    expect(w.some((x) => x.includes("ซ้ายไปขวา"))).toBe(true);
  });

  it("ใช้แต่ ÷ อย่างเดียวไม่ต้องเตือน", () => {
    const w = variableWarnings(V({ steps: [{ kind: "work_days_std" }, { kind: "hours_per_day" }] }));
    expect(w).toHaveLength(0);
  });

  it("หารด้วยค่าคงที่ 0 = ขั้นนั้นถูกข้ามทุกครั้ง ต้องบอก", () => {
    const w = variableWarnings(V({ steps: [{ op: "div", kind: "constant", value: 0 }] }));
    expect(w.some((x) => x.includes("ถูกข้าม"))).toBe(true);
  });

  it("เลือกช่องกรอกแต่ยังไม่ระบุช่อง ต้องบอก", () => {
    expect(variableWarnings(V({ source: "input" })).length).toBe(1);
    expect(variableWarnings(V({ steps: [{ op: "mul", kind: "input" }] })).length).toBe(1);
  });
});
