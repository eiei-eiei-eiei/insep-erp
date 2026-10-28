import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { grantBlock } from "@/lib/connector/grant";

/**
 * ชั้นข้อมูลของแท็บ Claude connector ในหน้า /platform (D141)
 * 🚨 `db` คือ service role จาก requirePlatformAdmin() — ข้าม RLS ทุก tenant ของ DB ก้อนนี้
 *    ผู้เรียกทุกตัวต้องผ่าน requirePlatformAdmin() มาแล้ว
 */
export type ConnectorUserRow = {
  userId: string;
  username: string;
  displayName: string;
  role: string;
  mustChangePassword: boolean;
  allowed: boolean;
  allowedAt: string | null;
};

export type ConnectorTenantRow = {
  tenantId: string;
  slug: string;
  name: string;
  isActive: boolean;
  users: ConnectorUserRow[];
};

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`อ่าน${what}ไม่สำเร็จ: ${r.error.message}`);
  return (r.data ?? []) as T;
};

export async function listConnectorUsers(db: SupabaseClient): Promise<ConnectorTenantRow[]> {
  const [t, p, c] = await Promise.all([
    db.from("tenants").select("id, slug, name, is_active, is_platform").order("slug"),
    db.from("profiles").select("id, username, display_name, role, tenant_id, must_change_password").order("username"),
    db.from("connector_users").select("user_id, created_at"),
  ]);
  const tenants = must(t, "รายชื่อลูกค้า") as { id: string; slug: string; name: string; is_active: boolean; is_platform: boolean }[];
  const profiles = must(p, "รายชื่อผู้ใช้") as { id: string; username: string; display_name: string | null; role: string; tenant_id: string; must_change_password: boolean }[];
  const grants = new Map((must(c, "สิทธิ์ connector") as { user_id: string; created_at: string }[]).map((g) => [g.user_id, g.created_at]));

  return tenants
    .filter((x) => !x.is_platform)
    .map((x) => ({
      tenantId: x.id,
      slug: x.slug,
      name: x.name,
      isActive: x.is_active,
      users: profiles
        .filter((u) => u.tenant_id === x.id)
        .map((u) => ({
          userId: u.id,
          username: u.username,
          displayName: u.display_name ?? "",
          role: u.role,
          mustChangePassword: Boolean(u.must_change_password),
          allowed: grants.has(u.id),
          allowedAt: grants.get(u.id) ?? null,
        })),
    }));
}

/** อ่านผู้ใช้ 1 คน + ลูกค้าของเขา (ใช้ตัดสินก่อนให้สิทธิ์ · ไม่เชื่อค่าที่หน้าจอส่งมา) */
async function loadUser(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("profiles")
    .select("id, username, role, must_change_password, tenant_id, tenants(slug, is_active, is_platform)")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("อ่านผู้ใช้ไม่สำเร็จ: " + error.message);
  if (!data) throw new Error("ไม่พบผู้ใช้นี้แล้ว — รีเฟรชหน้า");
  const ten = (Array.isArray(data.tenants) ? data.tenants[0] : data.tenants) as { slug: string; is_active: boolean; is_platform: boolean } | null;
  return { ...data, tenant: ten };
}

export async function grantConnector(db: SupabaseClient, userId: string, adminId: string): Promise<{ username: string; slug: string }> {
  const u = await loadUser(db, userId);
  if (!u.tenant || u.tenant.is_platform) throw new Error("บัญชีของแพลตฟอร์มใช้ connector ไม่ได้");
  const block = grantBlock({ role: u.role, must_change_password: u.must_change_password }, u.tenant.is_active);
  if (block) throw new Error(block);
  const { error } = await db.from("connector_users").upsert({ user_id: userId, granted_by: adminId }, { onConflict: "user_id" });
  if (error) throw new Error("ให้สิทธิ์ไม่สำเร็จ: " + error.message);
  return { username: u.username, slug: u.tenant.slug };
}

export async function revokeConnector(db: SupabaseClient, userId: string): Promise<{ username: string; slug: string | null }> {
  const u = await loadUser(db, userId);
  const { error } = await db.from("connector_users").delete().eq("user_id", userId);
  if (error) throw new Error("ถอนสิทธิ์ไม่สำเร็จ: " + error.message);
  return { username: u.username, slug: u.tenant?.slug ?? null };
}
