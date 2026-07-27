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

/** ข้อมูลรายงาน ภส. (JSON) สำหรับเติมฟอร์มฝั่ง client */
export async function getExciseReportData(
  kind: ExciseKind,
  month: string,
  id: string,
  entityId: string,
) {
  return reportData(kind, month, id, entityId);
}
