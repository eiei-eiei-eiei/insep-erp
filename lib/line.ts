import "server-only";

/**
 * lib/line — LINE Messaging API push (ฝั่ง server) · port จาก sales/Config.gs
 *   sendLineNotification — silent fail เสมอ (ห้าม throw ทับ business logic)
 *   ENV: LINE_CHANNEL_TOKEN, LINE_GROUP_ID (ตั้งตอน go-live — ไม่ตั้ง = ข้ามเงียบ ๆ)
 */
export async function sendLine(text: string): Promise<void> {
  try {
    const token = process.env.LINE_CHANNEL_TOKEN;
    const groupId = process.env.LINE_GROUP_ID;
    if (!token || !groupId) return; // ยังไม่ตั้งค่า → ข้ามเงียบ ๆ (เหมือนเดิม)

    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ to: groupId, messages: [{ type: "text", text }] }),
    });
    if (!res.ok) {
      console.error(`[LINE] ส่งไม่สำเร็จ status=${res.status}`);
    }
  } catch (err) {
    // Silent fail — ไม่ throw
    console.error("[LINE] exception:", err);
  }
}
