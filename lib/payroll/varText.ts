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
import type { PayComponent, PayVariable, VarOp, VarRounding, VarSource } from "./types";

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

// ── รายการเพิ่ม/หัก ──────────────────────────────────────────────────────────
/**
 * สูตรของ "รายการเพิ่ม/หัก" ในรูปที่คนอ่านรู้เรื่อง — เหตุผลเดียวกับ `variableFormulaText`:
 * ลูกค้าต้องเห็นว่าที่ตั้งไว้จะกลายเป็นการคำนวณแบบไหน **ก่อน**จะเอาไปใช้จ่ายเงินจริง
 */
export function componentFormulaText(
  c: Pick<PayComponent, "method" | "amount" | "rate" | "multiplier" | "tiers" | "variableCode" | "inputKeys" | "inputAgg">,
  opt?: { inputLabels?: Record<string, string>; variableNames?: Record<string, string> },
): string {
  const units = inputsText(c.inputKeys, c.inputAgg, opt?.inputLabels);

  switch (c.method) {
    case "fixed":
      return `${num(c.amount)} บาท/งวด`;
    case "per_unit":
      return `${num(c.amount)} × ${units || "(ยังไม่เลือกช่องกรอก)"}`;
    case "percent_base":
      return `${num(c.rate)}% ของค่าจ้างฐาน`;
    case "variable": {
      const v = c.variableCode
        ? opt?.variableNames?.[c.variableCode] ?? c.variableCode
        : "(ยังไม่เลือกตัวแปร)";
      // ★ ไม่เลือกช่องกรอกเลย = คูณ 1 — เขียนให้เห็น ไม่ใช่ให้เดา
      return `${v} × ${num(c.multiplier)}${units ? ` × ${units}` : " (ไม่คูณหน่วย)"}`;
    }
    case "tier_table":
      return `ตามขั้น: ${tierListText(c.tiers)} · จากค่า ${units || "(ยังไม่เลือกช่องกรอก)"}`;
    case "manual":
      return "กรอกยอดเองต่อคนต่องวด";
    default:
      return "—";
  }
}

/** ขั้นบันไดในบรรทัดเดียว — เรียงตามลำดับที่ **จะถูกใช้จริง** */
export function tierListText(tiers: PayComponent["tiers"]): string {
  const t = tiers ?? [];
  if (t.length === 0) return "(ยังไม่ได้ตั้งขั้น)";
  return t.map((x) => `≤${num(x.upTo)} → ${num(x.amount)}`).join(" · ") + " · เกินทุกขั้น → 0";
}

/**
 * 🚨 ขั้นบันไดต้องเรียงจากน้อยไปมาก — `tierAmount()` คืน**ขั้นแรก**ที่ค่า ≤ ขอบบน
 *    เรียงผิดแล้วได้เงินผิดขั้นโดยไม่มีอะไรฟ้อง → เรียงให้ตอนบันทึกเสมอ
 */
export function sortTiers(tiers: PayComponent["tiers"]): PayComponent["tiers"] {
  return [...(tiers ?? [])].sort((a, b) => Number(a.upTo) - Number(b.upTo));
}

export function componentWarnings(
  c: Pick<PayComponent, "method" | "multiplier" | "tiers" | "variableCode" | "inputKeys">,
): string[] {
  const out: string[] = [];
  const keys = c.inputKeys ?? [];

  if (c.method === "variable") {
    if (!c.variableCode) out.push("ยังไม่ได้เลือกตัวแปรกลางที่จะใช้เป็นฐาน");
    // 🪤 ตัวคูณ 0 = ยอดเป็น 0 ทุกงวดโดยไม่มีอะไรฟ้อง (ค่าเริ่มต้นเดิมเคยเป็น 0)
    if (!Number(c.multiplier)) out.push("ตัวคูณเป็น 0 — ยอดของรายการนี้จะเป็น 0 ทุกงวด (ไม่คูณอะไรให้ใส่ 1)");
  }
  if ((c.method === "per_unit" || c.method === "tier_table") && keys.length === 0) {
    out.push("วิธีคิดนี้ต้องอ้างช่องกรอกอย่างน้อย 1 ช่อง");
  }
  if (c.method === "tier_table") {
    const t = c.tiers ?? [];
    if (t.length === 0) out.push("ยังไม่ได้ตั้งขั้นบันไดสักขั้น — ยอดจะเป็น 0 ทุกงวด");
    const sorted = sortTiers(t) ?? [];
    if (t.some((x, i) => x.upTo !== sorted[i]?.upTo)) {
      out.push("ขั้นบันไดยังไม่ได้เรียงจากน้อยไปมาก — ระบบจะเรียงให้ตอนบันทึก");
    }
  }
  return out;
}

/** ชื่อช่องกรอกที่รายการนี้ใช้ + วิธีรวมค่าเมื่อมีหลายช่อง */
function inputsText(
  keys: string[] | undefined,
  agg: "sum" | "avg" | undefined,
  labels?: Record<string, string>,
): string {
  const k = keys ?? [];
  if (k.length === 0) return "";
  const names = k.map((x) => labels?.[x] ?? x);
  if (names.length === 1) return `(${names[0]})`;
  return `(${names.join(agg === "avg" ? " เฉลี่ยกับ " : " + ")})`;
}

function num(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "0";
}
