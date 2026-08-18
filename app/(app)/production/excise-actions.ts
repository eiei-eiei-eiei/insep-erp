"use server";

import { createClient } from "@/lib/supabase/server";
import type { ExciseKind } from "@/lib/pdf/excise";
import { getExciseOptions, reportData } from "./excise-data";

/**
 * server action ของแท็บ "รายงานสรรพสามิต" ในแอปผลิต
 * (เดิมเป็น workspace แยก /reports — ยุบเข้ามาเป็นแท็บแล้ว ดู DECISIONS D62)
 *
 * ★ `getPdfAssetUrl` ไม่ได้อยู่ที่นี่ — ย้ายไป `app/(app)/actions.ts` เพราะฝั่งบัญชี (50ทวิ) ใช้ด้วย
 */

/** ตัวเลือกของแท็บ (กิจการ/วัตถุดิบ/สินค้า/ชื่อสุรา) — โหลดตอนเปิดแท็บ ไม่ใช่ตอนเปิดแอปผลิต */
export async function getExciseOptionsAction() {
  return getExciseOptions();
}

/** checklist "เดือนนี้สร้างรายงาน ภส. ครบยัง" (report_runs — FLOW sec 6) */
export async function getExciseReportRunsAction(month: string, entityId: string): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("report_runs")
    .select("report_key, created_at")
    .eq("month", month)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  const out: Record<string, string> = {};
  for (const r of data ?? []) {
    const k = r.report_key as string;
    if (!out[k]) out[k] = String(r.created_at).slice(0, 10);
  }
  return out;
}

/** จดว่าสร้างฟอร์ม ภส. นี้แล้ว (ติ๊ก checklist — ไม่กระทบตัว PDF) */
export async function markExciseRunAction(reportKey: string, month: string, entityId: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.from("report_runs").insert({ report_key: reportKey, month, entity_id: entityId });
  return { ok: !error };
}

/** ข้อมูลรายงาน ภส. (JSON) สำหรับเติมฟอร์มฝั่ง client */
export async function getExciseReportData(
  kind: ExciseKind,
  month: string,
  id: string,
  entityId: string,
) {
  return reportData(kind, month, id, entityId);
}
