/**
 * เทสตัวช่วยของ ping-dbs / fleet-sync
 *
 * เทสที่สำคัญที่สุดคือกลุ่ม "คีย์ผิดช่อง" — `supabase/fleet.json` อยู่ใน git
 * ถ้า service role key หลุดลงไปแล้ว push = ต้อง rotate คีย์ทุก DB ย้อนไม่ได้
 * รองลงมาคือ `unpingedTargets` ซึ่งเป็นตัวฟ้องว่า "รับลูกค้าใหม่แล้วลืมเพิ่มเข้ารายชื่อปิง"
 */
import { describe, expect, it } from "vitest";
import type { DbTarget } from "./db-targets";
import {
  checkPingTarget,
  fleetFromTargets,
  httpError,
  keyKind,
  logLine,
  parseFleet,
  pingEndpoint,
  staleFleetEntries,
  summarize,
  unpingedTargets,
  type PingResult,
  type PingTarget,
} from "./ping";

const REF_OWNER = "vmhiwlxdyhatucioalzp";
const REF_CUST = "tnuxrufpzeyuvwdmkojv";

const jwt = (role: string) =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ iss: "supabase", role, iat: 1 })).toString("base64url"),
    "signature",
  ].join(".");

const ANON = jwt("anon");
const SERVICE = jwt("service_role");

const url = (ref: string) => `https://${ref}.supabase.co`;
const target = (ref: string, name = "ก้อนทดสอบ", env = ".env.x"): DbTarget => ({
  name,
  env,
  dbUrl: `postgresql://postgres.${ref}:pwd@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
});

describe("keyKind", () => {
  it("แยก anon JWT ออกจาก service role JWT ได้", () => {
    expect(keyKind(ANON)).toBe("public");
    expect(keyKind(SERVICE)).toBe("secret");
  });

  it("รู้จักคีย์รูปแบบใหม่ (sb_publishable_ / sb_secret_)", () => {
    expect(keyKind("sb_publishable_abc123")).toBe("public");
    expect(keyKind("sb_secret_abc123")).toBe("secret");
  });

  it("ค่าที่แกะไม่ออกคืน unknown — ไม่เดาว่าปลอดภัย", () => {
    expect(keyKind("")).toBe("unknown");
    expect(keyKind("   ")).toBe("unknown");
    expect(keyKind("abc.def.ghi")).toBe("unknown");
    expect(keyKind("[YOUR-ANON-KEY]")).toBe("unknown");
  });

  it("เจอคำว่า service_role ในรูปแบบที่ไม่รู้จัก ก็ยังถือว่าเป็นความลับ", () => {
    expect(keyKind("something-service_role-something")).toBe("secret");
  });
});

describe("checkPingTarget", () => {
  it("ผ่านเมื่อครบและเป็น anon key", () => {
    expect(checkPingTarget({ name: "ก", url: url(REF_CUST), anonKey: ANON })).toEqual([]);
  });

  it("🚨 ปฏิเสธ service role key ในช่อง anonKey", () => {
    const problems = checkPingTarget({ name: "ก", url: url(REF_CUST), anonKey: SERVICE });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/service role/i);
  });

  it("ฟ้องช่องที่ขาด", () => {
    expect(checkPingTarget({})).toEqual(["ไม่มีช่อง name", "ไม่มีช่อง url", "ไม่มีช่อง anonKey"]);
  });

  it("ฟ้อง url ที่ไม่ใช่ของ Supabase", () => {
    const problems = checkPingTarget({ name: "ก", url: "https://example.com", anonKey: ANON });
    expect(problems.join()).toMatch(/supabase\.co/);
  });
});

describe("parseFleet", () => {
  const entry = { name: "ก้อน 1", url: url(REF_CUST), anonKey: ANON };

  it("รับได้ทั้งแบบ array และแบบมีช่อง targets", () => {
    expect(parseFleet([entry])).toEqual([entry]);
    expect(parseFleet({ _readme: "ห้ามแก้มือ", targets: [entry] })).toEqual([entry]);
  });

  it("ตัดช่องว่างหัวท้ายให้ (ค่าที่คนก๊อปมาแปะ)", () => {
    expect(parseFleet([{ name: " ก ", url: ` ${url(REF_CUST)} `, anonKey: ` ${ANON} ` }])).toEqual([
      { name: "ก", url: url(REF_CUST), anonKey: ANON },
    ]);
  });

  it("พังเมื่อไฟล์ว่างหรือรูปแบบผิด", () => {
    expect(() => parseFleet([])).toThrow(/fleet:sync/);
    expect(() => parseFleet({})).toThrow(/targets/);
    expect(() => parseFleet("nope")).toThrow();
    expect(() => parseFleet([null])).toThrow(/รายการที่ 1/);
  });

  it("พังพร้อมบอกลำดับรายการเมื่อคีย์ผิดช่อง", () => {
    expect(() => parseFleet([entry, { ...entry, name: "ก้อน 2", anonKey: SERVICE }])).toThrow(
      /รายการที่ 2 \(ก้อน 2\)/,
    );
  });
});

describe("fleetFromTargets", () => {
  const env = (ref: string, key = ANON) => ({
    NEXT_PUBLIC_SUPABASE_URL: url(ref),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
  });

  it("สร้างจาก targets + ไฟล์ env ได้", () => {
    const { fleet, problems } = fleetFromTargets(
      [target(REF_OWNER, "เจ้าของ", "a.env"), target(REF_CUST, "ลูกค้า", "b.env")],
      (f) => (f === "a.env" ? env(REF_OWNER) : env(REF_CUST)),
    );
    expect(problems).toEqual([]);
    expect(fleet.map((f) => f.url)).toEqual([url(REF_OWNER), url(REF_CUST)]);
  });

  it("🚨 ข้ามก้อนที่ ref ในไฟล์ env ไม่ตรงกับ dbUrl (ก๊อปข้ามก้อน)", () => {
    const { fleet, problems } = fleetFromTargets([target(REF_CUST, "ลูกค้า")], () => env(REF_OWNER));
    expect(fleet).toEqual([]);
    expect(problems[0]).toMatch(/ref ไม่ตรงกัน/);
  });

  it("ข้ามก้อนที่อ่านไฟล์ env ไม่ได้ แต่ไม่ล้มทั้งชุด", () => {
    const { fleet, problems } = fleetFromTargets(
      [target(REF_OWNER, "เจ้าของ", "หาย.env"), target(REF_CUST, "ลูกค้า", "b.env")],
      (f) => {
        if (f === "หาย.env") throw new Error("ENOENT");
        return env(REF_CUST);
      },
    );
    expect(fleet.map((f) => f.name)).toEqual(["ลูกค้า"]);
    expect(problems[0]).toMatch(/อ่านไฟล์ env ไม่ได้/);
  });

  it("🚨 ข้ามก้อนที่ไฟล์ env ใส่ service role key ไว้ในช่อง anon", () => {
    const { fleet, problems } = fleetFromTargets([target(REF_CUST)], () => env(REF_CUST, SERVICE));
    expect(fleet).toEqual([]);
    expect(problems[0]).toMatch(/service role/i);
  });
});

describe("unpingedTargets / staleFleetEntries", () => {
  const fleet: PingTarget[] = [{ name: "ลูกค้า", url: url(REF_CUST), anonKey: ANON }];

  it("ฟ้อง DB ที่มีใน targets แต่ยังไม่มีใครปิง (ลืมหลังรับลูกค้าใหม่)", () => {
    const out = unpingedTargets([target(REF_CUST, "ลูกค้า"), target(REF_OWNER, "เจ้าของ")], fleet);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("เจ้าของ");
    expect(out[0]).toContain(REF_OWNER);
  });

  it("ไม่ฟ้องเมื่อครบ", () => {
    expect(unpingedTargets([target(REF_CUST, "ลูกค้า")], fleet)).toEqual([]);
  });

  it("ฟ้องรายชื่อที่ค้างอยู่ใน fleet แต่เลิกอยู่ใน targets แล้ว", () => {
    expect(staleFleetEntries([target(REF_OWNER, "เจ้าของ")], fleet)).toEqual(["ลูกค้า"]);
    expect(staleFleetEntries([target(REF_CUST, "ลูกค้า")], fleet)).toEqual([]);
  });
});

describe("pingEndpoint", () => {
  it("ต่อ path ถูกและทน / ท้าย url", () => {
    expect(pingEndpoint(url(REF_CUST))).toBe(`${url(REF_CUST)}/rest/v1/rpc/ping`);
    expect(pingEndpoint(`${url(REF_CUST)}/`)).toBe(`${url(REF_CUST)}/rest/v1/rpc/ping`);
  });
});

describe("httpError", () => {
  it("ย่อ error ของ PostgREST เหลือ code + message", () => {
    const body = JSON.stringify({
      code: "PGRST202",
      details: "Searched for the function public.ping ...",
      message: "Could not find the function public.ping in the schema cache",
    });
    expect(httpError(404, body)).toBe(
      "HTTP 404 PGRST202: Could not find the function public.ping in the schema cache",
    );
  });

  it("ทน body ที่ไม่ใช่ JSON และ body ว่าง", () => {
    expect(httpError(502, "<html>\n  bad gateway\n</html>")).toBe("HTTP 502 <html> bad gateway </html>");
    expect(httpError(500, "")).toBe("HTTP 500");
  });
});

describe("summarize / logLine", () => {
  const ok: PingResult = { name: "ลูกค้า", ref: REF_CUST, ok: 3, tries: 3, ms: 120, detail: "2026-08-17T01:17:00Z" };
  const bad: PingResult = { name: "เจ้าของ", ref: REF_OWNER, ok: 0, tries: 3, ms: 0, detail: "fetch failed" };

  it("แยกก้อนที่พังออกมาให้ตัดสิน exit code", () => {
    expect(summarize([ok]).failed).toEqual([]);
    expect(summarize([ok, bad]).failed).toEqual([bad]);
  });

  it("ก้อนที่สำเร็จบางครั้งยังถือว่าผ่าน (เน็ตกระตุกไม่ใช่ DB หลับ)", () => {
    expect(summarize([{ ...ok, ok: 1 }]).failed).toEqual([]);
    expect(summarize([{ ...ok, ok: 1 }]).lines[0]).toContain("1/3");
  });

  it("log 1 บรรทัดบอกผลรวมและรายก้อน", () => {
    const line = logLine(new Date("2026-08-17T13:30:05Z"), [ok, bad]);
    expect(line).toContain("2026-08-17 13:30:05");
    expect(line).toContain("FAIL");
    expect(line).toContain("ลูกค้า=ok/120ms");
    expect(logLine(new Date("2026-08-17T13:30:05Z"), [ok])).toContain("OK");
  });
});
