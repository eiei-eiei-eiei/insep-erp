import { connectorEnabled, resourceMetadata } from "@/lib/connector/guard";

/**
 * protected resource metadata (RFC 9728) ของ Claude connector (D141)
 * Claude อ่านตำแหน่งไฟล์นี้จาก header `WWW-Authenticate` ของ /api/mcp แล้วไปล็อกอินที่
 * Supabase Auth ของ DB ก้อนที่ deployment นี้ชี้ (NEXT_PUBLIC_SUPABASE_URL)
 * ★ ข้อมูลสาธารณะ (ไม่มีความลับ) แต่ยังปิดด้วย env เหมือน /api/mcp
 */
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  if (!connectorEnabled(process.env.CLAUDE_CONNECTOR)) return new Response("Not Found", { status: 404 });
  const origin = new URL(req.url).origin;
  return Response.json(resourceMetadata(origin, process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""), {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
