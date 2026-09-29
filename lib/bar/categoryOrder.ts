/**
 * ลำดับหมวดเมนูบาร์ (D101)
 *
 * หน้าขายเรียงแถบหมวดตาม `bar_category.sort` — ฟังก์ชันในไฟล์นี้ตัดสินว่าลำดับใหม่คืออะไร
 * ห้ามตัดสินในคอมโพเนนต์ (D84/D88)
 *
 * 🪤 ของเดิมตั้ง sort ของหมวดใหม่ = "จำนวนหมวดที่มีอยู่" → เคยลบหมวดไปแล้ว = เลขชนกับหมวดที่มีอยู่
 *    แล้วหมวดที่ sort เท่ากันไม่มีตัวตัดสิน ลำดับบนหน้าขายสลับไปมาเอง
 *    → หมวดใหม่ต่อท้ายด้วย max+1 · และทุกครั้งที่เรียงใหม่ เขียนทั้งชุดเป็น 0,1,2,… (ล้างเลขซ้ำไปในตัว)
 */

/** ย้ายหมวดขึ้น/ลง 1 ขั้น — ★ ใช้ ▲▼ ไม่ใช่ลาก (ทัชสกรีนชนกับการเลื่อนหน้า · D70) */
export function moveCategory(ids: readonly string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** sort ของหมวดที่เพิ่มใหม่ = ต่อท้ายสุดเสมอ (ไม่ใช่ "จำนวนหมวด") */
export function nextCategorySort(sorts: readonly number[]): number {
  return sorts.length === 0 ? 0 : Math.max(...sorts) + 1;
}

/** แถวที่ต้องเขียน sort ใหม่ — เขียนเฉพาะแถวที่ค่าเปลี่ยน */
export function sortUpdates(
  ids: readonly string[],
  current: ReadonlyMap<string, number>,
): { categoryId: string; sort: number }[] {
  return ids
    .map((categoryId, sort) => ({ categoryId, sort }))
    .filter((u) => current.get(u.categoryId) !== u.sort);
}

/**
 * ลำดับที่ส่งมาต้องเป็นหมวดชุดเดียวกับที่มีใน DB พอดี
 * 🚨 ไม่ครบ/เกิน = อีกเครื่องเพิ่ม/ลบหมวดระหว่างนั้น → ไม่เดา ให้รีเฟรช
 */
export function sameCategorySet(ids: readonly string[], existing: readonly string[]): boolean {
  if (ids.length !== existing.length) return false;
  const a = new Set(ids);
  if (a.size !== ids.length) return false;
  return existing.every((id) => a.has(id));
}
