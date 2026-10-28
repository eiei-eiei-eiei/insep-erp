import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hostToTenantSlug } from "../shared/tenant";
import { withAuthTimeout } from "./authFetch";
import { safeNext } from "../connector/guard";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** header ที่ middleware แปะให้หน้า login อ่าน slug ต่อได้ */
export const TENANT_SLUG_HEADER = "x-tenant-slug";

/**
 * header ที่ส่งต่อให้ server component — สร้างจาก `request.headers` **ณ ตอนเรียก** เสมอ
 *
 * 🔴 D135: เดิมคัดลอก header ไว้ครั้งเดียวตอนต้นฟังก์ชัน แล้วใช้ตัวนั้นซ้ำใน `setAll`
 *    ⇒ พอ `getUser()` ต่ออายุเซสชันสำเร็จ `request.cookies.set()` เขียนคุกกี้ใหม่ลง `request.headers`
 *      แต่สำเนาที่ส่งต่อยังเป็น**คุกกี้เก่าที่หมดอายุ** — layout/page ได้ refresh token ที่เพิ่งถูกใช้ไปแล้ว
 *      แล้วต่างคนต่างขอต่ออายุซ้ำด้วยตัวนั้น (ทุก createClient ในหน้าเดียว) ทั้งที่ middleware ต่อให้แล้ว
 *    ★ ตัวอย่างทางการของ Supabase ส่ง `{ request }` ตรง ๆ — เราต้องเขียนทับ x-tenant-slug จึงสร้าง Headers เอง
 *      ⇒ ต้องสร้างใหม่**หลัง**คุกกี้ถูกเขียน (มีเทสยิงจริงที่ `lib/supabase/middleware.test.ts`)
 */
export function forwardHeaders(request: NextRequest, slug: string | null): Headers {
  const h = new Headers(request.headers);
  // ★ set() ไม่ใช่ "ตั้งถ้ายังไม่มี" — client ยิง x-tenant-slug ปลอมมาเองได้
  //   ต้องเขียนทับทุกครั้งเพื่อไม่ให้ค่าจากภายนอกรอดเข้าไปถึงหน้า login
  h.set(TENANT_SLUG_HEADER, slug ?? "");
  return h;
}

/** redirect ที่พาคุกกี้ที่ Supabase เพิ่งเขียน/ลบไปด้วย — ไม่งั้นคุกกี้เสียค้างแล้วขอต่ออายุซ้ำทุกคำขอ */
function redirectWithCookies(url: URL, from: NextResponse): NextResponse {
  const res = NextResponse.redirect(url);
  for (const c of from.cookies.getAll()) res.cookies.set(c);
  return res;
}

/**
 * Refresh Supabase session ในทุก request + บังคับ login
 * ผู้ใช้ที่ยังไม่ login → เด้งไป /login (ยกเว้นหน้า login เอง)
 *
 * + แกะ tenant slug จาก subdomain แปะเป็น header ให้ server component อ่านได้
 *   🚨 ใช้ "แต่งหน้า + ชี้ทาง" เท่านั้น ห้ามเอาไปตัดสินสิทธิ์เข้าถึงข้อมูล (NEXT_STEPS:181)
 *      สิทธิ์มาจาก profiles.tenant_id → my_tenant() → RLS เท่านั้น
 */
export async function updateSession(request: NextRequest) {
  const slug = hostToTenantSlug(request.headers.get("host"));

  let supabaseResponse = NextResponse.next({ request: { headers: forwardHeaders(request, slug) } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/+$/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      global: { fetch: withAuthTimeout() },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          // 🚨 สร้าง header ใหม่หลัง request.cookies.set — ห้ามใช้สำเนาที่ทำไว้ก่อนหน้า (D135)
          supabaseResponse = NextResponse.next({ request: { headers: forwardHeaders(request, slug) } });
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
    // D141 — มาจากหน้าอนุญาต Claude connector: ล็อกอินเสร็จต้องกลับไปหน้าเดิมพร้อม authorization_id
    //   (หายแล้ว Supabase ไม่มีทางต่อ flow ได้ ผู้ใช้ต้องเริ่มเชื่อมต่อใหม่จาก Claude)
    const back = safeNext(path + request.nextUrl.search);
    url.search = back ? `?next=${encodeURIComponent(back)}` : "";
    return redirectWithCookies(url, supabaseResponse);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    // 🚨 safeNext กัน open redirect — กลับได้เฉพาะหน้าอนุญาตของ connector
    const back = safeNext(request.nextUrl.searchParams.get("next"));
    url.pathname = back ? back.split("?")[0] : "/";
    url.search = back && back.includes("?") ? back.slice(back.indexOf("?")) : "";
    return redirectWithCookies(url, supabaseResponse);
  }

  return supabaseResponse;
}
