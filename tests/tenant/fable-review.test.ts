import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, type Tenant } from "./harness";

/**
 * D182 — แก้ตามรีวิว Fable รอบ 1 (migration 0114) · ยิง DB จริงด้วย client ผู้ใช้ (RLS มีผล)
 *
 * 🔴 ชั้นเดียวที่เห็นตรรกะใน plpgsql (D79) · ทุกข้อพิสูจน์ 2 ทิศทาง (บล็อกเมื่อควร + ทำได้เมื่อควร)
 *   และตรวจด้วย admin ว่าแถวในตารางเป็นอย่างที่คาดจริง ไม่ใช่แค่ดูค่าที่ RPC ตอบ
 */

let A: Tenant;
let asMain: SupabaseClient;
const db = () => admin();
const must = (w: string, e: { message: string } | null) => { if (e) throw new Error(`${w}: ${e.message}`); };

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("fable");
  const base = { tenant_id: A.tenantId };
  // กิจการที่ 2 (ไม่ใช่กิจการหลัก) — ใช้พิสูจน์ Y4/Y5
  must("กิจการ 2", (await db().from("entities").insert({
    ...base, entity_id: "EID02", name: "กิจการทดสอบ 2", is_vat: true, is_default: false,
  })).error);

  // R5 — batch ที่ "รินแล้ว" (มีแต่ log_ferment + log_ferment_draw ไม่มีกลั่น) กับ batch ที่ยังไม่ริน
  must("หมัก R5", (await db().from("log_ferment").insert([
    { ...base, entity_id: "EID01", ferment_date: "2026-11-01", product_name: "สุราทดสอบ", batch: "T-F-DRAWN",
      container_id: "T-CON-01", container_qty: 1, material_ids: "T-MAT-01", material_amounts: "50" },
    { ...base, entity_id: "EID01", ferment_date: "2026-11-01", product_name: "สุราทดสอบ", batch: "T-F-FREE",
      container_id: "T-CON-01", container_qty: 1, material_ids: "T-MAT-01", material_amounts: "50" },
  ])).error);
  must("ริน R5", (await db().from("log_ferment_draw").insert({
    ...base, entity_id: "EID01", draw_date: "2026-11-10", product_name: "สุราทดสอบ", batch: "T-F-DRAWN", vol: 40, abv: 12,
  })).error);

  // Y4 — บิลหัก ณ ที่จ่ายของกิจการที่ 2 และของกิจการหลัก
  must("บิล Y4", (await db().from("transactions").insert([
    { ...base, entity_id: "EID02", tx_id: "T-TX-W2", transaction_date: "2026-11-05", type: "รายจ่าย",
      account_name: "บัญชีทดสอบ", net_amount: -97, base_amount: 100, amount_after_discount: 100,
      wht_rate: 3, wht_amount: 3, status: "ปกติ" },
    { ...base, entity_id: "EID01", tx_id: "T-TX-W1", transaction_date: "2026-11-05", type: "รายจ่าย",
      account_name: "บัญชีทดสอบ", net_amount: -97, base_amount: 100, amount_after_discount: 100,
      wht_rate: 3, wht_amount: 3, status: "ปกติ" },
  ], { defaultToNull: false })).error);

  // Y5 — รหัสสินค้าเดียวกันในคลังขายของ 2 กิจการ
  must("คลัง Y5", (await db().from("warehouse_stock").insert([
    { ...base, entity_id: "EID01", item_code: "T-ITEM", item_name: "ทดสอบ ของ", qty: 10 },
    { ...base, entity_id: "EID02", item_code: "T-ITEM", item_name: "ทดสอบ ของ", qty: 50 },
  ])).error);

  asMain = await signIn(A);
}, 180_000);

afterAll(async () => {
  await cleanupTestTenants();
}, 120_000);

// ─────────────────────────────────────────────────────────────────────────────
describe("R5 — ลบ batch หมักที่รินสุราแช่แล้ว", () => {
  const fermentRows = async (batch: string) => {
    const { count } = await db().from("log_ferment").select("id", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId).eq("batch", batch);
    return count ?? 0;
  };

  it("🚨 batch ที่รินแล้ว → ลบไม่ได้ · log_ferment ยังอยู่", async () => {
    expect(await fermentRows("T-F-DRAWN")).toBe(1); // positive control
    const { data, error } = await asMain.rpc("fn_delete_ferment_batch", { p_batch: "T-F-DRAWN" });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false });
    expect(String((data as { error: string }).error)).toContain("รินสุราแช่ไปแล้ว");
    expect(await fermentRows("T-F-DRAWN")).toBe(1);
  });

  it("batch ที่ยังไม่ริน/ไม่กลั่น → ลบได้ตามเดิม", async () => {
    const { data, error } = await asMain.rpc("fn_delete_ferment_batch", { p_batch: "T-F-FREE" });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });
    expect(await fermentRows("T-F-FREE")).toBe(0);
  });

  it("ฝั่งกลั่นยังกันเหมือนเดิม (batch ของ seed มี log_distill)", async () => {
    const { data } = await asMain.rpc("fn_delete_ferment_batch", { p_batch: A.batch });
    expect(data).toMatchObject({ ok: false });
    expect(String((data as { error: string }).error)).toContain("กลั่นไปแล้ว");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Y3 — โอนเงินตอนเลือก 'ทุกกิจการ'", () => {
  const transfer = (entity: string | null) => asMain.rpc("fn_save_transfer", {
    p_from: "บัญชีทดสอบ", p_to: "บัญชีทดสอบ 2", p_amount: 10, p_date: "2026-11-20",
    p_note: "ทดสอบ Y3", p_entity: entity,
  });

  it("🚨 'ALL' / ว่าง / null → ไม่ลงอะไรเลย + บอกให้เลือกกิจการ", async () => {
    for (const e of ["ALL", "", null]) {
      const { data, error } = await transfer(e);
      expect(error, String(e)).toBeNull();
      expect(data, String(e)).toMatchObject({ ok: false });
      expect(String((data as { error: string }).error)).toContain("เลือกกิจการที่แถบด้านบนก่อน");
    }
    const { count } = await db().from("transactions").select("tx_id", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId).ilike("description", "%ทดสอบ Y3%");
    expect(count).toBe(0);
  });

  it("เลือกกิจการจริง → โอนได้ 2 ขา ลงกิจการนั้น", async () => {
    const { data, error } = await transfer("EID02");
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });
    const { data: rows } = await db().from("transactions").select("entity_id, net_amount")
      .eq("tenant_id", A.tenantId).ilike("description", "%ทดสอบ Y3%");
    expect(rows?.map((r) => r.entity_id)).toEqual(["EID02", "EID02"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Y4 — 50ทวิ ไม่ระบุกิจการ = กิจการของบิล (เดิมตก EID01 เสมอ)", () => {
  const issue = (doc: string, txIds: string[], entity: string) => asMain.rpc("fn_issue_wht", {
    p_doc_no: doc, p_tx_ids: txIds, p_issue_date: "2026-11-20", p_contact_name: "คู่ค้าทดสอบ", p_address: "",
    p_wht_amount: 3, p_pnd_type: "ภ.ง.ด.3", p_income_type: "", p_income_seq: 5, p_base_amount: 100,
    p_payment_date: "2026-11-05", p_entity_id: entity, p_contact_id: null,
  });
  const certEntity = async (doc: string) => {
    const { data } = await db().from("wht_certificates").select("entity_id")
      .eq("tenant_id", A.tenantId).eq("doc_no", doc).maybeSingle();
    return (data?.entity_id as string | undefined) ?? null;
  };

  it("🚨 บิลของ EID02 ออกจากมุม 'ทุกกิจการ' (ส่งกิจการว่าง) → ใบอยู่ EID02 ไม่ใช่ EID01", async () => {
    const { data, error } = await issue("T-50-Y4A", ["T-TX-W2"], "");
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });
    expect(await certEntity("T-50-Y4A")).toBe("EID02");
  });

  it("ส่ง 'ALL' ก็ใช้กิจการของบิลเหมือนกัน", async () => {
    const { data } = await issue("T-50-Y4B", ["T-TX-W1"], "ALL");
    expect(data).toMatchObject({ ok: true });
    expect(await certEntity("T-50-Y4B")).toBe("EID01");
  });

  it("บิลอยู่คนละกิจการในใบเดียว → ไม่ออก + บอกเหตุผล", async () => {
    const { data } = await issue("T-50-Y4C", ["T-TX-W1", "T-TX-W2"], "");
    expect(data).toMatchObject({ ok: false });
    expect(String((data as { error: string }).error)).toContain("คนละกิจการ");
    expect(await certEntity("T-50-Y4C")).toBeNull();
  });

  it("ไม่มีบิล + ไม่ระบุกิจการ → ไม่ออก (ไม่เดาให้)", async () => {
    const { data } = await issue("T-50-Y4D", [], "");
    expect(data).toMatchObject({ ok: false });
    expect(await certEntity("T-50-Y4D")).toBeNull();
  });

  it("ระบุกิจการมาเอง → ใช้ตามที่ระบุ (พฤติกรรมเดิม)", async () => {
    const { data } = await issue("T-50-Y4E", [], "EID02");
    expect(data).toMatchObject({ ok: true });
    expect(await certEntity("T-50-Y4E")).toBe("EID02");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Y5 — ปรับสต็อกคลังขายด้วยมือ ไม่เขียนทับกิจการอื่น", () => {
  const qty = async (entity: string) => {
    const { data } = await db().from("warehouse_stock").select("qty")
      .eq("tenant_id", A.tenantId).eq("entity_id", entity).eq("item_code", "T-ITEM").single();
    return Number(data!.qty);
  };

  it("🚨 รับเข้า 5 → กิจการหลัก 10→15 · กิจการที่ 2 คง 50 · stock_moves ลงกิจการหลัก", async () => {
    const { data, error } = await asMain.rpc("fn_manual_stock_move", {
      p: { itemCode: "T-ITEM", actionType: "IN", qty: 5, remarks: "ทดสอบ Y5" }, p_user: "ทดสอบ",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, newStock: 15 });
    expect(await qty("EID01")).toBe(15);
    expect(await qty("EID02")).toBe(50);
    const { data: mv } = await db().from("stock_moves").select("entity_id, qty_before, qty_after")
      .eq("tenant_id", A.tenantId).eq("remarks", "ทดสอบ Y5");
    expect(mv).toEqual([{ entity_id: "EID01", qty_before: 10, qty_after: 15 }]);
  });

  it("รหัสที่มีแต่ในกิจการอื่น → ไม่พบ (ไม่ไปแก้ของกิจการอื่น)", async () => {
    must("ของเฉพาะ EID02", (await db().from("warehouse_stock").insert({
      tenant_id: A.tenantId, entity_id: "EID02", item_code: "T-ONLY2", item_name: "ทดสอบ", qty: 7,
    })).error);
    const { data } = await asMain.rpc("fn_manual_stock_move", {
      p: { itemCode: "T-ONLY2", actionType: "OUT", qty: 1 }, p_user: "ทดสอบ",
    });
    expect(data).toMatchObject({ ok: false });
    const { data: r } = await db().from("warehouse_stock").select("qty")
      .eq("tenant_id", A.tenantId).eq("entity_id", "EID02").eq("item_code", "T-ONLY2").single();
    expect(Number(r!.qty)).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Y6 — ยกเลิกรายการในบิลบาร์ที่ปิดแล้ว", () => {
  const E = "EID01";
  const seedSale = async (saleNo: string, lines: number[], sale: Record<string, unknown>) => {
    const base = { tenant_id: A.tenantId, entity_id: E };
    must(`บิล ${saleNo}`, (await db().from("bar_sale").insert({
      ...base, sale_no: saleNo, status: "ปกติ", tab_name: "ทดสอบ", closed_at: "2026-11-20T12:00:00Z",
      business_date: "2026-11-20", method: "เงินสด", customer_id: "T-C-Y6", ...sale,
    }, { defaultToNull: false })).error);
    must(`รายการ ${saleNo}`, (await db().from("bar_sale_item").insert(lines.map((amt, i) => ({
      ...base, sale_no: saleNo, line_no: i + 1, menu_id: null, menu_name: `ทดสอบ ${i + 1}`,
      qty: 1, price: amt, amount: amt, cost: 0,
    })))).error);
  };
  const saleOf = async (saleNo: string) => {
    const { data } = await db().from("bar_sale").select("sub_total, discount, rounding, grand_total")
      .eq("tenant_id", A.tenantId).eq("entity_id", E).eq("sale_no", saleNo).single();
    return Object.fromEntries(Object.entries(data!).map(([k, v]) => [k, Number(v)]));
  };
  const spend = async () => {
    const { data } = await db().from("bar_customer").select("spend_total")
      .eq("tenant_id", A.tenantId).eq("customer_id", "T-C-Y6").single();
    return Number(data!.spend_total);
  };
  const voidLine = (saleNo: string, line: number) =>
    asMain.rpc("fn_bar_void_line", { p_entity: E, p_sale_no: saleNo, p_line_no: line, p_reason: "ทดสอบ" });

  beforeAll(async () => {
    must("ลูกค้า Y6", (await db().from("bar_customer").insert({
      tenant_id: A.tenantId, entity_id: E, customer_id: "T-C-Y6", name: "ทดสอบ Y6", visits: 3, spend_total: 1000,
    })).error);
  });

  it("🚨 ลด 10% ของ 1,000 = 100 → ยกเลิก 200 → ลด 80 จ่าย 720 (ผู้ใช้ตัดสิน) · ยอดสะสมลูกค้าถอย 180", async () => {
    await seedSale("T-Y6-PCT", [800, 200], { sub_total: 1000, discount: 100, discount_pct: 10, rounding: 0, grand_total: 900 });
    const before = await spend();
    const { error } = await voidLine("T-Y6-PCT", 2);
    expect(error, error?.message).toBeNull();
    expect(await saleOf("T-Y6-PCT")).toEqual({ sub_total: 800, discount: 80, rounding: 0, grand_total: 720 });
    expect(await spend()).toBe(before - 180);
  });

  it("ส่วนลดเป็นบาท → คงบาทเดิม (ไม่เกินยอด)", async () => {
    await seedSale("T-Y6-BAHT", [800, 200], { sub_total: 1000, discount: 100, discount_pct: null, rounding: 0, grand_total: 900 });
    await voidLine("T-Y6-BAHT", 2);
    expect(await saleOf("T-Y6-BAHT")).toEqual({ sub_total: 800, discount: 100, rounding: 0, grand_total: 700 });
  });

  it("🚨 เปิดปัดเศษ: 99.75 (ปัด +0.25 = 100) → ยกเลิก 29.50 → 70.25 ปัดเป็น 70 (ไม่ใช่ 70.50)", async () => {
    must("เปิดปัดเศษ", (await db().from("app_settings").insert({
      tenant_id: A.tenantId, kind: "bar_round_cash", value: "1",
    })).error);
    await seedSale("T-Y6-RND", [70.25, 29.5], { sub_total: 99.75, discount: 0, discount_pct: null, rounding: 0.25, grand_total: 100 });
    await voidLine("T-Y6-RND", 2);
    expect(await saleOf("T-Y6-RND")).toEqual({ sub_total: 70.25, discount: 0, rounding: -0.25, grand_total: 70 });
  });

  it("ยกเลิกหมดทุกรายการ → 0 พอดี (เดิมค้าง rounding เช่น 0.25)", async () => {
    await voidLine("T-Y6-RND", 1);
    expect(await saleOf("T-Y6-RND")).toEqual({ sub_total: 0, discount: 0, rounding: 0, grand_total: 0 });
  });
});
