"use server";

import { createClient } from "@/lib/supabase/server";
import type { ExciseKind } from "@/lib/pdf/excise";
import { reportData } from "./data";

/** signed URL ของไฟล์ใน bucket pdf-templates (หมดอายุสั้น) — client fetch ไปทำ PDF */
export async function getPdfAssetUrl(path: string): Promise<{ url: string | null; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("pdf-templates")
    .createSignedUrl(path, 120);
  if (error) return { url: null, error: error.message };
  return { url: data.signedUrl };
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
