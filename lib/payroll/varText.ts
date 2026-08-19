/**
 * lib/payroll/varText — ป้ายภาษาไทยของตัวแปรกลาง + การเขียนสูตรให้คนอ่าน
 *
 * 🚨 เหตุผลที่ไฟล์นี้ต้องมีอยู่ (ไม่ใช่ของประดับ):
 *    ตัวแปรคิด **เรียงซ้ายไปขวาทีละขั้น ไม่มีลำดับความสำคัญของตัวดำเนินการ**
 *    แต่คนอ่านสูตรด้วยกฎคณิตศาสตร์ (คูณ/หารก่อนบวก/ลบ) โดยอัตโนมัติ
 *    → `ฐาน − A ÷ B` คนอ่านว่า `ฐาน − (A÷B)` แต่ระบบให้ `(ฐาน − A) ÷ B`
 *    **ใส่วงเล็บให้ครบทุกขั้นเสมอ** คือสิ่งเดียวที่กันความเข้าใจผิดนี้ได้
 *    (ตั้งเกณฑ์ผิดแบบนี้ไม่มีอะไร error — ได้แค่ตัวเลขที่ผิดทุกงวด)
 */
import type { PayVariable, VarOp, VarRounding, VarSource } from "./types";

/** ป้ายของค่าที่ใช้เป็นตัวตั้ง/ตัวดำเนินการได้ — ต้องอ่านรู้เรื่องโดยไม่ต้องเปิดคู่มือ */
export const VAR_SOURCE_LABEL: Record<VarSource, string> = {
  base_wage: "ฐานเงินเดือน / ค่าแรงของพนักงาน",
  prorated_base: "ค่าจ้างฐานหลังคิดตามวันมาทำงานแล้ว",
  work_days_std: "วันทำงานมาตรฐานของงวดนั้น",
  work_days_actual: "วันมาทำงานจริงของคนนั้น",
  hours_per_day: "ชั่วโมงทำงานต่อวัน",
  input: "ค่าจากช่องที่กรอกต่อคนต่องวด",
  constant: "ค่าคงที่",
};

/** ป้ายสั้นสำหรับใช้ในสูตร (ตัวยาวทำให้อ่านวงเล็บไม่ออก) */
export const VAR_SOURCE_SHORT: Record<VarSource, string> = {
  base_wage: "ฐานเงินเดือน",
  prorated_base: "ค่าจ้างหลัง prorate",
  work_days_std: "วันมาตรฐาน",
  work_days_actual: "วันมาทำงานจริง",
  hours_per_day: "ชม./วัน",
  input: "ช่องกรอก",
  constant: "ค่าคงที่",
};

export const VAR_OP_LABEL: Record<VarOp, string> = {
  add: "บวก (+)",
  sub: "ลบ (−)",
  mul: "คูณ (×)",
  div: "หาร (÷)",
};

export const VAR_OP_SYMBOL: Record<VarOp, string> = {
  add: "+",
  sub: "−",
  mul: "×",
  div: "÷",
};

export const VAR_ROUNDING_LABEL: Record<VarRounding, string> = {
  none: "ไม่ปัด (ค่าเต็มความละเอียด)",
  int: "จำนวนเต็ม",
  dec2: "ทศนิยม 2 ตำแหน่ง",
};

/** ชื่อของ 1 ช่อง — ค่าคงที่โชว์ตัวเลข · ช่องกรอกโชว์รหัสช่อง (หรือชื่อถ้าส่ง labels มา) */
function slotText(
  kind: VarSource,
  opt: { value?: number; inputKey?: string },
  inputLabels?: Record<string, string>,
): string {
  if (kind === "constant") return String(opt.value ?? 0);
  if (kind === "input") {
    const k = opt.inputKey ?? "";
    if (!k) return "ช่องกรอก (ยังไม่เลือก)";
    return inputLabels?.[k] ?? k;
  }
  return VAR_SOURCE_SHORT[kind];
}

/**
 * สูตรของตัวแปรในรูปที่คนอ่านแล้วเห็น**ลำดับการคิดจริง**
 *
 * ตัวอย่าง: `((ฐานเงินเดือน + ค่าตำแหน่ง) ÷ วันมาตรฐาน) ÷ ชม./วัน`
 * ★ ขั้นเดียวไม่ต้องมีวงเล็บ (อ่านง่ายกว่า และไม่มีทางอ่านผิด)
 */
export function variableFormulaText(
  v: Pick<PayVariable, "source" | "constValue" | "inputKey" | "steps" | "rounding">,
  inputLabels?: Record<string, string>,
): string {
  let out = slotText(v.source, { value: v.constValue, inputKey: v.inputKey }, inputLabels);
  const steps = v.steps ?? [];

  steps.forEach((s, i) => {
    const rhs = slotText(s.kind, { value: s.value, inputKey: s.inputKey }, inputLabels);
    const sym = VAR_OP_SYMBOL[s.op ?? "div"];
    // ขั้นที่ 2 เป็นต้นไปต้องครอบวงเล็บของเดิม ไม่งั้นอ่านเป็นกฎคณิตศาสตร์แล้วผิด
    out = i === 0 ? `${out} ${sym} ${rhs}` : `(${out}) ${sym} ${rhs}`;
  });

  if (steps.length > 1) out = `(${out})`;
  if (v.rounding === "int") out += " → ปัดเป็นจำนวนเต็ม";
  if (v.rounding === "dec2") out += " → ทศนิยม 2 ตำแหน่ง";
  return out;
}

/**
 * ✅ / ⚠️ คำเตือนที่ควรขึ้นข้างสูตร
 * ★ เตือนอย่างเดียว **ไม่บล็อก** — บางเจ้าอาจตั้งใจ (แพตเทิร์นเดียวกับ `legCoverage` ใน D67)
 */
export function variableWarnings(
  v: Pick<PayVariable, "source" | "constValue" | "inputKey" | "steps">,
): string[] {
  const out: string[] = [];
  const steps = v.steps ?? [];

  if (v.source === "input" && !v.inputKey) out.push("ตัวตั้งเลือกช่องกรอกไว้แต่ยังไม่ได้ระบุว่าช่องไหน");
  steps.forEach((s, i) => {
    if (s.kind === "input" && !s.inputKey) out.push(`ขั้นที่ ${i + 1} เลือกช่องกรอกไว้แต่ยังไม่ได้ระบุว่าช่องไหน`);
    if ((s.op ?? "div") === "div" && s.kind === "constant" && !s.value) {
      out.push(`ขั้นที่ ${i + 1} หารด้วยค่าคงที่ 0 — ขั้นนี้จะถูกข้ามทุกครั้ง`);
    }
  });

  // 🪤 คนอ่านสูตรด้วยกฎคณิตศาสตร์แล้วจะเข้าใจผิดเฉพาะตอนมีทั้ง +/− และ ×/÷ ปนกัน
  const kinds = new Set(steps.map((s) => (["add", "sub"].includes(s.op ?? "div") ? "addsub" : "muldiv")));
  if (kinds.size > 1) {
    out.push(
      "สูตรนี้มีทั้งบวก/ลบ และคูณ/หาร ปนกัน — ระบบคิด**เรียงจากซ้ายไปขวาทีละขั้น** " +
        "ไม่ได้คิดคูณ/หารก่อน · ดูวงเล็บในบรรทัดสูตรให้ตรงกับที่ตั้งใจ",
    );
  }
  return out;
}
