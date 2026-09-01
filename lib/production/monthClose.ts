/**
 * ปิดเดือนสรรพสามิต — ตรรกะการแสดงผล (D91)
 *
 * 🚨 **ห้ามตัดสินป้าย/ข้อความในคอมโพเนนต์** — บทเรียน D84 (ชื่อโมดูลผิดเพราะ ternary ในหน้าจอ)
 *    และ D88 ข้อ 4 (ป้าย "ไม่มียอด" ขึ้นทั้งที่มียอด) · ทุกอย่างที่ผู้ใช้อ่านแล้วตัดสินใจ
 *    ต้องมาจากฟังก์ชันที่มีเทสคุม
 */

/** ผลรวมขาเข้าฟอร์มของเดือนหนึ่ง — โครงตรงกับ `fn_excise_month_totals` ใน 0058 */
export type Pair = { in: number; out: number };
export type Runs = { n: number; vol: number };
export type ExciseTotals = {
  product?: Record<string, Pair>;
  material?: Record<string, Pair>;
  distill?: Record<string, Runs>;
  draw?: Record<string, Runs>;
};

export type MonthCloseRow = {
  id: number;
  month: string;
  closedAt: string;
  closedBy: string | null;
  note: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenNote: string | null;
  totals: ExciseTotals | null;
};

export type MonthCloseStatus = {
  /** ปิดอยู่ตอนนี้ไหม = มีแถวที่ยังไม่ถูกถอน */
  closed: boolean;
  /** แถวที่ยัง active (ปิดอยู่) — null เมื่อเดือนเปิด */
  active: MonthCloseRow | null;
  /** จำนวนรอบที่เคยปิดไปแล้วและถอนออก — ใช้บอกผู้ใช้ว่าเดือนนี้ถูกแก้มาก่อน */
  reopenedTimes: number;
};

export function closeStatus(rows: readonly MonthCloseRow[]): MonthCloseStatus {
  const active = rows.find((r) => !r.reopenedAt) ?? null;
  return {
    closed: active !== null,
    active,
    reopenedTimes: rows.filter((r) => r.reopenedAt).length,
  };
}

/** ป้ายสถานะบนการ์ด — ★ ตัดสินที่นี่ที่เดียว */
export function monthCloseBadge(st: MonthCloseStatus): { text: string; tone: "ok" | "warn" } {
  return st.closed ? { text: "ปิดเดือนแล้ว", tone: "ok" } : { text: "ยังไม่ปิดเดือน", tone: "warn" };
}

/**
 * ข้อความเตือนก่อนกดปิดเดือน
 *
 * 🚨 **เตือน ไม่บล็อก** (แพตเทิร์น `legCoverage` ของ D67) — โรงที่ออกฟอร์มบางใบไปแล้ว
 *    ในรอบก่อน หรือใช้แค่บางเส้นทางผลิต ก็ยังต้องปิดเดือนได้
 */
export function closeWarnText(done: number, total: number): string | null {
  if (total <= 0 || done >= total) return null;
  return `ยังสร้างฟอร์มไม่ครบ (${done}/${total} ใบ) — ปิดเดือนได้ แต่ตรวจให้แน่ใจว่ายื่นครบแล้ว`;
}

/**
 * ผลของ dry-run: กดคำนวณใหม่แล้วจะเกิดอะไร **แยกตามทิศทาง**
 *
 * 🚨 `changed` เฉย ๆ เป็นตัวเลขที่ไม่มีทิศทาง — เอาไปแต่งประโยคที่มีทิศทางไม่ได้
 *    (บั๊กที่เจอตอนเทสเบราว์เซอร์ D91: หน้าจอบอก "กดเพื่อเอาออก" ทั้งที่การกดจะทำให้
 *    แถว **กลับมาแสดง** — คำโกหกที่กลับด้านกับความจริงพอดี · ตระกูล D81)
 */
export type RecomputePreview = { toHide: number; toShow: number };

/**
 * มีคู่ จ่าย/รับ ที่การแสดงผลยังไม่ตรงกับความจริง — บอกก่อน ไม่แอบทำให้เอง
 *
 * ซ่อนเพิ่มได้: แถวที่ถูกล็อกไว้ด้วยกติกาเก่าของ D90 · เดือนเคยปิดแล้วถอน
 * เอากลับมาแสดง: คู่ที่ซ่อนไว้ แต่เดือนที่เกี่ยวข้องถูกปิดไปแล้ว (ฟอร์มที่ยื่นมีแถวนั้นอยู่)
 */
export function pendingRecomputeText(p: RecomputePreview): string | null {
  const parts: string[] = [];
  if (p.toHide > 0) {
    parts.push(
      `มีคู่ จ่าย/รับ ของบิลที่ยกเลิก ${p.toHide} คู่ที่ยังแสดงบนฟอร์มของเดือนนี้ ` +
        `— ถ้ายังไม่ได้ยื่นงบเดือนนี้ กด "คำนวณใหม่ตามจริง" เพื่อเอาออก`,
    );
  }
  if (p.toShow > 0) {
    parts.push(
      `มีคู่ จ่าย/รับ ${p.toShow} คู่ที่ถูกซ่อนไว้ แต่เดือนที่เกี่ยวข้องปิดไปแล้ว ` +
        `— กด "คำนวณใหม่ตามจริง" เพื่อให้กลับมาแสดงตามฟอร์มที่ยื่นไป`,
    );
  }
  return parts.length ? parts.join(" · ") : null;
}

const GROUP_LABEL: Record<keyof ExciseTotals, string> = {
  product: "บรรจุ/จ่ายขวด",
  material: "วัตถุดิบ",
  distill: "กลั่น",
  draw: "รินน้ำสุราแช่",
};

export type DriftLine = { group: string; key: string; before: string; after: string };

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const trim = (n: number): string => String(Math.round(n * 1e6) / 1e6);

function show(v: Pair | Runs | undefined): string {
  if (!v) return "—";
  if ("in" in v) return `รับ ${trim(num(v.in))} · จ่าย ${trim(num(v.out))}`;
  return `${trim(num(v.n))} ครั้ง · ${trim(num(v.vol))} ล.`;
}

/**
 * ข้อมูลขยับไปจากตอนปิดเดือนไหม
 *
 * 🚨 คืนลิสต์ว่างเสมอเมื่อ `saved` เป็น null — **ยังไม่เคยปิด = ไม่มีอะไรให้เทียบ**
 *    (บทเรียน D88 ข้อ 4: ข้อความ "ต่างจากยอดที่ยื่นไว้" เคยโผล่ทั้งที่ยังไม่เคยยื่น)
 */
export function driftSummary(saved: ExciseTotals | null, current: ExciseTotals | null): DriftLine[] {
  if (!saved || !current) return [];
  const out: DriftLine[] = [];
  for (const g of Object.keys(GROUP_LABEL) as (keyof ExciseTotals)[]) {
    const a = (saved[g] ?? {}) as Record<string, Pair | Runs>;
    const b = (current[g] ?? {}) as Record<string, Pair | Runs>;
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const before = show(a[k]);
      const after = show(b[k]);
      if (before !== after) out.push({ group: GROUP_LABEL[g], key: k, before, after });
    }
  }
  return out;
}

/**
 * ผลของการถอนปิด/คำนวณใหม่
 *
 * 🚨 ไม่มีอะไรเปลี่ยนก็ต้องพูดตรง ๆ ห้ามขึ้นเขียวลอย ๆ
 * 🚨 และต้องบอก **ทิศทาง** ที่เกิดขึ้นจริง — ผู้ใช้ต้องรู้ว่าตัวเลขบนฟอร์มเพิ่มหรือลด
 */
export function recomputeResultText(p: RecomputePreview): { text: string; warn: boolean } {
  const bits: string[] = [];
  if (p.toHide > 0) bits.push(`เอาออกจากฟอร์ม ${p.toHide} คู่`);
  if (p.toShow > 0) bits.push(`เอากลับมาแสดง ${p.toShow} คู่`);
  if (!bits.length) {
    return { text: "คำนวณใหม่แล้ว — ไม่มีคู่ไหนต้องเปลี่ยน ตัวเลขบนฟอร์มเท่าเดิม", warn: true };
  }
  return { text: `คำนวณใหม่แล้ว — ${bits.join(" · ")}`, warn: false };
}

/**
 * ข้อความตอนยกเลิกบิลไม่สำเร็จในการซ่อน เพราะเดือนถูกปิดไปแล้ว
 *
 * 🚨 ต้องบอกให้ครบว่า **ใครต้องเป็นคนกด** — ฝ่ายขายยกเลิกได้ แต่ถอนปิดเดือนไม่ได้
 *    (ทุกครั้งที่ปฏิเสธ ต้องตอบให้ได้ว่าต้องทำอะไรแทน — D83/D88)
 */
export function cancelLockedText(quNo: string, months: readonly string[]): string | null {
  if (months.length === 0) return null;
  return (
    `ยกเลิก ${quNo} แล้ว — แต่เดือน ${months.join(", ")} ปิดบัญชีสรรพสามิตไปแล้ว ` +
    `คู่ จ่าย/รับ จะยังแสดงบนฟอร์ม ภส. ตามเดิม (ฟอร์มที่ยื่นไปแล้วต้องไม่เปลี่ยน) · ` +
    `ถ้ายังไม่ได้ยื่นจริง ให้เจ้าของกิจการถอนปิดเดือนที่ ผลิต → รายงานสรรพสามิต`
  );
}
