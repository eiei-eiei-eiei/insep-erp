import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { withAuthTimeout } from "./authFetch";
import { ENTITY_COOKIE, entityHeadersFromCookie } from "@/lib/shared/entityWorkspace";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Supabase client สำหรับ Server Component / Server Action / Route Handler.
 * อ่าน/เขียน session ผ่าน cookies ของ Next.js
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/+$/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      // D135: ขอต่ออายุเซสชันค้างได้ตลอดกาล → หน้า "กำลังโหลด…" ไม่มีวันจบ · มีเพดานแล้วได้ user = null → เด้ง login
      // D187 — "กิจการที่เลือกอยู่" จาก cookie → header `x-entity-id` → my_current_entity() ใน DB
      //   ★ จุดเดียวที่สร้าง client ของแอป (ไม่มี browser client) ⇒ ทุก query/RPC ได้ header นี้
      //   🔒 ไม่ใช่ด่าน — DB ตรวจ tenant + สิทธิ์เองทุกครั้ง · ไม่มี cookie = ไม่แนบ (DB ใช้กิจการล่าสุด/หลัก)
      global: { fetch: withAuthTimeout(), headers: entityHeadersFromCookie(cookieStore.get(ENTITY_COOKIE)?.value) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // เรียกจาก Server Component (set cookie ไม่ได้) — ปล่อยผ่าน
            // middleware จะ refresh session ให้เอง
          }
        },
      },
    },
  );
}
