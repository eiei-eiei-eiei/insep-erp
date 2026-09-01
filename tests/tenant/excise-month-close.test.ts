import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, seedUser, admin, type Tenant } from "./harness";

/**
 * ปิดเดือนสรรพสามิต (D91 · migration 0058) — เทสที่ยิง Supabase จริง
 *
 * 🔴 **ชั้นเดียวที่เห็นตรรกะนี้ได้** — กติกาทั้งหมดอยู่ใน plpgsql
 *    `npm run build` / `lint` / `test` มองไม่เห็นแม้แต่บรรทัดเดียว (บทเรียน D79:
 *    บั๊กใน `fn_save_transaction` ทำให้ฟีเจอร์ไม่เคยทำงานเลยตั้งแต่เปิดระบบ
 *    โดยที่เทสอัตโนมัติเขียวหมดทุกรอบ)
 *
 * ต้นเรื่องของ D91: D90 ถาม `report_runs` ("เคยกดพิมพ์ไหม") ซึ่งเป็นเช็กลิสต์
 * โรงงานพิมพ์บัญชีประจำวันให้เจ้าหน้าที่ตรวจแทบทุกวัน → ยกเลิกบิลแล้วแก้ฟอร์มไม่ได้ตลอดกาล
 */

let A: Tenant;
let asA: SupabaseClient;

const MONTH = "2026-09";
const NEXT = "2026-10";

/** สร้างออเดอร์ที่ "ตัดสต็อกไปแล้ว" ให้พร้อมถูกยกเลิก — ปูสถานะเดียวกับที่ fn_confirm_fulfillment ทิ้งไว้ */
async function seedFulfilledOrder(n: number, saleDate: string) {
  const db = admin();
  const quNo = `QU-MC-${n}`;
  const orderNo = `ORD-MC-${n}`;
  const base = { tenant_id: A.tenantId, entity_id: A.entityId };

  const so = await db.from("sales_orders").insert({
    ...base, qu_no: quNo, order_no: orderNo,
    customer_id: A.contactId, customer_name: "ลูกค้าทดสอบ",
    status: "ส่งของแล้วรอชำระยอดค้าง", grand_total: 450, outstanding_balance: 0,
  });
  if (so.error) throw new Error(`สร้างออเดอร์ ${orderNo}: ${so.error.message}`);

  const lp = await db.from("log_product").insert({
    ...base, doc_date: saleDate, trans_type: "จ่าย",
    product_id: A.productId, amount: 1,
    note: `ลูกค้า: ลูกค้าทดสอบ (${orderNo})`, ref_no: orderNo,
  });
  if (lp.error) throw new Error(`log_product ${orderNo}: ${lp.error.message}`);

  const il = await db.from("integration_log").insert({
    tenant_id: A.tenantId, action: "SELL_PRODUCT", idempotency_key: orderNo, status: "ok",
    payload: [{ product_id: A.productId, amount: 1 }],
  });
  if (il.error) throw new Error(`integration_log ${orderNo}: ${il.error.message}`);

  return { quNo, orderNo };
}

async function hiddenOf(orderNo: string): Promise<boolean[]> {
  const { data, error } = await admin()
    .from("log_product").select("excise_hidden, id").eq("ref_no", orderNo).order("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.excise_hidden as boolean);
}

const closeMonth = (c: SupabaseClient, month = MONTH) =>
  c.rpc("fn_excise_close_month", { p_entity: A.entityId, p_month: month, p_note: "" });
const reopenMonth = (c: SupabaseClient, month = MONTH) =>
  c.rpc("fn_excise_reopen_month", { p_entity: A.entityId, p_month: month, p_note: "" });

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("mclose");
  asA = await signIn(A);
}, 180_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("① เดือนยังเปิด — ยกเลิกแล้วต้องหายจากฟอร์ม", () => {
  it("ยกเลิก → ซ่อนทั้งคู่ (จ่าย + รับ)", async () => {
    const { quNo, orderNo } = await seedFulfilledOrder(1, `${MONTH}-03`);
    const { data, error } = await asA.rpc("fn_cancel_order", { p_qu_no: quNo });
    expect(error, error?.message).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);
    expect((data as { excise_hidden: boolean }).excise_hidden).toBe(true);

    const h = await hiddenOf(orderNo);
    expect(h.length, "ต้องมีทั้งแถวขายและแถวคืน").toBe(2);
    expect(h, "🚨 ซ่อนข้างเดียว = ยอดคงเหลือบนฟอร์มเพี้ยน แย่กว่าไม่ซ่อนเลย").toEqual([true, true]);
  });

  it("🔴 ต้นเรื่องของ D91: กดสร้างรายงาน (report_runs) แล้วยกเลิก — ต้องยังซ่อนได้", async () => {
    const rr = await admin().from("report_runs").insert(
      ["phor_so_07_01", "phor_so_07_02_1", "phor_so_07_02_2", "phor_so_07_04"].map((k) => ({
        tenant_id: A.tenantId, entity_id: A.entityId, report_key: k, month: MONTH,
      })),
    );
    expect(rr.error, rr.error?.message).toBeNull();

    const { quNo, orderNo } = await seedFulfilledOrder(2, `${MONTH}-04`);
    const { error } = await asA.rpc("fn_cancel_order", { p_qu_no: quNo });
    expect(error, error?.message).toBeNull();

    expect(
      await hiddenOf(orderNo),
      "report_runs คือเช็กลิสต์ ไม่ใช่ตัวล็อก — พิมพ์บัญชีประจำวันแล้วห้ามล็อกการแก้",
    ).toEqual([true, true]);
  });
});

describe("② ปิดเดือนแล้ว — ฟอร์มที่ยื่นไปต้องไม่เปลี่ยน", () => {
  it("ปิดเดือนสำเร็จ", async () => {
    const { data, error } = await closeMonth(asA);
    expect(error, error?.message).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);
  });

  it("🚨 ปิดซ้อนไม่ได้ (partial unique index)", async () => {
    const { data } = await closeMonth(asA);
    expect((data as { ok: boolean; error?: string }).ok).toBe(false);
    expect((data as { error: string }).error).toMatch(/ปิดไปแล้ว/);
  });

  it("🚨 ปิดเดือนต้องไม่ไปแหย่คู่ที่ซ่อนไว้ก่อนหน้า (ของไม่เคยออกจากโรงจริง)", async () => {
    expect(await hiddenOf("ORD-MC-1")).toEqual([true, true]);
    expect(await hiddenOf("ORD-MC-2")).toEqual([true, true]);
  });

  it("ยกเลิกหลังปิดเดือน → ไม่ซ่อน และบอกกลับมาว่าติดเดือนไหน", async () => {
    const { quNo, orderNo } = await seedFulfilledOrder(3, `${MONTH}-20`);
    const { data, error } = await asA.rpc("fn_cancel_order", { p_qu_no: quNo });
    expect(error, error?.message).toBeNull();
    expect((data as { excise_hidden: boolean }).excise_hidden).toBe(false);
    expect((data as { excise_locked_months: string[] }).excise_locked_months).toEqual([MONTH]);
    expect(await hiddenOf(orderNo), "ฟอร์มที่ยื่นไปแล้วห้ามเปลี่ยนย้อนหลัง").toEqual([false, false]);
  });
});

describe("③ ถอนปิดเดือน = ปุ่มคืนค่า", () => {
  it("ถอนแล้วต้องคำนวณใหม่ให้ทันที ไม่ใช่ให้ไปกดอีกปุ่ม", async () => {
    const { data, error } = await reopenMonth(asA);
    expect(error, error?.message).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);
    expect((data as { changed: number }).changed, "คู่ของออเดอร์ที่ 3 ต้องถูกปรับ").toBe(1);
    expect(await hiddenOf("ORD-MC-3")).toEqual([true, true]);
  });

  it("ถอนเดือนที่ยังไม่ได้ปิด = ตอบปฏิเสธ ไม่ใช่เงียบ", async () => {
    const { data } = await reopenMonth(asA, "2026-01");
    expect((data as { ok: boolean }).ok).toBe(false);
    expect((data as { error: string }).error).toMatch(/ยังไม่ได้ปิด/);
  });

  it("ปิดใหม่หลังถอนได้ และประวัติการปิดรอบก่อนยังอยู่ครบ", async () => {
    const again = await closeMonth(asA);
    expect((again.data as { ok: boolean }).ok).toBe(true);

    const { data } = await admin()
      .from("excise_month_close").select("id, reopened_at")
      .eq("tenant_id", A.tenantId).eq("month", MONTH);
    expect(data!.length, "ถอนแล้วต้องไม่ลบแถวทิ้ง").toBe(2);
    expect(data!.filter((r) => !r.reopened_at).length, "ต้องมีแถวที่ active ใบเดียว").toBe(1);
  });
});

describe("④ 🚨 คู่ จ่าย/รับ ข้ามเดือน — ห้ามซ่อนครึ่งเดียว", () => {
  it("ขายเดือนที่ปิดแล้ว · ยกเลิกเดือนถัดไป (ยังเปิด) → ต้องไม่ซ่อนทั้งคู่", async () => {
    // ขาย 2026-09 (ปิดอยู่จากข้อ ③) แต่แถวคืนจะลงวันปัจจุบัน ซึ่งเป็นคนละเดือน
    const { orderNo } = await seedFulfilledOrder(4, `${MONTH}-25`);
    // จำลอง "ยกเลิกเดือนถัดไป" ด้วยการเรียกตัวคำถามตรง ๆ หลังย้ายแถวคืนไปเดือนถัดไป
    await admin().from("log_product").insert({
      tenant_id: A.tenantId, entity_id: A.entityId, doc_date: `${NEXT}-02`,
      trans_type: "รับ", product_id: A.productId, amount: 1,
      note: `คืนสต็อก: ยกเลิกออเดอร์ ${orderNo}`, ref_no: orderNo,
    });
    await admin().from("sales_orders").update({ status: "ยกเลิก" }).eq("qu_no", `QU-MC-4`);

    const open = await asA.rpc("fn_excise_months_open", {
      p_tenant: A.tenantId, p_entity: A.entityId, p_ref: orderNo,
    });
    expect(open.error, open.error?.message).toBeNull();
    expect(open.data, "เดือนขาย (ก.ย.) ปิดอยู่ → ทั้งคู่ต้องโชว์ตามจริง").toBe(false);

    const rc = await asA.rpc("fn_excise_recompute_hidden", {
      p_entity: A.entityId, p_month: NEXT, p_dry: false,
    });
    expect(rc.error, rc.error?.message).toBeNull();
    expect(await hiddenOf(orderNo)).toEqual([false, false]);
  });

  it("พอถอนปิดเดือนที่ขายด้วย ทั้งคู่ถึงจะซ่อนได้", async () => {
    await reopenMonth(asA);
    const open = await asA.rpc("fn_excise_months_open", {
      p_tenant: A.tenantId, p_entity: A.entityId, p_ref: "ORD-MC-4",
    });
    expect(open.data).toBe(true);
    await asA.rpc("fn_excise_recompute_hidden", { p_entity: A.entityId, p_month: NEXT, p_dry: false });
    expect(await hiddenOf("ORD-MC-4")).toEqual([true, true]);
  });
});

describe("⑤ dry-run ต้องไม่เขียนอะไร", () => {
  it("นับได้ว่าจะกระทบกี่คู่ โดยค่าใน DB ไม่ขยับ", async () => {
    await closeMonth(asA); // ปิด ก.ย. อีกครั้ง → คู่ที่ซ่อนอยู่ยังซ่อนต่อ
    const before = await hiddenOf("ORD-MC-1");
    const dry = await asA.rpc("fn_excise_recompute_hidden", {
      p_entity: A.entityId, p_month: MONTH, p_dry: true,
    });
    expect(dry.error, dry.error?.message).toBeNull();
    expect((dry.data as { dry: boolean }).dry).toBe(true);
    expect(await hiddenOf("ORD-MC-1"), "dry-run ต้องไม่แตะข้อมูล").toEqual(before);
  });

  it("🚨 ต้องบอก **ทิศทาง** ไม่ใช่แค่จำนวน (0059) — หน้าจอเอาไปแต่งประโยคที่มีทิศทาง", async () => {
    // ORD-MC-4 ถูกซ่อนอยู่ แต่ ก.ย. เพิ่งถูกปิดใหม่ → ทิศที่ถูกคือ "เอากลับมาแสดง"
    const dry = await asA.rpc("fn_excise_recompute_hidden", {
      p_entity: A.entityId, p_month: NEXT, p_dry: true,
    });
    const d = dry.data as { to_hide: number; to_show: number; changed: number };
    expect(d.changed).toBe(1);
    expect(d.to_show, "คู่นี้ต้องกลับมาแสดง ไม่ใช่ถูกเอาออก").toBe(1);
    expect(d.to_hide, "บอกทิศผิด = หน้าจอจะบอกผู้ใช้กลับด้านกับความจริง").toBe(0);
  });
});

describe("⑥ 🚨 สิทธิ์ — ปิด/ถอน/คำนวณใหม่ เป็นระดับหัวหน้าเท่านั้น", () => {
  it("บทบาทที่ไม่มี prod.config ทำไม่ได้ทั้ง 3 อย่าง (ยิง RPC ตรงก็ไม่รอด)", async () => {
    const { client: asSales } = await seedUser(A, "sales_manager");
    for (const [name, res] of [
      ["ปิดเดือน", await closeMonth(asSales, "2026-11")],
      ["ถอนปิดเดือน", await reopenMonth(asSales, MONTH)],
      ["คำนวณใหม่", await asSales.rpc("fn_excise_recompute_hidden", {
        p_entity: A.entityId, p_month: MONTH, p_dry: false,
      })],
    ] as const) {
      expect(res.error, `${name} ต้องถูกปฏิเสธ`).not.toBeNull();
      expect(res.error!.message, name).toMatch(/ไม่มีสิทธิ์/);
    }
    await asSales.auth.signOut().catch(() => {});
  });

  it("viewer อ่านสถานะปิดเดือนได้ แต่แก้ไม่ได้", async () => {
    const { client: asViewer } = await seedUser(A, "viewer");
    const { data, error } = await asViewer
      .from("excise_month_close").select("month").eq("month", MONTH);
    expect(error, error?.message).toBeNull();
    expect(data!.length, "prod.read ต้องอ่านได้").toBeGreaterThan(0);

    await asViewer.from("excise_month_close")
      .update({ reopened_at: new Date().toISOString() }).eq("month", MONTH);
    const after = await admin().from("excise_month_close")
      .select("id").eq("tenant_id", A.tenantId).eq("month", MONTH).is("reopened_at", null);
    // 🪤 RLS ที่ไม่มี policy เขียน = อัปเดต 0 แถว **ไม่ใช่ error** → ต้อง assert ที่ข้อมูลจริง
    expect(after.data!.length, "แถวที่ active ต้องยังอยู่ = เขียนไม่เข้า").toBe(1);
    await asViewer.auth.signOut().catch(() => {});
  });
});
