/**
 * gen-abv — สกัด ABV_CORR_TABLE + correctAbvTo20C จากไฟล์ระบบเดิมโดยตรง (ไม่พิมพ์มือ)
 * แล้วสร้าง:
 *   1. lib/abv/table.ts                  — ตาราง verbatim (P1: ห้ามพิมพ์ใหม่/reformat)
 *   2. lib/abv/__golden__/abv-vectors.json — ผลลัพธ์จากฟังก์ชัน "เดิม" บน grid ~16k จุด
 * รัน: node scripts/gen-abv.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const LEGACY = "docs/legacy/production/_js_distill.html";
const html = readFileSync(LEGACY, "utf8");

// ── สกัด literal ของตาราง (ตั้งแต่ '[' หลัง const ... ถึง '];' ตัวปิด) ──────────────
const declStart = html.indexOf("const ABV_CORR_TABLE = [");
if (declStart < 0) throw new Error("ไม่พบ const ABV_CORR_TABLE ใน legacy");
const arrStart = html.indexOf("[", declStart);
const arrEnd = html.indexOf("];", declStart); // rows ลงท้าย '],' — '];' คือตัวปิด array เท่านั้น
let literal = html.slice(arrStart, arrEnd + 1); // รวม ']' ตัวปิด

// แถว header ขึ้นต้น '[,0,...' (มี hole นำหน้า) → แทนด้วย '[null,' (index [0][0] ไม่ถูกใช้เลย)
// เป็นการเปลี่ยนจุดเดียวเพื่อให้ผ่าน TS/eslint no-sparse-arrays — ค่าอื่น byte-identical
literal = literal.replace("[,", "[null,");

// ── สกัดโค้ด (ตาราง + ฟังก์ชัน) เพื่อ eval ฟังก์ชัน "เดิม" มาสร้าง golden ─────────────
const codeEnd = html.indexOf("function updateDtBatchDropdown");
const originalCode = html.slice(declStart, codeEnd);
const correctAbvTo20C = new Function(
  originalCode + "\n return correctAbvTo20C;",
)();

// ── grid: abv 0..100 step 0.5 (201) × temp 0..40 step 0.5 (81) = 16281 จุด ───────────
const ABV_STEPS = 201;
const TEMP_STEPS = 81;
const STEP = 0.5;
const values = [];
for (let ti = 0; ti < TEMP_STEPS; ti++) {
  const temp = ti * STEP;
  for (let ai = 0; ai < ABV_STEPS; ai++) {
    const abv = ai * STEP;
    values.push(correctAbvTo20C(abv, temp)); // number | null
  }
}

// ── เขียนไฟล์ ───────────────────────────────────────────────────────────────────
mkdirSync("lib/abv/__golden__", { recursive: true });

const tableTs = `// ⚠️ AUTO-GENERATED — สกัด verbatim จาก ${LEGACY} (กติกาเหล็ก P1)
// ห้ามแก้มือ ห้าม reformat · สร้างใหม่: node scripts/gen-abv.mjs
// ตาราง calal: แถว 0 = header แอลกอฮอล์ 0-100 (101 ค่า) · แถว 1-41 = อุณหภูมิ 0-40°C
// ค่า "" = จุดว่างในตาราง (parseFloat → NaN → correctAbvTo20C คืน null)
export const ABV_CORR_TABLE: (number | string | null)[][] = ${literal};
`;
writeFileSync("lib/abv/table.ts", tableTs, "utf8");

writeFileSync(
  "lib/abv/__golden__/abv-vectors.json",
  JSON.stringify({ abvSteps: ABV_STEPS, tempSteps: TEMP_STEPS, step: STEP, values }),
  "utf8",
);

const nonNull = values.filter((v) => v !== null).length;
console.log(`✓ lib/abv/table.ts`);
console.log(`✓ lib/abv/__golden__/abv-vectors.json — ${values.length} จุด (มีค่า ${nonNull}, null ${values.length - nonNull})`);
