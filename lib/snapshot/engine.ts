import "server-only"; // ⛔ ใช้ service role — ห้ามหลุด client
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * snapshot engine — จับ/ย้อนสภาพข้อมูลทั้งระบบ (D33)
 * ลำดับตาราง = FK-safe (เหมือน migration import) · stock_product ไม่เก็บ (recompute หลัง restore)
 * strip คอลัมน์ `id` (bigserial) ทุกตาราง — ไม่มี FK อ้าง id → restore ให้ DB แจกใหม่
 *
 * 🚨 multi-tenant: ไฟล์นี้ใช้ **service role = bypass RLS ทั้งหมด** → DB ช่วยกรองให้ไม่ได้เลย
 *    ทุก query ต้องใส่ .eq("tenant_id", tenantId) ด้วยมือ ห้ามลืมแม้แต่บรรทัดเดียว
 *    ลืม 1 จุดตอน dump = ลูกค้า A ได้ข้อมูลลูกค้าทุกเจ้าติดไปใน snapshot ของตัวเอง
 *    ลืม 1 จุดตอน restore = ทับข้อมูลลูกค้าเจ้าอื่น
 */
export const SNAPSHOT_ORDER = [
  "entities", "bank_accounts", "app_settings", "contacts",
  "materials", "containers", "products", "sale_menu",
  "log_material", "log_ferment", "log_distill", "log_distill_run",
  "log_ferment_monitor", "log_dilute", "log_product",
  "transactions", "transaction_items", "wht_certificates", "tax_summaries",
  "sales_orders", "sales_order_items", "warehouse_stock", "stock_moves",
  "integration_log", "edit_log", "report_runs", "counters",
] as const;

type Rows = Record<string, unknown>[];
type Payload = Record<string, Rows>;

async function rpc(admin: SupabaseClient, fn: string, args?: Record<string, unknown>) {
  const { error } = await admin.rpc(fn, args ?? {});
  if (error) throw new Error(`rpc ${fn}: ${error.message}`);
}

/** ดึงทุกตารางของ tenant เดียว (strip id) → payload + row_counts */
async function dumpAll(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ payload: Payload; counts: Record<string, number> }> {
  const payload: Payload = {};
  const counts: Record<string, number> = {};
  for (const t of SNAPSHOT_ORDER) {
    const { data, error } = await admin.from(t).select("*").eq("tenant_id", tenantId);
    if (error) throw new Error(`dump ${t}: ${error.message}`);
    const rows = (data ?? []).map((r) => {
      const { id: _drop, ...rest } = r as Record<string, unknown>;
      void _drop;
      return rest;
    });
    payload[t] = rows;
    counts[t] = rows.length;
  }
  return { payload, counts };
}

/** จับ snapshot (ตอนข้อมูลปัจจุบัน) */
export async function takeSnapshot(opts: {
  name: string;
  createdBy: string;
  tenantId: string;
  isAuto?: boolean;
}) {
  const admin = createAdminClient();
  const { payload, counts } = await dumpAll(admin, opts.tenantId);
  const { data, error } = await admin
    .from("snapshots")
    .insert({
      tenant_id: opts.tenantId,
      name: opts.name,
      created_by: opts.createdBy,
      is_auto: opts.isAuto ?? false,
      row_counts: counts,
      payload,
    })
    .select("id, name, created_at, row_counts")
    .single();
  if (error) throw new Error(`บันทึก snapshot: ${error.message}`);
  return data;
}

async function insertBatch(admin: SupabaseClient, table: string, rows: Rows, batch = 500) {
  for (let i = 0; i < rows.length; i += batch) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + batch));
    if (error) throw new Error(`restore insert ${table} (${i + 1}-${i + Math.min(batch, rows.length - i)}): ${error.message}`);
  }
}

/**
 * re-derive counter "ทุกตัว" ที่ next_serial ใช้ จาก max ของข้อมูลที่เพิ่ง restore
 * (เหมือน migration seed) → กัน next_serial สร้าง id ชนของเดิม ไม่ว่า snapshot จะเก็บ counter เก่า/ผิดมา
 * ครอบ: CONTACT (C-####) · BANK_ACC (ACC-###) · TR-/TRF-<yyyymmdd> · QU-/ORD-<yyMMdd>
 */
async function reseedIdCounters(admin: SupabaseClient, tenantId: string) {
  const counterMax = new Map<string, number>();
  const bump = (key: string, serial: number) => {
    if (Number.isFinite(serial)) counterMax.set(key, Math.max(counterMax.get(key) ?? 0, serial));
  };
  const strOf = (r: unknown, col: string) => String((r as Record<string, unknown>)[col] ?? "");

  // transactions → TR-<date>, TRF-<date>
  const { data: txs } = await admin
    .from("transactions").select("tx_id, transfer_id").eq("tenant_id", tenantId);
  for (const t of txs ?? []) {
    const m = strOf(t, "tx_id").match(/^(TR-\d{8})-(\d+)$/);
    if (m) bump(m[1], Number(m[2]));
    const trf = strOf(t, "transfer_id").match(/^(TRF-\d{8})-(\d+)$/);
    if (trf) bump(trf[1], Number(trf[2]));
  }
  // sales_orders → QU-<date>, ORD-<date>
  const { data: os } = await admin
    .from("sales_orders").select("qu_no, order_no").eq("tenant_id", tenantId);
  for (const o of os ?? []) {
    const qm = strOf(o, "qu_no").match(/^QU(\d{6})-(\d+)$/);
    if (qm) bump(`QU-${qm[1]}`, Number(qm[2]));
    const om = strOf(o, "order_no").match(/^ORD(\d{6})-(\d+)$/);
    if (om) bump(`ORD-${om[1]}`, Number(om[2]));
  }
  // running ids → CONTACT (C-####), BANK_ACC (ACC-###)
  const { data: cs } = await admin
    .from("contacts").select("contact_id").eq("tenant_id", tenantId);
  for (const c of cs ?? []) {
    const m = strOf(c, "contact_id").match(/^C-(\d+)$/);
    if (m) bump("CONTACT", Number(m[1]));
  }
  const { data: bs } = await admin
    .from("bank_accounts").select("account_id").eq("tenant_id", tenantId);
  for (const b of bs ?? []) {
    const m = strOf(b, "account_id").match(/^ACC-(\d+)$/);
    if (m) bump("BANK_ACC", Number(m[1]));
  }

  const ups = [...counterMax.entries()].map(([key, value]) => ({ tenant_id: tenantId, key, value }));
  if (ups.length) {
    // PK ของ counters เป็น (tenant_id, key) แล้ว → ต้องบอก onConflict ให้ตรง
    const { error } = await admin.from("counters").upsert(ups, { onConflict: "tenant_id,key" });
    if (error) throw new Error(`reseed counters: ${error.message}`);
  }
}

/** ย้อนข้อมูลกลับไปตาม snapshot id (ล้างของ tenant นี้แล้วโหลดจาก payload) */
export async function restoreSnapshot(id: number, tenantId: string) {
  const admin = createAdminClient();
  // ★ .eq("tenant_id") ที่นี่คือตัวกันไม่ให้ restore snapshot ของลูกค้าเจ้าอื่น
  const { data: snap, error } = await admin
    .from("snapshots").select("payload").eq("id", id).eq("tenant_id", tenantId).single();
  if (error || !snap) throw new Error(`ไม่พบ snapshot #${id}`);
  const payload = snap.payload as Payload;

  await rpc(admin, "fn_mig_truncate", { p_tenant: tenantId });
  await rpc(admin, "fn_mig_set_triggers", { p_enable: false });
  try {
    for (const t of SNAPSHOT_ORDER) {
      const rows = payload[t] ?? [];
      // บังคับ tenant_id ทุกแถวอีกชั้น — payload เก่าจาก snapshot รุ่นก่อนอาจไม่มีคอลัมน์นี้
      const scoped = rows.map((r) => ({ ...r, tenant_id: tenantId }));
      if (scoped.length) await insertBatch(admin, t, scoped);
    }
  } finally {
    await rpc(admin, "fn_mig_set_triggers", { p_enable: true });
  }
  await rpc(admin, "fn_mig_recompute_stock", { p_tenant: tenantId });
  await reseedIdCounters(admin, tenantId); // กัน id ชนหลัง restore
}

/** เทียบ row_counts ของ snapshot กับสภาพปัจจุบัน (preview ผลกระทบ) */
export async function previewRestore(id: number, tenantId: string) {
  const admin = createAdminClient();
  const { data: snap, error } = await admin
    .from("snapshots").select("name, created_at, row_counts")
    .eq("id", id).eq("tenant_id", tenantId).single();
  if (error || !snap) throw new Error(`ไม่พบ snapshot #${id}`);
  const snapCounts = (snap.row_counts ?? {}) as Record<string, number>;
  const diffs: { table: string; current: number; snapshot: number; delta: number }[] = [];
  for (const t of SNAPSHOT_ORDER) {
    const { count } = await admin
      .from(t).select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const cur = count ?? 0;
    const snp = snapCounts[t] ?? 0;
    if (cur !== snp) diffs.push({ table: t, current: cur, snapshot: snp, delta: cur - snp });
  }
  return { name: snap.name as string, createdAt: snap.created_at as string, diffs };
}
