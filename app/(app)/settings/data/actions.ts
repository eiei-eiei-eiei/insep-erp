"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildEnvelope, EXPORT_TABLES, type ExportTenant } from "@/lib/export/tenantExport";
import { can, toRole } from "@/lib/shared/roles";

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
  if (!profile || !can(toRole(profile.role as string | null), "admin"))
    throw new Error("เฉพาะเจ้าของกิจการ (main) เท่านั้นที่ใช้เมนูนี้ได้");
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

/** limit ปริยายของ PostgREST — ต้องวนหน้า ไม่งั้นตารางใหญ่ขาดเงียบ ๆ (เหมือน scripts/backup-tables.ts) */
const PAGE = 1000;

export type ExportResult = {
  fileJson: string;
  counts: Record<string, number>;
  slug: string;
  name: string;
};

/**
 * ดาวน์โหลดข้อมูลของกิจการตัวเองทั้งก้อน (D82)
 *
 * 🚨 service role = bypass RLS → **ต้อง `.eq("tenant_id", …)` ทุกตาราง ห้ามลืมแม้แต่บรรทัดเดียว**
 *    ลืม 1 จุด = ลูกค้าเจ้าหนึ่งได้ข้อมูลของทุกเจ้าติดไปในไฟล์ที่ดาวน์โหลด
 *
 * 🪤 ต้องวน `.range()` — PostgREST คืนแค่ 1000 แถวแรกโดยไม่แจ้ง error
 *    ไฟล์สำรองที่ขาดแถวคือไฟล์ที่ **ดูเหมือนใช้ได้** จนถึงวันที่ต้องใช้จริง
 */
export async function exportTenantDataAction(password: string): Promise<Res<ExportResult>> {
  try {
    const me = await requireMainUser();
    await verifyPassword(me.email, password);
    const admin = createAdminClient();

    const { data: t, error: tErr } = await admin
      .from("tenants").select("id, slug, name").eq("id", me.tenantId).single();
    if (tErr || !t) throw new Error("ไม่พบข้อมูลกิจการ");
    const tenant: ExportTenant = { id: t.id as string, slug: t.slug as string, name: t.name as string };

    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const table of EXPORT_TABLES) {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from(table).select("*").eq("tenant_id", me.tenantId).range(from, from + PAGE - 1);
        if (error) throw new Error(`ดึงข้อมูล ${table}: ${error.message}`);
        rows.push(...((data ?? []) as Record<string, unknown>[]));
        if (!data || data.length < PAGE) break;
      }
      tables[table] = rows;
    }

    const envelope = buildEnvelope({ tenant, exportedBy: me.username, tables });
    return {
      ok: true,
      data: {
        fileJson: JSON.stringify(envelope, null, 1),
        counts: envelope.counts,
        slug: tenant.slug,
        name: tenant.name,
      },
    };
  } catch (e) { return { ok: false, error: msg(e) }; }
}
