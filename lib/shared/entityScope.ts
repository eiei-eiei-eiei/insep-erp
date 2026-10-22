/**
 * lib/shared/entityScope — จำกัดผู้ใช้ให้เห็นเฉพาะบางกิจการ (D120 · profiles.allowed_entity_ids)
 *
 * ค่าใน DB: `null` = เห็นทุกกิจการ · array = เห็นเฉพาะกิจการในลิสต์ (RLS + RPC ใช้ my_entities())
 * 🚨 ห้ามบันทึก array ว่าง — RLS ตีความว่า "ไม่เห็นอะไรเลย" (entity_id = any('{}') เป็น false)
 *    แต่ bar_guard (0065) ตีความว่า "เห็นทุกกิจการ" ⇒ สองชั้นขัดกันเอง ต้องไม่ปล่อยให้เกิด
 * 🚨 main ไม่ถูกจำกัด — มีสิทธิ์ admin แก้ profile ตัวเองคืนได้อยู่แล้ว การจำกัดจึงเป็นแค่ภาพลวง
 */

/** ข้อความบนหน้าจอว่าการจำกัดครอบอะไรบ้าง — 🚨 ต้องตรงกับ migration 0087 (ห้ามเขียนเกินความจริง) */
export const ENTITY_SCOPE_COVERS =
  "บิลบัญชี · ยอดบัญชีธนาคาร · ภพ.30/ภงด./50ทวิ · ชำระภาษี · พนักงานและงวดเงินเดือน";
/** 🪤 บาร์มีด่านกิจการเฉพาะตอน "เขียน" (bar_guard) — ตารางบาร์ยังอ่านได้ทุกกิจการ จึงอยู่ฝั่งนี้ */
export const ENTITY_SCOPE_NOT_COVERED =
  "งานผลิต งานขาย และบาร์ (ยังเห็นของทุกกิจการ) · รายชื่อคู่ค้า (ใช้ร่วมทุกกิจการ)";

/**
 * ตรวจค่าที่จะบันทึก — คืนข้อความไทย หรือ null ถ้าบันทึกได้
 * @param ids null = ทุกกิจการ
 */
export function entityScopeError(role: string, ids: string[] | null, allIds: string[]): string | null {
  if (ids === null) return null;
  if (role === "main") return "ผู้ใช้ main เห็นทุกกิจการเสมอ — จำกัดไม่ได้ (เปลี่ยนสิทธิ์เป็นบทบาทอื่นก่อน)";
  if (ids.length === 0) return "เลือกอย่างน้อย 1 กิจการ (หรือเลือก ทุกกิจการ)";
  const unknown = ids.filter((id) => !allIds.includes(id));
  if (unknown.length) return `ไม่พบกิจการ ${unknown.join(", ")}`;
  return null;
}

/**
 * ค่าที่จะเก็บจริง — ตัดซ้ำ + เรียง · เลือกครบทุกกิจการ = null (เพิ่มกิจการใหม่ทีหลังก็เห็นด้วย)
 * 🪤 ไม่ทำแบบนี้: เลือกครบ 3 กิจการแล้วเก็บเป็น [EID01,EID02,EID03] → เพิ่ม EID04 แล้วผู้ใช้มองไม่เห็นเงียบ ๆ
 */
export function normalizeEntityScope(ids: string[] | null, allIds: string[]): string[] | null {
  if (ids === null) return null;
  const uniq = [...new Set(ids)].sort();
  if (allIds.length > 0 && allIds.every((id) => uniq.includes(id))) return null;
  return uniq;
}

/** ป้ายในตารางผู้ใช้ */
export function entityScopeLabel(
  ids: string[] | null | undefined,
  entities: { entity_id: string; name: string }[],
): string {
  if (!ids || ids.length === 0) return "ทุกกิจการ";
  return ids
    .map((id) => {
      const n = entities.find((e) => e.entity_id === id)?.name;
      return n ? `${id} — ${n}` : id;
    })
    .join(" · ");
}
