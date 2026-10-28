import { redirect } from "next/navigation";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/server";
import { decideConsent } from "./actions";
import { tenantDisplayName } from "@/lib/connector/guard";

/**
 * หน้าอนุญาตให้ Claude เชื่อมต่อ (D141) — Supabase OAuth 2.1 server ส่งผู้ใช้มาที่นี่
 * (`Authorization Path` ใน dashboard ต้องเป็น /oauth/consent)
 *
 * อยู่นอกกลุ่ม `(app)` เพราะ layout นั้นเด้งไป /change-password · /suspended เอง แล้ว authorization_id หาย
 * → ที่นี่บอกเหตุผลเองแทน (connector_allowed() รวมการระงับ + ยังไม่ตั้งรหัสใหม่ไว้แล้ว)
 * ★ ต้องบอกให้ชัดว่าเชื่อมต่อเข้า "ลูกค้าไหน · บัญชีไหน" — ผู้ใช้คนเดียวอาจมีบัญชีในหลายลูกค้า (รับลงบิลให้)
 */
export const dynamic = "force-dynamic";

const box = "flex min-h-screen items-center justify-center bg-raised p-4";
const card = "w-full max-w-md rounded-lg bg-card p-8 shadow-lg";

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; failed?: string }>;
}) {
  const { authorization_id: id = "", failed } = await searchParams;
  if (!id) {
    return (
      <main className={box}>
        <div className={card}>
          <h1 className="text-xl font-bold text-ink">ไม่พบคำขอเชื่อมต่อ</h1>
          <p className="mt-3 text-sm text-muted">ลิงก์นี้ไม่สมบูรณ์ — กลับไปที่ Claude แล้วกดเชื่อมต่อ connector ใหม่อีกครั้ง</p>
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  const [details, allowed, prof, ten, brand] = await Promise.all([
    supabase.auth.oauth.getAuthorizationDetails(id),
    supabase.rpc("connector_allowed"),
    // 🪤 ต้องกรอง id — บทบาท main อ่าน profiles ได้ทั้ง tenant (maybeSingle เจอหลายแถว = error)
    supabase.from("profiles").select("username, display_name").eq("id", me.user?.id ?? "").maybeSingle(),
    supabase.from("tenants").select("name").maybeSingle(), // ไม่มี brand_name แล้ว (D47)
    supabase.from("app_settings").select("value").eq("kind", "brand_name").limit(1),
  ]);

  if (details.error || !details.data) {
    return (
      <main className={box}>
        <div className={card}>
          <h1 className="text-xl font-bold text-ink">คำขอเชื่อมต่อหมดอายุหรือใช้ไม่ได้</h1>
          <p className="mt-3 text-sm text-muted">กลับไปที่ Claude แล้วกดเชื่อมต่อ connector ใหม่อีกครั้ง</p>
        </div>
      </main>
    );
  }
  // เคยอนุญาตไว้แล้ว → Supabase ให้ redirect_url มาเลย (ไม่มี authorization_id)
  if (!("authorization_id" in details.data)) redirect(details.data.redirect_url as Route);

  const d = details.data;
  const ok = allowed.data === true && !allowed.error;
  const who = prof.data?.display_name || prof.data?.username || d.user.email;
  const tenant = tenantDisplayName(brand.data?.[0]?.value as string | undefined, ten.data?.name);

  return (
    <main className={box}>
      <div className={card}>
        <h1 className="text-xl font-bold text-ink">อนุญาตให้ {d.client.name || "Claude"} เชื่อมต่อ</h1>
        <p className="mt-3 text-sm text-muted">
          {d.client.name || "Claude"} จะบันทึกบิลบัญชีในนามบัญชี <b className="text-ink">{who}</b>
          {tenant ? <> ของ <b className="text-ink">{tenant}</b></> : null} ด้วยสิทธิ์เดียวกับที่บัญชีนี้มีในแอป
        </p>
        <ul className="mt-3 list-disc pl-5 text-xs text-faint">
          <li>ค้นคู่ค้า · ดูหมวดหมู่และบัญชีเงิน · บันทึกบิลรายจ่าย/รายรับ</li>
          <li>ทุกบิลต้องให้คุณกดอนุญาตในแชทก่อนบันทึก และแก้/ลบได้ที่แอป → บัญชี → ค้นบิล</li>
          <li>ยกเลิกการเชื่อมต่อได้ทุกเมื่อในแอป Claude (Connectors → Disconnect)</li>
        </ul>

        {failed && (
          <p className="mt-4 rounded border border-crit-line bg-crit-bg p-2 text-sm text-crit">ดำเนินการไม่สำเร็จ — ลองกดอีกครั้ง หรือเริ่มเชื่อมต่อใหม่จาก Claude</p>
        )}
        {!ok && (
          <p className="mt-4 rounded border border-warn-line bg-warn-bg p-2 text-sm text-warn">
            บัญชีนี้ยังใช้ Claude connector ไม่ได้ — ต้องให้ผู้ดูแลระบบเปิดสิทธิ์ที่หน้า /platform แท็บ Claude connector
            (หรือกิจการถูกระงับ / ยังไม่ได้ตั้งรหัสผ่านใหม่) · กด ปฏิเสธ เพื่อกลับไปที่ Claude
          </p>
        )}

        <form action={decideConsent} className="mt-6 flex gap-2">
          <input type="hidden" name="authorization_id" value={d.authorization_id} />
          <button
            type="submit"
            name="decision"
            value="approve"
            disabled={!ok}
            className="min-h-[44px] flex-1 rounded bg-brand text-sm font-medium text-on-brand transition disabled:opacity-50 sm:py-2"
          >
            อนุญาต
          </button>
          <button
            type="submit"
            name="decision"
            value="deny"
            className="min-h-[44px] flex-1 rounded border border-line text-sm font-medium text-muted transition hover:bg-raised hover:text-ink sm:py-2"
          >
            ปฏิเสธ
          </button>
        </form>
      </div>
    </main>
  );
}
