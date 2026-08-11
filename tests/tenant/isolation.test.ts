import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, anonClient,
  TENANT_TABLES, type Tenant,
} from "./harness";
// ใช้ path ตรง ไม่ใช่ alias @/ — vitest config ชุดนี้ไม่ได้ตั้ง resolve.alias ไว้
import { usernameToEmail } from "../../lib/shared/auth-domain";

/**
 * เทสกันข้อมูลรั่วข้ามลูกค้า — NEXT_STEPS:164 ระบุว่านี่คือความเสี่ยงอันดับ 1 ของ multi-tenant
 *
 * โครง: สร้างลูกค้าทดสอบ 2 ราย (A, B) ที่ใช้ "คีย์เหมือนกันทุกอย่าง" โดยตั้งใจ
 *       (EID01 · C-9001 · batch 9/69 · QU990101-001 · TR-99010101-0001)
 *       → ถ้าระบบแยก tenant ไม่จริง จะพังตั้งแต่ตอน seed หรือมองเห็นกันตอนอ่าน
 *
 * เทส 3 ชั้น:
 *   1. อ่านข้ามไม่ได้        — RLS (0028)
 *   2. ยิง RPC ข้ามไม่ได้    — ★ สำคัญกว่าชั้น 1 เพราะ security definer bypass RLS แล้วเงียบ (0029)
 *   3. positive control     — ของตัวเองยังทำงานปกติ (กันเทสผ่านเพราะ "พังหมดทุกอย่าง")
 */

let A: Tenant;
let B: Tenant;
let asA: SupabaseClient;

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("a");
  B = await seedTenant("b");
  asA = await signIn(A);
}, 120_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

// ── ชั้น 0: seed สำเร็จ = คีย์ซ้ำข้าม tenant ได้จริง ────────────────────────
describe("คีย์ซ้ำข้ามลูกค้าได้ (ผลของการผ่าตัด PK/unique ใน 0027)", () => {
  it("2 ลูกค้าใช้ EID01 / C-9001 / batch เดียวกัน / เลขบิลเดียวกัน พร้อมกันได้", () => {
    expect(A.tenantId).not.toBe(B.tenantId);
    expect(A.entityId).toBe(B.entityId);
    expect(A.quNo).toBe(B.quNo);
    expect(A.txId).toBe(B.txId);
    expect(A.batch).toBe(B.batch);
  });

  it("ชื่อผู้ใช้ซ้ำกันได้เพราะ slug คั่นในอีเมลภายใน", () => {
    expect(A.username).toBe(B.username); // ทั้งคู่ชื่อ 'owner'
    expect(A.email).not.toBe(B.email);
  });

  it("★ สูตร usernameToEmail(username, slug) ต้องล็อกอินเข้าบัญชีที่ seed ไว้ได้จริง", async () => {
    // เทสนี้เชื่อมสิ่งที่แอปคำนวณ (lib/shared/auth-domain) เข้ากับบัญชีที่มีอยู่จริงใน DB
    // ถ้า local-part ของอีเมลกับ username ไม่ตรงกัน จะจับได้ตรงนี้ก่อนถึงมือผู้ใช้
    for (const t of [A, B]) {
      expect(usernameToEmail(t.username, t.slug)).toBe(t.email);

      const c = anonClient();
      const { error } = await c.auth.signInWithPassword({
        email: usernameToEmail(t.username, t.slug),
        password: t.password,
      });
      expect(error, `ล็อกอินด้วย username+slug ของ ${t.slug} ไม่ผ่าน`).toBeNull();
      await c.auth.signOut();
    }
  });

  it("ชื่อผู้ใช้เดียวกันแต่คนละ slug = คนละบัญชี (ไม่ใช่คนเดียวกัน)", () => {
    expect(usernameToEmail("owner", A.slug)).not.toBe(usernameToEmail("owner", B.slug));
  });
});

// ── ชั้น 1: อ่านข้ามไม่ได้ ──────────────────────────────────────────────────
describe("ชั้น 1 — RLS: อ่านข้ามลูกค้าไม่ได้", () => {
  for (const table of TENANT_TABLES) {
    it(`${table} — ทุกแถวที่ A เห็นต้องเป็นของ A`, async () => {
      const { data, error } = await asA.from(table).select("tenant_id");
      expect(error, `${table} อ่านไม่ได้: ${error?.message}`).toBeNull();

      const foreign = (data ?? []).filter((r) => r.tenant_id !== A.tenantId);
      expect(
        foreign.length,
        `${table}: A เห็นแถวของ tenant อื่น ${foreign.length} แถว — ข้อมูลรั่ว!`,
      ).toBe(0);
    });
  }

  it("นับตรง ๆ: A มองไม่เห็นแถวของ B เลยแม้แต่แถวเดียว", async () => {
    for (const table of ["sales_orders", "transactions", "log_distill", "contacts", "products"]) {
      const { count } = await asA
        .from(table).select("*", { count: "exact", head: true }).eq("tenant_id", B.tenantId);
      expect(count ?? 0, `${table} เห็นแถวของ B`).toBe(0);
    }
  });

  it("tenants: A เห็นแค่ tenant ตัวเอง", async () => {
    const { data } = await asA.from("tenants").select("id");
    expect(data?.map((r) => r.id)).toEqual([A.tenantId]);
  });
});

// ── ชั้น 2: ยิง RPC ด้วยคีย์ของอีกฝั่งไม่ได้ ★ สำคัญที่สุด ──────────────────
describe("ชั้น 2 — RPC: ใช้คีย์ของลูกค้าอื่นไม่ได้ (definer bypass RLS)", () => {
  /**
   * ⚠️ ต้องใช้ `quNoOwn`/`txIdOwn` (คีย์ที่มีเฉพาะฝั่ง B) เท่านั้น
   *    ถ้าใช้คีย์ที่ซ้ำกันทั้งสองฝั่ง A จะไปโดนของตัวเองแล้วสำเร็จ = เทสไม่ได้ทดสอบอะไรเลย
   */
  const expectDenied = (label: string, res: { data: unknown; error: unknown }) => {
    if (res.error) return; // โยน exception = ปฏิเสธแล้ว
    const d = res.data as { ok?: boolean } | null;
    expect(
      d?.ok,
      `${label}: ทำงานสำเร็จกับข้อมูลของลูกค้าอื่น — ช่องโหว่!`,
    ).not.toBe(true);
  };

  it("ตั้งต้น: A ต้องไม่มีเอกสารเลขเดียวกับชุดเฉพาะของ B (ไม่งั้นเทสข้างล่างไม่มีความหมาย)", async () => {
    const { count: q } = await admin().from("sales_orders")
      .select("*", { count: "exact", head: true }).eq("tenant_id", A.tenantId).eq("qu_no", B.quNoOwn);
    const { count: t } = await admin().from("transactions")
      .select("*", { count: "exact", head: true }).eq("tenant_id", A.tenantId).eq("tx_id", B.txIdOwn);
    expect(q ?? 0).toBe(0);
    expect(t ?? 0).toBe(0);
  });

  it("fn_apply_order_action ด้วย qu_no เฉพาะของ B → ต้องถูกปฏิเสธ", async () => {
    expectDenied(
      "fn_apply_order_action",
      await asA.rpc("fn_apply_order_action", {
        p_qu_no: B.quNoOwn, p_update: { status: "ยกเลิก" }, p_revenue: null,
      }),
    );
    const { data } = await admin().from("sales_orders")
      .select("status").eq("tenant_id", B.tenantId).eq("qu_no", B.quNoOwn).single();
    expect(data?.status, "สถานะออเดอร์ของ B ถูกเปลี่ยน!").toBe("รอคอนเฟิร์ม");
  });

  it("fn_cancel_order ด้วย qu_no เฉพาะของ B → ต้องถูกปฏิเสธ", async () => {
    expectDenied("fn_cancel_order", await asA.rpc("fn_cancel_order", { p_qu_no: B.quNoOwn }));
    const { data } = await admin().from("sales_orders")
      .select("status").eq("tenant_id", B.tenantId).eq("qu_no", B.quNoOwn).single();
    expect(data?.status, "ออเดอร์ของ B ถูกยกเลิก!").not.toBe("ยกเลิก");
  });

  it("fn_void_deposit_invoice ด้วย qu_no เฉพาะของ B → ต้องถูกปฏิเสธ", async () => {
    expectDenied(
      "fn_void_deposit_invoice",
      await asA.rpc("fn_void_deposit_invoice", { p_qu_no: B.quNoOwn }),
    );
  });

  it("fn_confirm_fulfillment ด้วย qu_no เฉพาะของ B → ต้องถูกปฏิเสธ", async () => {
    expectDenied(
      "fn_confirm_fulfillment",
      await asA.rpc("fn_confirm_fulfillment", { p_qu_no: B.quNoOwn, p_user: "attacker" }),
    );
  });

  it("fn_void_transaction ด้วย tx_id เฉพาะของ B → ต้องถูกปฏิเสธ", async () => {
    expectDenied("fn_void_transaction", await asA.rpc("fn_void_transaction", { p_tx_id: B.txIdOwn }));
    const { data } = await admin().from("transactions")
      .select("status").eq("tenant_id", B.tenantId).eq("tx_id", B.txIdOwn).single();
    expect(data?.status, "บิลของ B ถูกยกเลิก!").toBe("ปกติ");
  });

  it("fn_settle_apar ด้วย tx_id เฉพาะของ B → ต้องถูกปฏิเสธ", async () => {
    expectDenied(
      "fn_settle_apar",
      await asA.rpc("fn_settle_apar", { p_tx_id: B.txIdOwn, p_account_name: "บัญชีทดสอบ" }),
    );
    const { data } = await admin().from("transactions")
      .select("ap_ar_status").eq("tenant_id", B.tenantId).eq("tx_id", B.txIdOwn).single();
    expect(data?.ap_ar_status, "บิลค้างของ B ถูกเคลียร์!").toBe("AR");
  });

  it("คีย์ที่ซ้ำกันทั้งสองฝั่ง: A ทำงานกับ 'ของตัวเอง' ไม่ใช่ของ B", async () => {
    // เคสนี้ต้องสำเร็จ (ไม่ใช่ช่องโหว่) — แต่ต้องไม่ไปแตะแถวของ B
    const res = await asA.rpc("fn_apply_order_action", {
      p_qu_no: A.quNo, p_update: { status: "ยกเลิก" }, p_revenue: null,
    });
    expect(res.error).toBeNull();

    const { data: bRow } = await admin().from("sales_orders")
      .select("status").eq("tenant_id", B.tenantId).eq("qu_no", B.quNo).single();
    expect(bRow?.status, "เลขเอกสารซ้ำกันแล้วไปโดนของอีกเจ้า!").toBe("รอคอนเฟิร์ม");
  });

  it("fn_receive_material: ชื่อวัตถุดิบของ B ต้องหาไม่เจอจากฝั่ง A", async () => {
    // ชื่อเหมือนกันทั้งสอง tenant → ต้อง match ของตัวเองเท่านั้น ไม่ใช่ของ B
    const res = await asA.rpc("fn_receive_material", {
      p_idempotency_key: "T-CROSS-1", p_date: "2026-01-02",
      p_doc_ref: "T-REF", p_note: "ทดสอบ",
      p_items: [{ material_name: "ไม่มีชื่อนี้ในกิจการ A", amount: 1 }],
    });
    expect(res.error, "ควร error เพราะไม่พบวัตถุดิบชื่อนี้ใน tenant ตัวเอง").not.toBeNull();
  });

  it("fn_sell_product: idempotency key ของ A ไม่ไปบล็อกงานของ B", async () => {
    const key = "T-IDEM-SHARED";
    const okA = await asA.rpc("fn_sell_product", {
      p_idempotency_key: key, p_date: "2026-01-03", p_trans_type: "จ่าย",
      p_note: "ทดสอบ A", p_items: [{ product_id: A.productId, amount: 1 }],
    });
    expect(okA.error).toBeNull();
    expect((okA.data as { duplicate: boolean }).duplicate).toBe(false);

    const asB = await signIn(B);
    const okB = await asB.rpc("fn_sell_product", {
      p_idempotency_key: key, p_date: "2026-01-03", p_trans_type: "จ่าย",
      p_note: "ทดสอบ B", p_items: [{ product_id: B.productId, amount: 1 }],
    });
    await asB.auth.signOut();
    expect(okB.error).toBeNull();
    expect(
      (okB.data as { duplicate: boolean }).duplicate,
      "key เดียวกันของคนละลูกค้าถูกมองว่าซ้ำ — งานของ B หายเงียบ",
    ).toBe(false);
  });
});

// ── ชั้น 3: positive control — ของตัวเองต้องยังทำงานปกติ ────────────────────
describe("ชั้น 3 — positive control (กันเทสผ่านเพราะพังหมดทุกอย่าง)", () => {
  it("A แก้ออเดอร์ของตัวเองได้ปกติ", async () => {
    const { data, error } = await asA.rpc("fn_apply_order_action", {
      p_qu_no: A.quNo, p_update: { remarks: null, status: "รอคอนเฟิร์ม" }, p_revenue: null,
    });
    expect(error).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);
  });

  it("A อ่านข้อมูลตัวเองครบ (ไม่ใช่ถูกบล็อกหมด)", async () => {
    const { data } = await asA.from("sales_orders").select("qu_no");
    expect(data?.map((r) => r.qu_no)).toContain(A.quNo);
  });

  it("★ กติกาเหล็ก: batch ซ้ำในกิจการเดียวกันต้องถูกบล็อก (1 batch = 1 แถว)", async () => {
    const { error } = await asA.from("log_distill").insert({
      tenant_id: A.tenantId, entity_id: A.entityId,
      distill_date: "2026-02-01", product_name: "สุราทดสอบ", batch: A.batch, vol: 10, abv: 40,
    });
    expect(
      error,
      "batch ซ้ำในกิจการเดียวกันต้อง insert ไม่ผ่าน — ฟอร์ม ภส. จะหักส่าซ้ำ",
    ).not.toBeNull();
  });

  it("เลขรันเอกสารของ A กับ B ไม่กินกัน", async () => {
    const first = await asA.rpc("fn_next_sales_doc", { p_prefix: "QU" });
    expect(first.error).toBeNull();

    const asB = await signIn(B);
    const bDoc = await asB.rpc("fn_next_sales_doc", { p_prefix: "QU" });
    await asB.auth.signOut();
    expect(bDoc.error).toBeNull();

    // counter แยกกัน → เลขที่ได้ต้องเท่ากัน (ต่างคนต่างเริ่มนับ) ไม่ใช่วิ่งต่อกัน
    expect(bDoc.data, "B ได้เลขต่อจาก A = counter ใช้ร่วมกัน").toBe(first.data);
  });
});
