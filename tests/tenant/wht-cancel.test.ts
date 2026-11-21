import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, anonClient, assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, type Tenant } from "./harness";
import { issuedTxIdsOf } from "../../lib/accounting/whtCancel";

/**
 * D180 ยกเลิกใบ 50ทวิ (migration 0113) — ยิง fn_cancel_wht / fn_update_wht / fn_edit_transaction ด้วย client จริง
 *
 * 🚨 ตรรกะทั้งหมดอยู่ใน plpgsql — build/lint/test มองไม่เห็น (D79) ชั้นนี้ชั้นเดียวที่จับได้
 * ★ พิสูจน์ 2 ทิศทาง (D85/D93): คนที่ควรยกเลิกได้ ยกเลิกได้จริง · คนที่ไม่ควร ยกเลิกไม่ได้ และแถวไม่เปลี่ยน
 */

let A: Tenant;
let OTHER: Tenant;
let asMain: SupabaseClient;
let asViewer: SupabaseClient;
let asPayroll: SupabaseClient;
let asStaffA: SupabaseClient; // accounting จำกัดเฉพาะกิจการ A
const B = "EID02";
const ACC = "บัญชีทดสอบยกเลิก50ทวิ";
const must = (w: string, e: { message: string } | null) => { if (e) throw new Error(`${w}: ${e.message}`); };

/** ปี พ.ศ. 2 หลักของวันนี้ — รูปแบบเลข 50ทวิ ปริยาย (`6901`) */
const YY = String((new Date().getFullYear() + 543) % 100).padStart(2, "0");
const no = (n: number) => `${YY}${n}`;

const TX = {
  plain: "T-WC-TX-PLAIN",
  filed: "T-WC-TX-FILED",
  reopened: "T-WC-TX-REOPEN",
  move: "T-WC-TX-MOVE",
  inB: "T-WC-TX-B",
  misc: "T-WC-TX-MISC",
};
const DOC = {
  low: no(950),
  plain: no(951), // เลขมากสุดของปี → ยกเลิกแล้วต้องไม่ถูกเสนอซ้ำ
  filed: no(940),
  reopened: no(941),
  move: no(942),
  inB: no(943),
  emp: no(944),
  perms: no(945),
  dbl: no(946),
};

async function cert(docNo: string, entity = A.entityId) {
  const { data, error } = await admin().from("wht_certificates")
    .select("status, cancel_reason, cancelled_at, cancelled_by, tx_ids")
    .eq("tenant_id", A.tenantId).eq("entity_id", entity).eq("doc_no", docNo).maybeSingle();
  must("อ่านใบ", error);
  return data;
}
async function cancel(c: SupabaseClient, docNo: string, over: { entity?: string; reason?: string; ack?: boolean } = {}) {
  return c.rpc("fn_cancel_wht", {
    p_entity_id: over.entity ?? A.entityId,
    p_doc_no: docNo,
    p_reason: over.reason ?? "ยอดจ่ายรวมค่าขนส่ง (ทดสอบ)",
    p_ack_filed: over.ack ?? false,
  });
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("whtcancel");
  OTHER = await seedTenant("whtcancel2");
  const db = admin();
  const T = A.tenantId;
  must("กิจการ B", (await db.from("entities").insert({ tenant_id: T, entity_id: B, name: "กิจการ B ทดสอบ" })).error);
  must("บัญชี", (await db.from("bank_accounts").insert(
    { tenant_id: T, account_id: "T-B-WC", account_name: ACC, entity_ids: [], opening_balance: 0 },
  )).error);
  const tx = (id: string, over: Record<string, unknown> = {}) => ({
    tenant_id: T, entity_id: A.entityId, tx_id: id, transaction_date: "2026-10-10", type: "รายจ่าย",
    account_name: ACC, contact_name: "คู่ค้าทดสอบ", net_amount: 97, amount_after_discount: 100, base_amount: 100,
    wht_rate: 3, wht_amount: 3, status: "ปกติ", ...over,
  });
  must("บิล", (await db.from("transactions").insert([
    tx(TX.plain),
    // บิลค้างที่เคลียเดือน 11 — ภงด. นับเดือน 11 ไม่ใช่ 10
    tx(TX.filed, { transaction_date: "2026-09-25", settled_on: "2026-11-03" }),
    tx(TX.reopened, { transaction_date: "2026-08-10" }),
    tx(TX.move),
    tx(TX.inB, { entity_id: B }),
    tx(TX.misc),
  ], { defaultToNull: false })).error);
  const c = (doc_no: string, tx_ids: string[], over: Record<string, unknown> = {}) => ({
    tenant_id: T, entity_id: A.entityId, doc_no, issue_date: "2026-10-12", contact_name: "คู่ค้าทดสอบ",
    wht_amount: 3, base_amount: 100, pnd_type: "ภ.ง.ด.3", tx_ids, ...over,
  });
  must("50ทวิ", (await db.from("wht_certificates").insert([
    c(DOC.low, [TX.misc]),
    c(DOC.plain, [TX.plain]),
    c(DOC.filed, [TX.filed]),
    c(DOC.reopened, [TX.reopened]),
    c(DOC.move, [TX.move]),
    c(DOC.inB, [TX.inB], { entity_id: B }),
    c(DOC.emp, [], { emp_id: "T-EMP-1", tax_year: 2569 }),
    c(DOC.perms, [TX.misc]),
    c(DOC.dbl, [TX.misc]),
  ])).error);
  // ใบของ tenant อื่น — เลขไม่ซ้ำกับฝั่ง A (ยิงข้ามได้จริง)
  must("50ทวิ tenant อื่น", (await db.from("wht_certificates").insert({
    tenant_id: OTHER.tenantId, entity_id: OTHER.entityId, doc_no: "T-WC-OTHER", issue_date: "2026-10-12",
    contact_name: "คู่ค้าอีกเจ้า", wht_amount: 3, base_amount: 100, tx_ids: [],
  })).error);
  must("ยื่นแล้ว", (await db.from("tax_filings").insert([
    { tenant_id: T, entity_id: A.entityId, kind: "pnd53", period: "2026-11" },
    // ถอนแล้ว — ต้องไม่นับ
    { tenant_id: T, entity_id: A.entityId, kind: "pnd3", period: "2026-08", reopened_at: new Date().toISOString() },
  ])).error);

  asMain = await signIn(A);
  asViewer = (await seedUser(A, "viewer")).client;
  asPayroll = (await seedUser(A, "payroll")).client;
  const staff = await seedUser(A, "accounting");
  must("จำกัดกิจการ", (await db.from("profiles").update({ allowed_entity_ids: [A.entityId] }).eq("id", staff.userId)).error);
  asStaffA = staff.client;
}, 240_000);

afterAll(async () => {
  for (const c of [asMain, asViewer, asPayroll, asStaffA]) await c?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("ยกเลิกได้", () => {
  it("★ main ยกเลิกใบ — แถวยังอยู่ ขึ้นสถานะยกเลิก + เหตุผล + ใครยกเลิก", async () => {
    const { data, error } = await cancel(asMain, DOC.plain);
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, doc_no: DOC.plain });
    const r = await cert(DOC.plain);
    expect(r).toMatchObject({ status: "ยกเลิก", cancel_reason: "ยอดจ่ายรวมค่าขนส่ง (ทดสอบ)" });
    expect(r!.cancelled_at).toBeTruthy();
    expect(r!.cancelled_by).toBeTruthy();
    // 🚨 ใบนี้เลขมากสุดของปี — ถ้ายกเลิกด้วยการลบแถว เลขถัดไปจะกลับมาเป็นเลขนี้ (max+1 · D100)
    const s = await asMain.rpc("fn_suggest_doc_no", { p_type: "acct_wht", p_entity: A.entityId, p_date: null });
    expect(s.error).toBeNull();
    expect(String(s.data)).toBe(no(952));
  });

  it("★ บิลกลับเข้าคิวรอออก (ใบที่ผู้ใช้อ่านได้ ผ่าน RLS) · ออกใบใหม่ให้บิลเดิมได้ แล้วออกจากคิวอีกครั้ง", async () => {
    const read = async () => {
      const { data, error } = await asMain.from("wht_certificates").select("tx_ids, status");
      must("อ่านใบ", error);
      return issuedTxIdsOf(data as { tx_ids: string[]; status: string }[]);
    };
    expect((await read()).has(TX.plain)).toBe(false);
    const { data, error } = await asMain.rpc("fn_issue_wht", {
      p_doc_no: no(952), p_tx_ids: [TX.plain], p_issue_date: "2026-11-21", p_contact_name: "คู่ค้าทดสอบ", p_address: "",
      p_wht_amount: 3, p_pnd_type: "ภ.ง.ด.3", p_income_type: "", p_income_seq: 5, p_base_amount: 90,
      p_payment_date: "2026-10-10", p_entity_id: A.entityId, p_contact_id: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });
    expect((await read()).has(TX.plain)).toBe(true);
  });

  it("🚨 เลขที่ยกเลิกไม่ถูกนำกลับมาใช้ — ออกเลขใบเดิมซ้ำไม่ได้ (PK)", async () => {
    const dup = await asMain.rpc("fn_issue_wht", {
      p_doc_no: DOC.plain, p_tx_ids: [TX.plain], p_issue_date: "2026-11-21", p_contact_name: "คู่ค้าทดสอบ", p_address: "",
      p_wht_amount: 3, p_pnd_type: "ภ.ง.ด.3", p_income_type: "", p_income_seq: 5, p_base_amount: 90,
      p_payment_date: "2026-10-10", p_entity_id: A.entityId, p_contact_id: null,
    });
    expect(dup.data).toMatchObject({ ok: false });
  });

  it("ยกเลิกซ้ำไม่ได้", async () => {
    const { data } = await cancel(asMain, DOC.plain);
    expect(data).toMatchObject({ ok: false });
    expect(String((data as { error: string }).error)).toContain("ยกเลิกไปแล้ว");
  });

  it("accounting ที่จำกัดกิจการ ยกเลิกใบในกิจการของตัวเองได้", async () => {
    const { data } = await cancel(asStaffA, DOC.dbl);
    expect(data).toMatchObject({ ok: true });
    expect((await cert(DOC.dbl))!.status).toBe("ยกเลิก");
  });
});

describe("ยกเลิกไม่ได้ — แถวไม่เปลี่ยน", () => {
  it("เหตุผลว่าง", async () => {
    const { data } = await cancel(asMain, DOC.perms, { reason: "   " });
    expect(data).toMatchObject({ ok: false });
    expect((await cert(DOC.perms))!.status).toBe("ปกติ");
  });

  it("🚨 viewer (อ่านอย่างเดียว) · ฝ่ายเงินเดือน (pay.write) ยกเลิกใบของคู่ค้าไม่ได้", async () => {
    for (const c of [asViewer, asPayroll]) {
      const { data, error } = await cancel(c, DOC.perms);
      expect(error).toBeNull();
      expect(data).toMatchObject({ ok: false });
    }
    expect((await cert(DOC.perms))!.status).toBe("ปกติ");
  });

  it("🚨 ผู้ใช้ที่จำกัดกิจการ ยกเลิกใบของกิจการอื่นไม่ได้ (positive control: ข้อบนยกเลิกในกิจการตัวเองได้)", async () => {
    const { data } = await cancel(asStaffA, DOC.inB, { entity: B });
    expect(data).toMatchObject({ ok: false });
    expect((await cert(DOC.inB, B))!.status).toBe("ปกติ");
  });

  it("🚨 ยิงข้าม tenant = ไม่พบ · ใบของอีกเจ้าไม่เปลี่ยน", async () => {
    const { data } = await cancel(asMain, "T-WC-OTHER", { entity: OTHER.entityId });
    expect(data).toMatchObject({ ok: false });
    const { data: o } = await admin().from("wht_certificates").select("status")
      .eq("tenant_id", OTHER.tenantId).eq("doc_no", "T-WC-OTHER").single();
    expect(o!.status).toBe("ปกติ");
  });

  it("🚨 ไม่ล็อกอิน (anon) เรียกไม่ได้", async () => {
    const { data, error } = await cancel(anonClient(), DOC.perms);
    expect(error !== null || (data as { ok: boolean }).ok === false).toBe(true);
    expect((await cert(DOC.perms))!.status).toBe("ปกติ");
  });

  it("ใบของพนักงาน (แอปเงินเดือน) ยกเลิกจากที่นี่ไม่ได้ แม้เป็น main", async () => {
    const { data } = await cancel(asMain, DOC.emp);
    expect(data).toMatchObject({ ok: false });
    expect(String((data as { error: string }).error)).toContain("พนักงาน");
    expect((await cert(DOC.emp))!.status).toBe("ปกติ");
  });
});

describe("ภงด. ยื่นแล้ว = เตือน ต้องรับทราบ (ไม่บล็อก)", () => {
  it("🚨 ไม่ติ๊กรับทราบ = need_ack + บอกแบบ/งวด (เดือนที่เคลีย ไม่ใช่เดือนบิล) · แถวไม่เปลี่ยน", async () => {
    const { data } = await cancel(asMain, DOC.filed);
    expect(data).toMatchObject({ ok: false, need_ack: true });
    expect(String((data as { filed: string }).filed)).toBe("ภ.ง.ด.53 งวด 2026-11");
    expect((await cert(DOC.filed))!.status).toBe("ปกติ");
  });

  it("ติ๊กรับทราบ = ยกเลิกได้", async () => {
    const { data } = await cancel(asMain, DOC.filed, { ack: true });
    expect(data).toMatchObject({ ok: true });
    expect((await cert(DOC.filed))!.status).toBe("ยกเลิก");
  });

  it("แถวยื่นที่ถอนแล้วไม่นับ — ยกเลิกได้โดยไม่ต้องรับทราบ", async () => {
    const { data } = await cancel(asMain, DOC.reopened);
    expect(data).toMatchObject({ ok: true });
  });
});

describe("RPC เดิมรู้จักสถานะ", () => {
  it("🚨 fn_update_wht แก้ใบที่ยกเลิกไม่ได้ · ใบปกติยังแก้ได้ (positive control)", async () => {
    const upd = (doc: string) => asMain.rpc("fn_update_wht", {
      p_entity_id: A.entityId, p_old_doc_no: doc, p_new_doc_no: "", p_issue_date: "2026-10-20",
      p_pnd_type: "ภ.ง.ด.3", p_income_seq: 5, p_income_type: null,
    });
    const bad = await upd(DOC.plain);
    expect(bad.data).toMatchObject({ ok: false });
    expect(String((bad.data as { error: string }).error)).toContain("ยกเลิกแล้ว");
    const ok = await upd(DOC.low);
    expect(ok.data).toMatchObject({ ok: true });
  });

  it("★ fn_edit_transaction: มีใบปกติ = ย้ายกิจการไม่ได้ · ยกเลิกใบแล้ว = ย้ายได้", async () => {
    const payload = {
      transaction_date: "2026-10-10", type: "รายจ่าย", account_name: ACC, category: "ค่าใช้จ่ายทดสอบ",
      contact_name: "คู่ค้าทดสอบ", description: "ทดสอบย้ายหลังยกเลิก 50ทวิ",
      base_amount: 100, discount: 0, amount_after_discount: 100, vat_amount: 0, wht_rate: 3, wht_amount: 3, net_amount: 97,
      tax_invoice_no: "", tax_invoice_date: "", entity_id: B,
    };
    const items = [{ item_name: "ของทดสอบ", quantity: 1, ex_vat: 100, in_vat: 107, total_price: 100 }];
    const before = await asMain.rpc("fn_edit_transaction", { p_tx_id: TX.move, p: payload, p_items: items });
    expect(before.data).toMatchObject({ ok: false });
    expect(String((before.data as { error: string }).error)).toContain(DOC.move);

    expect((await cancel(asMain, DOC.move)).data).toMatchObject({ ok: true });
    const after = await asMain.rpc("fn_edit_transaction", { p_tx_id: TX.move, p: payload, p_items: items });
    expect(after.error).toBeNull();
    expect(after.data).toMatchObject({ ok: true });
    const { data } = await admin().from("transactions").select("entity_id").eq("tenant_id", A.tenantId).eq("tx_id", TX.move).single();
    expect(data!.entity_id).toBe(B);
  });

  it("audit: การยกเลิกมีแถวใน edit_log", async () => {
    const { data, error } = await admin().from("edit_log").select("action, before, after")
      .eq("tenant_id", A.tenantId).eq("table_name", "wht_certificates").eq("row_pk", DOC.plain).eq("action", "update");
    must("อ่าน edit_log", error);
    expect((data ?? []).some((r) => (r.before as { status: string }).status === "ปกติ" && (r.after as { status: string }).status === "ยกเลิก")).toBe(true);
  });
});
