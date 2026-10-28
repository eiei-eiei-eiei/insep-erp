import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { bearerToken, connectorEnabled, wwwAuthenticate } from "@/lib/connector/guard";
import { authenticate } from "@/lib/connector/session";
import { buildServer } from "@/lib/connector/tools";

/**
 * Claude connector — remote MCP server (D141)
 *
 * ★ stateless: สร้าง server ใหม่ทุกคำขอ (Vercel serverless ไม่มี memory ข้ามคำขอ) และถามสิทธิ์ใหม่ทุกครั้ง
 * 🚨 ไม่มี service role ในไฟล์นี้หรือที่ไฟล์นี้เรียก — connectorRoute.test.ts อ่านซอร์สตรวจ
 * 🚨 middleware ยกเว้น path นี้จาก session guard (ไม่งั้นคำขอของ Claude ถูกเด้งไป /login ได้ 200 หน้า HTML)
 *    และตอบ 404 เองเมื่อไม่ได้ตั้ง env — ที่นี่กันซ้ำอีกชั้น
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  if (!connectorEnabled(process.env.CLAUDE_CONNECTOR)) return new Response("Not Found", { status: 404 });

  const origin = new URL(req.url).origin;
  const token = bearerToken(req.headers.get("authorization"));
  // 🚨 ต้องเป็น 401 + WWW-Authenticate — Claude ไม่สนใจ header นี้บน 200 (ล็อกอินไม่เริ่ม)
  if (!token) {
    return new Response(JSON.stringify({ error: "unauthorized", error_description: "ต้องล็อกอินก่อน" }), {
      status: 401,
      headers: { "WWW-Authenticate": wwwAuthenticate(origin), "Content-Type": "application/json" },
    });
  }

  const auth = await authenticate(token);
  if (!auth.ok) {
    // ★ บันทึกสาเหตุลง log ของ Vercel — Claude แสดงแค่ "ถูกปฏิเสธ" ไม่บอกเหตุผล (D141 เสียเวลาไล่เพราะไม่มีบรรทัดนี้)
    console.warn(`[mcp] ${auth.status} ${auth.message}${auth.detail ? ` | ${auth.detail}` : ""}`);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth.status === 401) headers["WWW-Authenticate"] = wwwAuthenticate(origin, "invalid_token");
    return new Response(JSON.stringify({ error: auth.status === 401 ? "invalid_token" : "forbidden", error_description: auth.message }), {
      status: auth.status,
      headers,
    });
  }

  const server = buildServer({ db: auth.db, me: auth.me });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  // ★ ไม่ close ตรงนี้: โหมด JSON คืน Response ที่ body พร้อมแล้ว แต่ปิดก่อนเบราว์เซอร์/Claude อ่านจบ
  //   เสี่ยงตัดคำตอบ · server/transport ผูกกับคำขอเดียวและถูกเก็บทิ้งเองเมื่อจบ
  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
