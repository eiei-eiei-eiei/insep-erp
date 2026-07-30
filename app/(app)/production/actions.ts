"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mapDbError } from "@/lib/shared/dbError";
import {
  getNextBatchNumber,
  getRemainingDistillVol,
  getDistillRun,
  getFermentMonitor,
  getHistoryBatches,
  getFermentMulti,
  getDistillMulti,
  getRecentMaterials,
  getRecentDilutes,
  getRecentProducts,
} from "./data";

export type SaveResult = { ok: boolean; error?: string; data?: unknown };

// ── read helpers ให้ client เรียกสด (wrap data.ts server-only) ──────────────────
export async function getNextBatchNumberAction(date: string): Promise<string> {
  return getNextBatchNumber(date);
}
export async function getRemainingDistillVolAction(
  productName: string,
): Promise<number> {
  return getRemainingDistillVol(productName);
}
export async function getDistillRunsAction(batch: string) {
  return getDistillRun(batch);
}
export async function getFermentMonitorAction(batch: string) {
  return getFermentMonitor(batch);
}
export async function getHistoryBatchesAction() {
  return getHistoryBatches();
}
export async function getFermentMultiAction(batches: string[]) {
  return getFermentMulti(batches);
}
export async function getDistillMultiAction(batches: string[]) {
  return getDistillMulti(batches);
}

function fail(error: string): SaveResult {
  return { ok: false, error };
}

async function db() {
  return createClient();
}

// ── แก้/ลบ ค่าติดตามหมัก (log_ferment_monitor) — RLS main + stock ไม่กระทบ + edit_log auto ──
export async function updateFermentMonitorAction(id: number, patch: {
  measureDate: string; measureTime: string | null; ph: number | null; brix: number | null; temp: number | null; note: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("log_ferment_monitor").update({
    measure_date: patch.measureDate,
    measure_time: patch.measureTime || null,
    ph: patch.ph, brix: patch.brix, temp: patch.temp,
    note: patch.note || null,
  }).eq("id", id);
  if (error) return fail(mapDbError(error));
  revalidatePath("/production");
  return { ok: true };
}
export async function deleteFermentMonitorAction(id: number): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("log_ferment_monitor").delete().eq("id", id);
  if (error) return fail(mapDbError(error));
  revalidatePath("/production");
  return { ok: true };
}

// ── ลบ reading ระหว่างกลั่น (log_distill_run) — แก้ค่าที่บันทึกผิดก่อนปิด batch ──
export async function deleteDistillRunAction(id: number): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("log_distill_run").delete().eq("id", id);
  if (error) return fail(mapDbError(error));
  revalidatePath("/production");
  return { ok: true };
}

// ── รายการล่าสุด + ลบ: วัตถุดิบ/ปรุง/บรรจุ (stock ปรับเอง: log_product trigger · material/dilute คิดตอนอ่าน) ──
export async function getRecentMaterialsAction() { return getRecentMaterials(); }
export async function getRecentDilutesAction() { return getRecentDilutes(); }
export async function getRecentProductsAction() { return getRecentProducts(); }

export async function deleteMaterialLogAction(id: number): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("log_material").delete().eq("id", id);
  if (error) return fail(mapDbError(error));
  revalidatePath("/production");
  return { ok: true };
}
export async function deleteDiluteLogAction(id: number): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("log_dilute").delete().eq("id", id);
  if (error) return fail(mapDbError(error));
  revalidatePath("/production");
  return { ok: true };
}
export async function deleteProductLogAction(id: number): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("log_product").delete().eq("id", id);
  if (error) return fail(mapDbError(error));
  revalidatePath("/production");
  return { ok: true };
}

// ── บันทึกวัตถุดิบ (รับ/จ่าย/ฯลฯ) — Log_Material ────────────────────────────────
export async function saveMaterialAction(input: {
  date: string;
  transType: string;
  materialId: string;
  amount: number;
  docRef?: string;
  note?: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("log_material").insert({
    doc_date: input.date,
    trans_type: input.transType,
    material_id: input.materialId,
    amount: input.amount,
    doc_ref: input.docRef ?? null,
    note: input.note ?? null,
  });
  if (error) return fail(error.message);
  revalidatePath("/production");
  return { ok: true };
}

// ── P10: บันทึกหมัก + เบิกวัตถุดิบ auto (RPC atomic) ─────────────────────────────
export async function saveFermentAction(input: {
  date: string;
  productName: string;
  batch: string;
  containerId?: string | null;
  containerQty?: number | null;
  materials: { material_id: string; amount: number }[];
}): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_save_ferment", {
    p_date: input.date,
    p_product_name: input.productName,
    p_batch: input.batch,
    p_container_id: input.containerId ?? null,
    p_container_qty: input.containerQty ?? null,
    p_materials: input.materials,
  });
  if (error) return fail(error.message);
  revalidatePath("/production");
  return { ok: true, data };
}

// ── บันทึก reading ระหว่างกลั่น — Log_DistillRun ────────────────────────────────
export async function startDistillRunAction(input: {
  batch: string;
  productName: string;
  fermCharge?: number | null;
}): Promise<SaveResult> {
  const supabase = await db();
  // potNo ถัดไป = max ของ batch + 1 (P8)
  const { data: rows } = await supabase
    .from("log_distill_run")
    .select("pot_no")
    .eq("batch", input.batch);
  const maxPot = (rows ?? []).reduce(
    (m, r) => Math.max(m, Number(r.pot_no) || 0),
    0,
  );
  const potNo = maxPot + 1;
  const runId =
    "DR-" + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const { error } = await supabase.from("log_distill_run").insert({
    run_id: runId,
    pot_no: potNo,
    batch: input.batch,
    product_name: input.productName,
    minute: 0,
    phase: "เริ่มกลั่น",
    ferm_charge: input.fermCharge ?? null,
  });
  if (error) return fail(error.message);
  revalidatePath("/production");
  return { ok: true, data: { runId, potNo } };
}

export async function saveDistillReadingAction(input: {
  runId: string;
  potNo: number;
  batch: string;
  productName: string;
  minute?: number | null;
  phase: string;
  abvObs?: number | null;
  tempSpirit?: number | null;
  abv20?: number | null;
  cumVol?: number | null;
  flowRate?: number | null;
  vaporTemp?: number | null;
  potTemp?: number | null;
  coolTemp?: number | null;
  note?: string | null;
}): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("log_distill_run").insert({
    run_id: input.runId,
    pot_no: input.potNo,
    batch: input.batch,
    product_name: input.productName,
    minute: input.minute ?? null,
    phase: input.phase,
    abv_obs: input.abvObs ?? null,
    temp_spirit: input.tempSpirit ?? null,
    abv20: input.abv20 ?? null,
    cum_vol: input.cumVol ?? null,
    flow_rate: input.flowRate ?? null,
    vapor_temp: input.vaporTemp ?? null,
    pot_temp: input.potTemp ?? null,
    cool_temp: input.coolTemp ?? null,
    note: input.note ?? null,
  });
  if (error) return fail(error.message);
  revalidatePath("/production");
  return { ok: true };
}

// ── P3: ปิด batch = log_distill 1 แถว (RPC, unique guard) ───────────────────────
export async function closeBatchAction(input: {
  date: string;
  productName: string;
  batch: string;
  vol: number;
  abv: number;
}): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_close_batch", {
    p_date: input.date,
    p_product_name: input.productName,
    p_batch: input.batch,
    p_vol: input.vol,
    p_abv: input.abv,
  });
  if (error) return fail(error.message);
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return fail(res.error ?? "ปิด batch ไม่สำเร็จ");
  revalidatePath("/production");
  return { ok: true, data };
}

// ── บันทึกค่าติดตามหมัก — Log_FermentMonitor ────────────────────────────────────
export async function saveFermentMonitorAction(input: {
  date: string;
  time?: string;
  batch: string;
  productName: string;
  ph?: number | null;
  brix?: number | null;
  temp?: number | null;
  note?: string | null;
}): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("log_ferment_monitor").insert({
    measure_date: input.date,
    measure_time: input.time ?? null,
    batch: input.batch,
    product_name: input.productName,
    ph: input.ph ?? null,
    brix: input.brix ?? null,
    temp: input.temp ?? null,
    note: input.note ?? null,
  });
  if (error) return fail(error.message);
  revalidatePath("/production");
  return { ok: true };
}

// ── บันทึกปรุง/ปรับดีกรี — Log_Dilute ───────────────────────────────────────────
export async function saveDiluteAction(input: {
  date: string;
  productName: string;
  bottleSize?: string | null;
  startVol?: number | null;
  startAbv?: number | null;
  water?: number | null;
  finalVol?: number | null;
  finalAbv?: number | null;
  note?: string | null;
}): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("log_dilute").insert({
    dilute_date: input.date,
    product_name: input.productName,
    bottle_size: input.bottleSize ?? null,
    start_vol: input.startVol ?? null,
    start_abv: input.startAbv ?? null,
    water: input.water ?? null,
    final_vol: input.finalVol ?? null,
    final_abv: input.finalAbv ?? null,
    note: input.note ?? null,
  });
  if (error) return fail(error.message);
  revalidatePath("/production");
  return { ok: true };
}

// ── บันทึกบรรจุ/จ่ายขวด — Log_Product (trigger อัปเดต stock) ─────────────────────
export async function saveProductAction(input: {
  date: string;
  transType: string;
  productId: string;
  amount: number;
  note?: string | null;
}): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("log_product").insert({
    doc_date: input.date,
    trans_type: input.transType,
    product_id: input.productId,
    amount: input.amount,
    note: input.note ?? null,
  });
  if (error) return fail(error.message);
  revalidatePath("/production");
  return { ok: true };
}

// ── ซ่อม/คำนวณสต็อกใหม่ทั้งหมด (recompute_stock_product) ─────────────────────────
export async function recomputeStockAction(): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.rpc("recompute_stock_product");
  if (error) return fail(error.message);
  revalidatePath("/production");
  return { ok: true };
}
