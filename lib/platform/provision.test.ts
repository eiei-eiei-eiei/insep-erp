import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeNewTenant,
  renameTenant,
  validateTenantIdentity,
  validateModules,
  validateNewEntity,
  validateNewTenant,
  validateQuota,
  type NewTenantInput,
} from "./provision";

/**
 * ตรวจ input ของงาน "รับลูกค้าใหม่" — ด่านนี้สำคัญเพราะ **สร้างลูกค้าครึ่งทางแล้วค้าง
 * คือสิ่งที่แก้ยากที่สุด** (tenant เกิดแล้วแต่ผู้ใช้ไม่เกิด = ลูกค้าเข้าระบบไม่ได้และลบก็ยาก)
 */
const ok: NewTenantInput = {
  slug: "rongsomchai",
  name: "โรงกลั่นสมชาย",
  color: "copper",
  entityId: "EID01",
  maxEntities: 1,
  isVat: true,
  modules: ["production", "accounting", "sales"],
};

describe("validateNewTenant", () => {
  it("ข้อมูลครบถูกต้อง = ผ่าน", () => {
    expect(validateNewTenant(ok)).toBeNull();
  });

  it("slug ภาษาไทย/มีช่องว่าง/มีจุด = ไม่ผ่าน (ต้องใช้เป็น subdomain + โดเมนอีเมลได้)", () => {
    expect(validateNewTenant({ ...ok, slug: "โรงสมชาย" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "rong somchai" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "rong.somchai" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "-rong" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "" })).not.toBeNull();
  });

  it("★ slug ที่เป็นชื่อสงวนใช้ไม่ได้ — 'platform' เป็นแถวของแอดมินเอง", () => {
    expect(validateNewTenant({ ...ok, slug: "platform" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "www" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, slug: "admin" })).not.toBeNull();
  });

  it("ชื่อกิจการว่าง = ไม่ผ่าน", () => {
    expect(validateNewTenant({ ...ok, name: "   " })).not.toBeNull();
  });

  it("ชุดสีที่ไม่มีใน BRAND_COLORS = ไม่ผ่าน (กันสีที่อ่านตัวหนังสือบนปุ่มไม่ออก)", () => {
    expect(validateNewTenant({ ...ok, color: "neon" })).not.toBeNull();
  });

  it("★★ ไม่เลือกโมดูลเลย = ไม่ผ่าน — ค่าว่างแปลว่า 'เปิดหมด' (fail-open ตาม D53)", () => {
    const err = validateNewTenant({ ...ok, modules: [] });
    expect(err, "ปล่อยผ่าน = ลูกค้าที่ไม่ติ๊กอะไรเลยได้ทุกโมดูลฟรี").not.toBeNull();
  });

  it("โมดูลที่ไม่รู้จัก = ไม่ผ่าน", () => {
    expect(validateNewTenant({ ...ok, modules: ["production", "hr"] })).not.toBeNull();
  });

  it("โควตาต้องเป็นจำนวนเต็ม >= 1", () => {
    expect(validateNewTenant({ ...ok, maxEntities: 0 })).not.toBeNull();
    expect(validateNewTenant({ ...ok, maxEntities: 1.5 })).not.toBeNull();
    expect(validateNewTenant({ ...ok, maxEntities: Number.NaN })).not.toBeNull();
    expect(validateNewTenant({ ...ok, maxEntities: 3 })).toBeNull();
  });

  it("รหัสกิจการต้องเป็นตัวพิมพ์ใหญ่/ตัวเลข", () => {
    expect(validateNewTenant({ ...ok, entityId: "eid01" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, entityId: "กิจการ" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, entityId: "E" })).not.toBeNull();
    expect(validateNewTenant({ ...ok, entityId: "EID02" })).toBeNull();
  });
});

describe("normalizeNewTenant", () => {
  it("ตัดช่องว่าง + slug เป็นตัวเล็ก + รหัสกิจการเป็นตัวใหญ่", () => {
    const n = normalizeNewTenant({
      ...ok,
      slug: "  RongSomchai  ",
      name: "  โรงกลั่นสมชาย ",
      entityId: " eid02 ",
      modules: [" production ", "", "sales"],
    });
    expect(n.slug).toBe("rongsomchai");
    expect(n.name).toBe("โรงกลั่นสมชาย");
    expect(n.entityId).toBe("EID02");
    expect(n.modules).toEqual(["production", "sales"]);
  });

  it("★ normalize แล้วต้องผ่าน validate — ผู้ใช้พิมพ์ตัวใหญ่มาไม่ควรโดนปฏิเสธ", () => {
    expect(validateNewTenant(normalizeNewTenant({ ...ok, slug: "RONGSOMCHAI" }))).toBeNull();
  });
});

describe("validateQuota", () => {
  it("ขยายโควตาได้", () => {
    expect(validateQuota(3, 1)).toBeNull();
  });

  it("★ ลดโควตาต่ำกว่าจำนวนกิจการที่มีอยู่จริงไม่ได้ (เหตุผลเดียวกับ D53)", () => {
    const err = validateQuota(1, 2);
    expect(err, "ข้อมูลที่ขัดกับความจริง = ต้นทางของบั๊ก 'ลูกค้าเข้าถึงข้อมูลตัวเองไม่ได้'").not.toBeNull();
  });

  it("เท่ากับจำนวนที่มีอยู่ = ได้ (แค่ปิดไม่ให้เพิ่มอีก)", () => {
    expect(validateQuota(2, 2)).toBeNull();
  });

  it("ค่าที่ไม่ใช่จำนวนเต็ม >= 1 = ไม่ผ่าน", () => {
    expect(validateQuota(0, 0)).not.toBeNull();
    expect(validateQuota(-1, 0)).not.toBeNull();
  });
});

describe("validateModules", () => {
  it("อย่างน้อย 1 โมดูล และต้องรู้จักทุกตัว", () => {
    expect(validateModules(["production"])).toBeNull();
    expect(validateModules([])).not.toBeNull();
    expect(validateModules(["production", "warehouse"])).not.toBeNull();
  });
});

describe("validateNewEntity", () => {
  it("รหัส + ชื่อ ต้องครบ", () => {
    expect(validateNewEntity({ entityId: "EID02", name: "สมชาย", isVat: false })).toBeNull();
    expect(validateNewEntity({ entityId: "EID02", name: "  ", isVat: true })).not.toBeNull();
    expect(validateNewEntity({ entityId: "e2", name: "สมชาย", isVat: true })).not.toBeNull();
  });
});

// ── สถานะจด VAT ต้องตั้งได้และแก้ได้ (เจอตอนเทสลูกค้าใหม่จากศูนย์ 2026-09-05) ────
//
// 🚨 บั๊กต้นเรื่อง: `provisionTenant` ฮาร์ดโค้ด `is_vat: true` และ **ไม่มี `update`
//    บน `entities` ที่แตะคอลัมน์นี้อยู่เลยทั้งโค้ดเบส** → ลูกค้าไม่จด VAT ทุกราย
//    ถูกตรึงเป็น "จด VAT" ตลอดกาล ⇒ trigger ม.86/13 ของ D55 ไม่มีวันทำงาน
//
// 🪤 เทสนี้ **อ่านซอร์สจริงมาตรวจ** เพราะกฎอยู่คนละไฟล์กับที่บังคับใช้
//    (ชั้นเดียวกับ tenantTables.test.ts / rolesSql.test.ts / exciseHidden.test.ts)
describe("is_vat — ตั้งตอนรับลูกค้าได้ และแก้ทีหลังได้ที่เดียว", () => {
  const provisionSrc = readFileSync(join(process.cwd(), "lib/platform/provision.ts"), "utf8");
  const settingsSrc = readFileSync(
    join(process.cwd(), "app/(app)/settings/actions.ts"),
    "utf8",
  );

  it("normalizeNewTenant ต้องส่ง isVat ต่อ ไม่กลืนหาย", () => {
    const raw: NewTenantInput = {
      slug: " ABC ", name: " ก ", color: "steel", entityId: " eid01 ",
      maxEntities: 1, modules: ["production"], isVat: false,
    };
    expect(normalizeNewTenant(raw).isVat).toBe(false);
    expect(normalizeNewTenant({ ...raw, isVat: true }).isVat).toBe(true);
  });

  it("🚩 provisionTenant ต้องไม่ฮาร์ดโค้ด is_vat", () => {
    expect(provisionSrc).not.toMatch(/is_vat:\s*true/);
    expect(provisionSrc).toMatch(/is_vat:\s*input\.isVat/);
  });

  it("🚩 มีทางแก้ is_vat ของกิจการที่มีอยู่แล้วจริง (ไม่ใช่มีแต่ insert)", () => {
    expect(provisionSrc).toContain("export async function setEntityVat");
    expect(provisionSrc).toMatch(/\.update\(\{\s*is_vat:\s*isVat\s*\}\)/);
  });

  // 🚨 ทิศตรงข้าม: หน้าตั้งค่าฝั่ง**ลูกค้า**ต้องแก้ไม่ได้ (D55 — ติ๊กผิด = ออกใบกำกับภาษี
  //    ทั้งที่ไม่มีสิทธิ์) · เผลอเติม is_vat เข้าไปในฟอร์มนั้นเมื่อไหร่ เทสนี้ต้องแดง
  it("🚩 saveEntityInfoAction (ฝั่งลูกค้า) ต้องไม่แตะ is_vat", () => {
    expect(settingsSrc).not.toMatch(/is_vat:/);
  });
});

// ── แก้ชื่อย่อ/ชื่อลูกค้า (D122) ─────────────────────────────────────────────
describe("validateTenantIdentity — กติกาเดียวกับตอนรับลูกค้าใหม่", () => {
  it("ผ่าน/ไม่ผ่านแบบเดียวกับ validateNewTenant", () => {
    expect(validateTenantIdentity("aim", "เอม")).toBeNull();
    expect(validateTenantIdentity("เอม", "เอม")).toMatch(/a-z/);
    expect(validateTenantIdentity("platform", "x")).toMatch(/สงวน/);
    expect(validateTenantIdentity("aim", "  ")).toMatch(/ชื่อกิจการ/);
    expect(validateNewTenant({ ...ok, slug: "platform" })).toBe(validateTenantIdentity("platform", ok.name));
  });
});

/** DB ปลอมพอให้ renameTenant เดินได้ — จดทุกการ update ไว้ตรวจ */
function fakeDb(rows: { id: string; slug: string; name: string; is_platform?: boolean }[]) {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const filters: [string, string, unknown][] = [];
      let patch: Record<string, unknown> | null = null;
      const pick = () =>
        rows.filter((r) => filters.every(([op, k, v]) => (op === "eq" ? (r as never)[k] === v : (r as never)[k] !== v)));
      const q = {
        select: () => q,
        update: (p: Record<string, unknown>) => { patch = p; return q; },
        eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return patch ? run() : q; },
        neq: (k: string, v: unknown) => { filters.push(["neq", k, v]); return q; },
        maybeSingle: async () => ({ data: pick()[0] ?? null, error: null }),
      };
      const run = async () => {
        updates.push({ table, patch: patch! });
        for (const r of pick()) Object.assign(r, patch);
        return { error: null };
      };
      return q;
    },
  };
  return { db: db as never, updates, rows };
}

describe("renameTenant — เปลี่ยนแค่แถว tenants", () => {
  it("แก้ชื่อย่อ+ชื่อ แล้วเขียนแค่ตาราง tenants (ไม่แตะแบรนด์/กิจการ)", async () => {
    const f = fakeDb([{ id: "t1", slug: "aim", name: "AIM ENGINEERING" }]);
    const r = await renameTenant(f.db, "t1", { slug: " AIM-ENG ", name: " เอม เอ็นจิเนียริ่ง " });
    expect(r).toEqual({ from: { slug: "aim", name: "AIM ENGINEERING" }, to: { slug: "aim-eng", name: "เอม เอ็นจิเนียริ่ง" }, changed: true });
    expect(f.updates).toEqual([{ table: "tenants", patch: { slug: "aim-eng", name: "เอม เอ็นจิเนียริ่ง" } }]);
  });

  it("ชื่อย่อชนลูกค้ารายอื่น = ไม่เขียนอะไรเลย", async () => {
    const f = fakeDb([{ id: "t1", slug: "aim", name: "A" }, { id: "t2", slug: "siamdist", name: "B" }]);
    await expect(renameTenant(f.db, "t1", { slug: "siamdist", name: "A" })).rejects.toThrow(/อยู่แล้ว/);
    expect(f.updates).toEqual([]);
  });

  it("แก้แค่ชื่อ (ชื่อย่อเดิม) ไม่ถือว่าชนกับตัวเอง", async () => {
    const f = fakeDb([{ id: "t1", slug: "aim", name: "A" }]);
    expect((await renameTenant(f.db, "t1", { slug: "aim", name: "B" })).changed).toBe(true);
  });

  it("ไม่มีอะไรเปลี่ยน = ไม่เขียน", async () => {
    const f = fakeDb([{ id: "t1", slug: "aim", name: "A" }]);
    expect((await renameTenant(f.db, "t1", { slug: "aim", name: "A" })).changed).toBe(false);
    expect(f.updates).toEqual([]);
  });

  it("🚨 tenant แพลตฟอร์มแก้ไม่ได้ · ชื่อสงวน/ภาษาไทยไม่ผ่าน", async () => {
    const f = fakeDb([{ id: "p", slug: "platform", name: "P", is_platform: true }, { id: "t1", slug: "aim", name: "A" }]);
    await expect(renameTenant(f.db, "p", { slug: "plat2", name: "P" })).rejects.toThrow(/แพลตฟอร์ม/);
    await expect(renameTenant(f.db, "t1", { slug: "admin", name: "A" })).rejects.toThrow(/สงวน/);
    await expect(renameTenant(f.db, "t1", { slug: "เอม", name: "A" })).rejects.toThrow(/a-z/);
    expect(f.updates).toEqual([]);
  });

  it("🚩 ฟังก์ชันต้องไม่เขียนตารางอื่น (แบรนด์อยู่ app_settings — D47)", () => {
    const src = readFileSync(join(process.cwd(), "lib/platform/provision.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function renameTenant"));
    expect(body.match(/\.from\("([a-z_]+)"\)/g)?.every((m) => m === '.from("tenants")')).toBe(true);
  });
});
