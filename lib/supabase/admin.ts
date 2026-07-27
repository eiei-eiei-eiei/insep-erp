import "server-only"; // ⛔ กันไฟล์นี้ (มี service role key) หลุดเข้า client bundle
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client แบบ service role — bypass RLS
 * ใช้เฉพาะงาน admin ที่ต้องข้ามสิทธิ์: สร้าง/ลบ auth user, รีเซ็ตรหัสผ่าน
 * ⚠️ ทุก action ที่เรียกตัวนี้ ต้องตรวจก่อนว่า caller เป็น role 'main'
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
