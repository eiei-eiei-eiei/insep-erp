import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client สำหรับ client component (browser).
 * ใช้ anon key — สิทธิ์จริง enforce ด้วย RLS ฝั่ง DB
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/+$/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
  );
}
