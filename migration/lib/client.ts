/**
 * client.ts — Supabase client แบบ service role (bypass RLS) สำหรับ migration เท่านั้น
 * อ่าน env จาก .env.local (Node 21+) — ห้าม import จากโค้ดฝั่ง client
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  /* ไม่มีไฟล์ก็อ่านจาก env ที่ตั้งไว้ */
}

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("❌ ต้องตั้ง NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env.local");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * อ่าน --tenant=<uuid> จาก argv — **บังคับใส่ทุกสคริปต์ migration**
 *
 * 🚨 สคริปต์พวกนี้ใช้ service role ที่ bypass RLS ทั้งหมด → ไม่มีอะไรกันการอ่าน/เขียน
 *    ข้ามลูกค้าเลยนอกจากค่านี้ · ปล่อยให้ default ไม่ได้ เพราะเดาผิดทีเดียว = ทับข้อมูลลูกค้าจริง
 */
export function requireTenantArg(): string {
  const v = process.argv
    .find((a) => a.startsWith("--tenant="))
    ?.split("=").slice(1).join("=").trim() ?? "";
  if (!v) {
    console.error(
      "\n❌ ต้องระบุ --tenant=<uuid>\n" +
        "   สคริปต์นี้ใช้ service role ที่ bypass RLS — ถ้าไม่ระบุ tenant จะไม่มีอะไร\n" +
        "   กันการอ่าน/เขียนข้ามข้อมูลลูกค้าเจ้าอื่น · ดู uuid ได้จากตาราง tenants",
    );
    process.exit(1);
  }
  return v;
}

/** insert เป็นชุด (batch) กัน payload ใหญ่เกิน — คืน error แรกที่เจอ */
export async function insertBatch(
  db: SupabaseClient,
  table: string,
  records: Record<string, unknown>[],
  batchSize = 500,
): Promise<void> {
  for (let i = 0; i < records.length; i += batchSize) {
    const chunk = records.slice(i, i + batchSize);
    const { error } = await db.from(table).insert(chunk);
    if (error) {
      throw new Error(`insert ${table} (แถว ${i + 1}-${i + chunk.length}): ${error.message}`);
    }
  }
}
