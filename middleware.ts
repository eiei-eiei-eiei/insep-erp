import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isPlatformPath, platformEnabled } from "@/lib/platform/guard";

export async function middleware(request: NextRequest) {
  // ── งานตามเวลา (cron): ไม่มีใครล็อกอิน → ปล่อยผ่าน session guard ──
  //    🚨 ไม่ได้แปลว่าเปิดให้ใครก็ได้ — route ตรวจ `CRON_SECRET` เองและปฏิเสธ 401
  //       ถ้าไม่มี header · ไม่ได้ตั้ง secret ไว้เลย = ตอบ 503 ปิดตาย (ไม่ใช่เปิดฟรี)
  //    ถ้าไม่ยกเว้นตรงนี้ คำขอจาก cron จะโดน redirect ไป /login แล้วได้ 200 ของหน้า login
  //    = งานเงียบหายโดยไม่มี error ให้เห็น
  if (request.nextUrl.pathname.startsWith("/api/cron/")) return NextResponse.next();

  // ── แอปจัดการหลังบ้าน: deployment ที่ไม่ได้ตั้ง PLATFORM_ADMIN = ไม่มีหน้านี้อยู่จริง ──
  //    ★ ต้องดักก่อน updateSession เพื่อให้ตอบ 404 ตรง ๆ ไม่ใช่เด้งไป /login
  //      (เด้งไป login = บอกเป็นนัยว่ามีหน้านี้อยู่ แค่ยังไม่ได้ล็อกอิน)
  //    ★ กันที่นี่แล้วยังกันซ้ำใน requirePlatformAdmin() อีกชั้น — middleware แก้ config ผิด
  //      แล้วหลุดทั้งแอปได้ ส่วน guard ฝั่ง server component พลาดได้ทีละหน้า
  if (isPlatformPath(request.nextUrl.pathname) && !platformEnabled(process.env.PLATFORM_ADMIN)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * ทุก path ยกเว้น:
     * - _next/static, _next/image (asset)
     * - favicon.ico, ไฟล์ภาพ
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
