import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  materialReport,
  productReport,
  productionReport,
  summaryReport,
  type Entity,
} from "@/lib/production/reports";
import type { ExciseKind } from "@/lib/pdf/excise";

async function loadEntity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entityId: string,
): Promise<Entity> {
  const { data } = await supabase
    .from("entities")
    .select("name, excise_id")
    .eq("entity_id", entityId)
    .single();
  return { company: data?.name ?? "", exciseId: data?.excise_id ?? "" };
}

/** ตัวเลือกสำหรับหน้า /reports (รายการวัตถุดิบ/สินค้า/ชื่อสุรา + กิจการ) */
export async function getReportOptions() {
  const supabase = await createClient();
  const [entities, materials, products] = await Promise.all([
    supabase.from("entities").select("entity_id, name, excise_id").order("entity_id"),
    supabase.from("materials").select("material_id, name, unit").order("material_id"),
    supabase.from("products").select("product_id, name, degree, bottle_size_l").order("product_id"),
  ]);
  const productNames = Array.from(new Set((products.data ?? []).map((p) => p.name as string)));
  return {
    entities: entities.data ?? [],
    materials: materials.data ?? [],
    products: products.data ?? [],
    productNames,
  };
}

/** ข้อมูลรายงาน ภส. (block D) สำหรับเติมฟอร์ม PDF (block F) */
export async function reportData(
  kind: ExciseKind,
  month: string,
  id: string,
  entityId: string,
) {
  const supabase = await createClient();
  const entity = await loadEntity(supabase, entityId);

  if (kind === "0701") {
    const [lm, mats, prods] = await Promise.all([
      supabase.from("log_material").select("doc_date, trans_type, material_id, amount, doc_ref"),
      supabase.from("materials").select("material_id, name, unit"),
      supabase.from("products").select("product_id, name, degree, bottle_size_l, liquor_type, liquor_kind"),
    ]);
    return materialReport(month, id, entity, lm.data ?? [], mats.data ?? [], prods.data ?? []);
  }
  if (kind === "0702_2") {
    const [lp, prods] = await Promise.all([
      supabase.from("log_product").select("doc_date, trans_type, product_id, amount, note"),
      supabase.from("products").select("product_id, name, degree, bottle_size_l, liquor_type, liquor_kind"),
    ]);
    return productReport(month, id, entity, lp.data ?? [], prods.data ?? []);
  }
  if (kind === "0702_1") {
    const [prods, ferm, dist, dilu, pack] = await Promise.all([
      supabase.from("products").select("product_id, name, degree, bottle_size_l, liquor_type, liquor_kind"),
      supabase.from("log_ferment").select("ferment_date, product_name, batch, container_qty, material_amounts"),
      supabase.from("log_distill").select("distill_date, product_name, batch, vol, abv"),
      supabase.from("log_dilute").select("dilute_date, product_name, start_vol, final_vol, final_abv"),
      supabase.from("log_product").select("doc_date, trans_type, product_id, amount, note"),
    ]);
    return productionReport(month, id, entity, prods.data ?? [], ferm.data ?? [], dist.data ?? [], dilu.data ?? [], pack.data ?? []);
  }
  // 0704
  const [mats, prods, lm, lp] = await Promise.all([
    supabase.from("materials").select("material_id, name, unit"),
    supabase.from("products").select("product_id, name, degree, bottle_size_l, liquor_type, liquor_kind"),
    supabase.from("log_material").select("doc_date, trans_type, material_id, amount, doc_ref"),
    supabase.from("log_product").select("doc_date, trans_type, product_id, amount, note"),
  ]);
  return summaryReport(month, entity, mats.data ?? [], prods.data ?? [], lm.data ?? [], lp.data ?? []);
}
