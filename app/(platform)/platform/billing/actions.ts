"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { logPlatformAction } from "@/lib/platform/provision";
import {
  recordPayment,
  saveSubscription,
  setTenantActive,
  voidLastPayment,
  type SubscriptionInput,
} from "@/lib/platform/billing-db";

/**
 * Server action ของหน้าค่างวด
 *
 * 🚨 ทุกตัว**ต้องขึ้นต้นด้วย `requirePlatformAdmin()`** — action ถูกเรียกตรงจากเบราว์เซอร์ได้
 *    ด่านที่ middleware/layout ทำไว้ไม่ครอบถึงตรงนี้
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

const refresh = () => revalidatePath("/platform/billing");

/** สร้าง/แก้ค่างวด — วันครบกำหนดคำนวณให้เอง (UI ส่งมาไม่ได้) */
export const saveSubscriptionAction = guard(
  async (input: { tenantId: string; slug: string } & SubscriptionInput): Promise<ActionResult> => {
    const { adminId, db } = await requirePlatformAdmin();
    const { tenantId, slug, ...sub } = input;
    await saveSubscription(db, tenantId, sub);

    await logPlatformAction(db, {
      actor: adminId,
      action: "save_subscription",
      tenantSlug: slug,
      detail: { plan: sub.plan, price: sub.price, cycle: sub.cycle, status: sub.status },
    });

    refresh();
    return { ok: true };
  },
);

/** บันทึกว่าจ่ายแล้ว 1 รอบ — คืนวันครบกำหนดใหม่ให้หน้าจอยืนยันกับคนกด */
export const recordPaymentAction = guard(
  async (input: {
    tenantId: string;
    slug: string;
    amount: number;
    paidOn: string;
    note: string | null;
  }): Promise<ActionResult<{ periodEndAfter: string }>> => {
    const { adminId, db } = await requirePlatformAdmin();
    const { periodEndAfter } = await recordPayment(db, input.tenantId, {
      amount: input.amount,
      paidOn: input.paidOn,
      note: input.note,
      actor: adminId,
    });

    await logPlatformAction(db, {
      actor: adminId,
      action: "record_payment",
      tenantSlug: input.slug,
      detail: { amount: input.amount, paid_on: input.paidOn, period_end_after: periodEndAfter },
    });

    refresh();
    return { ok: true, data: { periodEndAfter } };
  },
);

/** ย้อนรายการจ่ายล่าสุด (คีย์ผิด/บันทึกซ้ำ) */
export const voidPaymentAction = guard(
  async (input: { tenantId: string; slug: string }): Promise<ActionResult<{ periodEndAfter: string }>> => {
    const { adminId, db } = await requirePlatformAdmin();
    const { periodEndAfter } = await voidLastPayment(db, input.tenantId);

    await logPlatformAction(db, {
      actor: adminId,
      action: "void_payment",
      tenantSlug: input.slug,
      detail: { period_end_after: periodEndAfter },
    });

    refresh();
    return { ok: true, data: { periodEndAfter } };
  },
);

/**
 * ระงับ / คืนสิทธิ์การใช้งาน
 * ★ บังคับที่ `app/(app)/layout.tsx` ไม่ใช่ RLS — เหตุผลเต็มใน lib/platform/billing-db.ts
 */
export const setActiveAction = guard(
  async (input: { tenantId: string; slug: string; active: boolean }): Promise<ActionResult> => {
    const { adminId, db } = await requirePlatformAdmin();
    await setTenantActive(db, input.tenantId, input.active);

    await logPlatformAction(db, {
      actor: adminId,
      action: input.active ? "resume_tenant" : "suspend_tenant",
      tenantSlug: input.slug,
    });

    // ระงับแล้วรายชื่อลูกค้าหน้าแรกก็เปลี่ยนสถานะด้วย
    revalidatePath("/platform");
    refresh();
    return { ok: true };
  },
);
