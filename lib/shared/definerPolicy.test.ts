import { describe, it, expect } from "vitest";
import {
  auditDefiners, allowViolation, staleAllowlist, MUST_CLOSED_DEFINERS, DEFINER_ALLOWLIST,
  type DefinerRow,
} from "./definerPolicy";

/**
 * ตัวตรวจ definer (D99) ด้วยข้อมูลสังเคราะห์ — พิสูจน์ว่า **กฎจับได้จริง** โดยไม่ต้องมี DB
 * (ข้อมูลจริงจาก pg_proc ตรวจที่ tests/tenant/definer-grants.test.ts)
 *
 * ★ ทุกข้อเขียนเป็นคู่: สภาพที่ต้องผ่าน กับสภาพที่ต้องแดง — เทสที่ไม่เคยแดงพิสูจน์อะไรไม่ได้ (D92)
 */

const row = (p: Partial<DefinerRow> & { name: string }): DefinerRow => ({
  fn: `${p.name}()`, definer: true, result_type: "void", takes_p_tenant: false,
  anon: true, authed: true, service: true, owner_role: "postgres", src: "select 1", ...p,
});

/** ฐานที่ผ่านทุกกฎ — ตัวที่ต้องปิดปิดครบ + allowlist ตรงหมวด */
function healthy(): DefinerRow[] {
  const closed = MUST_CLOSED_DEFINERS.map((name) =>
    row({ name, anon: false, authed: false, src: "insert into x values (1)" }));
  return [
    ...closed,
    row({ name: "entity_is_vat", takes_p_tenant: true, src: "select coalesce((select is_vat from entities e where e.tenant_id = p_tenant), true)" }),
    row({ name: "fn_excise_months_open", takes_p_tenant: true, src: "select not exists (select 1 from log_product where tenant_id = p_tenant)" }),
    row({ name: "my_tenant", src: "select tenant_id from profiles where id = auth.uid()" }),
    row({ name: "my_role", src: "select role from profiles where id = auth.uid()" }),
    row({ name: "my_entities", src: "select allowed_entity_ids from profiles where id = auth.uid()" }),
    row({ name: "has_cap", src: "select case (select role from profiles where id = auth.uid()) when 'main' then true else false end" }),
    row({ name: "clear_password_change_flag", src: "begin update profiles set must_change_password = false where id = auth.uid(); end" }),
    row({ name: "next_serial", src: "declare v_tenant uuid := my_tenant(); begin insert into counters values (v_tenant); end" }),
    row({ name: "fn_bar_open_sale", src: "begin perform bar_guard(p_entity, 'bar.write'); insert into bar_sale values (1); end" }),
    row({ name: "fn_bar_add_lines", src: "begin perform bar_guard(p_entity, 'bar.write'); end" }),
    row({ name: "fn_bar_close_sale", src: "begin perform bar_guard(p_entity, 'bar.write'); end" }),
    row({ name: "bar_guard", src: "begin if not has_cap(p_cap) then raise exception 'x'; end if; end" }),
    row({ name: "fn_bar_quick_sale", src: "declare v jsonb := fn_bar_open_sale(p_entity); begin perform fn_bar_add_lines(p_entity); return fn_bar_close_sale(p_entity); end" }),
    row({ name: "fn_bar_next_doc", src: "select p_prefix || next_serial(p_prefix)" }),
    row({ name: "fn_next_sales_doc", src: "select p_prefix || next_serial(p_prefix)" }),
    row({ name: "recompute_stock_product", takes_p_tenant: true, anon: false, src: "begin if p_tenant <> my_tenant() then raise exception 'x'; end if; if not has_cap('prod.write') then raise exception 'y'; end if; end" }),
    row({ name: "trg_update_stock_product", result_type: "trigger", src: "begin perform apply_stock_delta(new.tenant_id); end" }),
  ];
}

const set = (rows: DefinerRow[], name: string, p: Partial<DefinerRow>) =>
  rows.map((r) => (r.name === name ? { ...r, ...p } : r));

describe("auditDefiners — ฐานที่ถูกต้องต้องผ่านทุกกฎ", () => {
  it("ไม่มีอะไรฟ้องเลย", () => {
    expect(auditDefiners(healthy())).toEqual({
      mustClosedOpen: [], mustClosedMissing: [], unguarded: [], pTenantOpen: [],
    });
    expect(staleAllowlist(healthy())).toEqual([]);
  });
});

describe("🚨 สิ่งที่ต้องจับได้ (แต่ละข้อทำให้ฐานที่ผ่านกลายเป็นแดง)", () => {
  it("ตัวที่ต้องปิดยังเปิดให้ anon (อาการของ revoke from public ที่ไม่มีผล)", () => {
    const a = auditDefiners(set(healthy(), "fn_mig_set_triggers", { anon: true }));
    expect(a.mustClosedOpen).toEqual(["fn_mig_set_triggers()"]);
  });

  it("ตัวที่ต้องปิด แต่ service_role เรียกไม่ได้แล้ว (restore/import จะพัง)", () => {
    expect(auditDefiners(set(healthy(), "fn_mig_truncate", { service: false })).mustClosedOpen)
      .toEqual(["fn_mig_truncate()"]);
  });

  it("ตัวที่ต้องปิดหายไปจาก DB (เปลี่ยนชื่อแล้วลืมแก้ลิสต์)", () => {
    const rows = healthy().filter((r) => r.name !== "bar_apply_move");
    expect(auditDefiners(rows).mustClosedMissing).toEqual(["bar_apply_move"]);
  });

  it("definer ใหม่ที่เปิดอยู่ ไม่มีด่าน และไม่อยู่ใน allowlist", () => {
    const rows = [...healthy(), row({ name: "fn_new_thing", src: "begin delete from sales_orders; end" })];
    expect(auditDefiners(rows).unguarded.map((x) => x.fn)).toEqual(["fn_new_thing()"]);
  });

  it("ด่านที่อยู่แค่ในคอมเมนต์ไม่นับ (ตรวจโค้ดจริง ไม่ใช่คำในไฟล์)", () => {
    const rows = [...healthy(), row({ name: "fn_new_thing", src: "-- my_tenant() has_cap(\nbegin delete from x; end" })];
    expect(auditDefiners(rows).unguarded.map((x) => x.fn)).toEqual(["fn_new_thing()"]);
  });

  it("definer ใหม่ที่รับ p_tenant — มี my_tenant() ในตัวก็ยังไม่พอ ต้องปิด/อ่านอย่างเดียว/อยู่ใน P_TENANT_GUARDED", () => {
    const rows = [...healthy(), row({ name: "fn_x", takes_p_tenant: true, src: "begin perform my_tenant(); delete from x where tenant_id = p_tenant; end" })];
    expect(auditDefiners(rows).pTenantOpen).toEqual(["fn_x()"]);
  });

  it("🔴 recompute แบบก่อน 0074 (มีแค่ coalesce(p_tenant, my_tenant())) ต้องถูกจับ แม้ผ่านกฎ ข.", () => {
    const before0074 = set(healthy(), "recompute_stock_product", {
      anon: true,
      src: "declare v_t uuid := coalesce(p_tenant, my_tenant()); begin update stock_product set balance = 0; end",
    });
    expect(auditDefiners(before0074).pTenantOpen).toEqual(["recompute_stock_product()"]);
    // มีด่านเทียบแล้ว แต่ anon ยังเรียกได้ → ก็ยังแดง
    expect(auditDefiners(set(healthy(), "recompute_stock_product", { anon: true })).pTenantOpen)
      .toEqual(["recompute_stock_product()"]);
  });

  it("trigger ไม่ถูกนับ (เรียกแบบ RPC ไม่ได้อยู่แล้ว)", () => {
    const rows = set(healthy(), "trg_update_stock_product", { src: "begin delete from everything; end" });
    expect(auditDefiners(rows).unguarded).toEqual([]);
  });
});

describe("🚨 allowlist ต้องตรวจตัวเองได้", () => {
  it("readonly: เติม insert เข้าไป → แดง · คำในคอมเมนต์/ข้อความไม่ทำให้แดงผิด", () => {
    const base = healthy();
    const vat = base.find((r) => r.name === "entity_is_vat")!;
    expect(allowViolation(base, { ...vat, src: vat.src + "; insert into x values (1)" })).toMatch(/คำสั่งเขียน/);
    expect(allowViolation(base, { ...vat, src: "-- insert ห้าม\nselect 'update ข้อความ'" })).toBeNull();
  });

  it("readonly: แอบเรียกฟังก์ชันที่เขียนได้ผ่าน select → แดง", () => {
    const base = healthy();
    const vat = base.find((r) => r.name === "entity_is_vat")!;
    expect(allowViolation(base, { ...vat, src: "select next_serial('x')" })).toMatch(/เรียก next_serial/);
  });

  it("self: แตะตารางอื่นนอกจาก profiles → แดง", () => {
    const base = healthy();
    const r = base.find((x) => x.name === "my_role")!;
    expect(allowViolation(base, { ...r, src: "select role from profiles p join entities e on true where p.id = auth.uid()" }))
      .toMatch(/แตะตาราง entities/);
  });

  it("self: update profiles โดยไม่จำกัด id = auth.uid() → แดง (ตั้ง role ให้คนอื่นได้)", () => {
    const base = healthy();
    const r = base.find((x) => x.name === "clear_password_change_flag")!;
    expect(allowViolation(base, { ...r, src: "begin if auth.uid() is null then raise exception 'x'; end if; update profiles set role = 'main'; end" }))
      .toMatch(/where id = auth.uid/);
  });

  it("delegates: เขียนเองตรง ๆ → แดง · ส่งต่อให้ตัวที่ไม่มีด่าน → แดง", () => {
    const base = healthy();
    const q = base.find((x) => x.name === "fn_bar_quick_sale")!;
    expect(allowViolation(base, { ...q, src: q.src + "; delete from bar_sale" })).toMatch(/เขียนเองตรง/);
    const noGuard = set(base, "fn_bar_add_lines", { src: "begin insert into bar_line values (1); end" });
    expect(allowViolation(noGuard, q)).toMatch(/fn_bar_add_lines/);
  });

  it("staleAllowlist: ตัวที่ปิดไปแล้วหรือหายไป ต้องถูกชี้ให้เอาออก", () => {
    const rows = set(healthy(), "entity_is_vat", { anon: false, authed: false })
      .filter((r) => r.name !== "my_entities");
    expect(staleAllowlist(rows).sort()).toEqual(["entity_is_vat", "my_entities"]);
  });

  it("ทุกชื่อใน allowlist มีเหตุผลกำกับ", () => {
    for (const [name, a] of Object.entries(DEFINER_ALLOWLIST)) expect(a.why.length, name).toBeGreaterThan(10);
  });
});
