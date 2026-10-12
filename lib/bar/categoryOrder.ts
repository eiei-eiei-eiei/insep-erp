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

/**
 * ── D109: บันทึกหมวดทีเดียว (ลำดับ + ชื่อ) ─────────────────────────────────
 * ผู้ใช้ขอ: เดิม ▲▼ บันทึกทุกครั้งที่กด (ต้องรอระบบทุกคลิก) และแก้ชื่อมีปุ่มบันทึกรายหมวด
 * → แก้ในจอทั้งหมดแล้วกด **บันทึก** ปุ่มเดียว (แบบเดียวกับจัดลำดับเมนู D108)
 */

/** ชื่อที่ต้องเขียนใหม่ — เฉพาะที่เปลี่ยน (ตัดช่องว่างหัวท้ายแล้วเทียบ) */
export function categoryNameUpdates(
  names: Readonly<Record<string, string>>,
  current: ReadonlyMap<string, string>,
): { categoryId: string; name: string }[] {
  return Object.entries(names)
    .map(([categoryId, n]) => ({ categoryId, name: n.trim() }))
    .filter((u) => current.has(u.categoryId) && current.get(u.categoryId) !== u.name);
}

/** ตรวจก่อนบันทึก — คืนข้อความไทย ("" = ผ่าน) · ใช้ทั้งบนจอ (ปิดปุ่ม) และ server (ด่านจริง) */
export function categoryEditsError(
  order: readonly string[],
  names: Readonly<Record<string, string>>,
  existing: readonly string[],
): string {
  if (!sameCategorySet(order, existing)) {
    return "รายการหมวดเปลี่ยนไประหว่างนั้น (อาจมีคนเพิ่ม/ลบหมวดจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่";
  }
  for (const [id, n] of Object.entries(names)) {
    if (!existing.includes(id)) return "มีหมวดที่ถูกลบไประหว่างนั้น — รีเฟรชหน้าแล้วลองใหม่";
    if (!n.trim()) return "ชื่อหมวดว่างไม่ได้";
  }
  return "";
}
