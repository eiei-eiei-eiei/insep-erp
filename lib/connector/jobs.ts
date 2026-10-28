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
