import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hostToTenantSlug } from "@/lib/shared/tenant";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** header ที่ middleware แปะให้หน้า login อ่าน slug ต่อได้ */
export const TENANT_SLUG_HEADER = "x-tenant-slug";

/**
 * Refresh Supabase session ในทุก request + บังคับ login
 * ผู้ใช้ที่ยังไม่ login → เด้งไป /login (ยกเว้นหน้า login เอง)
 *
 * + แกะ tenant slug จาก subdomain แปะเป็น header ให้ server component อ่านได้
 *   🚨 ใช้ "แต่งหน้า + ชี้ทาง" เท่านั้น ห้ามเอาไปตัดสินสิทธิ์เข้าถึงข้อมูล (NEXT_STEPS:181)
 *      สิทธิ์มาจาก profiles.tenant_id → my_tenant() → RLS เท่านั้น
 */
export async function updateSession(request: NextRequest) {
  // ★ set() ไม่ใช่ "ตั้งถ้ายังไม่มี" — client ยิง x-tenant-slug ปลอมมาเองได้
  //   ต้องเขียนทับทุกครั้งเพื่อไม่ให้ค่าจากภายนอกรอดเข้าไปถึงหน้า login
  const requestHeaders = new Headers(request.headers);
  const slug = hostToTenantSlug(request.headers.get("host"));
  requestHeaders.set(TENANT_SLUG_HEADER, slug ?? "");

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/+$/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: อย่าใส่ logic ระหว่าง createServerClient กับ getUser (auth bug)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/login");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
