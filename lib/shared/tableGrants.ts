/**
 * สิทธิ์ระดับตาราง (GRANT) — กติกาแหล่งเดียว (D118 · migration 0085)
 *
 * GRANT = "บัตรผ่านประตูห้อง" · RLS = "ล็อกเกอร์ในห้อง" — ต้องมีทั้งสองชั้น
 *
 * 🔴 ทำไมต้องมีไฟล์นี้: ตั้งแต่ 2026-10-30 Supabase **เลิกแจก grant ให้ตารางใหม่อัตโนมัติ**
 *    (project ใหม่เลิกไปก่อนแล้ว) แต่ migration 0001-0084 ไม่มี grant ตารางเลยสักบรรทัด
 *    ⇒ ลืม grant = แอปได้ `permission denied` ทั้งที่ build/lint/test ผ่านหมด
 *    และรับลูกค้าที่เปิด DB ก้อนใหม่ = **ทุกตารางเข้าไม่ได้ แอปใช้ไม่ได้ทั้งระบบ**
 *
 * ใช้ 2 ที่: `lib/shared/tableGrantsSql.test.ts` (อ่านไฟล์ SQL — จับก่อนลง DB)
 *          และ `auditTableGrants()` ← `fn_audit_table_grants()` (ถาม DB จริง — test:tenant + db:audit-grants)
 *
 * ★ เพิ่มตารางใหม่: ใส่ใน TENANT_TABLES (ถ้ามี tenant_id) หรือรายชื่อด้านล่าง
 *   แล้วเขียน grant ในไฟล์ migration เดียวกับที่ create table — ไม่งั้น `npm run test` ฟ้อง
 */
import { TENANT_TABLES } from "./tenantTables";

/**
 * ตารางที่แอปใช้ผ่านผู้ใช้ที่ล็อกอิน — ได้ select/insert/update/delete ให้ authenticated + service_role
 * (เท่ากับ DB เดิมทุกประการ ยกเว้น anon · สิทธิ์จริงยังคุมด้วย RLS)
 */
export const APP_TABLES = [...TENANT_TABLES, "tenants"] as const;

/**
 * ตารางแพลตฟอร์ม (D54/D59) — RLS deny-all **และ** ไม่มี grant ให้ anon/authenticated
 * 🚨 grant ให้ authenticated = ราคาที่ลูกค้าแต่ละเจ้าจ่ายรั่วให้ลูกค้าทุกเจ้า (ถ้า RLS พลาดชั้นเดียว)
 *    เข้าได้เฉพาะ service_role (หน้า /platform ฝั่ง server)
 */
export const PLATFORM_ONLY_TABLES = [
  "platform_admins", "platform_admin_log", "subscriptions", "subscription_payments",
  "connector_users", // D141 — ใครใช้ Claude connector ได้ · ลูกค้าเขียนได้ = ให้สิทธิ์ตัวเอง
] as const;

/** วิวที่ตั้งใจเปิดให้คนยังไม่ล็อกอินอ่าน (หน้า login แสดงแบรนด์ · 0025/0030) */
export const PUBLIC_VIEWS = ["tenant_branding"] as const;

/**
 * ตารางแอปที่ใช้คอลัมน์ `generated ... as identity` (ไม่ใช่ bigserial)
 * Postgres **ไม่ตรวจสิทธิ์ sequence ของ identity** ตอน insert ⇒ ไม่ต้อง grant usage
 * 🪤 ไม่ข้าม = DB ก้อนใหม่ฟ้องผิดว่าขาด usage (DB เดิมผ่านเพราะได้จาก default)
 * `tableGrantsSql.test.ts` อ่านไฟล์ SQL มาเทียบรายชื่อนี้ — เพิ่ม identity ใหม่แล้วลืมเติม = เทสแดง
 */
export const IDENTITY_APP_TABLES = ["payroll_items"] as const;

export const CRUD =["select", "insert", "update", "delete"] as const;

/** แถวจาก `fn_audit_table_grants()` — 1 แถวต่อ ตาราง/วิว/sequence ใน schema public */
export type GrantRow = {
  name: string;
  kind: "table" | "view" | "sequence";
  /** sequence: ตารางเจ้าของ (คอลัมน์ serial) · อื่น ๆ null */
  owner_table: string | null;
  rls: boolean | null;
  anon: string[];
  authed: string[];
  service: string[];
};

const has = (privs: string[], need: readonly string[]) => need.every((p) => privs.includes(p));

/**
 * ตรวจสิทธิ์จริงใน DB — คืนรายการปัญหาเป็นภาษาไทย (ว่าง = ผ่าน)
 *
 * 🪤 ไม่ตรวจ anon บนตารางแอป: DB เดิม 2 ก้อนได้ grant ให้ anon มาจาก default ของ Supabase
 *    (ปลอดภัยเพราะ RLS ทุก policy ต้องล็อกอิน) ส่วน DB ใหม่จะไม่มี — ทั้งสองแบบถือว่าถูก
 */
export function auditTableGrants(rows: GrantRow[]): string[] {
  const out: string[] = [];
  const app = new Set<string>(APP_TABLES);
  const platform = new Set<string>(PLATFORM_ONLY_TABLES);
  const views = new Set<string>(PUBLIC_VIEWS);
  const tables = rows.filter((r) => r.kind === "table");

  for (const r of tables) {
    if (app.has(r.name)) {
      if (!has(r.authed, CRUD)) out.push(`ตาราง ${r.name}: authenticated ขาดสิทธิ์ (มี ${r.authed.join(",") || "ไม่มีเลย"}) — แอปจะได้ permission denied`);
      if (!has(r.service, CRUD)) out.push(`ตาราง ${r.name}: service_role ขาดสิทธิ์ (มี ${r.service.join(",") || "ไม่มีเลย"})`);
    } else if (platform.has(r.name)) {
      if (r.anon.length || r.authed.length) out.push(`🚨 ตารางแพลตฟอร์ม ${r.name} เปิดให้ anon/authenticated (${[...r.anon, ...r.authed].join(",")}) — ต้องปิด`);
      if (!has(r.service, CRUD)) out.push(`ตารางแพลตฟอร์ม ${r.name}: service_role ขาดสิทธิ์ — หน้า /platform จะใช้ไม่ได้`);
    } else {
      out.push(`ตาราง ${r.name} ไม่อยู่ในรายชื่อใดเลย — เพิ่มใน TENANT_TABLES หรือ lib/shared/tableGrants.ts แล้วตัดสินว่าใครเข้าได้`);
    }
    // grant เปิดประตูแล้ว ถ้า RLS ไม่เปิด = ทุกคนที่ล็อกอินอ่านได้ทุกแถวของทุกลูกค้า
    if (r.rls === false) out.push(`🚨 ตาราง ${r.name} ไม่ได้เปิด RLS`);
  }

  for (const n of [...APP_TABLES, ...PLATFORM_ONLY_TABLES]) {
    if (!tables.some((r) => r.name === n)) out.push(`รายชื่อค้าง: ${n} ไม่มีใน DB (ลบออกจากรายชื่อ หรือยังไม่ได้ลง migration)`);
  }

  for (const r of rows.filter((x) => x.kind === "sequence")) {
    if (!r.owner_table || !app.has(r.owner_table)) continue; // identity ของตารางแพลตฟอร์ม ไม่ต้องให้ใคร
    if ((IDENTITY_APP_TABLES as readonly string[]).includes(r.owner_table)) continue;
    if (!has(r.authed, ["usage"])) out.push(`sequence ${r.name} (${r.owner_table}): authenticated ขาด usage — insert แถวใหม่จะล้ม`);
    if (!has(r.service, ["usage"])) out.push(`sequence ${r.name} (${r.owner_table}): service_role ขาด usage`);
  }

  for (const v of views) {
    const r = rows.find((x) => x.kind === "view" && x.name === v);
    if (!r) { out.push(`ไม่พบวิว ${v}`); continue; }
    if (!r.anon.includes("select")) out.push(`วิว ${v}: anon อ่านไม่ได้ — หน้า login จะไม่ขึ้นแบรนด์ลูกค้า`);
  }
  return out;
}
