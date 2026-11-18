/**
 * lib/connector/jobs — "งาน" ของรายการในบิล (item_job · D141 รอบ 3)
 *
 * ★ งานผูกกับแต่ละรายการอยู่แล้ว (บิลเดียวมีหลายงานได้) · เป็นข้อความอิสระ ไม่มีทะเบียนงาน
 *   ⇒ งานใหม่ = พิมพ์ชื่อใหม่ แล้วบันทึกไปก็โผล่เป็นตัวเลือกของบิลถัดไปเอง
 * ★ "ไม่ระบุงาน" (`job_none`) = ตั้งใจไม่ใส่ ⇒ **บันทึกเป็นค่าว่าง** (ผู้ใช้สั่ง) มีไว้ผ่านด่านบังคับเลือกงานเท่านั้น
 * ★ บังคับเลือกงานเมื่อกิจการนั้น "เคยใช้งาน" — ตัดสินจากข้อมูลจริง ไม่ฮาร์ดโค้ดรหัสกิจการ
 * ★ ฟังก์ชันล้วน ใช้ทั้ง server และการ์ด
 */

/** งานที่เสนอเป็นปุ่มในการ์ดย่อ */
export const JOB_CHIPS = 5;

/**
 * เรียงงานที่เคยใช้: งานของคู่ค้าเจ้านี้ก่อน (ใหม่สุดก่อน) แล้วตามด้วยงานที่ใช้บ่อยของกิจการ
 * @param recent งานของกิจการเรียงจากบิลใหม่สุด (ซ้ำได้ — นับเป็นความถี่)
 */
export function rankJobs(contactJobs: string[], recent: string[]): string[] {
  const clean = (s: string) => String(s ?? "").trim();
  const count = new Map<string, number>();
  for (const j of recent.map(clean)) if (j) count.set(j, (count.get(j) ?? 0) + 1);
  const out: string[] = [];
  for (const j of contactJobs.map(clean)) if (j && !out.includes(j)) out.push(j);
  for (const [j] of [...count].sort((a, b) => b[1] - a[1])) if (!out.includes(j)) out.push(j);
  return out;
}

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, "");

/**
 * งานที่ชื่อใกล้กับที่พิมพ์ (กันชื่อเพี้ยน "บาร์" vs "บาร์ค็อกเทล") — เตือนอย่างเดียว ไม่บล็อก
 * ใกล้ = ตัดช่องว่าง/ตัวพิมพ์แล้วเท่ากัน หรือคำหนึ่งอยู่ในอีกคำ (ยาว ≥ 2 ตัวอักษร)
 * ★ ชื่อเดียวกันเป๊ะ = ไม่ใช่ "ใกล้" (คืน null — ใช้ตัวเดิมอยู่แล้ว)
 */
export function similarJob(name: string, existing: string[]): string | null {
  const n = norm(name);
  if (n.length < 2) return null;
  if (existing.some((e) => e.trim() === name.trim())) return null;
  for (const e of existing) {
    const m = norm(e);
    if (m.length < 2) continue;
    if (m === n || m.includes(n) || n.includes(m)) return e;
  }
  return null;
}

/** สรุปงานของบิล (แถวงานในการ์ดย่อ) */
export type JobSummary =
  | { kind: "none_set" }                // ยังไม่ได้เลือกสักแถว
  | { kind: "single"; job: string }     // ทุกแถวงานเดียวกัน
  | { kind: "no_job" }                  // ทุกแถว "ไม่ระบุงาน"
  | { kind: "multi"; count: number }    // หลายงาน
  | { kind: "partial"; missing: number[] }; // บางแถวยังไม่เลือก (เลขแถวเริ่ม 1)

export function jobSummary(items: { job?: string; job_none?: boolean }[]): JobSummary {
  const val = items.map((it) => (it.job_none ? "\u0000none" : String(it.job ?? "").trim()));
  const missing = val.map((v, i) => (v ? 0 : i + 1)).filter(Boolean);
  if (missing.length === items.length) return { kind: "none_set" };
  if (missing.length) return { kind: "partial", missing };
  const set = new Set(val);
  if (set.size === 1) return val[0] === "\u0000none" ? { kind: "no_job" } : { kind: "single", job: val[0] };
  return { kind: "multi", count: [...set].filter((v) => v !== "\u0000none").length };
}

/**
 * ชื่อหมวดสินค้า/งานในบิลที่ "ยังไม่เคยใช้" (D174) — ใช้ทั้ง server (บอก Claude) และการ์ด (ป้าย ใหม่ + ปุ่มใช้ชื่อเดิม)
 *
 * ★ ชื่อใหม่ไม่ใช่ความผิด (หมวดใหม่ตั้งได้ · ทุกอย่างเป็นข้อความอิสระ) — **เตือนให้เห็น ไม่บล็อก**
 *   ที่กันคือหมวดซ้ำซ้อนเงียบ ๆ ("วัสดุสิ้นเปลือง" กับ "วัสดุ สิ้นเปลือง") ที่ทำให้สรุปตามหมวดแตกเป็นหลายก้อน
 * ★ รวมแถวที่ใช้ชื่อใหม่เดียวกันเป็นข้อเดียว (ปุ่ม "ใช้ชื่อเดิม" เปลี่ยนให้ทุกแถวนั้นทีเดียว)
 * ★ ไม่ระบุงาน (`job_none`) / ค่าว่าง = ไม่ใช่ชื่อใหม่
 */
export type NewName = {
  field: "category" | "job";
  name: string;
  /** แถวที่ใช้ชื่อนี้ (เริ่ม 0) */
  rows: number[];
  /** ชื่อเดิมที่ใกล้กัน · null = ไม่มีที่ใกล้ (เป็นหมวด/งานใหม่จริง) */
  similar: string | null;
};

export function newNames(
  items: { category?: string; job?: string; job_none?: boolean }[],
  known: { categories: string[]; jobs: string[] },
): NewName[] {
  const out: NewName[] = [];
  const add = (field: NewName["field"], raw: string | undefined, i: number, list: string[]) => {
    const name = String(raw ?? "").trim();
    if (!name || list.some((x) => x.trim() === name)) return;
    const hit = out.find((n) => n.field === field && n.name === name);
    if (hit) hit.rows.push(i);
    else out.push({ field, name, rows: [i], similar: similarJob(name, list) });
  };
  items.forEach((it, i) => {
    add("category", it.category, i, known.categories);
    if (!it.job_none) add("job", it.job, i, known.jobs);
  });
  return out;
}

/** ข้อความของชื่อใหม่ 1 ข้อ — การ์ดกับคำตอบของ preview_bill ใช้ประโยคเดียวกัน */
export function newNameText(n: NewName): string {
  const what = n.field === "category" ? "หมวดสินค้า" : "งาน";
  const rows = `รายการที่ ${n.rows.map((r) => r + 1).join(", ")}`;
  return n.similar
    ? `${rows}: ${what} "${n.name}" ยังไม่เคยใช้ — มี "${n.similar}" อยู่แล้ว ใช่อันนี้ไหม`
    : `${rows}: ${what}ใหม่ "${n.name}" (ยังไม่เคยใช้ — บันทึกแล้วจะเป็นตัวเลือกของบิลถัดไป)`;
}
