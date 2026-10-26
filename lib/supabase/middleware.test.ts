import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * D135 — middleware ต้องส่ง "คุกกี้ที่เพิ่งต่ออายุ" ต่อให้ server component
 *
 * 🔴 เดิมคัดลอก header ก่อน getUser() แล้วใช้ซ้ำ → server component ได้คุกกี้เก่าที่หมดอายุ
 *    (refresh token ที่ middleware เพิ่งใช้ไปแล้ว) แล้วไปขอต่ออายุซ้ำเองทุก createClient
 * ★ ยิง updateSession จริง — ปลอมแค่ Supabase ให้ "ต่ออายุสำเร็จ" ด้วยการเรียก setAll เหมือนไลบรารีจริง
 * ★ Next.js ส่ง header ที่ override ให้ server component ผ่าน `x-middleware-request-<ชื่อ>` บน response
 */

let refreshTo: string | null | undefined = null; // ค่าที่ "ต่ออายุ" ได้ · null = ต่อไม่ได้ (เซสชันตาย) · undefined = ยังไม่หมดอายุ ไม่ต้องต่อ
let seenFetch: unknown = undefined;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { global?: { fetch?: unknown }; cookies: { setAll: (c: { name: string; value: string; options: object }[]) => void } }) => {
    seenFetch = opts.global?.fetch;
    return {
      auth: {
        getUser: async () => {
          if (refreshTo === undefined) return { data: { user: { id: "u1" } } };
          if (refreshTo === null) {
            opts.cookies.setAll([{ name: "sb-proj-auth-token", value: "", options: { maxAge: 0 } }]);
            return { data: { user: null } };
          }
          opts.cookies.setAll([{ name: "sb-proj-auth-token", value: refreshTo, options: { path: "/" } }]);
          return { data: { user: { id: "u1" } } };
        },
      },
    };
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const { updateSession, TENANT_SLUG_HEADER } = await import("./middleware");

function req(path: string, cookie = "sb-proj-auth-token=OLD-EXPIRED; theme=dark") {
  return new NextRequest(`http://demo.localhost:3000${path}`, {
    headers: { cookie, host: "demo.localhost:3000", [TENANT_SLUG_HEADER]: "evil-tenant" },
  });
}

beforeEach(() => {
  refreshTo = "NEW-FRESH";
  seenFetch = undefined;
});

describe("D135 — ต่ออายุเซสชันใน middleware แล้วส่งต่อให้หน้าเว็บ", () => {
  it("🔴 server component ได้คุกกี้ตัวใหม่ ไม่ใช่ตัวเก่าที่หมดอายุ", async () => {
    const res = await updateSession(req("/accounting"));
    const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).toContain("sb-proj-auth-token=NEW-FRESH");
    expect(forwarded).not.toContain("OLD-EXPIRED");
    // คุกกี้อื่นของผู้ใช้ไม่หาย
    expect(forwarded).toContain("theme=dark");
  });

  it("เบราว์เซอร์ได้คุกกี้ตัวใหม่ด้วย (Set-Cookie บน response)", async () => {
    const res = await updateSession(req("/accounting"));
    expect(res.cookies.get("sb-proj-auth-token")?.value).toBe("NEW-FRESH");
  });

  it("★ x-tenant-slug ยังถูกเขียนทับจาก host เสมอ — ทั้งก่อนและหลังต่ออายุ (ค่าปลอมจาก client ไม่รอด)", async () => {
    const res = await updateSession(req("/accounting"));
    expect(res.headers.get(`x-middleware-request-${TENANT_SLUG_HEADER}`)).toBe("demo");
  });

  it("ไม่ต้องต่ออายุ (เซสชันยังดี) = ส่งต่อคุกกี้เดิม", async () => {
    refreshTo = undefined;
    const res = await updateSession(req("/accounting", "sb-proj-auth-token=STILL-GOOD"));
    expect(res.headers.get("x-middleware-request-cookie")).toBe("sb-proj-auth-token=STILL-GOOD");
    expect(res.cookies.get("sb-proj-auth-token")).toBeUndefined();
  });

  it("เซสชันตาย → เด้งไป /login และพาการลบคุกกี้ไปด้วย (ไม่งั้นขอต่ออายุซ้ำทุกคำขอ)", async () => {
    refreshTo = null;
    const res = await updateSession(req("/accounting"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    const c = res.cookies.get("sb-proj-auth-token");
    expect(c?.value).toBe("");
  });

  it("คำขอไป Supabase Auth มีเพดานเวลา (ส่ง fetch ที่ห่อแล้วเข้าไป)", async () => {
    await updateSession(req("/accounting"));
    expect(typeof seenFetch).toBe("function");
  });
});

describe("D135 — server client ก็มีเพดานเวลาเหมือนกัน", () => {
  it("lib/supabase/server.ts ส่ง withAuthTimeout() เข้า createServerClient", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("lib/supabase/server.ts", "utf8");
    expect(src).toMatch(/global:\s*\{\s*fetch:\s*withAuthTimeout\(\)\s*\}/);
  });
});
