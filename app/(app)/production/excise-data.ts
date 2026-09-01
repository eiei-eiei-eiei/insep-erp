import "server-only";
import { createClient } from "@/lib/supabase/server";
import { mustRead } from "@/lib/shared/dbError";

/**
 * แถว log_product ที่ **นับในฟอร์มสรรพสามิต** (D90)
 *
 * 🚨 ตัดเฉพาะคู่ จ่าย/รับ ของออเดอร์ที่ถูกยกเลิกก่อนออกรายงาน (`excise_hidden = true`)
 *    ตัดสินไปแล้วตั้งแต่ตอนกดยกเลิกใน `fn_cancel_order` — ที่นี่แค่เชื่อค่าที่แช่ไว้
 *    **ห้ามย้ายตรรกะตัดสินมาไว้ที่นี่** ไม่งั้นฟอร์มจะเปลี่ยนย้อนหลังเมื่อสถานะรายงานเปลี่ยน
 *
 * ★ กรองเฉพาะฝั่ง "ฟอร์ม" เท่านั้น — `stock_product` และหน้าสต็อก/ประวัติในแอป
 *   ยังคิดจากทุกแถวตามจริง (ของออกจากโรงจริงแล้วกลับมาจริง ต้องเห็นในระบบ)
 */
function exciseLogProduct(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase
    .from("log_product")
    .select("doc_date, trans_type, product_id, amount, note")
    .eq("excise_hidden", false);
}
import {
  materialReport,
  productReport,
  productionReport,
  fermentedReport,
  summaryReport,
  type Entity,
} from "@/lib/production/reports";
import { productionFormKind } from "@/lib/production/calc";
import type { ExciseKind } from "@/lib/pdf/excise";

async function loadEntity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entityId: string,
): Promise<Entity> {
  // 🚨 D89 — อ่านไม่ได้แล้วปล่อยผ่าน = หัวฟอร์มที่ยื่นสรรพสามิตไม่มีชื่อกิจการ/เลขสรรพสามิต
  const data = mustRead<{ name: string | null; excise_id: string | null }>(
    await supabase.from("entities").select("name, excise_id").eq("entity_id", entityId).single(),
    "ข้อมูลกิจการสำหรับหัวฟอร์ม",
  );
  return { company: data?.name ?? "", exciseId: data?.excise_id ?? "" };
}

/** ตัวเลือกของแท็บรายงานสรรพสามิต (รายการวัตถุดิบ/สินค้า/ชื่อสุรา + กิจการ) */
export async function getExciseOptions() {
  const supabase = await createClient();
  const [entities, materials, products] = await Promise.all([
    supabase.from("entities").select("entity_id, name, excise_id").order("entity_id"),
    supabase.from("materials").select("material_id, name, unit").order("material_id"),
    supabase.from("products").select("product_id, name, degree, bottle_size_l, liquor_type, liquor_kind").order("product_id"),
  ]);
  const rows = products.data ?? [];
  const productNames = Array.from(new Set(rows.map((p) => p.name as string)));

  // D78: ฟอร์มผลิตแยกใบตาม "ประเภทสุรา" → ต้องแยกรายชื่อให้ UI เลือกได้ถูกกล่อง
  //   ★ products หลายแถวชื่อเดียวกันได้ (ขนาดขวดต่างกัน) และรายงานรวมตาม *ชื่อ*
  //     → ถ้าแถวชื่อเดียวกันประเภทไม่ตรงกัน **ห้ามเดา** ต้องส่งกลับให้ UI เตือน
  //   ★ ตัดสินด้วย productionFormKind(ประเภท, ชนิด) — จุดเดียวที่รู้ว่าใครใช้ฟอร์มใบไหน
  //     (เฟสเบียร์เพิ่ม branch ที่ฟังก์ชันนั้น ตรงนี้ไม่ต้องแก้)
  const kindsByName = new Map<string, Set<string>>();
  for (const p of rows) {
    const n = String(p.name);
    const k = productionFormKind(p.liquor_type as string | null, p.liquor_kind as string | null);
    if (!kindsByName.has(n)) kindsByName.set(n, new Set());
    kindsByName.get(n)!.add(k ?? "");
  }
  const productNamesFermented: string[] = [];
  const productNamesDistilled: string[] = [];
  const namesNoProcess: string[] = [];    // ยังไม่ได้ตั้งประเภท / พิมพ์ค่าอื่น
  const namesMixedProcess: string[] = []; // ชื่อเดียวกันแต่ใช้ฟอร์มคนละใบ = เดาไม่ได้
  for (const [name, kinds] of kindsByName) {
    const known = [...kinds].filter((k) => k !== "");
    if (known.length === 0) { namesNoProcess.push(name); continue; }
    if (known.length > 1 || known.length !== kinds.size) namesMixedProcess.push(name);
    if (known[0] === "fermented") productNamesFermented.push(name);
    else productNamesDistilled.push(name);
  }

  return {
    entities: entities.data ?? [],
    materials: materials.data ?? [],
    products: rows,
    productNames,
    productNamesDistilled,
    productNamesFermented,
    namesNoProcess,
    namesMixedProcess,
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
    return materialReport(
      month, id, entity,
      mustRead(lm, "บันทึกวัตถุดิบ"), mustRead(mats, "ทะเบียนวัตถุดิบ"), mustRead(prods, "ทะเบียนสินค้า"),
    );
  }
  if (kind === "0702_2") {
    const [lp, prods] = await Promise.all([
      exciseLogProduct(supabase),
      supabase.from("products").select("product_id, name, degree, bottle_size_l, liquor_type, liquor_kind"),
    ]);
    return productReport(month, id, entity, mustRead(lp, "บันทึกสินค้า"), mustRead(prods, "ทะเบียนสินค้า"));
  }
  if (kind === "0702_1") {
    const [prods, ferm, dist, dilu, pack] = await Promise.all([
      supabase.from("products").select("product_id, name, degree, bottle_size_l, liquor_type, liquor_kind"),
      supabase.from("log_ferment").select("ferment_date, product_name, batch, container_qty, material_amounts"),
      supabase.from("log_distill").select("distill_date, product_name, batch, vol, abv"),
      supabase.from("log_dilute").select("dilute_date, product_name, start_vol, final_vol, final_abv"),
      exciseLogProduct(supabase),
    ]);
    return productionReport(
      month, id, entity,
      mustRead(prods, "ทะเบียนสินค้า"), mustRead(ferm, "บันทึกลงหมัก"), mustRead(dist, "บันทึกกลั่น"),
      mustRead(dilu, "บันทึกปรุง"), mustRead(pack, "บันทึกบรรจุ/จ่าย"),
    );
  }
  if (kind === "0702_1_chae") {
    // D78 สุราแช่: ไม่มี log_distill / log_dilute — น้ำหมัก → รินน้ำสุราแช่ → บรรจุ
    const [prods, ferm, draw, pack, conts] = await Promise.all([
      supabase.from("products").select("product_id, name, degree, bottle_size_l, liquor_type, liquor_kind"),
      supabase.from("log_ferment").select("ferment_date, product_name, batch, container_qty, material_amounts, container_id"),
      supabase.from("log_ferment_draw").select("draw_date, product_name, batch, vol, abv, adjust_date, water, final_vol, final_abv, note"),
      exciseLogProduct(supabase),
      supabase.from("containers").select("container_id, capacity_l"),
    ]);
    return fermentedReport(
      month, id, entity,
      mustRead(prods, "ทะเบียนสินค้า"), mustRead(ferm, "บันทึกลงหมัก"), mustRead(draw, "บันทึกรินน้ำสุราแช่"),
      mustRead(pack, "บันทึกบรรจุ/จ่าย"), mustRead(conts, "ทะเบียนภาชนะ"),
    );
  }
  // 0704
  const [mats, prods, lm, lp] = await Promise.all([
    supabase.from("materials").select("material_id, name, unit"),
    supabase.from("products").select("product_id, name, degree, bottle_size_l, liquor_type, liquor_kind"),
    supabase.from("log_material").select("doc_date, trans_type, material_id, amount, doc_ref"),
    exciseLogProduct(supabase),
  ]);
  return summaryReport(
    month, entity,
    mustRead(mats, "ทะเบียนวัตถุดิบ"), mustRead(prods, "ทะเบียนสินค้า"),
    mustRead(lm, "บันทึกวัตถุดิบ"), mustRead(lp, "บันทึกสินค้า"),
  );
}
