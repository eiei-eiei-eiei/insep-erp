/**
 * migration/aim/apply.ts — ลงข้อมูล PAT&AIM เข้า tenant ที่รับลูกค้าไว้แล้ว (D121)
 *
 * ลำดับที่ผู้ใช้ทำก่อน: รับลูกค้าใหม่ที่หน้า /platform (โมดูล บัญชี + เงินเดือน · กิจการ ≥ 9 · EID01)
 *   → provisioning สร้าง tenant + กิจการ EID01 + แบรนด์ + ผู้ใช้เจ้าของ ไว้ให้แล้ว
 *   → สคริปต์นี้ "เติม" ทุกอย่างที่เหลือ ทับข้อมูล EID01 ด้วยของจริงจากแอปเดิม
 *
 * 🚨 service role = bypass RLS → ทุกแถวต้องติด tenant_id เอง · ทุก query ต้องกรอง tenant เอง
 * 🚨 **ห้ามแตะ `fn_mig_set_triggers`** — ปิด trigger ได้ระดับตาราง = ปิดทั้ง DB
 *    ซึ่งมีลูกค้าเจ้าอื่นใช้อยู่ (D82) · ปล่อย trigger ทำงาน แล้วลบแถว audit ของการย้ายทีหลัง
 *    (เฉพาะ tenant นี้ · เฉพาะ insert ที่ไม่มีผู้ใช้ · เฉพาะช่วงเวลาที่รัน)
 * 🚨 ห้าม `fn_mig_truncate` ตอนล้มกลางทาง — ตัวนั้นลบกิจการ EID01 + แบรนด์ของ provisioning ด้วย
 *    → `wipeImported()` ลบเฉพาะสิ่งที่สคริปต์นี้ลง (ย้อนกลับถึงสภาพหลังรับลูกค้าพอดี)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Rec = Record<string, unknown>;

/** ของที่ provisioning สร้างไว้ — ห้ามลบตอนย้อนกลับ */
const PROVISION_SETTING_KINDS = ["brand_name", "brand_color", "default_mode"];

/** ลำดับ insert (แม่ก่อนลูก) · ย้อนกลับใช้ลำดับกลับด้าน */
export const INSERT_ORDER = [
  "entities", "bank_accounts", "app_settings", "contacts",
  "transactions", "transaction_items", "tax_summaries", "wht_certificates",
  "pay_inputs", "pay_variables", "pay_components", "pay_rates", "pay_post_legs",
  "employees", "payroll_periods", "payroll_items",
] as const;
export type ImportTable = (typeof INSERT_ORDER)[number];

/** ตารางที่ entity_id มีค่าปริยาย my_default_entity() (ใช้ไม่ได้กับ service role) */
const ENTITY_DEFAULT_TABLES = new Set<string>(["contacts", "transactions", "tax_summaries", "wht_certificates", "employees", "payroll_periods"]);

/** ตารางที่ต้องว่างก่อนลง (นอกจาก entities/app_settings ที่ provisioning สร้างไว้) */
const MUST_BE_EMPTY = INSERT_ORDER.filter((t) => t !== "entities" && t !== "app_settings");

export type TenantRow = { id: string; slug: string; name: string; modules_enabled: string[] | null; max_entities: number | null; is_active: boolean | null };

async function count(db: SupabaseClient, table: string, tenant: string): Promise<number> {
  const { count: n, error } = await db.from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenant);
  if (error) throw new Error(`นับ ${table}: ${error.message}`);
  return n ?? 0;
}

/** ด่านก่อนลง — คืนรายการปัญหา (ว่าง = ลงได้) */
export async function preflight(db: SupabaseClient, slug: string, entityCount: number, defaultEntity: string) {
  const problems: string[] = [];
  const { data: t, error } = await db.from("tenants").select("id, slug, name, modules_enabled, max_entities, is_active").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`อ่าน tenants: ${error.message}`);
  if (!t) return { tenant: null, problems: [`ไม่พบลูกค้าชื่อย่อ "${slug}" ใน DB นี้ — รับลูกค้าที่หน้า /platform ก่อน`] };
  const tenant = t as TenantRow;
  const mods = tenant.modules_enabled ?? [];
  for (const m of ["accounting", "payroll"]) if (!mods.includes(m)) problems.push(`ยังไม่ได้เปิดโมดูล ${m} ให้ลูกค้านี้ (หน้า /platform)`);
  if ((tenant.max_entities ?? 0) < entityCount) problems.push(`โควตากิจการ ${tenant.max_entities} < ${entityCount} ที่จะลง — ขยายที่หน้า /platform ก่อน`);
  for (const tb of MUST_BE_EMPTY) {
    const n = await count(db, tb, tenant.id);
    if (n > 0) problems.push(`ตาราง ${tb} มีข้อมูลอยู่แล้ว ${n} แถว — สคริปต์นี้ลงได้เฉพาะลูกค้าที่เพิ่งรับ (กันลงซ้ำ)`);
  }
  const { data: ents, error: eErr } = await db.from("entities").select("entity_id, is_default").eq("tenant_id", tenant.id);
  if (eErr) throw new Error(`อ่าน entities: ${eErr.message}`);
  const others = (ents ?? []).filter((e) => e.entity_id !== defaultEntity);
  if (others.length) problems.push(`มีกิจการอื่นนอกจาก ${defaultEntity} อยู่แล้ว (${others.map((e) => e.entity_id).join(", ")}) — ไม่ใช่สภาพหลังรับลูกค้าใหม่`);
  if (!(ents ?? []).some((e) => e.entity_id === defaultEntity && e.is_default)) {
    problems.push(`กิจการหลักของลูกค้านี้ไม่ใช่ ${defaultEntity} — ตอนรับลูกค้าต้องตั้งรหัสกิจการแรกเป็น ${defaultEntity}`);
  }
  return { tenant, problems };
}

/**
 * ย้อนกลับเฉพาะของที่สคริปต์นี้ลง → กลับไปสภาพหลังรับลูกค้าใหม่พอดี
 * ★ EID01 ถูก "แก้" (ไม่ใช่สร้าง) → คืนชื่อเดิมไม่ได้ แต่ไม่จำเป็น (แก้ได้จากหน้าตั้งค่า · ลงซ้ำก็ทับใหม่)
 */
export async function wipeImported(db: SupabaseClient, tenant: string, defaultEntity: string, since: string | null) {
  for (const tb of [...INSERT_ORDER].reverse()) {
    let q = db.from(tb).delete().eq("tenant_id", tenant);
    if (tb === "entities") q = q.neq("entity_id", defaultEntity);
    if (tb === "app_settings") q = q.not("kind", "in", `(${PROVISION_SETTING_KINDS.join(",")})`);
    const { error } = await q;
    if (error) throw new Error(`ย้อนกลับ ${tb}: ${error.message}`);
  }
  // ตัวนับเลขที่สคริปต์ตั้ง (provisioning ไม่ได้ตั้งตัวไหนไว้)
  const { error: cErr } = await db.from("counters").delete().eq("tenant_id", tenant);
  if (cErr) throw new Error(`ย้อนกลับ counters: ${cErr.message}`);
  await cleanAudit(db, tenant, since);
}

/**
 * แถว audit ที่เกิดจากการ insert ของสคริปต์ (ไม่มีผู้ใช้ · ช่วงเวลาที่รัน) — ไม่ใช่ "การแก้ไข" ของใคร
 * ★ ปล่อยไว้ = หน้า ตั้งค่า → ประวัติการแก้ไข จมด้วยแถว "เพิ่ม" นับพันที่ไม่มีใครทำ
 */
async function cleanAudit(db: SupabaseClient, tenant: string, since: string | null) {
  if (!since) return;
  const { error } = await db.from("edit_log").delete()
    .eq("tenant_id", tenant).is("user_id", null).gte("created_at", since);
  if (error) throw new Error(`ลบแถว audit ของการย้าย: ${error.message}`);
}

async function insertAll(db: SupabaseClient, table: string, rows: Rec[], batch = 300) {
  for (let i = 0; i < rows.length; i += batch) {
    const { error } = await db.from(table).insert(rows.slice(i, i + batch));
    if (error) throw new Error(`ลง ${table} (แถว ${i + 1}-${Math.min(i + batch, rows.length)}): ${error.message}`);
  }
}

export type ApplyInput = {
  tenantId: string;
  defaultEntity: string;
  tables: Record<ImportTable, Rec[]>;
  counters: { key: string; value: number }[];
};

/**
 * ลงทั้งชุด — ล้มที่ตารางไหน = ย้อนกลับทั้งหมดเอง (ไม่ปล่อยข้อมูลครึ่ง ๆ กลาง ๆ ไว้ในลูกค้าจริง)
 * คืนจำนวนแถวที่อ่านกลับมาได้จริงต่อตาราง (ใช้ยืนยันว่าลงครบ ไม่ใช่เชื่อว่า insert ไม่ error = ครบ)
 */
export async function applyAim(db: SupabaseClient, inp: ApplyInput, log: (s: string) => void) {
  const T = inp.tenantId;
  // ถอยเผื่อนาฬิกาเครื่องกับ DB ไม่ตรงกัน 5 นาที — ช่วงที่กินเกินมามีแต่แถว audit ของ provisioning (ไม่มีผู้ใช้เหมือนกัน)
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const stamp = (rows: Rec[]): Rec[] => rows.map((r) => ({ ...r, tenant_id: T }));
  // 🪤 ค่าปริยาย my_default_entity() อ่านจาก JWT → service role ได้ null แล้วชน not null
  //    (contacts ไม่แยกตามกิจการใน RLS — ใช้ร่วมทั้ง tenant · ผูกกิจการหลักเหมือนที่แอปทำให้ผู้ใช้ main)
  const withEntity = (tb: string, rows: Rec[]): Rec[] =>
    ENTITY_DEFAULT_TABLES.has(tb) ? rows.map((r) => (r.entity_id ? r : { ...r, entity_id: inp.defaultEntity })) : rows;
  try {
    for (const tb of INSERT_ORDER) {
      const rows = withEntity(tb, stamp(inp.tables[tb] ?? []));
      if (tb === "entities") {
        // EID01 มีอยู่แล้วจาก provisioning → แก้ · ที่เหลือ insert
        const def = rows.find((r) => r.entity_id === inp.defaultEntity);
        if (def) {
          const { tenant_id: _t, entity_id: _e, ...patch } = def;
          void _t; void _e;
          const { error } = await db.from("entities").update(patch).eq("tenant_id", T).eq("entity_id", inp.defaultEntity);
          if (error) throw new Error(`แก้กิจการ ${inp.defaultEntity}: ${error.message}`);
        }
        await insertAll(db, tb, rows.filter((r) => r.entity_id !== inp.defaultEntity));
      } else {
        await insertAll(db, tb, rows);
      }
      log(`  ✓ ${tb.padEnd(18)} ${rows.length}`);
    }
    if (inp.counters.length) {
      const { error } = await db.from("counters").upsert(stamp(inp.counters as unknown as Rec[]), { onConflict: "tenant_id,key" });
      if (error) throw new Error(`ตั้งตัวนับเลข: ${error.message}`);
      log(`  ✓ ${"counters".padEnd(18)} ${inp.counters.length}`);
    }
    await cleanAudit(db, T, since);
  } catch (e) {
    log(`\n❌ ${(e as Error).message}\n   ↩️ กำลังย้อนกลับทุกอย่างที่ลงไปในรอบนี้…`);
    await wipeImported(db, T, inp.defaultEntity, since);
    log("   ↩️ ย้อนกลับเสร็จ — ลูกค้ากลับไปสภาพหลังรับลูกค้าใหม่ (ลงใหม่ได้หลังแก้สาเหตุ)");
    throw e;
  }

  const got: Record<string, number> = {};
  for (const tb of INSERT_ORDER) got[tb] = await count(db, tb, T);
  return got;
}
