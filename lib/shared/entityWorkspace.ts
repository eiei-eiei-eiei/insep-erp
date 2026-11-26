/**
 * lib/shared/entityWorkspace — "กิจการที่เลือกอยู่" ทั้งเบราว์เซอร์ (ทาง Y · D187)
 *
 * สเปกเต็ม: docs/ENTITY_WORKSPACE_SPEC.md ส่วนที่ 2
 *
 * เส้นทางของค่า:  ตัวสลับบนแถบบน → switchEntityAction (app/(app)/actions.ts)
 *   → fn_set_last_entity (จด profiles.last_entity_id) + cookie `insep_entity`
 *   → lib/supabase/server.ts แนบ header `x-entity-id` ทุกคำขอ
 *   → my_current_entity() ใน DB (ตรวจ tenant + สิทธิ์ D120 ทุกครั้ง · ไม่ผ่าน = ข้ามไปชั้นถัดไป)
 *
 * 🔒 cookie/header **ไม่ใช่ด่านความปลอดภัย** — ผู้ใช้แก้ cookie หรือยิง PostgREST ตรงได้เสมอ
 *    ด่านจริงอยู่ใน my_current_entity() · ที่นี่แค่ตัดค่าขยะทิ้งก่อนส่ง (กัน header แปลก ๆ)
 */
import type { ModuleKey } from "./workspaces";

/** cookie ที่จำกิจการที่เลือก (ทั้งเบราว์เซอร์ — Q8: เปิด 2 แท็บคนละกิจการไม่ได้ โดยตั้งใจ) */
export const ENTITY_COOKIE = "insep_entity";

/** header ที่ PostgREST ส่งเข้า `request.headers` (ตัวพิมพ์เล็ก — PostgREST แปลงชื่อเป็นตัวเล็กเสมอ) */
export const ENTITY_HEADER = "x-entity-id";

/** อายุ cookie — 1 ปี (เป็นแค่ความชอบ · หมดอายุ = DB ใช้ profiles.last_entity_id แทน) */
export const ENTITY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * โมดูลที่ "ทำตามกิจการที่เลือก" แล้ว — เติมทีละเฟส (เฟส 2 ผลิต · 3 ขาย · 4 บาร์ · 5 เงินเดือน · 6 บัญชี)
 *
 * 🚨 ลิสต์ว่าง = **ซ่อนตัวสลับ** — ตัวสลับที่กดแล้วไม่มีโมดูลไหนเปลี่ยน = ปุ่มหลอก (ผู้ใช้จะคิดว่าพัง)
 *    เฟส 1 จึงวางท่อครบแต่ยังไม่โชว์ · เฟสไหนทำโมดูลเสร็จ เติม key ที่นี่ แล้วตัวสลับจะบอกบนจอ
 *    ว่า "มีผลกับ: …" ตามลิสต์นี้ (ไม่ต้องแก้ที่อื่น)
 */
export const ENTITY_SCOPED_MODULES: readonly ModuleKey[] = [];

/** รหัสกิจการที่ยอมส่งต่อ — ตัวอักษร/ตัวเลข/ขีด ไม่เกิน 40 ตัว (รหัสจริงแบบ EID01) */
const ENTITY_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** ตัดค่าขยะ: ว่าง/ยาวเกิน/มีอักขระแปลก ⇒ null (ไม่ส่ง header · DB ใช้ค่าชั้นถัดไปเอง) */
export function sanitizeEntityId(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return ENTITY_ID_RE.test(s) ? s : null;
}

/** header ที่ server client แนบไปทุกคำขอ — ไม่มี cookie / ค่าขยะ = ไม่แนบเลย */
export function entityHeadersFromCookie(cookieValue: string | null | undefined): Record<string, string> {
  const id = sanitizeEntityId(cookieValue);
  return id ? { [ENTITY_HEADER]: id } : {};
}

export type EntityOption = { entity_id: string; name: string };

/**
 * แสดงตัวสลับไหม — ต้องมีโมดูลที่ทำตามแล้วอย่างน้อย 1 ตัว **และ** ผู้ใช้เข้าได้ ≥ 2 กิจการ
 * (เข้าได้กิจการเดียว = ไม่มีอะไรให้สลับ · ผู้ใช้ที่ถูกจำกัดเหลือกิจการเดียวไม่ต้องเห็น)
 */
export function showEntitySwitcher(
  entities: readonly EntityOption[],
  scoped: readonly ModuleKey[] = ENTITY_SCOPED_MODULES,
): boolean {
  return scoped.length > 0 && entities.length >= 2;
}

/**
 * ลำดับสีประจำกิจการ (ใช้กับ chartColor) — เรียงตามรหัสกิจการ จึงได้สีเดิมทุกหน้า/ทุกเครื่อง
 * ไม่พบ = 0
 */
export function entityColorIndex(entities: readonly EntityOption[], entityId: string | null): number {
  const ids = entities.map((e) => e.entity_id).sort();
  const i = entityId ? ids.indexOf(entityId) : -1;
  return i < 0 ? 0 : i;
}

/**
 * 🪤 ฝาแฝดข้อความของ entity_guard() (migration 0115) — สองที่ต้องพูดเหมือนกัน
 *    (lib/shared/entityWorkspace.test.ts อ่าน SQL มาเทียบ)
 */
export const ENTITY_MISMATCH_HINT = "(อาจสลับในอีกแท็บ) — รีเฟรชหน้านี้ก่อนบันทึก";
