import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toRole, can, type Role } from "@/lib/shared/roles";
import { hasModule } from "@/lib/shared/workspaces";

/**
 * ตัวตนของผู้ที่เรียก /api/mcp (D141)
 *
 * 🚨 ใช้ anon key + token ของผู้ใช้เท่านั้น — **ไม่มี service role** ⇒ RLS ทุกตัวทำงานเหมือนผู้ใช้
 *    คนนั้นเปิดแอปเอง · tenant มาจาก `my_tenant()` (profiles ของ auth.uid()) ไม่ได้รับจากคำขอ
 * ★ ถามใหม่ทุกคำขอ (stateless) — ถอนสิทธิ์ / ระงับลูกค้า / เปลี่ยนบทบาท มีผลทันที
 */
export type ConnectorMe = {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  tenantSlug: string;
  tenantName: string;
  /** tenants.modules_enabled (ว่าง = เปิดหมด · hasModule) */
  modules: string[] | null;
  entities: { entity_id: string; name: string; is_vat: boolean }[];
};

export type AuthResult =
  | { ok: true; me: ConnectorMe; db: SupabaseClient }
  /** 401 = ให้ Claude ไปล็อกอินใหม่ · 403 = ล็อกอินได้แต่ไม่มีสิทธิ์ (ล็อกอินใหม่ไม่ช่วย) */
  | { ok: false; status: 401 | 403; message: string };

/** client ที่ทำงานในนามเจ้าของ token */
export function tokenClient(token: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/+$/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    },
  );
}

export async function authenticate(token: string): Promise<AuthResult> {
  const db = tokenClient(token);
  const { data: u, error: ue } = await db.auth.getUser(token);
  if (ue || !u.user) return { ok: false, status: 401, message: "token หมดอายุหรือใช้ไม่ได้ — เชื่อมต่อ connector ใหม่" };

  // 🚨 อ่านไม่ได้ ≠ ไม่อนุญาต ≠ อนุญาต — ตอบ 403 (ปิดตาย) ไม่ใช่ปล่อยผ่าน
  const allowed = await db.rpc("connector_allowed");
  if (allowed.error) return { ok: false, status: 403, message: "ตรวจสิทธิ์ connector ไม่สำเร็จ — ลองใหม่อีกครั้ง" };
  if (allowed.data !== true) {
    return {
      ok: false,
      status: 403,
      message:
        "บัญชีนี้ยังไม่ได้รับอนุญาตให้ใช้ Claude connector (หรือกิจการถูกระงับ / ยังไม่ได้ตั้งรหัสผ่านใหม่) — " +
        "ให้ผู้ดูแลระบบเปิดสิทธิ์ที่หน้า /platform แท็บ Claude connector",
    };
  }

  const [prof, ten, ents] = await Promise.all([
    db.from("profiles").select("username, display_name, role").eq("id", u.user.id).maybeSingle(),
    db.from("tenants").select("slug, name, brand_name, modules_enabled").maybeSingle(),
    db.from("entities").select("entity_id, name, is_vat").order("entity_id"),
  ]);
  if (prof.error || ten.error || ents.error || !prof.data || !ten.data) {
    return { ok: false, status: 403, message: "อ่านข้อมูลผู้ใช้/กิจการไม่สำเร็จ — ลองใหม่อีกครั้ง" };
  }

  const role = toRole(prof.data.role as string);
  if (!can(role, "acct.write")) {
    return { ok: false, status: 403, message: `บทบาท ${role} บันทึกบิลบัญชีไม่ได้ — ต้องมีสิทธิ์เขียนบัญชี (เช่น accounting / accounting_manager / main)` };
  }
  // ★ ธงโมดูล fail-open ตามกติกาเดิม (hasModule ค่าว่าง = เปิดหมด · D53)
  if (!hasModule(ten.data.modules_enabled as string[] | null, "accounting")) {
    return { ok: false, status: 403, message: "กิจการนี้ไม่ได้ใช้โมดูลบัญชี — บันทึกบิลผ่าน Claude ไม่ได้" };
  }

  return {
    ok: true,
    db,
    me: {
      userId: u.user.id,
      username: String(prof.data.username ?? ""),
      displayName: String(prof.data.display_name ?? prof.data.username ?? ""),
      role,
      tenantSlug: String(ten.data.slug),
      tenantName: String(ten.data.brand_name || ten.data.name),
      modules: (ten.data.modules_enabled as string[] | null) ?? null,
      entities: (ents.data ?? []).map((e) => ({
        entity_id: String(e.entity_id),
        name: String(e.name ?? ""),
        // is_vat null = จด VAT (ค่าปริยายเดียวกับ entity_is_vat ใน 0036)
        is_vat: e.is_vat !== false,
      })),
    },
  };
}
