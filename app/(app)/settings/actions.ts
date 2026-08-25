"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mapDbError } from "@/lib/shared/dbError";

/**
 * server action ของหน้าตั้งค่ากลาง — ย้ายมาจาก accounting/actions.ts (D63)
 * สิทธิ์บังคับที่ RLS ทั้งหมด (`app_settings_w` / `entities_upd` = main เท่านั้น)
 * ไม่ต้องเช็คซ้ำในนี้ — ซ่อน UI อย่างเดียวกันไม่อยู่ (anon key เป็นค่าสาธารณะ)
 */

export type SaveResult = { ok: boolean; error?: string; data?: unknown };
function fail(error: string): SaveResult {
  return { ok: false, error };
}

/** ตั้งค่าแบรนด์ของกิจการ (D43) — upsert ทีละ kind (app_settings เก็บ 1 แถวต่อ kind) */
export async function saveBrandingAction(input: {
  name: string;
  color: string;
  logoUrl: string;
  defaultMode: string;
}): Promise<SaveResult> {
  const supabase = await createClient();
  const pairs: [string, string][] = [
    ["brand_name", input.name],
    ["brand_color", input.color],
    ["default_mode", input.defaultMode],
    ["logo_url", input.logoUrl],
  ];
  for (const [kind, value] of pairs) {
    await supabase.from("app_settings").delete().eq("kind", kind);
    if (!value) continue; // ค่าว่าง (เช่นไม่ใส่โลโก้) = ไม่ต้องเก็บแถว
    const { error } = await supabase.from("app_settings").insert({ kind, value });
    if (error) return fail(mapDbError(error));
  }
  revalidatePath("/", "layout"); // แถบเมนูอยู่ใน layout — ต้อง revalidate ทั้ง layout
  return { ok: true };
}

/**
 * ข้อมูลกิจการที่ขึ้นหัวเอกสาร (D44) + **เลขทะเบียนสรรพสามิต** (ใหม่)
 *
 * 🪤 แยกจาก `saveDocEntityAction` โดยตั้งใจ — ของเดิมใช้ dropdown ตัวเดียวเป็นทั้ง
 *    "กำลังแก้กิจการไหน" และ "กิจการไหนออกเอกสารการค้า" → พอมีเหตุให้เข้าไปแก้กิจการที่ 2
 *    (เช่นกรอกเลขสรรพสามิตของโรงที่สอง) การกดบันทึกจะย้ายกิจการที่ออกใบกำกับภาษีไปด้วย
 *    **เงียบ ๆ ไม่มีอะไรฟ้อง** = ออกใบกำกับในนามนิติบุคคลผิด
 *
 * ★ `exciseId` เก็บตามที่พิมพ์ ไม่ strip ขีด — เลขจริงมีรูปแบบ 0605567002178-1-001
 *   และ lib/pdf/excise ทำ replace(/\D/g,"") เองตอนวาดลงช่องอยู่แล้ว
 * ★ ไม่มี `is_vat` ที่นี่โดยตั้งใจ — การจด VAT เป็นข้อเท็จจริงทางกฎหมายที่ trigger ฝั่ง DB
 *   ใช้ตัดสินว่าออกใบกำกับภาษีได้ไหม (D55) ต้องให้เจ้าของระบบตั้งผ่านสคริปต์เท่านั้น
 */
export async function saveEntityInfoAction(input: {
  entityId: string;
  name: string;
  nameEng: string;
  taxId: string;
  branch: string;
  address: string;
  phone: string;
  bankLine: string;
  exciseId: string;
  ssoEmployerNo: string;
}): Promise<SaveResult> {
  const supabase = await createClient();
  const entityId = input.entityId.trim();
  if (!entityId) return fail("เลือกกิจการก่อน");
  if (!input.name.trim()) return fail("กรอกชื่อกิจการ (ขึ้นหัวเอกสาร)");

  const { error } = await supabase
    .from("entities")
    .update({
      name: input.name.trim(),
      name_eng: input.nameEng.trim() || null,
      tax_id: input.taxId.trim() || null,
      branch: input.branch.trim() || null,
      address: input.address.trim() || null,
      phone: input.phone.trim() || null,
      bank_line: input.bankLine.trim() || null,
      excise_id: input.exciseId.trim() || null,
      sso_employer_no: input.ssoEmployerNo.trim() || null,
    })
    .eq("entity_id", entityId);
  if (error) return fail(mapDbError(error));

  revalidatePath("/settings/company");
  revalidatePath("/accounting");
  revalidatePath("/sales");
  revalidatePath("/production");
  revalidatePath("/payroll");
  return { ok: true };
}

/** กิจการที่ใช้ออกเอกสารการค้า (app_settings.sales_doc_entity) — 1 แถวต่อ kind */
export async function saveDocEntityAction(entityId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const id = entityId.trim();
  if (!id) return fail("เลือกกิจการที่ใช้ออกเอกสารก่อน");

  await supabase.from("app_settings").delete().eq("kind", "sales_doc_entity");
  const { error } = await supabase.from("app_settings").insert({ kind: "sales_doc_entity", value: id });
  if (error) return fail(mapDbError(error));

  revalidatePath("/settings/company");
  revalidatePath("/sales");
  return { ok: true };
}

/**
 * กิจการ + บัญชีเงินที่ **รับรายได้จากการขาย** (D80)
 *
 * 🚨 ก่อนหน้านี้ค่าคู่นี้ (`sales_revenue_entity` / `sales_revenue_account`) **ไม่มีที่ไหนเขียนเลย
 *    สักจุดในทั้งระบบ** — ตั้งได้ทางเดียวคือยิง SQL เอง · ผลคือลูกค้าใหม่กด "รับมัดจำ & ส่งคลัง"
 *    แล้วตัน ปิดการขายใบแรกไม่ได้เลย และข้อความ error ยังชี้ให้ไปเปิดไฟล์เอกสารแทนหน้าตั้งค่า
 *    (ตระกูล D74/D77: ฟีเจอร์ที่ไม่มีทางเข้าถึง = บั๊กที่ยังไม่ถูกนับ)
 *
 * 🪤 **แยกจาก `saveDocEntityAction` โดยตั้งใจ** ด้วยเหตุผลเดียวกับ D63 —
 *    "กิจการที่ออกเอกสาร" กับ "กิจการที่รับเงิน" เป็นคนละเรื่องและตั้งต่างกันได้
 *    รวมเป็นดร็อปดาวน์เดียวเมื่อไหร่ = แก้อันหนึ่งแล้วอีกอันย้ายตามเงียบ ๆ
 *
 * ★ ชื่อบัญชีต้องตรงกับ `bank_accounts.account_name` เป๊ะ (ฝั่งขายเอาไปเขียนลง
 *   `transactions.account_name` ตรง ๆ) → หน้าจอให้เลือกจากดร็อปดาวน์ ไม่ให้พิมพ์เอง
 */
export async function saveSalesRevenueAction(input: {
  entityId: string;
  accountName: string;
}): Promise<SaveResult> {
  const supabase = await createClient();
  const entityId = input.entityId.trim();
  const accountName = input.accountName.trim();
  if (!entityId) return fail("เลือกกิจการที่รับรายได้ก่อน");
  if (!accountName) return fail("เลือกบัญชีที่เงินเข้าก่อน");

  for (const [kind, value] of [
    ["sales_revenue_entity", entityId],
    ["sales_revenue_account", accountName],
  ] as [string, string][]) {
    await supabase.from("app_settings").delete().eq("kind", kind);
    const { error } = await supabase.from("app_settings").insert({ kind, value });
    if (error) return fail(mapDbError(error));
  }

  revalidatePath("/settings/company");
  revalidatePath("/sales");
  return { ok: true };
}

/**
 * แจ้งเตือน LINE ต่อกิจการ (0033) — ของเดิมอ่านจาก env ของ Vercel
 * → ลูกค้าทุกเจ้าใน deployment เดียวกันยิงเข้ากลุ่มเดียวกันหมด (เห็นออเดอร์กัน)
 *
 * ★ `token = null` แปลว่า "ไม่เปลี่ยนโทเคนเดิม" — หน้าจอไม่เคยได้ค่าเต็มกลับไป
 *   จึงส่งกลับมาไม่ได้ · ส่งสตริงว่างมาไม่ได้แปลว่าลบ (ใช้ปุ่มลบแยก)
 */
export async function saveLineAction(input: {
  token: string | null;
  groupId: string;
}): Promise<SaveResult> {
  const supabase = await createClient();
  const groupId = input.groupId.trim();
  const token = input.token?.trim() ?? null;

  await supabase.from("app_settings").delete().eq("kind", "line_group_id");
  if (groupId) {
    const { error } = await supabase.from("app_settings").insert({ kind: "line_group_id", value: groupId });
    if (error) return fail(mapDbError(error));
  }

  if (token !== null) {
    await supabase.from("app_settings").delete().eq("kind", "line_channel_token");
    if (token) {
      const { error } = await supabase.from("app_settings").insert({ kind: "line_channel_token", value: token });
      if (error) return fail(mapDbError(error));
    }
  }

  revalidatePath("/settings/notify");
  return { ok: true };
}

/** ปิดแจ้งเตือน LINE ของกิจการนี้ — ลบทั้งโทเคนและกลุ่ม */
export async function clearLineAction(): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .delete()
    .in("kind", ["line_channel_token", "line_group_id"]);
  if (error) return fail(mapDbError(error));
  revalidatePath("/settings/notify");
  return { ok: true };
}
