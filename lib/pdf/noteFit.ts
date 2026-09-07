/**
 * lib/pdf/noteFit — จัดข้อความให้อยู่ในช่อง "หมายเหตุ" ของฟอร์ม ภส. (D94)
 *
 * 🔴 ทำไมต้องมี: ช่องหมายเหตุของฟอร์ม ภส.๐๗-๐๒/๑(๑) สุรากลั่น กว้างจริง **60.4 pt**
 *    (x 758.7 → เส้นแบ่งคอลัมน์ที่ 819.1 — วัดจากไฟล์ template ไม่ใช่ถึงขอบกระดาษ 841.8)
 *    แต่ `fillProductionForm` วาดตรง ๆ ไม่เคยคุมความกว้างเลย ⇒ ข้อความทะลุเส้นออกไป
 *    · ข้อความอัตโนมัติเดิม "ปรุงปรับดีกรี 40 ได้ปริมาณ 292.50 ลิตร" = 69.0 pt **ล้นอยู่แล้ว 8.6 pt**
 *
 * 🚨 กติกาที่ผู้ใช้สั่ง: **ห้ามตัดประโยค** — ต่างจากฟอร์มสุราแช่ (D78) ที่ย่อฟอนต์แล้วตัดท้ายด้วย …
 *    ที่นี่จึง **ขึ้นบรรทัดที่ 2** แทน แล้วค่อยย่อฟอนต์ถ้ายังไม่พอ
 *    ถ้าย่อจนสุดแล้วยังไม่พอ → คืน `overflow: true` พร้อมบรรทัดครบถ้วน (ยอมล้นดีกว่าตัดคำหาย)
 *
 * ★ ไฟล์นี้ไม่ import pdf-lib — รับฟังก์ชันวัดความกว้างเข้ามา จึงเทสได้โดยไม่ต้องโหลดฟอนต์จริง
 */

/** วัดความกว้างข้อความ (pt) — ฝั่งเรียกส่ง `f.widthOfTextAtSize` ของ pdf-lib เข้ามา */
export type Measure = (text: string, size: number) => number;

export type NoteFitOptions = {
  /** ความกว้างช่อง (pt) */
  maxW: number;
  /** ขนาดฟอนต์เริ่มต้น */
  size: number;
  /** ย่อได้ต่ำสุดแค่ไหน (เล็กกว่านี้อ่านไม่ออกบนกระดาษจริง) */
  minSize?: number;
  /** จำนวนบรรทัดที่ยอมให้ในช่องหนึ่งแถว */
  maxLines?: number;
  /** ระยะจาก baseline ถึง **เส้นตารางบน** (pt) — ไม่ส่ง = ไม่คุมแนวตั้ง */
  above?: number;
  /** ระยะจาก baseline ถึง **เส้นตารางล่าง** (pt) */
  below?: number;
};

/**
 * 🔴 สัดส่วนหมึกของ THSarabun เทียบขนาดฟอนต์ — วัดจากของจริงแบบระวังไว้ก่อน
 *    ASC เผื่อสระบน/วรรณยุกต์ (ไ ้ ็ ์) · DESC เผื่อหางล่าง (ญ ฎ ฏ ฤ)
 *
 * 🪤 บทเรียนจากรอบแรก: baseline ของฟอร์มนี้อยู่ **สูงจากเส้นล่างแค่ 2.59 pt** (ต่ำจากเส้นบน 9.89)
 *    การจัด 2 บรรทัดให้ "กึ่งกลางรอบ baseline" จึงดันบรรทัดล่างทะลุเส้นตารางลงไปทุกครั้ง
 *    ⇒ ต้องคิดจาก **กรอบช่อง** ไม่ใช่จาก baseline
 */
const ASC = 0.95;
const DESC = 0.3;
const LEADING = 1.12;
const MARGIN = 0.3;

/** ความสูงหมึกรวมของ n บรรทัดที่ขนาด size */
function inkHeight(lineCount: number, size: number): number {
  return size * (ASC + DESC) + Math.max(0, lineCount - 1) * size * LEADING;
}

/** n บรรทัดที่ขนาดนี้ อยู่ในกรอบแถวได้ไหม (1 บรรทัด = baseline เดิมของฟอร์ม ผ่านเสมอ) */
export function fitsVertically(lineCount: number, size: number, above?: number, below?: number): boolean {
  if (lineCount <= 1) return true;
  if (above == null || below == null) return true;
  return inkHeight(lineCount, size) + 2 * MARGIN <= above + below;
}

export type NoteFit = {
  lines: string[];
  size: number;
  /** true = ย่อจนสุดแล้วยังไม่พอ (ล้นเส้น/ล้นแถว) — ผู้เรียกควรเตือนผู้ใช้ ไม่ใช่เงียบ */
  overflow: boolean;
};

/** ตัดคำแบบละโมบตามช่องว่าง · คำเดี่ยวที่ยาวเกินช่องถูกหั่นทีละตัวอักษร */
function wrap(text: string, measure: Measure, size: number, maxW: number): string[] {
  const words = text.split(" ").filter((w) => w !== "");
  const lines: string[] = [];
  let cur = "";
  const push = () => { if (cur !== "") { lines.push(cur); cur = ""; } };

  for (const w of words) {
    const cand = cur === "" ? w : cur + " " + w;
    if (measure(cand, size) <= maxW) { cur = cand; continue; }
    push();
    if (measure(w, size) <= maxW) { cur = w; continue; }
    // คำเดี่ยวยาวเกินช่อง — หั่นทีละตัวอักษร (ยังไม่ตัดทิ้ง แค่ขึ้นบรรทัดใหม่)
    let chunk = "";
    for (const ch of w) {
      if (chunk !== "" && measure(chunk + ch, size) > maxW) { lines.push(chunk); chunk = ch; }
      else chunk += ch;
    }
    cur = chunk;
  }
  push();
  return lines.length ? lines : [""];
}

/**
 * หาขนาดฟอนต์ + การขึ้นบรรทัดที่ทำให้ข้อความอยู่ในช่องได้ **โดยไม่ตัดคำ**
 *
 * ★ ข้อความที่พอดีอยู่แล้วในบรรทัดเดียว คืน `{lines:[text], size}` ขนาดเดิมเป๊ะ
 *   ⇒ แถวเดิมที่เคยพิมพ์ถูกต้องอยู่แล้ว **หน้าตาไม่ขยับแม้จุดเดียว**
 */
export function fitNote(text: string, measure: Measure, opts: NoteFitOptions): NoteFit {
  const s = String(text ?? "").trim();
  const maxLines = opts.maxLines ?? 2;
  const minSize = opts.minSize ?? 5;
  if (s === "") return { lines: [], size: opts.size, overflow: false };

  for (let size = opts.size; size >= minSize - 1e-9; size -= 0.25) {
    const lines = wrap(s, measure, size, opts.maxW);
    if (
      lines.length <= maxLines &&
      lines.every((l) => measure(l, size) <= opts.maxW) &&
      fitsVertically(lines.length, size, opts.above, opts.below)   // 🔴 ต้องผ่านทั้งกว้างและสูง
    ) {
      return { lines, size: Number(size.toFixed(2)), overflow: false };
    }
  }
  // ย่อจนสุดแล้วยังไม่พอ — คืนข้อความครบ ห้ามตัดประโยค (ผู้ใช้สั่ง) แล้วชูธงให้ผู้เรียกเตือน
  return { lines: wrap(s, measure, minSize, opts.maxW), size: minSize, overflow: true };
}

/**
 * baseline ของแต่ละบรรทัด — จัดหมึกให้อยู่กึ่งกลาง **กรอบแถว** ไม่ใช่กึ่งกลาง baseline
 *
 * ★ 1 บรรทัด → คืน [y] เป๊ะ ๆ (แถวเดิมที่เคยพิมพ์ถูกอยู่แล้ว ไม่ขยับแม้จุดเดียว)
 * 🪤 ไม่ส่ง above/below มา = ไม่รู้กรอบ → กลับไปคร่อม baseline แบบเดิม (ใช้เฉพาะตอนเทส)
 */
export function noteBaselines(
  y: number,
  lineCount: number,
  size: number,
  above?: number,
  below?: number,
): number[] {
  const leading = size * LEADING;
  if (lineCount <= 1) return [y];
  if (above == null || below == null) {
    const top = y + ((lineCount - 1) * leading) / 2;
    return Array.from({ length: lineCount }, (_, i) => top - i * leading);
  }
  const ink = inkHeight(lineCount, size);
  const slack = above + below - ink;
  // เหลือที่เท่าไรก็แบ่งบน/ล่างเท่ากัน · ไม่พอก็ยังชิดขอบบนไว้ก่อน (อย่างน้อยไม่ทะลุเส้นล่าง)
  const inkTop = y + above - Math.max(MARGIN, slack / 2);
  const first = inkTop - ASC * size;
  return Array.from({ length: lineCount }, (_, i) => first - i * leading);
}
