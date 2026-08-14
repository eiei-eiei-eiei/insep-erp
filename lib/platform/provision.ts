/**
 * ตรรกะ "รับลูกค้าใหม่ / เพิ่มกิจการ / รีเซ็ตรหัส" — **แหล่งความจริงเดียว**
 *
 * ใช้ร่วมกัน 2 ทาง:
 *   1. server action ของแอปจัดการหลังบ้าน (app/(platform)/platform/actions.ts)
 *   2. สคริปต์ terminal เดิม (scripts/provision-tenant.ts · scripts/add-entity.ts)
 *
 * ★ ทำไมต้องอยู่ที่เดียว: ถ้าปล่อยให้ UI กับสคริปต์มีตรรกะคนละชุด วันหนึ่งจะสร้างลูกค้า
 *   ได้คนละแบบ (เช่น UI ลืมสร้าง app_settings แบรนด์) แล้วหาสาเหตุไม่เจอเพราะ "สคริปต์ทำถูก"
 *
 * 🚨 ไฟล์นี้ **ห้าม import "server-only"** — สคริปต์รันด้วย tsx บน node ธรรมดา
 *    ซึ่งแพ็กเกจนั้นจะ throw ทันที · ความปลอดภัยมาจากการที่ทุกฟังก์ชัน "รับ client เข้ามา"
 *    ไม่ได้อ่าน service role key เอง → ไฟล์นี้เข้า client bundle ก็ไม่มีกุญแจติดไป
 *
 * 🚨 ทุกฟังก์ชันที่แตะ DB ใช้ **service role (ข้าม RLS)** → ต้องระบุ tenant เองทุก query เสมอ
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidTenantSlug, isReservedSlug } from "../shared/tenant";
import { usernameToEmail } from "../shared/auth-domain";
import { generateInitialPassword } from "../shared/password";
import { MODULES } from "../shared/workspaces";
import { BRAND_COLORS } from "../shared/branding";

// ── รูปแบบข้อมูล ─────────────────────────────────────────────────────────────

export type NewTenantInput = {
  slug: string;
  name: string;
  color: string;
  entityId: string;
  maxEntities: number;
  modules: string[];
};

export type NewTenantResult = {
  tenantId: string;
  username: string;
  /** ⚠️ แสดงบนจอครั้งเดียว — ห้ามเก็บลง DB / log ทุกกรณี */
  password: string;
};

export type NewEntityInput = {
  entityId: string;
  name: string;
  isVat: boolean;
};

export type TenantUserRow = {
  id: string;
  username: string | null;
  displayName: string | null;
  role: string;
  mustChangePassword: boolean;
};

export type TenantEntityRow = {
  entityId: string;
  name: string;
  isVat: boolean;
  isDefault: boolean;
};

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  color: string;
  modules: string[];
  maxEntities: number;
  isActive: boolean;
  createdAt: string;
  entities: TenantEntityRow[];
  users: TenantUserRow[];
};

/** รหัสกิจการ — ตัวพิมพ์ใหญ่/ตัวเลข/ขีด เช่น EID01 (DB ไม่ได้บังคับรูปแบบ จึงบังคับที่นี่) */
export const ENTITY_ID_RE = /^[A-Z0-9-]{2,12}$/;

// ── ตรวจ input (ล้วน — เทสออฟไลน์ได้) ────────────────────────────────────────

/**
 * ตรวจให้ครบก่อนแตะ DB — สร้างครึ่งทางแล้วค้างคือสิ่งที่แก้ยากที่สุดในงานนี้
 * คืนข้อความภาษาไทยบอกสาเหตุ หรือ null ถ้าผ่าน
 */
export function validateNewTenant(input: NewTenantInput): string | null {
  const slug = input.slug.trim().toLowerCase();
  if (!slug || !isValidTenantSlug(slug)) {
    return "ชื่อย่อลูกค้า (slug) ต้องเป็น a-z 0-9 และ - เท่านั้น ห้ามภาษาไทย เช่น rongsomchai";
  }
  if (isReservedSlug(slug)) {
    return `ชื่อย่อ "${slug}" เป็นชื่อสงวนของระบบ — ใช้ชื่ออื่น`;
  }
  if (!input.name.trim()) {
    return "ต้องใส่ชื่อกิจการที่จะแสดงในแอป";
  }
  if (!BRAND_COLORS.some((c) => c.key === input.color)) {
    return "ชุดสีไม่ถูกต้อง";
  }
  // ★ ห้ามยอมให้ modules ว่าง: hasModule() ตั้งใจ fail-open (ว่าง = เปิดหมด — D53)
  //   ถ้าปล่อยผ่าน ลูกค้าที่ "ไม่ติ๊กอะไรเลย" จะได้ทุกโมดูลฟรี ซึ่งตรงข้ามกับที่คนกดตั้งใจ
  if (!input.modules.length) {
    return "ต้องเลือกอย่างน้อย 1 โมดูล (ไม่เลือกเลย = ระบบถือว่าเปิดทุกโมดูล ซึ่งไม่ใช่สิ่งที่ตั้งใจ)";
  }
  const bad = input.modules.find((m) => !MODULES.includes(m as (typeof MODULES)[number]));
  if (bad) return `โมดูล "${bad}" ไม่รู้จัก — ใช้ได้: ${MODULES.join(", ")}`;

  if (!Number.isInteger(input.maxEntities) || input.maxEntities < 1) {
    return "โควตากิจการต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป";
  }
  if (!ENTITY_ID_RE.test(input.entityId)) {
    return "รหัสกิจการต้องเป็นตัวพิมพ์ใหญ่/ตัวเลข 2-12 ตัว เช่น EID01";
  }
  return null;
}

export function validateNewEntity(input: NewEntityInput): string | null {
  if (!ENTITY_ID_RE.test(input.entityId)) {
    return "รหัสกิจการต้องเป็นตัวพิมพ์ใหญ่/ตัวเลข 2-12 ตัว เช่น EID02";
  }
  if (!input.name.trim()) return "ต้องใส่ชื่อกิจการใหม่";
  return null;
}

export function validateQuota(maxEntities: number, currentEntities: number): string | null {
  if (!Number.isInteger(maxEntities) || maxEntities < 1) {
    return "โควตากิจการต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป";
  }
  // 🚨 ลดโควตาต่ำกว่าจำนวนกิจการที่ลูกค้ามีอยู่จริงไม่ได้ — เหตุผลเดียวกับ D53:
  //    ข้อมูลที่ขัดกับความจริงเป็นต้นทางของบั๊ก "ลูกค้าเข้าถึงข้อมูลตัวเองไม่ได้"
  if (maxEntities < currentEntities) {
    return `ลดโควตาต่ำกว่าจำนวนกิจการที่มีอยู่จริงไม่ได้ (ตอนนี้มี ${currentEntities} กิจการ)`;
  }
  return null;
}

export function validateModules(modules: string[]): string | null {
  if (!modules.length) {
    return "ต้องเปิดอย่างน้อย 1 โมดูล (ไม่เลือกเลย = ระบบถือว่าเปิดทุกโมดูล — D53)";
  }
  const bad = modules.find((m) => !MODULES.includes(m as (typeof MODULES)[number]));
  return bad ? `โมดูล "${bad}" ไม่รู้จัก` : null;
}

// ── งานที่แตะ DB ─────────────────────────────────────────────────────────────

const fail = (msg: string): never => {
  throw new Error(msg);
};

/** normalize ค่าที่คนพิมพ์มา (จากฟอร์มหรือ CLI) ให้อยู่ในรูปที่ DB คาดหวัง */
export function normalizeNewTenant(raw: NewTenantInput): NewTenantInput {
  return {
    slug: raw.slug.trim().toLowerCase(),
    name: raw.name.trim(),
    color: raw.color.trim(),
    entityId: raw.entityId.trim().toUpperCase(),
    maxEntities: raw.maxEntities,
    modules: raw.modules.map((m) => m.trim()).filter(Boolean),
  };
}

/**
 * รับลูกค้าใหม่ 1 ราย — tenant + กิจการแรก + แบรนด์ + ผู้ใช้ role main
 *
 * ★ ได้ระบบเปล่า **ไม่มีข้อมูลตัวอย่างใด ๆ** (D53) — ห้าม import อะไรจาก tests/ เข้ามาที่นี่
 *   ตัวนั้นยัด "สุราทดสอบ"/ออเดอร์/บิลเข้าไปด้วย ซึ่งลูกค้าที่จ่ายเงินต้องไม่ได้รับ
 */
export async function createTenant(
  db: SupabaseClient,
  raw: NewTenantInput,
): Promise<NewTenantResult> {
  const input = normalizeNewTenant(raw);
  const bad = validateNewTenant(input);
  if (bad) fail(bad);

  const { data: dup } = await db.from("tenants").select("id").eq("slug", input.slug).maybeSingle();
  if (dup) fail(`มีลูกค้าชื่อย่อ "${input.slug}" อยู่แล้ว — ใช้ชื่ออื่น`);

  // ── 1. tenants ──
  const { data: t, error: tErr } = await db
    .from("tenants")
    .insert({
      slug: input.slug,
      name: input.name,
      modules_enabled: input.modules,
      max_entities: input.maxEntities,
    })
    .select("id")
    .single();
  if (tErr) fail(`สร้างลูกค้า: ${tErr.message}`);
  const tenantId = t!.id as string;

  // ── 2. กิจการแรก (is_default → my_default_entity() ใช้ตัวนี้) ──
  const { error: eErr } = await db.from("entities").insert({
    tenant_id: tenantId,
    entity_id: input.entityId,
    name: input.name,
    is_vat: true,
    is_default: true,
  });
  if (eErr) fail(`สร้างกิจการแรก: ${eErr.message}`);

  // ── 3. แบรนด์ (อยู่ที่ app_settings ที่เดียว — D47) ──
  const { error: sErr } = await db.from("app_settings").insert([
    { tenant_id: tenantId, kind: "brand_name", value: input.name },
    { tenant_id: tenantId, kind: "brand_color", value: input.color },
    { tenant_id: tenantId, kind: "default_mode", value: "light" },
  ]);
  if (sErr) fail(`ตั้งแบรนด์: ${sErr.message}`);

  // ── 4. ผู้ใช้ role main ──
  //    ชื่อผู้ใช้ห้ามซ้ำ "ทั้งระบบ" (0032) → owner-<slug> ให้ชนยาก
  //    must_change_password ปล่อยให้ trigger handle_new_user (0031) ตั้งเอง — ห้ามส่ง skip
  const username = `owner-${input.slug}`;
  const password = generateInitialPassword();
  const { data: u, error: uErr } = await db.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username, display_name: `เจ้าของ${input.name}`, tenant_id: tenantId },
  });
  if (uErr) {
    fail(
      /already been registered|already exists/i.test(uErr.message)
        ? `ชื่อผู้ใช้ "${username}" ถูกใช้แล้ว (ชื่อผู้ใช้ห้ามซ้ำทั้งระบบ) — เปลี่ยนชื่อย่อลูกค้า`
        : `สร้างผู้ใช้: ${uErr.message}`,
    );
  }
  const { error: rErr } = await db.from("profiles").update({ role: "main" }).eq("id", u!.user!.id);
  if (rErr) fail(`ตั้งสิทธิ์เจ้าของกิจการ: ${rErr.message}`);

  return { tenantId, username, password };
}

export async function findTenantBySlug(
  db: SupabaseClient,
  slug: string,
): Promise<{ id: string; name: string; maxEntities: number } | null> {
  const { data } = await db
    .from("tenants")
    .select("id, name, max_entities")
    .eq("slug", slug.trim().toLowerCase())
    .maybeSingle();
  return data
    ? { id: data.id as string, name: data.name as string, maxEntities: Number(data.max_entities) || 1 }
    : null;
}

/**
 * เพิ่มกิจการให้ลูกค้า — ★ **จุดบังคับโควตาจริง**
 *
 * RLS (0028) ห้ามลูกค้า insert `entities` เองอยู่แล้ว → สร้างได้เฉพาะ service role
 * = ผ่านทางนี้เท่านั้น → โควตาเลี่ยงผ่าน API ไม่ได้
 *
 * 🚨 จงใจ **ไม่ขยายโควตาให้อัตโนมัติ** — การเพิ่มกิจการกับการอนุมัติว่าลูกค้าจ่ายค่า add-on แล้ว
 *    ต้องเป็นคนละการตัดสินใจ (D53) · ฝั่ง UI จึงแยกเป็นคนละปุ่ม
 */
export async function addEntityToTenant(
  db: SupabaseClient,
  tenantId: string,
  raw: NewEntityInput,
): Promise<void> {
  const input = { ...raw, entityId: raw.entityId.trim().toUpperCase(), name: raw.name.trim() };
  const bad = validateNewEntity(input);
  if (bad) fail(bad);

  const { data: t } = await db
    .from("tenants")
    .select("max_entities")
    .eq("id", tenantId)
    .maybeSingle();
  if (!t) fail("ไม่พบลูกค้ารายนี้");
  const quota = Number(t!.max_entities) || 1;

  const { data: existing, error: exErr } = await db
    .from("entities")
    .select("entity_id")
    .eq("tenant_id", tenantId);
  if (exErr) fail(`อ่านรายการกิจการ: ${exErr.message}`);

  if (existing!.some((e) => e.entity_id === input.entityId)) {
    fail(`กิจการรหัส "${input.entityId}" มีอยู่แล้วในลูกค้ารายนี้`);
  }
  if (existing!.length >= quota) {
    fail(
      `ลูกค้ารายนี้ใช้โควตาครบแล้ว (${existing!.length}/${quota}) — ` +
        "ถ้าลูกค้าจ่ายค่า add-on แล้ว ให้ขยายโควตาก่อน " +
        "(ปุ่ม “บันทึกโควตา” ในแอปจัดการหลังบ้าน)",
    );
  }

  const { error } = await db.from("entities").insert({
    tenant_id: tenantId,
    entity_id: input.entityId,
    name: input.name,
    is_vat: input.isVat,
    is_default: false,
  });
  if (error) fail(`สร้างกิจการ: ${error.message}`);
}

/**
 * รีเซ็ตรหัสผ่านของผู้ใช้ในระบบลูกค้า → คืน "รหัสชั่วคราว" ที่ต้องแสดงบนจอครั้งเดียว
 *
 * ⚠️ ปุ่มส่งอีเมลรีเซ็ตของ Supabase ใช้ไม่ได้กับระบบนี้ — อีเมลเป็นของปลอม `@insep.local`
 *    (requirement ข้อ 1) → ต้องตั้งรหัสใหม่ให้แล้วบอกลูกค้าทางช่องทางอื่น
 * 🚨 ห้ามเก็บค่าที่คืนจากฟังก์ชันนี้ลง DB หรือ log
 */
export async function resetUserPassword(db: SupabaseClient, userId: string): Promise<string> {
  const password = generateInitialPassword();
  const { error } = await db.auth.admin.updateUserById(userId, { password });
  if (error) fail(`ตั้งรหัสใหม่: ${error.message}`);

  // รหัสที่คนอื่นตั้งให้ = รหัสชั่วคราว → เจ้าตัวต้องเปลี่ยนเองตอนล็อกอินครั้งถัดไป (0031)
  const { error: flagErr } = await db
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", userId);
  if (flagErr) fail(`ตั้งธงบังคับเปลี่ยนรหัส: ${flagErr.message}`);

  return password;
}

/**
 * รายชื่อลูกค้าทั้งหมด + กิจการ + ผู้ใช้ (สำหรับหน้าจอแอดมิน)
 *
 * ★ ยิง 3 query แล้วประกอบใน JS แทน join — ตั้งใจ: ลูกค้าหลักสิบราย ข้อมูลไม่กี่ร้อยแถว
 *   และ PostgREST embed ข้ามตารางที่ RLS คุมคนละแบบเป็นแหล่งของความประหลาดใจ
 * ★ กรอง `is_platform` ออก — แถวนั้นมีไว้ผูกบัญชีแอดมินเอง ไม่ใช่ลูกค้า
 */
export async function listTenants(db: SupabaseClient): Promise<TenantRow[]> {
  const [{ data: tenants, error: tErr }, { data: entities }, { data: profiles }, { data: settings }] =
    await Promise.all([
      db
        .from("tenants")
        .select("id, slug, name, modules_enabled, max_entities, is_active, created_at")
        .eq("is_platform", false)
        .order("created_at", { ascending: true }),
      db.from("entities").select("tenant_id, entity_id, name, is_vat, is_default"),
      db.from("profiles").select("id, tenant_id, username, display_name, role, must_change_password"),
      db.from("app_settings").select("tenant_id, value").eq("kind", "brand_color"),
    ]);
  if (tErr) fail(`อ่านรายชื่อลูกค้า: ${tErr.message}`);

  const byTenant = <T extends { tenant_id: string }>(rows: T[] | null, id: string) =>
    (rows ?? []).filter((r) => r.tenant_id === id);

  return (tenants ?? []).map((t) => ({
    id: t.id as string,
    slug: t.slug as string,
    name: t.name as string,
    color: (byTenant(settings, t.id as string)[0]?.value as string) ?? "steel",
    modules: (t.modules_enabled as string[] | null) ?? [],
    maxEntities: Number(t.max_entities) || 1,
    isActive: t.is_active as boolean,
    createdAt: t.created_at as string,
    entities: byTenant(entities, t.id as string)
      .map((e) => ({
        entityId: e.entity_id as string,
        name: e.name as string,
        isVat: e.is_vat as boolean,
        isDefault: e.is_default as boolean,
      }))
      .sort((a, b) => a.entityId.localeCompare(b.entityId)),
    users: byTenant(profiles, t.id as string)
      .map((p) => ({
        id: p.id as string,
        username: p.username as string | null,
        displayName: p.display_name as string | null,
        role: p.role as string,
        mustChangePassword: Boolean(p.must_change_password),
      }))
      .sort((a, b) => (a.role === "main" ? -1 : b.role === "main" ? 1 : 0)),
  }));
}

/**
 * บันทึกว่าแอดมินทำอะไรไป — silent fail โดยตั้งใจ
 * (log ล้มต้องไม่ทำให้งานที่ทำสำเร็จไปแล้วดูเหมือนล้มเหลว)
 * 🚨 ห้ามใส่รหัสผ่านลง detail เด็ดขาด
 */
export async function logPlatformAction(
  db: SupabaseClient,
  entry: { actor: string; action: string; tenantSlug?: string | null; detail?: unknown },
): Promise<void> {
  await db
    .from("platform_admin_log")
    .insert({
      actor: entry.actor,
      action: entry.action,
      tenant_slug: entry.tenantSlug ?? null,
      detail: entry.detail ?? null,
    })
    .then(undefined, () => undefined);
}
