import "server-only";
import { createClient } from "@/lib/supabase/server";
import { brandingFromSettings, type Branding } from "@/lib/shared/branding";
import type { EditLogRow } from "@/lib/shared/editLog";

/**
 * ข้อมูลของหน้าตั้งค่ากลาง (/settings)
 *
 * ★ ทำไมไม่ดึงจาก accounting/data.ts `getBootstrap()` เหมือนเดิม:
 *   การ์ดพวกนี้เคยอยู่ในแท็บตั้งค่าของ **แอปบัญชี** ซึ่งถูก `requireModule("accounting")` กั้น
 *   → ลูกค้าที่ซื้อแค่โมดูลผลิต ตั้งชื่อ/สีแบรนด์ หรือเลขสรรพสามิตของตัวเองไม่ได้เลย
 *   ทั้งที่แบรนด์ใช้ทั้งแอปและ LINE ใช้ฝั่งขาย → ย้ายมาเป็นหน้ากลางที่ไม่ผูกกับโมดูลใด (D63)
 */

export type SettingsEntity = {
  entity_id: string;
  name: string;
  excise_id: string | null;
  sso_employer_no: string | null;
  is_vat: boolean;
  name_eng: string | null;
  tax_id: string | null;
  branch: string | null;
  address: string | null;
  phone: string | null;
  bank_line: string | null;
};

/** กิจการ + กิจการที่ใช้ออกเอกสารการค้า (คิวรีชุดเดียวกับที่ getBootstrap เคยใช้) */
export async function getCompanySettings(): Promise<{
  entities: SettingsEntity[];
  docEntityId: string;
  /** กิจการ + บัญชีที่รับรายได้ขาย (D80) — เดิมไม่มีหน้าจอตั้งเลย ต้องยิง SQL เอง */
  revenueEntityId: string;
  revenueAccountName: string;
  accounts: string[];
}> {
  const supabase = await createClient();
  const [entities, settings, accounts] = await Promise.all([
    supabase
      .from("entities")
      .select("entity_id, name, excise_id, sso_employer_no, is_vat, name_eng, tax_id, branch, address, phone, bank_line")
      .order("entity_id"),
    supabase
      .from("app_settings")
      .select("kind, value")
      .in("kind", ["sales_doc_entity", "sales_revenue_entity", "sales_revenue_account"]),
    supabase.from("bank_accounts").select("account_name").order("account_name"),
  ]);
  const byKind = (k: string) => (settings.data ?? []).filter((x) => x.kind === k).map((x) => x.value as string);
  return {
    entities: (entities.data ?? []) as SettingsEntity[],
    // ยังไม่ตั้ง → ใช้กิจการที่รับรายได้ขายเป็นค่าตั้งต้น (D44)
    docEntityId: byKind("sales_doc_entity")[0] ?? byKind("sales_revenue_entity")[0] ?? "",
    revenueEntityId: byKind("sales_revenue_entity")[0] ?? "",
    revenueAccountName: byKind("sales_revenue_account")[0] ?? "",
    accounts: (accounts.data ?? []).map((a) => a.account_name as string),
  };
}

/** แบรนด์ของกิจการ (ชื่อ/สี/โลโก้/โหมดเริ่มต้น) */
export async function getBrandingSettings(): Promise<Branding> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("kind, value")
    .in("kind", ["brand_name", "brand_color", "logo_url", "default_mode"]);
  return brandingFromSettings(data as { kind: string; value: string }[]);
}

/**
 * แจ้งเตือน LINE ต่อกิจการ (0033)
 * ★ ไม่ส่งโทเคนเต็มกลับหน้าจอ — ส่งแค่ "ตั้งค่าแล้วหรือยัง" + 4 ตัวท้ายไว้ยืนยันด้วยตา
 *   (role ที่ไม่ใช่ main จะได้ค่าว่างจาก RLS เองอยู่แล้ว)
 */
export async function getLineSettings(): Promise<{ hasToken: boolean; tokenTail: string; groupId: string }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("kind, value")
    .in("kind", ["line_channel_token", "line_group_id"]);
  const byKind = (k: string) => (data ?? []).filter((x) => x.kind === k).map((x) => x.value as string);
  return {
    hasToken: byKind("line_channel_token").length > 0,
    tokenTail: (byKind("line_channel_token")[0] ?? "").slice(-4),
    groupId: byKind("line_group_id")[0] ?? "",
  };
}

/**
 * ประวัติการแก้ไข (`edit_log`) — หน้า ตั้งค่า → ประวัติการแก้ไข (D80)
 *
 * 🚨 ก่อนหน้านี้ `edit_log` **ไม่มีทางเปิดดูจากแอปเลยแม้แต่หน้าเดียว** ทั้งที่หน้าแก้บิลเขียนบอกผู้ใช้
 *    ว่า "การแก้จะถูกบันทึกใน edit_log" = บอกว่าบันทึกไว้ แต่ไม่มีที่ให้ดู (ตระกูล D74/D77)
 *
 * ★ สิทธิ์บังคับที่ RLS: policy `edit_log_sel` เปิดให้ role main และกรอง tenant ให้แล้ว (0028)
 *   ไม่ต้องเช็คซ้ำที่นี่ · layout ของ /settings กัน role ไว้อีกชั้นอยู่แล้ว
 *
 * ★ ไม่ใช้ fetchAllRows โดยตั้งใจ — log โตไม่มีเพดาน ดึงทั้งก้อนคือทางไปสู่หน้าค้าง
 *   ดึงเฉพาะหน้าล่าสุดตามตัวกรอง แล้วบอกยอดรวมด้วย count ให้ผู้ใช้รู้ว่ายังมีเก่ากว่านี้อีก
 */
export type EditHistoryFilter = {
  table?: string;
  action?: string;
  q?: string;
  /** ย้อนหลังกี่วัน (0 = ไม่จำกัด) */
  days?: number;
  limit?: number;
};

export async function getEditHistory(f: EditHistoryFilter = {}): Promise<{
  rows: EditLogRow[];
  total: number;
  limit: number;
}> {
  const supabase = await createClient();
  const limit = f.limit ?? 200;

  let q = supabase
    .from("edit_log")
    .select("id, table_name, row_pk, action, before, after, user_id, created_at", { count: "exact" })
    .order("id", { ascending: false })
    .limit(limit);

  if (f.table) q = q.eq("table_name", f.table);
  if (f.action) q = q.eq("action", f.action);
  if (f.q?.trim()) q = q.ilike("row_pk", `%${f.q.trim()}%`);
  if (f.days && f.days > 0) {
    const since = new Date(Date.now() - f.days * 86400_000).toISOString();
    q = q.gte("created_at", since);
  }

  const [{ data, count }, profiles] = await Promise.all([
    q,
    supabase.from("profiles").select("id, display_name, username"),
  ]);

  // ใครแก้ — user_id เป็น uuid ที่ผู้ใช้อ่านไม่รู้เรื่อง ต้องแปลงเป็นชื่อคน
  const nameOf = new Map(
    (profiles.data ?? []).map((p: { id: string; display_name: string | null; username: string | null }) => [
      p.id,
      p.display_name || p.username || "",
    ]),
  );

  return {
    limit,
    total: count ?? 0,
    rows: (data ?? []).map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      tableName: String(r.table_name),
      rowPk: String(r.row_pk ?? ""),
      action: String(r.action) as EditLogRow["action"],
      before: (r.before ?? null) as Record<string, unknown> | null,
      after: (r.after ?? null) as Record<string, unknown> | null,
      userId: (r.user_id as string) ?? null,
      // ระบบเขียนเอง (RPC/สคริปต์) จะไม่มี user_id — บอกตรง ๆ ดีกว่าปล่อยว่าง
      userName: nameOf.get(r.user_id as string) || (r.user_id ? "(ผู้ใช้ที่ถูกลบแล้ว)" : "ระบบ"),
      createdAt: String(r.created_at),
    })),
  };
}
