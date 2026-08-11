"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { takeSnapshot, restoreSnapshot, previewRestore } from "@/lib/snapshot/engine";

export type Res<T = unknown> = { ok: boolean; error?: string; data?: T };

const msg = (e: unknown) => (e instanceof Error ? e.message : "เกิดข้อผิดพลาด");

/**
 * ตรวจ caller = main จริง (ผ่าน session + RLS) + คืน email/username ไว้ re-auth
 * ★ คืน tenantId ด้วย — ทุก action ในไฟล์นี้ใช้ service role ที่ bypass RLS
 *   จึงต้องกรอง tenant ด้วยมือเอง DB ช่วยไม่ได้
 */
async function requireMainUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("ต้องเข้าสู่ระบบก่อน");
  const { data: profile } = await supabase
    .from("profiles").select("role, username, tenant_id").eq("id", user.id).single();
  if (profile?.role !== "main") throw new Error("เฉพาะเจ้าของกิจการ (main) เท่านั้นที่ใช้เมนูนี้ได้");
  if (!profile.tenant_id) throw new Error("บัญชีนี้ยังไม่ได้ผูกกับกิจการ (tenant) — ติดต่อผู้ดูแลระบบ");
  return {
    userId: user.id,
    email: user.email as string,
    username: profile.username as string,
    tenantId: profile.tenant_id as string,
  };
}

/** ยืนยันตัวตนด้วยรหัสผ่านอีกครั้ง (step-up) — เช็คฝั่ง server ด้วย throwaway client ไม่แตะ session เดิม */
async function verifyPassword(email: string, password: string) {
  if (!password) throw new Error("กรุณากรอกรหัสผ่านเพื่อยืนยัน");
  const raw = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await raw.auth.signInWithPassword({ email, password });
  if (error) throw new Error("รหัสผ่านไม่ถูกต้อง");
}

/** รายการ snapshot (ไม่โหลด payload) */
export async function listSnapshotsAction(): Promise<Res> {
  try {
    const me = await requireMainUser();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("snapshots")
      .select("id, name, created_at, created_by, is_auto, row_counts")
      .eq("tenant_id", me.tenantId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { ok: true, data };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

/** จับ snapshot สภาพปัจจุบัน (ต้องกรอกรหัส) */
export async function createSnapshotAction(name: string, password: string): Promise<Res> {
  try {
    const me = await requireMainUser();
    await verifyPassword(me.email, password);
    const clean = (name || "").trim() || `snapshot ${new Date().toLocaleString("th-TH")}`;
    const data = await takeSnapshot({ name: clean, createdBy: me.username, tenantId: me.tenantId });
    return { ok: true, data };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

/** preview ผลกระทบก่อน restore (ไม่ต้องรหัส — อ่านอย่างเดียว) */
export async function previewRestoreAction(id: number): Promise<Res> {
  try {
    const me = await requireMainUser();
    return { ok: true, data: await previewRestore(id, me.tenantId) };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

/** ย้อนข้อมูลกลับ (ต้องกรอกรหัส) — auto-snapshot สภาพปัจจุบันก่อนเสมอ */
export async function restoreSnapshotAction(id: number, password: string): Promise<Res> {
  try {
    const me = await requireMainUser();
    await verifyPassword(me.email, password);
    await takeSnapshot({
      name: `[auto] ก่อนย้อนกลับ #${id} · ${new Date().toLocaleString("th-TH")}`,
      createdBy: me.username,
      tenantId: me.tenantId,
      isAuto: true,
    });
    await restoreSnapshot(id, me.tenantId);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

/** ลบ snapshot (ต้องกรอกรหัส) */
export async function deleteSnapshotAction(id: number, password: string): Promise<Res> {
  try {
    const me = await requireMainUser();
    await verifyPassword(me.email, password);
    const admin = createAdminClient();
    const { error } = await admin.from("snapshots").delete().eq("id", id).eq("tenant_id", me.tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e) { return { ok: false, error: msg(e) }; }
}
