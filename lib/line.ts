import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * lib/line — LINE Messaging API push (ฝั่ง server) · port จาก sales/Config.gs
 *   sendLine — silent fail เสมอ (ห้าม throw ทับ business logic — กติกาเดิมตั้งแต่ Phase 4)
 *
 * 🚨 ค่าตั้งค่ามาจาก `app_settings` **ต่อ tenant** ไม่ใช่ env (0033)
 *    ของเดิมอ่าน LINE_CHANNEL_TOKEN/LINE_GROUP_ID จาก env ของ Vercel project
 *    → ลูกค้าทุกเจ้าใน deployment เดียวกันยิงเข้ากลุ่มเดียวกันหมด = เห็นออเดอร์กัน
 *
 * 🚨 **ห้ามใส่ fallback ไป env กลับเข้ามาเด็ดขาด** — fallback คือตัวบั๊กเอง:
 *    tenant ที่ยังไม่ได้ตั้งค่าจะไปยิงเข้ากลุ่มของ env ซึ่งเป็นของอีกเจ้า
 *    ไม่มีค่า = เงียบ ถูกต้องแล้ว
 */

/** kind ใน app_settings ที่ policy app_settings_sel (0033) จำกัดให้เฉพาะ main อ่านได้ */
const TOKEN_KIND = "line_channel_token";
const GROUP_KIND = "line_group_id";

/**
 * ส่งข้อความเข้ากลุ่ม LINE ของ tenant ที่ผู้เรียกล็อกอินอยู่
 *
 * @param supabase client ของ session ปัจจุบัน — ใช้หา "ว่าใครเป็นคนทำ" เท่านั้น
 *
 * ★ tenant มาจาก session เสมอ ไม่รับเป็นพารามิเตอร์ — กันบั๊กชนิดเดียวกับที่ 0033 กำลังแก้
 *   (ผู้เรียกส่ง tenant ผิด = ยิงเข้ากลุ่มลูกค้าคนอื่น)
 * ★ ต้องอ่านค่าด้วย admin client เพราะ role sale/warehouse ก็ทำให้เกิดแจ้งเตือนได้
 *   แต่ policy ใหม่ห้ามคนกลุ่มนั้นอ่าน kind ลับ
 */
export async function sendLine(supabase: SupabaseClient, text: string): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const admin = createAdminClient();

    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .maybeSingle();
    const tenantId = profile?.tenant_id as string | undefined;
    if (!tenantId) return;

    const { data: rows } = await admin
      .from("app_settings")
      .select("kind, value")
      .eq("tenant_id", tenantId)
      .in("kind", [TOKEN_KIND, GROUP_KIND]);

    const get = (k: string) => (rows ?? []).find((r) => r.kind === k)?.value as string | undefined;
    const token = get(TOKEN_KIND)?.trim();
    const groupId = get(GROUP_KIND)?.trim();
    if (!token || !groupId) return; // กิจการนี้ยังไม่ตั้งค่า → ข้ามเงียบ ๆ

    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ to: groupId, messages: [{ type: "text", text }] }),
    });
    if (!res.ok) {
      // ห้าม log token/groupId — ขึ้น log ของ Vercel ที่คนอื่นในทีมเห็นได้
      console.error(`[LINE] ส่งไม่สำเร็จ status=${res.status}`);
    }
  } catch (err) {
    // Silent fail — ไม่ throw
    console.error("[LINE] exception:", err);
  }
}

/**
 * ส่งเข้ากลุ่ม LINE ของ tenant ที่ระบุ — **สำหรับงานเบื้องหลังที่ไม่มี session เท่านั้น**
 * (ตอนนี้มีผู้เรียกรายเดียว: cron เตือนกำหนดยื่นภาษี · D88)
 *
 * 🚨 ข้อห้ามของ `sendLine` ที่ว่า "tenant ต้องมาจาก session เสมอ" ยังอยู่ครบสำหรับทุก
 *    เส้นทางที่มีผู้ใช้ล็อกอิน — ตัวนี้เป็นข้อยกเว้นเดียวเพราะ cron ไม่มีใครล็อกอินให้ถาม
 *    ★ ผู้เรียก **ต้องส่ง tenantId ที่ไล่มาจากแถวในตาราง `tenants` เอง**
 *      ห้ามเอามาจาก query string / body / header ของคำขอที่ยิงเข้ามาเด็ดขาด
 *      (หลุดเมื่อไหร่ = คนนอกสั่งยิงข้อความเข้ากลุ่ม LINE ของลูกค้ารายไหนก็ได้)
 *
 * คืน true เมื่อส่งสำเร็จจริง · false เมื่อยังไม่ตั้งค่า LINE หรือส่งไม่ผ่าน
 * (ผู้เรียกใช้ค่านี้ตัดสินว่าจะบันทึกว่า "เตือนแล้ว" หรือยัง — ไม่งั้นเตือนหายเงียบ ๆ)
 */
export async function sendLineToTenant(tenantId: string, text: string): Promise<boolean> {
  try {
    if (!tenantId) return false;
    const admin = createAdminClient();
    const { data: rows } = await admin
      .from("app_settings")
      .select("kind, value")
      .eq("tenant_id", tenantId)
      .in("kind", [TOKEN_KIND, GROUP_KIND]);

    const get = (k: string) => (rows ?? []).find((r) => r.kind === k)?.value as string | undefined;
    const token = get(TOKEN_KIND)?.trim();
    const groupId = get(GROUP_KIND)?.trim();
    if (!token || !groupId) return false; // ยังไม่ตั้งค่า → ข้ามเงียบ ๆ (ห้าม fallback ไป env)

    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ to: groupId, messages: [{ type: "text", text }] }),
    });
    if (!res.ok) {
      console.error(`[LINE] ส่งไม่สำเร็จ status=${res.status}`); // ห้าม log token/groupId
      return false;
    }
    return true;
  } catch (err) {
    console.error("[LINE] exception:", err);
    return false;
  }
}
