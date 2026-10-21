import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { APP_TABLES, PLATFORM_ONLY_TABLES, IDENTITY_APP_TABLES, CRUD, auditTableGrants, type GrantRow } from "./tableGrants";

/**
 * D118 · grant ตาราง — ชั้นอ่านไฟล์ migration (จับให้ได้ **ก่อน** ลง DB)
 * ชั้นที่พิสูจน์จริงคือ `fn_audit_table_grants()` ← test:tenant + `npm run db:audit-grants`
 *
 * 🔴 ตั้งแต่ 2026-10-30 Supabase ไม่แจก grant ให้ตารางใหม่แล้ว — ลืม = แอปได้ permission denied
 *    บนทุก DB และ build/lint/test เดิมผ่านหมด · ไฟล์นี้คือด่านที่ทำให้ "ลืม" แล้ว npm run test แดง
 *
 * 🪤 ตรวจโค้ดจริง ไม่ใช่คำในไฟล์ — ตัดคอมเมนต์ + body ฟังก์ชันทิ้งก่อน (กับดัก D92/D95)
 */

const DIR = path.resolve(__dirname, "../../supabase/migrations");
/** ไฟล์แรกที่ grant เอง — ไฟล์เก่ากว่านี้ลง DB แล้ว ห้ามแก้ */
const FIRST_AWARE = "20261021000085";

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const topLevel = (s: string) => stripComments(s).replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, " ");
const sqlOf = (f: string) => topLevel(readFileSync(path.join(DIR, f), "utf8"));

type Created = { file: string; serial: string[] };
/** ตารางที่ยังอยู่ → ไฟล์ล่าสุดที่ create มัน (drop แล้ว = ตัดออก) */
function liveTables(): Map<string, Created> {
  const live = new Map<string, Created>();
  for (const f of files) {
    const s = sqlOf(f);
    const events: { at: number; fn: () => void }[] = [];
    for (const m of s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
      const serial = [...m[2].matchAll(/^\s*([a-z_][a-z0-9_]*)\s+(?:big)?serial\b/gim)].map((x) => x[1].toLowerCase());
      events.push({ at: m.index!, fn: () => live.set(m[1].toLowerCase(), { file: f, serial }) });
    }
    for (const m of s.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
      events.push({ at: m.index!, fn: () => live.delete(m[1].toLowerCase()) });
    }
    events.sort((a, b) => a.at - b.at).forEach((e) => e.fn());
  }
  return live;
}

type Grant = { file: string; privs: string[]; targets: string[]; roles: string[]; seq: boolean; all: boolean };
function grants(): Grant[] {
  const out: Grant[] = [];
  for (const f of files) {
    for (const m of sqlOf(f).matchAll(/grant\s+([a-z ,]+?)\s+on\s+(all\s+tables\s+in\s+schema|all\s+sequences\s+in\s+schema|table|sequence)?\s*([a-z0-9_., ]+?)\s+to\s+([^;]+);/gi)) {
      const kind = (m[2] ?? "").toLowerCase();
      if (/^function|^execute/i.test(m[1])) continue;
      out.push({
        file: f,
        privs: m[1].split(",").map((p) => p.trim().toLowerCase()),
        targets: m[3].split(",").map((t) => t.trim().toLowerCase().replace(/^public\./, "")),
        roles: m[4].split(",").map((r) => r.trim().toLowerCase()),
        seq: kind === "sequence",
        all: kind.startsWith("all"),
      });
    }
  }
  return out;
}

const live = liveTables();
const G = grants();
const covers = (g: Grant, privs: readonly string[], roles: string[]) =>
  privs.every((p) => g.privs.includes(p) || g.privs.includes("all")) && roles.every((r) => g.roles.includes(r));

describe("D118 · grant ตาราง (ชั้นอ่านไฟล์)", () => {
  it("ตัวอ่านไฟล์เจอตารางครบจริง — กันเทสผ่านเพราะ regex ไม่เจออะไรเลย", () => {
    expect(live.size).toBeGreaterThanOrEqual(60);
    expect(live.has("transactions")).toBe(true);
    expect(live.has("scan_log")).toBe(false); // drop ไปแล้วใน 0039
    expect(G.filter((g) => g.file >= FIRST_AWARE).length).toBeGreaterThan(50);
  });

  it("ทุกตารางที่มีอยู่ต้องถูกจัดกลุ่ม (แอป / แพลตฟอร์ม) — ตารางใหม่ต้องตัดสินว่าใครเข้าได้", () => {
    const known = new Set<string>([...APP_TABLES, ...PLATFORM_ONLY_TABLES]);
    expect([...live.keys()].filter((t) => !known.has(t))).toEqual([]);
    expect([...known].filter((t) => !live.has(t))).toEqual([]);
  });

  it("🚨 ตารางแอปทุกตัวมี grant ให้ authenticated + service_role", () => {
    const missing = APP_TABLES.filter((t) => {
      const c = live.get(t)!;
      const from = c.file > FIRST_AWARE ? c.file : FIRST_AWARE;
      return !G.some((g) => !g.seq && g.file >= from && g.targets.includes(t) && covers(g, CRUD, ["authenticated", "service_role"]));
    });
    expect(missing).toEqual([]);
  });

  it("🚨 ตารางที่สร้างหลัง 0085 ต้อง grant ในไฟล์เดียวกับที่ create (ไม่งั้นลง DB แล้วใช้ไม่ได้ทันที)", () => {
    const bad = [...live].filter(([t, c]) => c.file > FIRST_AWARE &&
      !G.some((g) => g.file === c.file && g.targets.includes(t) && g.roles.includes("service_role"))).map(([t]) => t);
    expect(bad).toEqual([]);
  });

  it("🚨 sequence ของคอลัมน์ serial ทุกตัวมี usage ให้ authenticated + service_role", () => {
    const missing: string[] = [];
    for (const [t, c] of live) {
      if (!(APP_TABLES as readonly string[]).includes(t)) continue;
      const from = c.file > FIRST_AWARE ? c.file : FIRST_AWARE;
      for (const col of c.serial) {
        const seq = `${t}_${col}_seq`;
        if (!G.some((g) => g.seq && g.file >= from && g.targets.includes(seq) && covers(g, ["usage"], ["authenticated", "service_role"]))) missing.push(seq);
      }
    }
    expect(missing).toEqual([]);
  });

  it("รายชื่อตารางแอปที่ใช้ identity ตรงกับไฟล์ SQL (ตัวตรวจ DB ข้าม sequence ของตารางพวกนี้)", () => {
    const fromSql = new Set<string>();
    for (const f of files) {
      for (const m of sqlOf(f).matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
        if (/generated\s+(always|by\s+default)\s+as\s+identity/i.test(m[2])) fromSql.add(m[1].toLowerCase());
      }
    }
    const appIdentity = [...fromSql].filter((t) => live.has(t) && (APP_TABLES as readonly string[]).includes(t)).sort();
    expect(appIdentity).toEqual([...IDENTITY_APP_TABLES].sort());
  });

  it("🚨 ตารางแพลตฟอร์มห้าม grant ให้ anon/authenticated ในไฟล์ไหนเลย (ราคาลูกค้ารั่ว)", () => {
    const bad = G.filter((g) => g.targets.some((t) => (PLATFORM_ONLY_TABLES as readonly string[]).includes(t)) &&
      g.roles.some((r) => r === "anon" || r === "authenticated" || r === "public"));
    expect(bad).toEqual([]);
  });

  it("🚨 ห้าม grant แบบเหมา `on all tables/sequences` — จะเปิดตารางแพลตฟอร์มไปด้วย", () => {
    expect(G.filter((g) => g.all)).toEqual([]);
  });

  it("🚨 ตั้งแต่ 0085 ห้าม grant ตารางให้ anon (คนยังไม่ล็อกอินใช้แค่วิว tenant_branding)", () => {
    const bad = G.filter((g) => g.file >= FIRST_AWARE && g.roles.includes("anon"));
    expect(bad).toEqual([]);
  });
});

describe("D118 · auditTableGrants (ตัวตรวจผลจาก DB จริง)", () => {
  const full = ["select", "insert", "update", "delete"];
  const base = (): GrantRow[] => [
    ...APP_TABLES.map((name) => ({ name, kind: "table" as const, owner_table: null, rls: true, anon: [], authed: [...full], service: [...full] })),
    ...PLATFORM_ONLY_TABLES.map((name) => ({ name, kind: "table" as const, owner_table: null, rls: true, anon: [], authed: [], service: [...full] })),
    { name: "log_product_id_seq", kind: "sequence", owner_table: "log_product", rls: null, anon: [], authed: ["select", "usage"], service: ["select", "usage"] },
    { name: "platform_admin_log_id_seq", kind: "sequence", owner_table: "platform_admin_log", rls: null, anon: [], authed: [], service: [] },
    { name: "tenant_branding", kind: "view", owner_table: null, rls: null, anon: ["select"], authed: ["select"], service: full },
  ];

  it("สภาพที่ถูกต้อง = ไม่มีปัญหา (รวม DB เดิมที่ anon ยังมีสิทธิ์ค้างบนตารางแอป)", () => {
    expect(auditTableGrants(base())).toEqual([]);
    const legacy = base().map((r) => (APP_TABLES as readonly string[]).includes(r.name) ? { ...r, anon: [...full] } : r);
    expect(auditTableGrants(legacy)).toEqual([]);
  });

  it("DB ก้อนใหม่ที่ไม่ได้ grant → ฟ้องทุกตาราง", () => {
    const fresh = base().map((r) => r.kind === "table" ? { ...r, authed: [], service: [] } : r);
    expect(auditTableGrants(fresh).length).toBeGreaterThanOrEqual(APP_TABLES.length);
  });

  it("ตารางแพลตฟอร์มเปิดให้ authenticated → ฟ้อง", () => {
    const rows = base().map((r) => r.name === "subscriptions" ? { ...r, authed: ["select"] } : r);
    expect(auditTableGrants(rows).join("\n")).toMatch(/subscriptions/);
  });

  it("ตารางใหม่ที่ไม่อยู่ในรายชื่อ · RLS ปิด · sequence ขาด usage · วิวแบรนด์อ่านไม่ได้ → ฟ้องทุกข้อ", () => {
    const rows = base()
      .map((r) => r.name === "transactions" ? { ...r, rls: false } : r)
      .map((r) => r.kind === "sequence" && r.owner_table === "log_product" ? { ...r, authed: [] } : r)
      .map((r) => r.name === "tenant_branding" ? { ...r, anon: [] } : r);
    rows.push({ name: "new_thing", kind: "table", owner_table: null, rls: true, anon: [], authed: full, service: full });
    const p = auditTableGrants(rows).join("\n");
    expect(p).toMatch(/new_thing/);
    expect(p).toMatch(/transactions ไม่ได้เปิด RLS/);
    expect(p).toMatch(/log_product_id_seq/);
    expect(p).toMatch(/tenant_branding/);
  });

  it("sequence ของ identity (payroll_items) ไม่มี usage → ไม่ฟ้อง (Postgres ไม่ตรวจสิทธิ์ตรงนี้)", () => {
    const rows = base();
    rows.push({ name: "payroll_items_id_seq", kind: "sequence", owner_table: "payroll_items", rls: null, anon: [], authed: [], service: [] });
    expect(auditTableGrants(rows)).toEqual([]);
  });
});
