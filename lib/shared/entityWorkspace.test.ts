import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ENTITY_COOKIE, ENTITY_HEADER, ENTITY_MISMATCH_HINT, ENTITY_SCOPED_MODULES,
  entityColorIndex, entityHeadersFromCookie, sanitizeEntityId, showEntitySwitcher,
} from "./entityWorkspace";

/**
 * D187 · ทาง Y เฟส 1 — ฐาน "กิจการที่เลือกอยู่"
 * ชั้นที่พิสูจน์ DB จริงอยู่ที่ tests/tenant/entity-workspace.test.ts · ไฟล์นี้คุมตัวช่วย + อ่านซอร์ส
 * 🪤 อ่านซอร์สหลังตัดคอมเมนต์เสมอ — ตรวจโค้ดจริง ไม่ใช่คำในคอมเมนต์ (D92/D95)
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, " ");

const MIG_DIR = "supabase/migrations";
const mig0115 = readdirSync(path.join(ROOT, MIG_DIR)).find((f) => /^\d{8}000115_/.test(f));
const sql0115 = mig0115 ? stripSql(read(`${MIG_DIR}/${mig0115}`)) : "";
const fnBody = (name: string) => {
  const m = sql0115.match(new RegExp(`create or replace function ${name}\\([\\s\\S]*?\\$(fn)?\\$([\\s\\S]*?)\\$(fn)?\\$`, "i"));
  return m ? m[2] : "";
};

describe("sanitizeEntityId — ตัดค่าขยะก่อนส่งเป็น header", () => {
  it.each(["EID01", "EID02", "eid_9", "A-1"])("รับ %s", (v) => {
    expect(sanitizeEntityId(v)).toBe(v);
  });
  it("ตัดช่องว่าง/ขึ้นบรรทัดหัวท้าย", () => {
    expect(sanitizeEntityId("  EID01 ")).toBe("EID01");
    expect(sanitizeEntityId("EID01\n")).toBe("EID01");
  });
  it.each([null, undefined, "", "   ", "EID 01", "EID01;drop", "x".repeat(41), "ก01", "EID\n01"])(
    "ไม่รับ %j",
    (v) => {
      expect(sanitizeEntityId(v as string | null | undefined)).toBeNull();
    },
  );
});

describe("entityHeadersFromCookie", () => {
  it("มี cookie ที่ถูกรูปแบบ → แนบ header ชื่อตัวเล็ก", () => {
    expect(entityHeadersFromCookie("EID02")).toEqual({ "x-entity-id": "EID02" });
  });
  it("ไม่มี cookie / ค่าขยะ → ไม่แนบอะไรเลย (DB ใช้กิจการล่าสุด/หลักเอง)", () => {
    expect(entityHeadersFromCookie(undefined)).toEqual({});
    expect(entityHeadersFromCookie("bad value")).toEqual({});
  });
  it("ชื่อ header เป็นตัวเล็ก — PostgREST ใส่ request.headers เป็นตัวเล็กเสมอ", () => {
    expect(ENTITY_HEADER).toBe(ENTITY_HEADER.toLowerCase());
  });
});

describe("showEntitySwitcher — ห้ามปุ่มหลอก", () => {
  const two = [{ entity_id: "EID01", name: "ก" }, { entity_id: "EID02", name: "ข" }];
  it("🚨 เฟส 1: ยังไม่มีโมดูลไหนทำตาม ⇒ ซ่อนเสมอ (ตัวสลับที่ไม่มีผล = ผู้ใช้คิดว่าพัง)", () => {
    expect(ENTITY_SCOPED_MODULES).toEqual([]);
    expect(showEntitySwitcher(two)).toBe(false);
  });
  it("มีโมดูลทำตามแล้ว + เข้าได้ ≥ 2 กิจการ ⇒ แสดง", () => {
    expect(showEntitySwitcher(two, ["production"])).toBe(true);
  });
  it("เข้าได้กิจการเดียว ⇒ ไม่แสดง (ไม่มีอะไรให้สลับ)", () => {
    expect(showEntitySwitcher(two.slice(0, 1), ["production"])).toBe(false);
  });
});

describe("entityColorIndex — สีเดิมทุกหน้า", () => {
  const ents = [{ entity_id: "EID02", name: "ข" }, { entity_id: "EID01", name: "ก" }];
  it("เรียงตามรหัส ไม่ขึ้นกับลำดับที่ส่งมา", () => {
    expect(entityColorIndex(ents, "EID01")).toBe(0);
    expect(entityColorIndex(ents, "EID02")).toBe(1);
    expect(entityColorIndex([...ents].reverse(), "EID02")).toBe(1);
  });
  it("ไม่พบ/null ⇒ 0", () => {
    expect(entityColorIndex(ents, "EID99")).toBe(0);
    expect(entityColorIndex(ents, null)).toBe(0);
  });
});

describe("migration 0115 — อ่านซอร์ส", () => {
  it("มีไฟล์ 0115 และนิยามครบ 3 ฟังก์ชัน (กันเทสผ่านเพราะหาไฟล์ไม่เจอ)", () => {
    expect(mig0115).toBeTruthy();
    for (const f of ["my_current_entity", "entity_guard", "fn_set_last_entity"]) {
      expect(fnBody(f), `ไม่พบ body ของ ${f}`).not.toBe("");
    }
  });

  it("my_current_entity: ทุกชั้นผ่าน tenant + สิทธิ์ (my_tenant + my_entities) และอ่าน header ชื่อเดียวกับฝั่ง TS", () => {
    const b = fnBody("my_current_entity");
    expect(b).toMatch(/e\.tenant_id\s*=\s*my_tenant\(\)/);
    expect(b).toMatch(/my_entities\(\)\s+is\s+null\s+or\s+e\.entity_id\s*=\s*any\(my_entities\(\)\)/);
    expect(b).toContain(`'${ENTITY_HEADER}'`);
    expect(b).toMatch(/current_setting\('request\.headers',\s*true\)/);
    // ลำดับชั้น: header → last_entity_id → is_default
    const iH = b.indexOf(ENTITY_HEADER), iL = b.indexOf("last_entity_id"), iD = b.indexOf("is_default limit 1");
    expect(iH).toBeGreaterThan(-1);
    expect(iL).toBeGreaterThan(iH);
    expect(iD).toBeGreaterThan(iL);
  });

  it("entity_guard: เช็ค has_cap + เทียบกับ my_current_entity() + ข้อความตรงฝาแฝด TS", () => {
    const b = fnBody("entity_guard");
    expect(b).toMatch(/has_cap\(p_cap\)/);
    expect(b).toMatch(/v_current\s*:=\s*my_current_entity\(\)/);
    expect(b).toMatch(/p_entity\s*<>\s*v_current/);
    expect(b).toContain(ENTITY_MISMATCH_HINT);
  });

  it("fn_set_last_entity: แก้เฉพาะโปรไฟล์ตัวเอง + กิจการต้องอยู่ใน tenant และในสิทธิ์", () => {
    const b = fnBody("fn_set_last_entity");
    expect(b).toMatch(/update\s+profiles\s+set\s+last_entity_id\s*=\s*v_ok\s+where\s+id\s*=\s*auth\.uid\(\)/);
    expect(b).toMatch(/e\.tenant_id\s*=\s*v_tenant/);
    expect(b).toMatch(/my_entities\(\)\s+is\s+null\s+or\s+e\.entity_id\s*=\s*any\(my_entities\(\)\)/);
  });

  it.each(["my_current_entity()", "entity_guard(text, text)", "fn_set_last_entity(text)"])(
    "%s: revoke public + anon (D99) และ grant authenticated",
    (sig) => {
      const esc = sig.replace(/[()]/g, "\\$&");
      expect(sql0115).toMatch(new RegExp(`revoke execute on function ${esc} from public, anon;`));
      expect(sql0115).toMatch(new RegExp(`grant execute on function ${esc} to authenticated`));
    },
  );

  it("🚫 เฟส 1 ไม่แตะ RLS / default ของตารางใด (ลงแล้วแอปต้องทำงานเหมือนเดิม)", () => {
    expect(sql0115).not.toMatch(/create\s+policy|drop\s+policy|alter\s+column[\s\S]*?set\s+default/i);
  });
});

describe("ท่อ cookie → header (อ่านซอร์สจริง)", () => {
  it("lib/supabase/server.ts แนบ header จาก cookie ENTITY_COOKIE", () => {
    const src = stripTs(read("lib/supabase/server.ts"));
    expect(src).toMatch(/headers:\s*entityHeadersFromCookie\(cookieStore\.get\(ENTITY_COOKIE\)\?\.value\)/);
  });

  it("switchEntityAction: จดใน DB ก่อน แล้วตั้ง cookie ด้วยค่าที่ DB ยืนยัน (ไม่ใช่ค่าจาก client)", () => {
    const src = stripTs(read("app/(app)/actions.ts"));
    const fn = src.slice(src.indexOf("export async function switchEntityAction"));
    const iRpc = fn.indexOf(`rpc("fn_set_last_entity"`);
    const iSet = fn.indexOf("store.set(ENTITY_COOKIE, confirmed");
    expect(iRpc).toBeGreaterThan(-1);
    expect(iSet).toBeGreaterThan(iRpc);
    expect(fn).toMatch(/httpOnly:\s*true/);
  });

  it("signOut ลบ cookie กิจการด้วย (คนถัดไปบนเครื่องนี้ไม่ได้ค่าของคนก่อน)", () => {
    const src = stripTs(read("app/(app)/actions.ts"));
    const fn = src.slice(src.indexOf("export async function signOut"), src.indexOf("export async function switchEntityAction"));
    expect(fn).toContain("store.delete(ENTITY_COOKIE)");
  });

  it("ชื่อ cookie ไม่ชนคุกกี้เซสชันของ Supabase (ห้ามถูกลบ/อ่านปนกัน)", () => {
    expect(ENTITY_COOKIE.startsWith("sb-")).toBe(false);
  });
});
