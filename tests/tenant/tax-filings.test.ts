import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, admin, type Tenant } from "./harness";

/**
 * "ยื่นแล้ว" เป็นเหตุการณ์ของตัวเอง (D95 · migration 0063) — เทสที่ยิง Supabase จริง
 *
 * 🔴 **ชั้นเดียวที่เห็นตรรกะนี้ได้** — กติกาสำคัญอยู่ใน plpgsql ทั้งหมด
 *    (`fn_file_tax` / `fn_unfile_tax` / บล็อกติ๊กอัตโนมัติใน `fn_pay_tax`)
 *    `npm run build` / `lint` / `test` มองไม่เห็นแม้แต่บรรทัดเดียว — บทเรียน D79
 *
 * ต้นเรื่อง: D88 เอา `report_runs` (เช็กลิสต์ว่ากดพิมพ์แล้ว) ไปตอบคำถาม "ยื่นแล้วหรือยัง"
 * → กดสร้าง ภพ.30 กลางเดือนเพื่อดูตัวเลข = การเตือนของงวดนั้นหายไปตลอดกาล
 */

let A: Tenant;
let asA: SupabaseClient;

const PERIOD = "2026-08";

const fileTax = (c: SupabaseClient, kind = "vat", period = PERIOD, entity?: string) =>
  c.rpc("fn_file_tax", {
    p_kind: kind, p_period: period, p_entity: entity ?? A.entityId, p_filed_on: null, p_note: "",
  });
const unfileTax = (c: SupabaseClient, kind = "vat", period = PERIOD) =>
  c.rpc("fn_unfile_tax", { p_kind: kind, p_period: period, p_entity: A.entityId, p_note: "" });

const activeFilings = async (kind: string, period = PERIOD) => {
  const { data, error } = await admin()
    .from("tax_filings")
    .select("id, source, reopened_at")
    .eq("tenant_id", A.tenantId).eq("kind", kind).eq("period", period)
    .is("reopened_at", null);
  if (error) throw new Error(error.message);
  return data ?? [];
};

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("filing");
  asA = await signIn(A);
}, 180_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("① ติ๊กยื่นเอง", () => {
  it("🚨 ติ๊กได้โดย **ไม่ต้องกดสร้างแบบก่อน** (ผู้ใช้ยื่นผ่านเว็บ e-Filing เองได้ — D69)", async () => {
    const { data, error } = await fileTax(asA);
    expect(error, error?.message).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);
    const rows = await activeFilings("vat");
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("manual");
  });

  it("🚨 ติ๊กซ้อนไม่ได้ (partial unique index) และตอบเป็นข้อความไทยที่บอกว่าต้องทำอะไร", async () => {
    const { data } = await fileTax(asA);
    expect((data as { ok: boolean }).ok).toBe(false);
    expect((data as { error: string }).error).toMatch(/ถอนการบันทึกยื่น/);
  });

  it("คนละงวด/คนละแบบ = คนละแถว ไม่ชนกัน", async () => {
    expect((await fileTax(asA, "pnd3")).data).toMatchObject({ ok: true });
    expect((await fileTax(asA, "vat", "2026-07")).data).toMatchObject({ ok: true });
    expect(await activeFilings("pnd3")).toHaveLength(1);
    expect(await activeFilings("vat", "2026-07")).toHaveLength(1);
  });

  it("งวดผิดรูปแบบต้อง error ไม่ใช่บันทึกมั่ว", async () => {
    const { error } = await fileTax(asA, "vat", "2026/08");
    expect(error, "งวดที่ไม่ใช่ yyyy-MM ต้องถูกปฏิเสธ").not.toBeNull();
  });
});

describe("② ถอนการยื่น — ถอนแล้วต้องกลับมาเตือน", () => {
  it("ถอนแล้วแถวยังอยู่ (เป็นประวัติ) แต่ไม่นับว่ายื่นแล้ว", async () => {
    const { data, error } = await unfileTax(asA, "pnd3");
    expect(error, error?.message).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);
    expect(await activeFilings("pnd3"), "ต้องไม่เหลือแถว active").toHaveLength(0);

    const all = await admin().from("tax_filings").select("id")
      .eq("tenant_id", A.tenantId).eq("kind", "pnd3").eq("period", PERIOD);
    expect(all.data ?? [], "🚨 ถอน = เติม reopened_at ไม่ใช่ลบแถว (ต้องตอบได้ว่าใครถอนเมื่อไร)").toHaveLength(1);
  });

  it("🚨 ไม่มีอะไรให้ถอน = error ภาษาไทย ไม่ใช่ ok (บทเรียน D93/D94)", async () => {
    const { data } = await unfileTax(asA, "pnd53");
    expect((data as { ok: boolean }).ok).toBe(false);
    expect((data as { error: string }).error).toMatch(/ยังไม่ได้บันทึกว่ายื่น/);
  });

  it("ถอนแล้วติ๊กใหม่ได้ (แถวที่ถอนแล้วไม่กันรอบใหม่)", async () => {
    expect((await fileTax(asA, "pnd3")).data).toMatchObject({ ok: true });
    expect(await activeFilings("pnd3")).toHaveLength(1);
  });
});

describe("③ จ่ายแล้ว = ยื่นแล้ว (ทิศทางเดียว)", () => {
  const PAY_PERIOD = "2026-06";

  it("บันทึกจ่าย → ระบบติ๊กยื่นให้เอง source = 'pay'", async () => {
    // ต้องมีแถว tax_summaries ของงวดนั้นก่อน (เงื่อนไขเดิมของ fn_pay_tax — D88)
    const s = await admin().from("tax_summaries").insert({
      tenant_id: A.tenantId, entity_id: A.entityId, report_month: PAY_PERIOD,
      total_sales_vat: 700, total_purchase_vat: 0, forwarded_vat_in: 0,
      net_payable: 700, forwarded_vat_out: 0,
    });
    expect(s.error, s.error?.message).toBeNull();

    const { data, error } = await asA.rpc("fn_pay_tax", {
      p_kind: "vat", p_period: PAY_PERIOD, p_entity: A.entityId,
      p_date: "2026-07-14", p_amount: 700, p_surcharge: 0,
      p_payload: { accountName: "บัญชีทดสอบ", category: "ภาษีมูลค่าเพิ่มนำส่ง", contactName: "กรมสรรพากร" },
    });
    expect(error, error?.message).toBeNull();
    expect((data as { ok: boolean }).ok, JSON.stringify(data)).toBe(true);

    const rows = await activeFilings("vat", PAY_PERIOD);
    expect(rows, "🚨 จ่ายแล้วต้องถือว่ายื่นแล้ว ไม่งั้นระบบเตือนงวดที่จ่ายเงินไปแล้ว").toHaveLength(1);
    expect(rows[0].source).toBe("pay");
  });

  it("🚨 ถอนการยื่นไม่ได้ขณะยังมีการจ่ายค้างอยู่ — และต้องบอกว่าต้องกดอะไรก่อน (D83)", async () => {
    const { data } = await asA.rpc("fn_unfile_tax", {
      p_kind: "vat", p_period: PAY_PERIOD, p_entity: A.entityId, p_note: "",
    });
    expect((data as { ok: boolean }).ok).toBe(false);
    expect((data as { error: string }).error).toMatch(/ถอนการบันทึกจ่าย/);
  });

  it("🚨 ถอนการจ่าย **ไม่** ถอนการยื่นตามไปด้วย (ถอนเพราะยอดผิด ≠ ไม่ได้ยื่น)", async () => {
    const { data, error } = await asA.rpc("fn_unpay_tax", {
      p_kind: "vat", p_period: PAY_PERIOD, p_entity: A.entityId,
    });
    expect(error, error?.message).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);
    expect(await activeFilings("vat", PAY_PERIOD), "ยังต้องถือว่ายื่นแล้ว").toHaveLength(1);
  });

  it("ติ๊กเองไว้ก่อนแล้วค่อยจ่าย → ไม่ระเบิด และไม่ทับค่าที่ผู้ใช้กรอกไว้", async () => {
    const P = "2026-05";
    const s = await admin().from("tax_summaries").insert({
      tenant_id: A.tenantId, entity_id: A.entityId, report_month: P,
      total_sales_vat: 100, total_purchase_vat: 0, forwarded_vat_in: 0,
      net_payable: 100, forwarded_vat_out: 0,
    });
    expect(s.error, s.error?.message).toBeNull();
    expect((await fileTax(asA, "vat", P)).data).toMatchObject({ ok: true });

    const { data, error } = await asA.rpc("fn_pay_tax", {
      p_kind: "vat", p_period: P, p_entity: A.entityId,
      p_date: "2026-06-14", p_amount: 100, p_surcharge: 0,
      p_payload: { accountName: "บัญชีทดสอบ", category: "ภาษีมูลค่าเพิ่มนำส่ง", contactName: "กรมสรรพากร" },
    });
    // 🚨 ถ้าปล่อยให้ unique index เด้งในนี้ = **บิลจ่ายหายทั้งใบ** (ทั้งฟังก์ชันเป็น transaction เดียว)
    expect(error, error?.message).toBeNull();
    expect((data as { ok: boolean }).ok, JSON.stringify(data)).toBe(true);

    const rows = await activeFilings("vat", P);
    expect(rows).toHaveLength(1);
    expect(rows[0].source, "ของที่ผู้ใช้ติ๊กเองต้องไม่ถูกเขียนทับ").toBe("manual");
  });
});

describe("④ สิทธิ์ (RLS + definer ต้องเช็คเอง)", () => {
  it("ฝ่ายบัญชี (acct.write) ติ๊กยื่นได้ แต่ถอนไม่ได้ (ถอน = acct.config)", async () => {
    const { client } = await seedUser(A, "accounting");
    const ok = await client.rpc("fn_file_tax", {
      p_kind: "pnd53", p_period: PERIOD, p_entity: A.entityId, p_filed_on: null, p_note: "",
    });
    expect(ok.error, ok.error?.message).toBeNull();
    expect((ok.data as { ok: boolean }).ok).toBe(true);

    const no = await client.rpc("fn_unfile_tax", {
      p_kind: "pnd53", p_period: PERIOD, p_entity: A.entityId, p_note: "",
    });
    expect(no.error, "🚨 ถอนแล้วระบบกลับไปเตือนคนทั้งกลุ่ม LINE → ต้องเป็นระดับหัวหน้า").not.toBeNull();
    await client.auth.signOut().catch(() => {});
  });

  it("ฝ่ายขายเข้าไม่ถึงเลย — ทั้งอ่านและเขียน", async () => {
    const { client } = await seedUser(A, "sales");
    const read = await client.from("tax_filings").select("id");
    // 🪤 "อ่านไม่ได้" ในโลก RLS = คืนลิสต์ว่าง ไม่ใช่ error → ต้อง assert จำนวนแถว (D85)
    expect(read.data ?? [], "ข้อมูลภาษีต้องไม่รั่วไปฝ่ายขาย").toHaveLength(0);

    const write = await client.rpc("fn_file_tax", {
      p_kind: "vat", p_period: "2026-04", p_entity: A.entityId, p_filed_on: null, p_note: "",
    });
    expect(write.error, "ฝ่ายขายต้องติ๊กยื่นภาษีไม่ได้").not.toBeNull();
    await client.auth.signOut().catch(() => {});
  });

  it("🚨 เขียนตรงเข้าตารางไม่ได้เลย — ไม่มี policy เขียนโดยตั้งใจ (บทเรียน D85/0052)", async () => {
    const ins = await asA.from("tax_filings").insert({
      entity_id: A.entityId, kind: "vat", period: "2026-03",
    });
    expect(ins.error, "ต้องเขียนผ่าน RPC เท่านั้น").not.toBeNull();
  });

  it("ข้าม tenant ไม่ได้ (กิจการของคนอื่น)", async () => {
    const B = await seedTenant("filing2");
    const asB = await signIn(B);
    const { data, error } = await asB.rpc("fn_file_tax", {
      p_kind: "vat", p_period: PERIOD, p_entity: A.entityId, p_filed_on: null, p_note: "",
    });
    // กิจการของ A ไม่มีอยู่ใน tenant ของ B → RPC ต้องไม่สร้างแถวให้ A
    if (!error) expect((data as { ok: boolean }).ok).toBe(false);
    const rows = await admin().from("tax_filings").select("id")
      .eq("tenant_id", B.tenantId);
    expect(rows.data ?? [], "ห้ามมีแถวข้ามลูกค้า").toHaveLength(0);
    await asB.auth.signOut().catch(() => {});
  });
});

describe("⑤ ผู้ไม่จด VAT (ด่านกฎหมาย ม.86/13 · D55)", () => {
  it("🚨 กิจการไม่จด VAT ยื่น ภพ.30 ไม่ได้ — บล็อกที่ DB ยิง API ตรงก็ไม่รอด", async () => {
    const C = await seedTenant("filing3");
    const asC = await signIn(C);
    const upd = await admin().from("entities").update({ is_vat: false })
      .eq("tenant_id", C.tenantId).eq("entity_id", C.entityId);
    expect(upd.error, upd.error?.message).toBeNull();

    const { error } = await asC.rpc("fn_file_tax", {
      p_kind: "vat", p_period: PERIOD, p_entity: C.entityId, p_filed_on: null, p_note: "",
    });
    expect(error, "ผู้ไม่จด VAT ไม่มี ภพ.30 ให้ยื่น").not.toBeNull();

    // ★ แต่ ภงด. ยังต้องยื่นได้ — หัก ณ ที่จ่ายไม่เกี่ยวกับการจดทะเบียน VAT
    const ok = await asC.rpc("fn_file_tax", {
      p_kind: "pnd3", p_period: PERIOD, p_entity: C.entityId, p_filed_on: null, p_note: "",
    });
    expect(ok.error, ok.error?.message).toBeNull();
    expect((ok.data as { ok: boolean }).ok).toBe(true);
    await asC.auth.signOut().catch(() => {});
  });

  it("วิธียื่นเก็บได้เฉพาะค่าที่รู้จัก (ชุดปิดที่ DB)", async () => {
    const bad = await admin().from("entities").update({ filing_method: "fax" })
      .eq("tenant_id", A.tenantId).eq("entity_id", A.entityId);
    expect(bad.error, "ค่าที่ไม่รู้จักต้องเข้าไม่ได้").not.toBeNull();

    const good = await admin().from("entities").update({ filing_method: "efiling" })
      .eq("tenant_id", A.tenantId).eq("entity_id", A.entityId);
    expect(good.error, good.error?.message).toBeNull();
  });
});
