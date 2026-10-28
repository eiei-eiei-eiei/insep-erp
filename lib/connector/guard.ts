/**
 * lib/connector/guard — ประตูของ Claude connector (D141) · ฟังก์ชันล้วน มีเทสคุม
 *
 * กันซ้อน 3 ชั้น:
 *   1. env `CLAUDE_CONNECTOR=1` — deployment ที่ไม่ได้ตั้ง = /api/mcp ตอบ 404 (แพตเทิร์น PLATFORM_ADMIN D54)
 *   2. token OAuth ของ Supabase (ผู้ใช้คนนั้นจริง) — ไม่มี/ใช้ไม่ได้ = 401 พร้อมบอกทางไปล็อกอิน
 *   3. `connector_allowed()` — ต้องอยู่ในรายชื่อที่แอดมินแพลตฟอร์มอนุญาต · ถามทุกคำขอ (ถอนแล้วหยุดทันที)
 * 🚨 ไม่ใช้ service role ที่ไหนเลยในเส้นทางนี้ — สิทธิ์ทั้งหมดมาจาก RLS ของผู้ใช้ที่ล็อกอิน
 */

export const MCP_PATH = "/api/mcp";
/**
 * protected resource metadata (RFC 9728) — เสิร์ฟใต้ /api/mcp แล้วชี้ด้วย header ของ 401
 * ★ ไม่ใช้ /.well-known ที่ราก: Claude อ่านตำแหน่งจาก `resource_metadata` ใน header ได้ (วิธีที่เอกสารบอกว่าเสถียรสุด)
 */
export const RESOURCE_META_PATH = "/api/mcp/oauth-protected-resource";
/** หน้าที่ Supabase ส่งผู้ใช้มากดอนุญาต — ต้องตั้ง Authorization Path ใน dashboard ให้ตรง */
export const CONSENT_PATH = "/oauth/consent";

/** env เปิด connector · 🚨 ค่าอื่นทุกค่า (รวมว่าง/"true") = ปิด — ตั้งผิดแล้วปิดดีกว่าเปิดโดยไม่ตั้งใจ */
export function connectorEnabled(v: string | undefined | null): boolean {
  return String(v ?? "").trim() === "1";
}

export function isConnectorPath(pathname: string): boolean {
  return pathname === MCP_PATH || pathname.startsWith(MCP_PATH + "/");
}

/** `Authorization: Bearer <token>` → token · ไม่ใช่รูปแบบนี้ = null (🚨 ไม่รับ token จาก query string) */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(header ?? ""));
  return m ? m[1] : null;
}

/** ตัด / ท้าย URL ออก (env บางตัวมีมา) */
const trimUrl = (u: string) => u.trim().replace(/\/+$/, "");

export type ResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  resource_name: string;
};

/**
 * 🚨 `resource` ต้องเท่ากับ URL ที่ผู้ใช้กรอกใน Claude **ทุกตัวอักษร** (ไม่งั้นล็อกอินล้ม)
 * 🚨 authorization server ตัวแรกเท่านั้นที่ Claude ใช้ — ใส่ตัวเดียว = Supabase ของ DB ก้อนที่ deployment นี้ชี้
 */
export function resourceMetadata(origin: string, supabaseUrl: string): ResourceMetadata {
  return {
    resource: trimUrl(origin) + MCP_PATH,
    authorization_servers: [trimUrl(supabaseUrl) + "/auth/v1"],
    bearer_methods_supported: ["header"],
    resource_name: "Insep ERP",
  };
}

/** header ของ 401 — Claude อ่าน resource_metadata แล้วไปหา Supabase เอง (ต้องเป็น 401 ไม่ใช่ 200) */
export function wwwAuthenticate(origin: string, error?: "invalid_token"): string {
  const meta = `resource_metadata="${trimUrl(origin)}${RESOURCE_META_PATH}"`;
  return error ? `Bearer error="${error}", ${meta}` : `Bearer ${meta}`;
}

/**
 * ปลายทางหลังล็อกอินที่ยอมให้เด้งกลับ — เฉพาะหน้าอนุญาตของ connector
 * 🚨 กัน open redirect: ต้องขึ้นต้นด้วย path นี้ตรง ๆ ห้าม `//` ห้าม scheme
 */
export function safeNext(raw: string | null | undefined): string | null {
  const s = String(raw ?? "");
  if (s !== CONSENT_PATH && !s.startsWith(CONSENT_PATH + "?")) return null;
  if (/[\r\n\\]/.test(s)) return null;
  return s;
}
