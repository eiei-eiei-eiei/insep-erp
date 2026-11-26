import "server-only";
import { createClient } from "@/lib/supabase/server";
import { mustRead } from "@/lib/shared/dbError";
import { fetchAllRows } from "@/lib/shared/paginate";

type Db = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;

/**
 * 🚨 D186 — ทุกตารางที่ฟอร์ม ภส. อ่าน ต้อง **แบ่งหน้า** และ **กรองกิจการ**
 *
 * ① แบ่งหน้า: PostgREST คืนครั้งละไม่เกิน 1,000 แถว **ไม่มี error** · ฟอร์มอ่านทั้งประวัติ
 *    (ต้องใช้คิดยอดยกมา) ⇒ แถวไหนเกิน 1,000 ฟอร์มขาดแถว + ยอดยกมาผิดเงียบ ๆ
 *    → วนด้วย `fetchAllRows` (ตรวจจำนวนกับ count — ได้ไม่ครบ = throw ไม่ปล่อยเลขผิดออกฟอร์ม)
 *    · เรียงด้วย `id` ให้แบ่งหน้านิ่ง (ไม่เรียง = หน้าถัดไปอาจซ้ำ/ข้ามแถว)
 * ② กรองกิจการ: เดิมเลือกกิจการแล้วเปลี่ยนแค่หัวฟอร์ม แต่ตัวเลขเป็นของทุกกิจการรวมกัน
 *    (ตัวปิดเดือน `fn_excise_month_totals` กรองกิจการอยู่แล้ว — สองที่ต้องตรงกัน)
 *    · ทะเบียน วัตถุดิบ/สินค้า/ภาชนะ **ไม่กรอง** — PK ระดับ tenant ใช้เป็นตัวค้นชื่อ/หน่วยเท่านั้น
 *      ตัวเลขบนฟอร์มมาจากแถว log ที่กรองแล้วทั้งหมด
 */
function readLog<T = Row>(db: Db, table: string, cols: string, entityId: string, label: string): Promise<T[]> {
  return fetchAllRows<T>(
    async (from, to) => {
      const { data, error, count } = await db
        .from(table)
        .select(cols, from === 0 ? { count: "exact" } : undefined)
        .eq("entity_id", entityId)
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as unknown as T[], error, count };
    },
    { label },
  );
}

/** ทะเบียน (ไม่กรองกิจการ — ดูเหตุผลข้างบน) · แบ่งหน้าเหมือนกัน */
function readMaster<T = Row>(db: Db, table: string, cols: string, orderCol: string, label: string): Promise<T[]> {
  return fetchAllRows<T>(
    async (from, to) => {
      const { data, error, count } = await db
        .from(table)
        .select(cols, from === 0 ? { count: "exact" } : undefined)
        .order(orderCol, { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as unknown as T[], error, count };
    },
    { label },
  );
}

/**
 * แถว log_product ที่ **นับในฟอร์มสรรพสามิต** (D90)
 *
 * 🚨 ตัดเฉพาะคู่ จ่าย/รับ ของออเดอร์ที่ถูกยกเลิกก่อนออกรายงาน (`excise_hidden = true`)
 *    ตัดสินไปแล้วตั้งแต่ตอนกดยกเลิกใน `fn_cancel_order` — ที่นี่แค่เชื่อค่าที่แช่ไว้
 *    **ห้ามย้ายตรรกะตัดสินมาไว้ที่นี่** ไม่งั้นฟอร์มจะเปลี่ยนย้อนหลังเมื่อสถานะรายงานเปลี่ยน
 *
 * ★ กรองเฉพาะฝั่ง "ฟอร์ม" เท่านั้น — `stock_product` และหน้าสต็อก/ประวัติในแอป
 *   ยังคิดจากทุกแถวตามจริง (ของออกจากโรงจริงแล้วกลับมาจริง ต้องเห็นในระบบ)
 * ★ D186: แบ่งหน้า + กรองกิจการ เหมือน `readLog` (เขียนแยกเพราะมีตัวกรอง excise_hidden)
 */
function exciseLogProduct(db: Db, entityId: string): Promise<LogProduct[]> {
  return fetchAllRows<LogProduct>(
    async (from, to) => {
      const { data, error, count } = await db
        .from("log_product")
        .select("doc_date, trans_type, product_id, amount, note", from === 0 ? { count: "exact" } : undefined)
        .eq("excise_hidden", false)
        .eq("entity_id", entityId)
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as unknown as LogProduct[], error, count };
    },
    { label: "บันทึกสินค้า" },
  );
}
import {
  materialReport,
  productReport,
  productionReport,
  fermentedReport,
  summaryReport,
  type Entity,
  type LogMaterial,
  type LogFerment,
  type LogDistill,
  type LogDilute,
  type LogProduct,
  type LogFermentDraw,
  type MaterialMaster,
  type ProductMaster,
  type ContainerMaster,
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
  const [entities, materials, rows] = await Promise.all([
    supabase.from("entities").select("entity_id, name, excise_id").order("entity_id"),
    readMaster<MaterialMaster>(supabase, "materials", "material_id, name, unit", "material_id", "ทะเบียนวัตถุดิบ"),
    readMaster<{
      product_id: string; name: string; degree: number | null; bottle_size_l: number | null;
      liquor_type: string | null; liquor_kind: string | null;
    }>(supabase, "products", PRODUCT_COLS, "product_id", "ทะเบียนสินค้า"),
  ]);
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
    materials,
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

  // ทะเบียน — ใช้ร่วมทุกกิจการ (ไม่กรอง) · เรียงตามรหัส (ต้องเรียงถึงแบ่งหน้าได้)
  const products = () =>
    readMaster<ProductMaster>(supabase, "products", PRODUCT_COLS, "product_id", "ทะเบียนสินค้า");
  const materials = () =>
    readMaster<MaterialMaster>(supabase, "materials", "material_id, name, unit", "material_id", "ทะเบียนวัตถุดิบ");
  // บันทึก — กรองกิจการที่เลือก
  const logMaterial = () =>
    readLog<LogMaterial>(supabase, "log_material", "doc_date, trans_type, material_id, amount, doc_ref", entityId, "บันทึกวัตถุดิบ");
  const logProduct = () => exciseLogProduct(supabase, entityId);

  if (kind === "0701") {
    const [lm, mats, prods] = await Promise.all([logMaterial(), materials(), products()]);
    return materialReport(month, id, entity, lm, mats, prods);
  }
  if (kind === "0702_2") {
    const [lp, prods] = await Promise.all([logProduct(), products()]);
    return productReport(month, id, entity, lp, prods);
  }
  if (kind === "0702_1") {
    const [prods, ferm, dist, dilu, pack] = await Promise.all([
      products(),
      readLog<LogFerment>(supabase, "log_ferment", "ferment_date, product_name, batch, container_qty, material_amounts", entityId, "บันทึกลงหมัก"),
      readLog<LogDistill>(supabase, "log_distill", "distill_date, product_name, batch, vol, abv", entityId, "บันทึกกลั่น"),
      // D94: redistill_lot + note — แถวจากล็อตกลั่นซ้ำพกหมายเหตุของตัวเองมาพิมพ์ลงฟอร์ม
      readLog<LogDilute>(supabase, "log_dilute", "dilute_date, product_name, start_vol, final_vol, final_abv, redistill_lot, note", entityId, "บันทึกปรุง"),
      logProduct(),
    ]);
    return productionReport(month, id, entity, prods, ferm, dist, dilu, pack);
  }
  if (kind === "0702_1_chae") {
    // D78 สุราแช่: ไม่มี log_distill / log_dilute — น้ำหมัก → รินน้ำสุราแช่ → บรรจุ
    const [prods, ferm, draw, pack, conts] = await Promise.all([
      products(),
      readLog<LogFerment>(supabase, "log_ferment", "ferment_date, product_name, batch, container_qty, material_amounts, container_id", entityId, "บันทึกลงหมัก"),
      readLog<LogFermentDraw>(supabase, "log_ferment_draw", "draw_date, product_name, batch, vol, abv, adjust_date, water, final_vol, final_abv, note", entityId, "บันทึกรินน้ำสุราแช่"),
      logProduct(),
      readMaster<ContainerMaster>(supabase, "containers", "container_id, capacity_l", "container_id", "ทะเบียนภาชนะ"),
    ]);
    return fermentedReport(month, id, entity, prods, ferm, draw, pack, conts);
  }
  // 0704
  const [mats, prods, lm, lp] = await Promise.all([materials(), products(), logMaterial(), logProduct()]);
  return summaryReport(month, entity, mats, prods, lm, lp);
}

const PRODUCT_COLS = "product_id, name, degree, bottle_size_l, liquor_type, liquor_kind";
