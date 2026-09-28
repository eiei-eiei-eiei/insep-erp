import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, admin, anonClient, type Tenant,
} from "./harness";
import { DATE_FMTS, RESETS, allowedResets, type DocNumberCfg } from "../../lib/shared/docNumbering";
// ★ สเปกของรูปแบบเดิม (golden A9 / P12 / D94) — ใช้พิสูจน์ว่าค่าปริยายของ SQL ให้ผลเท่าของเดิม
import { nextWhtDocNo } from "../../lib/accounting/wht";
import { nextBatchNumber } from "../../lib/production/calc";
import { nextLotNumber } from "../../lib/production/redistill";

/**
 * รูปแบบเลขเอกสาร (D100 · migration 0075-0076) — ยิง Supabase จริง
 *
 * 🔴 ชั้นเดียวที่เห็นตรรกะนี้ — การจัดรูปเลข / ตัวกันเลขซ้ำ / ด่านสิทธิ์ อยู่ใน plpgsql ทั้งหมด (D79)
 * ทุกข้อพิสูจน์ 2 ทิศ: สิ่งที่ต้องได้ และสิ่งที่ต้องไม่ได้
 */

let A: Tenant;
let B: Tenant;
let asA: SupabaseClient;
let asB: SupabaseClient;

/** วันนี้ตามเวลาไทย แยกส่วน (ตรงกับที่ SQL ใช้ — ไม่ใช่ UTC) */
function todayTH() {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()); // YYYY-MM-DD
  const [y, m, d] = s.split("-");
  return { y: Number(y), yy: y.slice(2), mm: m, dd: d };
}

const cfg = (c: Partial<DocNumberCfg>): DocNumberCfg => ({
  prefix: "IV", date_fmt: "YYMM", era: "be", reset: "month", digits: 4, sep: "-", num_first: false, ...c,
});

const save = (c: SupabaseClient, type: string, x: DocNumberCfg, next: number | null = null) =>
  c.rpc("fn_doc_numbering_save", { p_type: type, p_entity: A.entityId, p_cfg: x, p_next: next });
const preview = (c: SupabaseClient, type: string, x: DocNumberCfg, next: number | null = null) =>
  c.rpc("fn_doc_numbering_preview", { p_type: type, p_entity: A.entityId, p_cfg: x, p_next: next });
const nextSales = async (c: SupabaseClient, prefix: string) => {
  const { data, error } = await c.rpc("fn_next_sales_doc", { p_prefix: prefix });
  expect(error, error?.message).toBeNull();
  return data as string;
};
const numOf = (no: string) => Number(no.split("-").pop());
/**
 * พนักงานขาย (sales.write ไม่มี sales.config) — สร้างครั้งเดียวแล้วใช้ร่วม
 * 🪤 harness ตั้งชื่อผู้ใช้จาก role + slug → เรียก seedUser(A, "sales") ซ้ำ = ชื่อผู้ใช้ชนกัน
 */
let salesClient: SupabaseClient | null = null;
const salesStaff = async () => (salesClient ??= (await seedUser(A, "sales")).client);
const must = (r: { error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
};
const suggest = async (c: SupabaseClient, type: string, entity: string | null, date: string | null = null) => {
  const { data, error } = await c.rpc("fn_suggest_doc_no", { p_type: type, p_entity: entity, p_date: date });
  expect(error, error?.message).toBeNull();
  return data as string;
};
/** วันนี้ไทยแบบ YYYY-MM-DD (ใช้ป้อนฟังก์ชันเดิมใน lib) */
const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("docno-a");
  B = await seedTenant("docno-b");
  asA = await signIn(A);
  asB = await signIn(B);
}, 180_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await asB?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("① ไม่ตั้งค่า = รูปแบบเดิมเป๊ะ · วันที่ตามเวลาไทย (เฟส 0)", () => {
  it("QU/ORD/INV/TAX ได้ {prefix}{ปปดดวว ค.ศ. ไทย}-{NNN}", async () => {
    const t = todayTH();
    for (const p of ["QU", "ORD", "INV", "TAX"]) {
      expect(await nextSales(asA, p)).toMatch(new RegExp(`^${p}${t.yy}${t.mm}${t.dd}-\\d{3}$`));
    }
  });

  it("key ของตัวนับยังเป็นรูปแบบเดิม (QU-ปปดดวว) — ลูกค้าเดิมเลขเดินต่อ", async () => {
    const t = todayTH();
    const { data } = await admin().from("counters").select("key")
      .eq("tenant_id", A.tenantId).eq("key", `QU-${t.yy}${t.mm}${t.dd}`);
    expect(data).toHaveLength(1);
  });

  it("ใบเสร็จผู้ไม่จด VAT ได้ชุดใหม่ RC (ข้อ 4) ไม่ใช่ INV", async () => {
    const t = todayTH();
    expect(await nextSales(asA, "RC")).toMatch(new RegExp(`^RC${t.yy}${t.mm}${t.dd}-\\d{3}$`));
  });

  it("บาร์: B/BR แยกกิจการตามเดิม", async () => {
    const t = todayTH();
    const { data, error } = await asA.rpc("fn_bar_next_doc", { p_prefix: "B", p_entity: A.entityId });
    expect(error, error?.message).toBeNull();
    expect(data).toMatch(new RegExp(`^B${t.yy}${t.mm}${t.dd}-\\d{3}$`));
    const { data: keys } = await admin().from("counters").select("key")
      .eq("tenant_id", A.tenantId).eq("key", `B-${A.entityId}-${t.yy}${t.mm}${t.dd}`);
    expect(keys).toHaveLength(1);
  });

  it("ชนิดที่ไม่รู้จัก = error ไทย ไม่ใช่เลขว่าง", async () => {
    const { error } = await asA.rpc("fn_next_doc_no", { p_type: "sales_xxx" });
    expect(error?.message).toMatch(/ไม่รู้จักชนิดเอกสาร/);
  });

  it("🚨 ไม่ล็อกอิน (anon) ออกเลขไม่ได้", async () => {
    const { data, error } = await anonClient().rpc("fn_next_doc_no", { p_type: "sales_qu" });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});

describe("② ตั้งรูปแบบเอง แล้วเลขที่ออกจริงตรงกับตัวอย่างบนจอ", () => {
  it("ตัวอย่าง = เลขที่ออกจริงตัวถัดไป (ตัวจัดรูปตัวเดียวกัน)", async () => {
    const t = todayTH();
    const be = String((t.y + 543) % 100).padStart(2, "0");
    const { data: pv, error } = await preview(asA, "sales_inv", cfg({}));
    expect(error, error?.message).toBeNull();
    expect(pv).toMatchObject({ ok: true });
    expect((pv as { next_no: string }).next_no).toMatch(new RegExp(`^IV${be}${t.mm}-\\d{4}$`));

    const { error: sErr } = await save(asA, "sales_inv", cfg({}));
    expect(sErr, sErr?.message).toBeNull();
    const issued = await nextSales(asA, "INV");
    expect(issued).toBe((pv as { next_no: string }).next_no);
  });

  it("★ เปลี่ยนรูปแบบกลางรอบ = เดินต่อจากตัวนับเดิม ไม่รีเซ็ตกลับ 1 (ข้อ 6)", async () => {
    // QU ไม่ได้ตั้งค่า ออกไปแล้วในข้อ ① → ตั้งรูปแบบใหม่ที่ key ต่างไป
    const before = numOf(await nextSales(asA, "QU"));
    expect((await save(asA, "sales_qu", cfg({ prefix: "QU", date_fmt: "YYMMDD", era: "ce", reset: "day", digits: 5 }))).error).toBeNull();
    const after = await nextSales(asA, "QU");
    expect(numOf(after)).toBe(before + 1);
    expect(after).toMatch(/-\d{5}$/);
  });

  it("เปลี่ยนแค่จำนวนหลัก = ชุดเดิมเดินต่อ", async () => {
    const n1 = numOf(await nextSales(asA, "INV"));
    expect((await save(asA, "sales_inv", cfg({ digits: 6 }))).error).toBeNull();
    const second = await nextSales(asA, "INV");
    expect(numOf(second)).toBe(n1 + 1);
    expect(second).toMatch(/-\d{6}$/);
  });
});

describe("③ มากกว่าเลขที่มีอยู่เสมอ — ไม่ซ้ำ ไม่ย้อนลำดับ (0077)", () => {
  it("🚨 เลขถัดไปมีเอกสารใช้แล้ว (ช่องใดก็ได้ของออเดอร์) → ได้เลขที่มากกว่านั้น", async () => {
    const { data: pv } = await preview(asA, "sales_inv", cfg({ digits: 6 }));
    const expected = (pv as { next_no: string }).next_no;
    // ยัดเลขนั้นไว้ในช่อง rcpt_no1 (ไม่ใช่ inv_no) — ต้องยังถูกนับ
    const { error } = await admin().from("sales_orders").insert({
      tenant_id: A.tenantId, entity_id: A.entityId, qu_no: "QU-T-DOCNO-1", order_no: "ORD-T-DOCNO-1",
      customer_name: "ลูกค้าทดสอบ", status: "รอคอนเฟิร์ม", grand_total: 1, outstanding_balance: 1,
      rcpt_no1: expected,
    });
    expect(error, error?.message).toBeNull();
    const issued = await nextSales(asA, "INV");
    expect(issued).not.toBe(expected);
    expect(numOf(issued)).toBe(numOf(expected) + 1);
  });

  it("🚨 ไม่เติมช่องว่าง: มีเลขที่พิมพ์ดักไว้ข้างหน้า → เลขใหม่ต่อจากตัวที่มากที่สุด", async () => {
    const { data: pv } = await preview(asA, "sales_inv", cfg({ digits: 6 }));
    const n = (pv as { next_n: number }).next_n;
    const ahead = (pv as { next_no: string }).next_no.replace(/\d+$/, String(n + 40).padStart(6, "0"));
    must(await admin().from("sales_orders").insert({
      tenant_id: A.tenantId, entity_id: A.entityId, qu_no: "QU-T-DOCNO-2", order_no: "ORD-T-DOCNO-2",
      customer_name: "ลูกค้าทดสอบ", status: "รอคอนเฟิร์ม", grand_total: 1, outstanding_balance: 1, inv_no: ahead,
    }));
    expect(numOf(await nextSales(asA, "INV"))).toBe(n + 41);
  });

  it("★ เปลี่ยนแค่ตัวคั่นกลางรอบ = เลขเดินต่อ ไม่เริ่ม 1 ใหม่ (ไม่มี 'เลขที่ 1' สองใบในเดือนเดียว)", async () => {
    const before = numOf(await nextSales(asA, "INV"));
    expect((await save(asA, "sales_inv", cfg({ digits: 6, sep: "/" }))).error).toBeNull();
    const after = await nextSales(asA, "INV");
    expect(after).toMatch(/\/\d{6}$/);
    expect(numOf(after.replace("/", "-"))).toBe(before + 1);
  });

  it("🚨 ตั้ง 'เลขถัดไป' ไม่มากกว่าเลขล่าสุด = บล็อก และรูปแบบไม่ถูกบันทึก (rollback ทั้งก้อน)", async () => {
    const { data: pv } = await preview(asA, "sales_inv", cfg({ digits: 6, sep: "/" }));
    const last = (pv as { next_n: number }).next_n - 1;
    const { error } = await save(asA, "sales_inv", cfg({ digits: 6, sep: "." }), last);
    expect(error?.message).toMatch(/ต้องมากกว่า/);
    const { data: cur } = await admin().from("doc_numbering").select("sep")
      .eq("tenant_id", A.tenantId).eq("doc_type", "sales_inv").single();
    expect(cur!.sep).toBe("/"); // ค่าจากครั้งที่สำเร็จ — ครั้งที่ถูกบล็อกไม่ทับ
    const { data: pv2 } = await preview(asA, "sales_inv", cfg({ digits: 6 }), last);
    expect((pv2 as { taken: boolean }).taken).toBe(true); // หน้าจอเห็นก่อนกดบันทึก
  });

  it("ตั้ง 'เลขถัดไป' ที่ว่าง = ออกเลขนั้นจริง (ลูกค้าย้ายมาจากระบบอื่น)", async () => {
    expect((await save(asA, "sales_tax", cfg({ prefix: "TX", date_fmt: "YYYY", reset: "year" }), 154)).error).toBeNull();
    expect(numOf(await nextSales(asA, "TAX"))).toBe(154);
    expect(numOf(await nextSales(asA, "TAX"))).toBe(155);
  });
});

describe("④ รูปแบบที่ทำให้เลขซ้ำ บันทึกไม่ได้ (ฝาแฝด TS ↔ SQL ต้องตรงกัน)", () => {
  it("allowedResets() ตรงกับ fn_doc_cfg_error ทุกคู่ ส่วนวันที่ × รอบ", async () => {
    for (const d of DATE_FMTS) {
      for (const r of RESETS) {
        const { data, error } = await preview(asA, "sales_ord", cfg({ date_fmt: d, reset: r }));
        expect(error, error?.message).toBeNull();
        const ok = (data as { ok: boolean }).ok;
        expect(ok, `${d} × ${r}`).toBe(allowedResets(d).includes(r));
      }
    }
  });

  it("เริ่มนับใหม่ทุกวันแต่ไม่มีวันในเลข → error ไทยที่บอกเหตุผล", async () => {
    const { error } = await save(asA, "sales_ord", cfg({ date_fmt: "YYMM", reset: "day" }));
    expect(error?.message).toMatch(/พรุ่งนี้จะซ้ำ/);
  });

  it("ตัวอักษรนำหน้ามีเว้นวรรค → error", async () => {
    const { error } = await save(asA, "sales_ord", cfg({ prefix: "IV X" }));
    expect(error?.message).toMatch(/ตัวอักษรนำหน้า/);
  });
});

describe("⑤ สิทธิ์ + ขอบเขต tenant", () => {
  it("🚨 ฝ่ายขาย ออกเลขได้ แต่ตั้งรูปแบบไม่ได้", async () => {
    const client = await salesStaff();
    const { error: issueErr } = await client.rpc("fn_next_sales_doc", { p_prefix: "QU" });
    expect(issueErr, issueErr?.message).toBeNull();
    const { error } = await client.rpc("fn_doc_numbering_save", {
      p_type: "sales_ord", p_entity: A.entityId, p_cfg: cfg({}), p_next: null,
    });
    expect(error?.message).toMatch(/ผู้ดูแลระบบ/);
  });

  it("🚨 ฝ่ายบัญชี (ไม่มี sales.write) ออกเลขเอกสารขายไม่ได้", async () => {
    const { client } = await seedUser(A, "accounting");
    const { error } = await client.rpc("fn_next_sales_doc", { p_prefix: "INV" });
    expect(error?.message).toMatch(/ไม่มีสิทธิ์/);
  });

  it("รูปแบบของ A ไม่รั่วไป B — B ยังได้รูปแบบเดิม", async () => {
    const t = todayTH();
    expect(await nextSales(asB, "INV")).toMatch(new RegExp(`^INV${t.yy}${t.mm}${t.dd}-\\d{3}$`));
    const { data } = await asB.from("doc_numbering").select("doc_type");
    expect(data).toHaveLength(0); // RLS: มองไม่เห็นแถวของ A
  });
});

describe("⑥ กลับไปใช้รูปแบบเดิม", () => {
  it("คืนค่าแล้วกลับเป็นรูปแบบเดิม · คืนซ้ำ = error ไทย (row_count = 0)", async () => {
    const t = todayTH();
    const { error } = await asA.rpc("fn_doc_numbering_reset", { p_type: "sales_tax", p_entity: A.entityId });
    expect(error, error?.message).toBeNull();
    expect(await nextSales(asA, "TAX")).toMatch(new RegExp(`^TAX${t.yy}${t.mm}${t.dd}-\\d{3}$`));
    const { error: again } = await asA.rpc("fn_doc_numbering_reset", { p_type: "sales_tax", p_entity: A.entityId });
    expect(again?.message).toMatch(/รูปแบบเริ่มต้น/);
  });

  it("หน้าตั้งค่าเห็นครบทุกชนิด พร้อมเลขถัดไป", async () => {
    const { data, error } = await asA.rpc("fn_doc_numbering_list", { p_entity: A.entityId });
    expect(error, error?.message).toBeNull();
    const rows = data as { doc_type: string; next_no: string }[];
    expect(rows.map((r) => r.doc_type)).toEqual([
      "sales_qu", "sales_ord", "sales_inv", "sales_tax", "sales_rcpt", "bar_bill", "bar_rcpt",
      "acct_wht", "prod_batch", "prod_lot",
    ]);
    for (const r of rows) expect(r.next_no, r.doc_type).toBeTruthy();
  });
});

describe("⑦ เฟส 2 — 50ทวิ / batch / ล็อต: เสนอเลขโดยไม่กินเลข · ค่าปริยาย = รูปแบบเดิมเป๊ะ", () => {
  it("50ทวิ ไม่มีใบเลย = เท่ากับ nextWhtDocNo เดิม (`6901`)", async () => {
    const { data } = await admin().from("wht_certificates").select("doc_no")
      .eq("tenant_id", A.tenantId).eq("entity_id", A.entityId);
    const legacy = nextWhtDocNo((data ?? []).map((r) => r.doc_no as string));
    expect(await suggest(asA, "acct_wht", A.entityId)).toBe(legacy);
  });

  it("🚨 50ทวิ มีเลขที่พิมพ์เองไว้ข้างหน้า = max+1 เหมือนเดิม ไม่ย้อนไปเติมช่องว่าง", async () => {
    const yy = String((todayTH().y + 543) % 100).padStart(2, "0");
    must(await admin().from("wht_certificates").insert({
      tenant_id: A.tenantId, entity_id: A.entityId, doc_no: `${yy}07`, issue_date: todayISO(),
      contact_name: "คู่ค้าทดสอบ", wht_amount: 1,
    }));
    const { data } = await admin().from("wht_certificates").select("doc_no")
      .eq("tenant_id", A.tenantId).eq("entity_id", A.entityId);
    const legacy = nextWhtDocNo((data ?? []).map((r) => r.doc_no as string));
    expect(legacy).toBe(`${yy}08`);
    expect(await suggest(asA, "acct_wht", A.entityId)).toBe(legacy);
  });

  it("เสนอเลขไม่กินเลข — เปิดฟอร์ม 3 ครั้งได้เลขเดิม", async () => {
    const a = await suggest(asA, "acct_wht", A.entityId);
    expect(await suggest(asA, "acct_wht", A.entityId)).toBe(a);
    expect(await suggest(asA, "acct_wht", A.entityId)).toBe(a);
  });

  it("batch = nextBatchNumber เดิม (ข้อมูลตั้งต้นมี 9/69 จาก harness)", async () => {
    const all: string[] = [];
    for (const t of ["log_ferment", "log_distill", "log_ferment_draw"]) {
      const { data } = await admin().from(t).select("batch").eq("tenant_id", A.tenantId);
      all.push(...(data ?? []).map((r) => r.batch as string));
    }
    for (const d of [todayISO(), "2026-03-01", "2027-01-15"]) {
      expect(await suggest(asA, "prod_batch", null, d), d).toBe(nextBatchNumber(d, all));
    }
  });

  it("ล็อตกลั่นซ้ำ = nextLotNumber เดิม", async () => {
    const { data } = await admin().from("log_redistill").select("lot_no").eq("tenant_id", A.tenantId);
    const lots = (data ?? []).map((r) => r.lot_no as string);
    expect(await suggest(asA, "prod_lot", null, todayISO())).toBe(nextLotNumber(todayISO(), lots));
  });

  it("ตั้งรูปแบบ batch เองได้ และเลขที่เสนอตามรูปแบบนั้น", async () => {
    const { error } = await asA.rpc("fn_doc_numbering_save", {
      p_type: "prod_batch", p_entity: null,
      p_cfg: cfg({ prefix: "B", date_fmt: "YYYY", era: "be", reset: "year", digits: 3, sep: "-", num_first: false }),
      p_next: null,
    });
    expect(error, error?.message).toBeNull();
    expect(await suggest(asA, "prod_batch", null, "2026-09-28")).toBe("B2569-001");
    must(await asA.rpc("fn_doc_numbering_reset", { p_type: "prod_batch", p_entity: null }));
  });

  it("🚨 สิทธิ์: ฝ่ายเงินเดือนขอเลข 50ทวิ ได้ (ชุดเดียวกับบัญชี D69) · ฝ่ายขายไม่ได้ · ฝ่ายบัญชีขอเลข batch ไม่ได้", async () => {
    const pay = await seedUser(A, "payroll");
    const r1 = await pay.client.rpc("fn_suggest_doc_no", { p_type: "acct_wht", p_entity: A.entityId, p_date: null });
    expect(r1.error, r1.error?.message).toBeNull();
    const sales = await seedUser(A, "sales_manager");
    const r2 = await sales.client.rpc("fn_suggest_doc_no", { p_type: "acct_wht", p_entity: A.entityId, p_date: null });
    expect(r2.error?.message).toMatch(/ไม่มีสิทธิ์/);
    const acct = await seedUser(A, "accounting_manager");
    const r3 = await acct.client.rpc("fn_suggest_doc_no", { p_type: "prod_batch", p_entity: null, p_date: null });
    expect(r3.error?.message).toMatch(/ไม่มีสิทธิ์/);
  });
});

describe("⑧ เฟส 3 — ลงเอกสารขายย้อนหลัง (0078)", () => {
  it("เลขเป็นของ **วันที่บนเอกสาร** ไม่ใช่วันที่กดบันทึก (รูปแบบเดิม เริ่มนับใหม่ทุกวัน)", async () => {
    const { data, error } = await asA.rpc("fn_next_doc_no", { p_type: "sales_tax", p_entity: null, p_date: "2026-09-25" });
    expect(error, error?.message).toBeNull();
    expect(data).toMatch(/^TAX260925-\d{3}$/);
  });

  it("เลขที่กรอกเอง: ยังไม่มีใช้ = ผ่าน · มีเอกสารใช้แล้ว (ช่องใดของออเดอร์ก็ได้) = ถูกจับ", async () => {
    const free = await asA.rpc("fn_doc_manual_check", { p_type: "sales_tax", p_no: "TAX260925-901" });
    expect(free.error, free.error?.message).toBeNull();
    expect(free.data).toBe(false);
    const { data: row } = await admin().from("sales_orders").select("rcpt_no1")
      .eq("tenant_id", A.tenantId).eq("qu_no", "QU-T-DOCNO-1").single();
    const used = await asA.rpc("fn_doc_manual_check", { p_type: "sales_tax", p_no: row!.rcpt_no1 });
    expect(used.data).toBe(true);
  });

  it("🚨 กรอกเลขเอกสารเองได้เฉพาะหัวหน้า (sales.config) · กรอกเลขเอกสารที่ไม่ใช่ฝั่งขายไม่ได้", async () => {
    const r = await (await salesStaff()).rpc("fn_doc_manual_check", { p_type: "sales_tax", p_no: "X1" });
    expect(r.error?.message).toMatch(/หัวหน้าฝ่ายขาย/);
    const w = await asA.rpc("fn_doc_manual_check", { p_type: "acct_wht", p_no: "6999" });
    expect(w.error?.message).toMatch(/เฉพาะเอกสารขาย/);
  });

  it("🚨 วันที่ส่งของล่วงหน้า = ปฏิเสธ (ฟอร์ม ภส. บันทึกเฉพาะของที่ออกไปแล้ว)", async () => {
    const { data, error } = await asA.rpc("fn_confirm_fulfillment", {
      p_qu_no: "QU-NOT-EXIST", p_user: "test", p_date: "2999-01-01",
    });
    expect(error, error?.message).toBeNull();
    expect(data).toMatchObject({ ok: false });
    expect((data as { error: string }).error).toMatch(/เลยวันนี้ไม่ได้/);
  });

  it("🚨 ส่งของย้อนหลัง → ฟอร์ม ภส. (log_product.doc_date) เป็นวันที่ส่งของ ไม่ใช่วันที่กด", async () => {
    const db = admin();
    must(await db.from("sales_orders").insert({
      tenant_id: A.tenantId, entity_id: A.entityId, qu_no: "QU-T-SHIP", order_no: "ORD-T-SHIP",
      customer_name: "ลูกค้าทดสอบ", status: "รอคลังจัดส่ง", grand_total: 100, outstanding_balance: 0,
    }));
    must(await db.from("sales_order_items").insert({
      tenant_id: A.tenantId, qu_no: "QU-T-SHIP", item_name: "เมนูทดสอบ", qty: 1, price: 100,
    }));
    const { data, error } = await asA.rpc("fn_confirm_fulfillment", {
      p_qu_no: "QU-T-SHIP", p_user: "test", p_date: "2026-09-20",
    });
    expect(error, error?.message).toBeNull();
    expect(data).toMatchObject({ ok: true });
    const { data: rows } = await db.from("log_product").select("doc_date")
      .eq("tenant_id", A.tenantId).eq("ref_no", "ORD-T-SHIP");
    expect(rows?.length).toBeGreaterThan(0);
    for (const r of rows ?? []) expect(r.doc_date).toBe("2026-09-20");
  });
});
