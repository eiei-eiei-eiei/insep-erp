"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type MasterResult = { ok: boolean; error?: string };

// whitelist ตาราง + primary key (กัน table name หลุด)
const TABLES = {
  materials: "material_id",
  containers: "container_id",
  products: "product_id",
} as const;
export type MasterTable = keyof typeof TABLES;

/** เพิ่ม/แก้ (upsert by pk) — ใช้ทั้งเพิ่มใหม่และแก้ไข */
export async function upsertMaster(
  table: MasterTable,
  row: Record<string, unknown>,
): Promise<MasterResult> {
  const pk = TABLES[table];
  if (!row[pk]) return { ok: false, error: "ต้องระบุรหัส" };
  const supabase = await createClient();
  const { error } = await supabase.from(table).upsert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/production");
  return { ok: true };
}

/** ลบ — ถ้ามี log/สต็อกอ้างอยู่ FK จะห้ามลบ → ข้อความชัดเจน */
export async function deleteMaster(
  table: MasterTable,
  id: string,
): Promise<MasterResult> {
  const pk = TABLES[table];
  const supabase = await createClient();
  const { error } = await supabase.from(table).delete().eq(pk, id);
  if (error) {
    const msg = /foreign key|violates|referenced/i.test(error.message)
      ? "ลบไม่ได้ — มีรายการ (log/สต็อก/เมนูขาย) ใช้ข้อมูลนี้อยู่ · ให้ลบรายการที่อ้างอิงก่อน"
      : error.message;
    return { ok: false, error: msg };
  }
  revalidatePath("/production");
  return { ok: true };
}
