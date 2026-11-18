import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/shared/paginate";

/**
 * ค่าไม่ซ้ำจากประวัติรายการในบิล (ชื่อสินค้า · หมวดหมู่สินค้า · งาน) — ตัวเลือกของช่องกรอก
 *
 * ★ แหล่งเดียวของหน้าบันทึกบิลในแอปกับ Claude connector (D174 — ย้ายจาก accounting/data.ts)
 *   คิดคนละที่ = Claude เสนอ "หมวดใหม่" ทั้งที่ในแอปมีหมวดนั้นอยู่แล้ว
 * 🔴 D174 — ของเดิม `.limit(5000)` ไม่เรียงลำดับ แต่ PostgREST ตัดที่ max_rows (1,000) เงียบ ๆ
 *    ⇒ ได้แค่ 1,000 แถวแบบสุ่ม หมวดเก่าหายจากดร็อปดาวน์ · ตอนนี้แบ่งหน้าอ่านครบ (fetchAllRows)
 * ★ นับเฉพาะบิลสถานะปกติ (บิลยกเลิกไม่ควรเสนอชื่อของมัน)
 */
export type ItemHistory = { itemNames: string[]; itemCategories: string[]; itemJobs: string[] };

type Row = { item_name: string | null; item_category: string | null; item_job: string | null; transactions: { status: string } | null };

export async function itemHistoryFor(supabase: SupabaseClient, entityId?: string): Promise<ItemHistory> {
  const rows = await fetchAllRows<Row>(
    async (from, to) => {
      let q = supabase
        .from("transaction_items")
        .select("item_name, item_category, item_job, transactions!inner(entity_id, status)", from === 0 ? { count: "exact" } : undefined)
        .order("tx_id")
        .order("item_id")
        .range(from, to);
      if (entityId && entityId !== "ALL") q = q.eq("transactions.entity_id", entityId);
      const { data, error, count } = await q;
      return { data: (data ?? []) as unknown as Row[], error, count };
    },
    { label: "ประวัติชื่อรายการ" },
  );
  const names = new Set<string>();
  const cats = new Set<string>();
  const jobs = new Set<string>();
  for (const r of rows) {
    if (r.transactions && r.transactions.status !== "ปกติ") continue;
    if (r.item_name?.trim()) names.add(r.item_name.trim());
    if (r.item_category?.trim()) cats.add(r.item_category.trim());
    if (r.item_job?.trim()) jobs.add(r.item_job.trim());
  }
  const sortTh = (a: string, b: string) => a.localeCompare(b, "th");
  return {
    itemNames: [...names].sort(sortTh),
    itemCategories: [...cats].sort(sortTh),
    itemJobs: [...jobs].sort(sortTh),
  };
}
