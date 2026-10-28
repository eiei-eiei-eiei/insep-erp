"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { logPlatformAction } from "@/lib/platform/provision";
import { grantConnector, revokeConnector } from "@/lib/platform/connector-db";

/**
 * Server action ของแท็บ Claude connector (D141)
 * 🚨 ทุกตัว**ต้องขึ้นต้นด้วย `requirePlatformAdmin()`** — action ถูกเรียกตรงจากเบราว์เซอร์ได้
 * ★ ทุกครั้งบันทึกลง platform_admin_log (ใครให้สิทธิ์ใคร เมื่อไร)
 */
export type ActionResult = { ok: boolean; error?: string };

function guard<A extends unknown[]>(fn: (...args: A) => Promise<ActionResult>) {
  return async (...args: A): Promise<ActionResult> => {
    try {
      return await fn(...args);
    } catch (e) {
      // NEXT_REDIRECT / NEXT_NOT_FOUND ต้องโยนต่อ ไม่งั้นด่านสิทธิ์กลายเป็นข้อความ error
      if (e && typeof e === "object" && "digest" in e && typeof e.digest === "string" && e.digest.startsWith("NEXT_")) throw e;
      return { ok: false, error: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" };
    }
  };
}

export const grantConnectorAction = guard(async (userId: string): Promise<ActionResult> => {
  const { adminId, db } = await requirePlatformAdmin();
  const r = await grantConnector(db, userId, adminId);
  await logPlatformAction(db, { actor: adminId, action: "grant_connector", tenantSlug: r.slug, detail: { user_id: userId, username: r.username } });
  revalidatePath("/platform/connector");
  return { ok: true };
});

export const revokeConnectorAction = guard(async (userId: string): Promise<ActionResult> => {
  const { adminId, db } = await requirePlatformAdmin();
  const r = await revokeConnector(db, userId);
  await logPlatformAction(db, { actor: adminId, action: "revoke_connector", tenantSlug: r.slug, detail: { user_id: userId, username: r.username } });
  revalidatePath("/platform/connector");
  return { ok: true };
});
