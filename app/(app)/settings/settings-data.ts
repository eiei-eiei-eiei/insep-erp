import "server-only";
import { createClient } from "@/lib/supabase/server";
import { brandingFromSettings, type Branding } from "@/lib/shared/branding";

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
}> {
  const supabase = await createClient();
  const [entities, settings] = await Promise.all([
    supabase
      .from("entities")
      .select("entity_id, name, excise_id, is_vat, name_eng, tax_id, branch, address, phone, bank_line")
      .order("entity_id"),
    supabase.from("app_settings").select("kind, value").in("kind", ["sales_doc_entity", "sales_revenue_entity"]),
  ]);
  const byKind = (k: string) => (settings.data ?? []).filter((x) => x.kind === k).map((x) => x.value as string);
  return {
    entities: (entities.data ?? []) as SettingsEntity[],
    // ยังไม่ตั้ง → ใช้กิจการที่รับรายได้ขายเป็นค่าตั้งต้น (D44)
    docEntityId: byKind("sales_doc_entity")[0] ?? byKind("sales_revenue_entity")[0] ?? "",
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
