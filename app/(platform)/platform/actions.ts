"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import {
  addEntityToTenant,
  createTenant,
  logPlatformAction,
  resetUserPassword,
  validateModules,
  validateQuota,
  type NewTenantInput,
} from "@/lib/platform/provision";

/**
 * Server action ของแอปจัดการหลังบ้าน — ทุกตัวใช้ service role (ข้ามทุก tenant)
 *
 * 🚨 ทุก action **ต้องขึ้นต้นด้วย requirePlatformAdmin()** — action ถูกเรียกตรงจากเบราว์เซอร์ได้
 *    ด่านที่ middleware/layout ทำไว้ไม่ครอบถึงตรงนี้
 * 🚨 รหัสผ่านชั่วคราวคืนออกไปทาง `data` เท่านั้น (แสดงบนจอครั้งเดียว)
 *    ห้ามเก็บลง DB / audit log ทุกกรณี — requirement ข้อ 3 เฟส 1
 */

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

function guard<T, A extends unknown[]>(fn: (...args: A) => Promise<ActionResult<T>>) {
  return async (...args: A): Promise<ActionResult<T>> => {
    try {
      return await fn(...args);
    } catch (e) {
      // NEXT_REDIRECT / NEXT_NOT_FOUND ของ Next ต้องโยนต่อ ไม่งั้นด่านสิทธิ์กลายเป็นข้อความ error
      if (e && typeof e === "object" && "digest" in e && typeof e.digest === "string" && e.digest.startsWith("NEXT_")) {
        throw e;
      }
      return { ok: false, error: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" };
    }
  };
}

const refresh = () => revalidatePath("/platform");

/** รับลูกค้าใหม่ — คืนชื่อผู้ใช้ + รหัสชั่วคราวให้หน้าจอแสดงครั้งเดียว */
export const createTenantAction = guard(
  async (input: NewTenantInput): Promise<ActionResult<{ username: string; password: string }>> => {
    const { adminId, db } = await requirePlatformAdmin();
    const { username, password } = await createTenant(db, input);

    await logPlatformAction(db, {
      actor: adminId,
      action: "create_tenant",
      tenantSlug: input.slug.trim().toLowerCase(),
      detail: { modules: input.modules, max_entities: input.maxEntities, entity_id: input.entityId },
    });

    refresh();
    return { ok: true, data: { username, password } };
  },
);

/** เปิด/ปิดโมดูลตามแพ็กเกจที่ลูกค้าซื้อ */
export const setModulesAction = guard(
  async (input: { tenantId: string; slug: string; modules: string[] }): Promise<ActionResult> => {
    const { adminId, db } = await requirePlatformAdmin();
    const bad = validateModules(input.modules);
    if (bad) return { ok: false, error: bad };

    const { error } = await db
      .from("tenants")
      .update({ modules_enabled: input.modules })
      .eq("id", input.tenantId);
    if (error) return { ok: false, error: error.message };

    await logPlatformAction(db, {
      actor: adminId,
      action: "set_modules",
      tenantSlug: input.slug,
      detail: { modules: input.modules },
    });

    refresh();
    return { ok: true };
  },
);

/**
 * ขยาย/ลดโควตากิจการ — **แยกจากปุ่ม "เพิ่มกิจการ" โดยตั้งใจ** (D53)
 * การอนุมัติว่าลูกค้าจ่ายค่า add-on แล้ว กับการสร้างกิจการ ต้องเป็นคนละการตัดสินใจ
 */
export const setQuotaAction = guard(
  async (input: { tenantId: string; slug: string; maxEntities: number }): Promise<ActionResult> => {
    const { adminId, db } = await requirePlatformAdmin();

    const { count, error: cErr } = await db
      .from("entities")
      .select("entity_id", { count: "exact", head: true })
      .eq("tenant_id", input.tenantId);
    if (cErr) return { ok: false, error: cErr.message };

    const bad = validateQuota(input.maxEntities, count ?? 0);
    if (bad) return { ok: false, error: bad };

    const { error } = await db
      .from("tenants")
      .update({ max_entities: input.maxEntities })
      .eq("id", input.tenantId);
    if (error) return { ok: false, error: error.message };

    await logPlatformAction(db, {
      actor: adminId,
      action: "set_quota",
      tenantSlug: input.slug,
      detail: { max_entities: input.maxEntities },
    });

    refresh();
    return { ok: true };
  },
);

/** เพิ่มกิจการ (add-on) — ด่านโควตาอยู่ใน addEntityToTenant() */
export const addEntityAction = guard(
  async (input: {
    tenantId: string;
    slug: string;
    entityId: string;
    name: string;
    isVat: boolean;
  }): Promise<ActionResult> => {
    const { adminId, db } = await requirePlatformAdmin();
    await addEntityToTenant(db, input.tenantId, {
      entityId: input.entityId,
      name: input.name,
      isVat: input.isVat,
    });

    await logPlatformAction(db, {
      actor: adminId,
      action: "add_entity",
      tenantSlug: input.slug,
      detail: { entity_id: input.entityId.trim().toUpperCase(), is_vat: input.isVat },
    });

    refresh();
    return { ok: true };
  },
);

/**
 * รีเซ็ตรหัสผ่านผู้ใช้ของลูกค้า — งานที่ "ยังไม่มีวิธีที่ทดสอบแล้ว" ก่อนหน้านี้
 * (อีเมลเป็นของปลอม @insep.local → ปุ่มส่งอีเมลรีเซ็ตของ Supabase ใช้ไม่ได้)
 *
 * 🚨 ต้องยืนยันว่า user คนนี้อยู่ในลูกค้ารายที่ส่งมาจริง — service role ข้าม RLS
 *    ถ้าไม่เช็ค คนที่ยิง action ตรงพร้อม uuid มั่ว ๆ จะรีเซ็ตรหัสใครก็ได้ในระบบ
 */
export const resetPasswordAction = guard(
  async (input: {
    tenantId: string;
    slug: string;
    userId: string;
  }): Promise<ActionResult<{ username: string; password: string }>> => {
    const { adminId, db } = await requirePlatformAdmin();

    const { data: profile } = await db
      .from("profiles")
      .select("id, username")
      .eq("id", input.userId)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    if (!profile) return { ok: false, error: "ไม่พบผู้ใช้คนนี้ในลูกค้ารายที่เลือก" };

    const password = await resetUserPassword(db, input.userId);

    await logPlatformAction(db, {
      actor: adminId,
      action: "reset_password",
      tenantSlug: input.slug,
      detail: { username: profile.username }, // ⛔ ห้ามใส่ password
    });

    refresh();
    return { ok: true, data: { username: (profile.username as string) ?? "", password } };
  },
);
