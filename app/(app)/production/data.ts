import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  pendingBatches,
  nextBatchNumber,
  remainingDistillVol,
} from "@/lib/production/calc";

/** master data โดเมนผลิต (materials/containers/products) */
export async function getProductionMasters() {
  const supabase = await createClient();
  const [materials, containers, products] = await Promise.all([
    supabase.from("materials").select("*").order("material_id"),
    supabase.from("containers").select("*").order("container_id"),
    supabase.from("products").select("*").order("product_id"),
  ]);
  return {
    materials: materials.data ?? [],
    containers: containers.data ?? [],
    products: products.data ?? [],
  };
}

/** P11: batch ที่หมักแล้วยังไม่กลั่น (ใช้หน้ากลั่น/monitor) */
export async function getPendingBatches() {
  const supabase = await createClient();
  const [ferment, distill] = await Promise.all([
    supabase
      .from("log_ferment")
      .select("batch, product_name, material_amounts, ferment_date")
      .order("id"),
    supabase.from("log_distill").select("batch"),
  ]);
  const ferments = (ferment.data ?? []).map((f) => ({
    batch: f.batch as string,
    productName: f.product_name as string,
    materialAmounts: f.material_amounts as string | null,
  }));
  const distilled = (distill.data ?? []).map((d) => d.batch as string);
  return pendingBatches(ferments, distilled);
}

/** P12: เลข batch ถัดไปของวันที่ (ปี พ.ศ.) */
export async function getNextBatchNumber(dateISO: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("log_ferment").select("batch");
  return nextBatchNumber(dateISO, (data ?? []).map((r) => r.batch as string));
}

/** P9: ปริมาณสุราคงเหลือรอปรุง ต่อชื่อสุรา */
export async function getRemainingDistillVol(productName: string) {
  if (!productName) return 0;
  const supabase = await createClient();
  const [distill, dilute] = await Promise.all([
    supabase.from("log_distill").select("vol").eq("product_name", productName),
    supabase.from("log_dilute").select("start_vol").eq("product_name", productName),
  ]);
  return remainingDistillVol(
    (distill.data ?? []).map((d) => d.vol as number),
    (dilute.data ?? []).map((d) => d.start_vol as number),
  );
}

/** สต็อกขวดคงเหลือ (stock_product join ชื่อสินค้า) */
export async function getProductStock() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_product")
    .select("product_id, balance, last_updated, products(name, degree, bottle_size_l)")
    .order("product_id");
  return data ?? [];
}

/** ประวัติค่าวัดหมัก (Log_FermentMonitor) ของ batch เรียงเก่า→ใหม่ (สำหรับตาราง+กราฟ) */
export async function getFermentMonitor(batch: string) {
  if (!batch) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("log_ferment_monitor")
    .select("measure_date, measure_time, ph, brix, temp, note")
    .eq("batch", batch)
    .order("measure_date")
    .order("measure_time");
  return data ?? [];
}

/** รายชื่อ batch สำหรับหน้าประวัติ: หมัก (มีค่าวัด) / กลั่น (มี run) + startDate/ชื่อสุรา */
export async function getHistoryBatches() {
  const supabase = await createClient();
  const [ferments, monitors, runs] = await Promise.all([
    supabase.from("log_ferment").select("batch, ferment_date, product_name"),
    supabase.from("log_ferment_monitor").select("batch"),
    supabase.from("log_distill_run").select("batch"),
  ]);
  const info: Record<string, { startDate: string; productName: string }> = {};
  for (const f of ferments.data ?? []) {
    const b = f.batch as string;
    const d = f.ferment_date as string;
    if (!info[b] || d < info[b].startDate) info[b] = { startDate: d, productName: (f.product_name as string) ?? "" };
  }
  const monBatches = [...new Set((monitors.data ?? []).map((m) => m.batch as string))];
  const runBatches = [...new Set((runs.data ?? []).map((r) => r.batch as string))];
  const mk = (b: string) => ({ batch: b, startDate: info[b]?.startDate ?? null, productName: info[b]?.productName ?? "" });
  return {
    ferment: monBatches.map(mk).sort((a, b) => a.batch.localeCompare(b.batch)),
    distill: runBatches.map(mk).sort((a, b) => a.batch.localeCompare(b.batch)),
  };
}

/** ค่าวัดหมักหลาย batch (สำหรับ overlay) */
export async function getFermentMulti(batches: string[]) {
  const out: Record<string, unknown[]> = {};
  for (const b of batches) out[b] = [];
  if (batches.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from("log_ferment_monitor")
    .select("batch, measure_date, measure_time, ph, brix, temp")
    .in("batch", batches);
  for (const r of data ?? []) (out[r.batch as string] = out[r.batch as string] || []).push(r);
  return out;
}

/** reading กลั่นหลาย batch + ค่าหัวใจสุดท้ายจาก log_distill (สำหรับ overlay + yield) */
export async function getDistillMulti(batches: string[]) {
  const data: Record<string, unknown[]> = {};
  for (const b of batches) data[b] = [];
  if (batches.length === 0) return { data, final: {} as Record<string, { vol: number; abv: number }> };
  const supabase = await createClient();
  const [runs, distills] = await Promise.all([
    supabase.from("log_distill_run").select("batch, pot_no, phase, minute, abv20, cum_vol, vapor_temp, ferm_charge").in("batch", batches),
    supabase.from("log_distill").select("batch, vol, abv").in("batch", batches),
  ]);
  for (const r of runs.data ?? []) (data[r.batch as string] = data[r.batch as string] || []).push(r);
  const final: Record<string, { vol: number; abv: number }> = {};
  for (const d of distills.data ?? []) final[d.batch as string] = { vol: Number(d.vol) || 0, abv: Number(d.abv) || 0 };
  return { data, final };
}

/** ประวัติการกลั่นของ batch (Log_DistillRun) เรียงตามหม้อ+เวลา */
export async function getDistillRun(batch: string) {
  if (!batch) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("log_distill_run")
    .select("*")
    .eq("batch", batch)
    .order("pot_no")
    .order("created_at");
  return data ?? [];
}
