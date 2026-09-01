import "server-only";
import { createClient } from "@/lib/supabase/server";
import { mustRead } from "@/lib/shared/dbError";
import {
  pendingBatches,
  nextBatchNumber,
  remainingDistillVol,
  remainingFermentedVol,
  isFermented,
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
  const [ferment, distill, draw] = await Promise.all([
    supabase
      .from("log_ferment")
      .select("batch, product_name, material_amounts, ferment_date")
      .order("id"),
    supabase.from("log_distill").select("batch"),
    // D78: สุราแช่ไม่มีการกลั่น — batch จบเมื่อรินน้ำสุราออกจากถัง
    //      ★ ไม่รวมตัวนี้ = batch ของสุราแช่ที่รินแล้วจะค้างอยู่ในรายการ "รอกลั่น" ตลอดกาล
    supabase.from("log_ferment_draw").select("batch"),
  ]);
  const ferments = (ferment.data ?? []).map((f) => ({
    batch: f.batch as string,
    productName: f.product_name as string,
    materialAmounts: f.material_amounts as string | null,
  }));
  const done = [
    ...(distill.data ?? []).map((d) => d.batch as string),
    ...(draw.data ?? []).map((d) => d.batch as string),
  ];

  // D80: ติดธง "batch นี้เป็นสุราแช่ไหม" ให้แท็บกลั่นกรองออก
  // 🪤 **ห้ามกรองในนี้ตรง ๆ** — ฟังก์ชันนี้ใช้ร่วมกับแท็บ **ติดตามหมัก** ด้วย
  //    และ batch สุราแช่ก็ต้องวัด pH/Brix ได้เหมือนกัน (วิธีเดียวกับ getBatchBoard)
  const { data: prods } = await supabase.from("products").select("name, liquor_type");
  const fermentedNames = new Set(
    (prods ?? []).filter((p) => isFermented(p.liquor_type as string | null)).map((p) => String(p.name)),
  );
  // 🪤 liquor_type ว่าง = **ไม่ถือว่าแช่** → ยังโชว์ในแท็บกลั่น (กติกา D78: ห้าม default เป็นกลั่น
  //    ก็จริง แต่การ "ซ่อน" ก็เป็นการเดาเหมือนกัน — ปล่อยให้แถบเตือนในแท็บรายงานจัดการ)
  return pendingBatches(ferments, done).map((b) => ({
    ...b,
    fermented: fermentedNames.has(b.productName),
  }));
}

/** P12: เลข batch ถัดไปของวันที่ (ปี พ.ศ.) */
export async function getNextBatchNumber(dateISO: string) {
  const supabase = await createClient();
  // 🚨🚨 D89 — ว่างเพราะอ่านไม่ได้ = เลข batch วนกลับไปเริ่มที่ 1 แล้ว **ชน batch เดิม**
  //    กติกาเหล็ก "1 batch = 1 แถว log_distill" พังทันที และฟอร์ม ภส. หักส่าซ้ำ
  const data = mustRead(await supabase.from("log_ferment").select("batch"), "เลข batch ที่มีอยู่");
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
  // 🚨 D89 — ว่าง = คงเหลือผิด → ปรุงเกินของที่มีจริง แล้วยอดบนฟอร์ม ภส. เพี้ยนตาม
  return remainingDistillVol(
    mustRead(distill, "บันทึกกลั่น").map((d) => d.vol as number),
    mustRead(dilute, "บันทึกปรุง").map((d) => d.start_vol as number),
  );
}

/** D78: ปริมาณน้ำสุราแช่คงเหลือรอบรรจุ ต่อชื่อสุรา (คู่แฝดของ getRemainingDistillVol) */
export async function getRemainingFermentedVol(productName: string) {
  if (!productName) return 0;
  const supabase = await createClient();
  const [draw, prods] = await Promise.all([
    supabase.from("log_ferment_draw").select("vol, final_vol").eq("product_name", productName),
    supabase.from("products").select("product_id, name, bottle_size_l").eq("name", productName),
  ]);
  const prodRows = mustRead(prods, "ทะเบียนสินค้า");
  const ids = prodRows.map((p) => String(p.product_id));
  const sizeById = new Map(prodRows.map((p) => [String(p.product_id), Number(p.bottle_size_l) || 0]));
  let packed: number[] = [];
  if (ids.length > 0) {
    const data = mustRead(
      await supabase
        .from("log_product")
        .select("product_id, amount, trans_type")
        .in("product_id", ids)
        .eq("trans_type", "รับ"),
      "บันทึกบรรจุ",
    );
    packed = (data ?? []).map((r) => (Number(r.amount) || 0) * (sizeById.get(String(r.product_id)) ?? 0));
  }
  return remainingFermentedVol(
    mustRead(draw, "บันทึกรินน้ำสุราแช่").map((d) => ({ vol: d.vol as number, final_vol: d.final_vol as number | null })),
    packed,
  );
}

/** D78: รายการรินน้ำสุราแช่ล่าสุด (แก้/ลบได้จากแอป — FLOW_REDESIGN sec 10) */
export async function getRecentDraws() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("log_ferment_draw")
    .select("id, draw_date, product_name, batch, vol, abv, adjust_date, water, final_vol, final_abv, note")
    .order("draw_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(30);
  return data ?? [];
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
    .select("id, measure_date, measure_time, ph, brix, temp, note")
    .eq("batch", batch)
    .order("measure_date")
    .order("measure_time");
  return data ?? [];
}

/** รายการล่าสุด (สำหรับแก้/ลบในแท็บ) — log_material / log_dilute / log_product */
export async function getRecentMaterials() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("log_material")
    .select("id, doc_date, trans_type, material_id, amount, doc_ref, note")
    .order("doc_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(30);
  return data ?? [];
}
export async function getRecentDilutes() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("log_dilute")
    .select("id, dilute_date, product_name, bottle_size, start_vol, start_abv, water, final_vol, final_abv, note")
    .order("dilute_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(30);
  return data ?? [];
}
export async function getRecentFerments() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("log_ferment")
    .select("batch, ferment_date, product_name, container_qty, material_amounts")
    .order("ferment_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(80);
  // รวมตาม batch (1 batch มีได้หลายถ้ง/หลายแถว)
  const byBatch = new Map<string, { batch: string; fermentDate: string; productName: string; tanks: number; volPerTank: number | null }>();
  for (const r of data ?? []) {
    const b = r.batch as string;
    const qty = Number(r.container_qty) || 0;
    const mainAmt = parseFloat(String(r.material_amounts ?? "").split(",")[0]) || 0; // ★ ค่าแรก = วัตถุดิบหลัก
    const e = byBatch.get(b);
    if (!e) {
      byBatch.set(b, {
        batch: b, fermentDate: (r.ferment_date as string) ?? "", productName: (r.product_name as string) ?? "",
        tanks: qty, volPerTank: qty > 0 ? Math.round((mainAmt / qty) * 100) / 100 : null,
      });
    } else {
      e.tanks += qty;
    }
  }
  return [...byBatch.values()].slice(0, 30);
}

export async function getRecentProducts() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("log_product")
    .select("id, doc_date, trans_type, product_id, amount, note")
    .order("doc_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(30);
  return data ?? [];
}

/**
 * กระดาน batch (FLOW_REDESIGN sec 3) — 1 การ์ด = 1 batch พร้อมสถานะว่าอยู่ขั้นไหน
 * อ่านอย่างเดียว ไม่คำนวณเงิน/ดีกรีใหม่ — แค่รวบ log ที่มีอยู่มาบอก "ทำอะไรต่อ"
 */
export type BatchCard = {
  batch: string;
  productName: string;
  fermentDate: string;
  tanks: number;
  fermVol: number;               // วัตถุดิบหลักรวม (ฐานคิดส่า P4) — แสดงเฉย ๆ
  monitorCount: number;
  lastMeasure: { date: string; ph: number | null; brix: number | null; temp: number | null } | null;
  pots: number;                  // จำนวนหม้อที่เริ่มกลั่นแล้ว
  activePot: number | null;      // หม้อที่ยังไม่ "จบหม้อ" (ค้างอยู่)
  closed: { date: string; vol: number; abv: number } | null; // ปิด batch แล้ว (log_distill)
  /** D78: batch นี้เป็นสุราแช่ไหม (ตัดสินจาก products.liquor_type ของชื่อสุรา) */
  fermented: boolean;
  /** D78: รินน้ำสุราแช่ออกจากถังแล้ว (log_ferment_draw) — vol/abv = ยอดหลังปรุง */
  drawn: { date: string; vol: number; abv: number } | null;
  stage: "ลงหมัก" | "ติดตามหมัก" | "กำลังกลั่น" | "ปิด batch แล้ว" | "รินน้ำสุราแล้ว";
};

export async function getBatchBoard(): Promise<BatchCard[]> {
  const supabase = await createClient();
  const { data: fermRows } = await supabase
    .from("log_ferment")
    .select("batch, ferment_date, product_name, container_qty, material_amounts")
    .order("ferment_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(400);

  // รวมหลายถัง/หลายแถวเป็น batch เดียว (เรียงใหม่→เก่าตามวันลงหมัก)
  const byBatch = new Map<string, BatchCard>();
  for (const r of fermRows ?? []) {
    const b = r.batch as string;
    const mainAmt = parseFloat(String(r.material_amounts ?? "").split(",")[0]) || 0; // ★ค่าแรก = วัตถุดิบหลัก
    const e = byBatch.get(b);
    if (!e) {
      byBatch.set(b, {
        batch: b,
        productName: (r.product_name as string) ?? "",
        fermentDate: (r.ferment_date as string) ?? "",
        tanks: Number(r.container_qty) || 0,
        fermVol: mainAmt,
        monitorCount: 0, lastMeasure: null, pots: 0, activePot: null, closed: null,
        fermented: false, drawn: null,
        stage: "ลงหมัก",
      });
    } else {
      e.tanks += Number(r.container_qty) || 0;
      e.fermVol += mainAmt;
      if ((r.ferment_date as string) < e.fermentDate) e.fermentDate = r.ferment_date as string;
    }
  }
  const batches = [...byBatch.keys()];
  if (batches.length === 0) return [];

  const [monitors, runs, distills, draws, prods] = await Promise.all([
    supabase.from("log_ferment_monitor").select("batch, measure_date, measure_time, ph, brix, temp").in("batch", batches),
    supabase.from("log_distill_run").select("batch, pot_no, phase").in("batch", batches),
    supabase.from("log_distill").select("batch, distill_date, vol, abv").in("batch", batches),
    supabase.from("log_ferment_draw").select("batch, draw_date, vol, abv, final_vol, final_abv").in("batch", batches),
    supabase.from("products").select("name, liquor_type"),
  ]);

  // D78: ประเภทสุราต่อ "ชื่อสุรา" (products หลายแถวชื่อเดียวกันได้ — ถือว่าแช่ถ้ามีแถวใดเป็นแช่
  //      ★ แถวชื่อเดียวกันประเภทไม่ตรงกันเป็นข้อมูลผิด แท็บรายงานสรรพสามิตจะเตือนให้แก้)
  const fermentedNames = new Set(
    (prods.data ?? []).filter((p) => isFermented(p.liquor_type as string | null)).map((p) => String(p.name)),
  );
  for (const c of byBatch.values()) c.fermented = fermentedNames.has(c.productName);

  const lastKey = new Map<string, string>(); // batch → คีย์เรียง "วันที่ เวลา" ของค่าวัดล่าสุด
  for (const m of monitors.data ?? []) {
    const c = byBatch.get(m.batch as string);
    if (!c) continue;
    c.monitorCount++;
    const key = `${String(m.measure_date).slice(0, 10)} ${String(m.measure_time ?? "")}`;
    if (!c.lastMeasure || key >= (lastKey.get(c.batch) ?? "")) {
      lastKey.set(c.batch, key);
      c.lastMeasure = {
        date: `${String(m.measure_date).slice(0, 10)}${m.measure_time ? " " + String(m.measure_time).slice(0, 5) : ""}`,
        ph: m.ph === null ? null : Number(m.ph),
        brix: m.brix === null ? null : Number(m.brix),
        temp: m.temp === null ? null : Number(m.temp),
      };
    }
  }
  // หม้อที่เริ่มแล้ว vs หม้อที่ยังไม่จบ (ตรงกับ resume ของ DistillTab, D39)
  const potPhases = new Map<string, Map<number, boolean>>(); // batch → potNo → มีแถว 'จบหม้อ'
  for (const r of runs.data ?? []) {
    const b = r.batch as string;
    const pot = Number(r.pot_no) || 0;
    const m = potPhases.get(b) ?? new Map<number, boolean>();
    m.set(pot, (m.get(pot) ?? false) || r.phase === "จบหม้อ");
    potPhases.set(b, m);
  }
  for (const [b, pots] of potPhases) {
    const c = byBatch.get(b);
    if (!c) continue;
    c.pots = pots.size;
    const open = [...pots.entries()].filter(([, done]) => !done).map(([p]) => p);
    c.activePot = open.length > 0 ? Math.max(...open) : null;
  }
  for (const d of distills.data ?? []) {
    const c = byBatch.get(d.batch as string);
    if (!c) continue;
    c.closed = { date: String(d.distill_date).slice(0, 10), vol: Number(d.vol) || 0, abv: Number(d.abv) || 0 };
  }

  for (const d of draws.data ?? []) {
    const c = byBatch.get(d.batch as string);
    if (!c) continue;
    const vol = d.final_vol == null ? Number(d.vol) || 0 : Number(d.final_vol) || 0;
    const abv = d.final_abv == null ? Number(d.abv) || 0 : Number(d.final_abv) || 0;
    c.drawn = { date: String(d.draw_date).slice(0, 10), vol, abv };
  }

  for (const c of byBatch.values()) {
    // D78: เส้นทางสุราแช่ไม่มีขั้นกลั่น — จบที่ "รินน้ำสุราแล้ว" (ไม่งั้นการ์ดจะค้าง "ลงหมัก" ตลอดกาล)
    c.stage = c.drawn
      ? "รินน้ำสุราแล้ว"
      : c.closed ? "ปิด batch แล้ว" : c.pots > 0 ? "กำลังกลั่น" : c.monitorCount > 0 ? "ติดตามหมัก" : "ลงหมัก";
    c.fermVol = Math.round(c.fermVol * 100) / 100;
  }
  return [...byBatch.values()].sort((a, b) => (a.fermentDate < b.fermentDate ? 1 : a.fermentDate > b.fermentDate ? -1 : b.batch.localeCompare(a.batch)));
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
