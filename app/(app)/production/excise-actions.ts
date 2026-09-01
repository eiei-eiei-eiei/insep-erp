"use server";

import { createClient } from "@/lib/supabase/server";
import type { ExciseKind } from "@/lib/pdf/excise";
import { getExciseOptions, reportData } from "./excise-data";
import { mapDbError, mustRead } from "@/lib/shared/dbError";
import type { ExciseTotals, MonthCloseRow, RecomputePreview } from "@/lib/production/monthClose";

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

// ── ปิดเดือนสรรพสามิต (D91) ──────────────────────────────────────────────────
//
// 🚨 `report_runs` ด้านบนคือ **เช็กลิสต์** — กดพิมพ์กี่ครั้งก็ได้ ไม่ล็อกอะไร
//    ตัวล็อกจริงคือ `excise_month_close` ด้านล่างนี้ ซึ่งผู้ใช้ประกาศเอง (D91 แก้ D90)

export type MonthCloseView = {
  rows: MonthCloseRow[];
  /**
   * กดคำนวณใหม่แล้วจะเกิดอะไร (dry-run ไม่เขียนอะไร)
   * 🚨 ต้องแยกทิศทาง — recompute เป็นสองทางมาตั้งแต่แรก (ซ่อนเพิ่ม / เอากลับมาแสดง)
   */
  pending: RecomputePreview;
  /** ผลรวมข้อมูลปัจจุบัน — ดึงเฉพาะตอนเดือนปิดอยู่ ไว้เทียบกับค่าที่แช่ไว้ */
  currentTotals: ExciseTotals | null;
};

export async function getExciseMonthCloseAction(month: string, entityId: string): Promise<MonthCloseView> {
  const supabase = await createClient();

  const closeRows = mustRead(
    await supabase
      .from("excise_month_close")
      .select("id, month, closed_at, closed_by, note, reopened_at, reopened_by, reopen_note, totals")
      .eq("month", month)
      .eq("entity_id", entityId)
      .order("closed_at", { ascending: false }),
    "สถานะปิดเดือนสรรพสามิต",
  );

  // ★ ชื่อคนปิด/คนถอนเป็นของประดับ — อ่านไม่ได้ก็แค่ไม่โชว์ชื่อ **ห้ามทำให้ทั้งการ์ดพัง**
  //   (ต่างจากตัวสถานะข้างบนที่อ่านพลาดแล้วผู้ใช้จะเข้าใจผิดว่าเดือนยังเปิด → ต้อง mustRead)
  const ids = [...new Set(closeRows.flatMap((r) => [r.closed_by, r.reopened_by]).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: pf } = await supabase.from("profiles").select("id, username, display_name").in("id", ids);
    for (const p of pf ?? []) names.set(p.id as string, (p.display_name as string) || (p.username as string));
  }

  const rows: MonthCloseRow[] = closeRows.map((r) => ({
    id: Number(r.id),
    month: String(r.month),
    closedAt: String(r.closed_at),
    closedBy: r.closed_by ? (names.get(String(r.closed_by)) ?? null) : null,
    note: (r.note as string | null) ?? null,
    reopenedAt: (r.reopened_at as string | null) ?? null,
    reopenedBy: r.reopened_by ? (names.get(String(r.reopened_by)) ?? null) : null,
    reopenNote: (r.reopen_note as string | null) ?? null,
    totals: (r.totals as ExciseTotals | null) ?? null,
  }));

  const dry = await supabase.rpc("fn_excise_recompute_hidden", {
    p_entity: entityId,
    p_month: month,
    p_dry: true,
  });
  if (dry.error) throw new Error(`ตรวจแถวที่ซ่อนได้ไม่สำเร็จ — ${mapDbError(dry.error)}`);

  let currentTotals: ExciseTotals | null = null;
  if (rows.some((r) => !r.reopenedAt)) {
    const tot = await supabase.rpc("fn_excise_month_totals", { p_entity: entityId, p_month: month });
    if (tot.error) throw new Error(`อ่านผลรวมของเดือนไม่สำเร็จ — ${mapDbError(tot.error)}`);
    currentTotals = (tot.data as ExciseTotals) ?? null;
  }

  const dd = dry.data as { to_hide?: number; to_show?: number } | null;
  return {
    rows,
    pending: { toHide: Number(dd?.to_hide ?? 0), toShow: Number(dd?.to_show ?? 0) },
    currentTotals,
  };
}

type CloseResult = { ok: boolean; error?: string; changed?: number; toHide?: number; toShow?: number };
const dirOf = (r: { to_hide?: number; to_show?: number }) =>
  ({ toHide: Number(r?.to_hide ?? 0), toShow: Number(r?.to_show ?? 0) });

export async function closeExciseMonthAction(month: string, entityId: string, note: string): Promise<CloseResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_excise_close_month", {
    p_entity: entityId,
    p_month: month,
    p_note: note,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  const r = data as CloseResult;
  return r?.ok ? { ok: true } : { ok: false, error: r?.error ?? "ปิดเดือนไม่สำเร็จ" };
}

export async function reopenExciseMonthAction(month: string, entityId: string, note: string): Promise<CloseResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_excise_reopen_month", {
    p_entity: entityId,
    p_month: month,
    p_note: note,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  const r = data as CloseResult;
  const d = data as { to_hide?: number; to_show?: number };
  return r?.ok ? { ok: true, changed: Number(r.changed ?? 0), ...dirOf(d) } : { ok: false, error: r?.error ?? "ถอนปิดเดือนไม่สำเร็จ" };
}

export async function recomputeExciseHiddenAction(month: string, entityId: string): Promise<CloseResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_excise_recompute_hidden", {
    p_entity: entityId,
    p_month: month,
    p_dry: false,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  const r = data as CloseResult;
  const d = data as { to_hide?: number; to_show?: number };
  return r?.ok ? { ok: true, changed: Number(r.changed ?? 0), ...dirOf(d) } : { ok: false, error: r?.error ?? "คำนวณใหม่ไม่สำเร็จ" };
}
