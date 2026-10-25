import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, seedUser, admin, type Tenant } from "./harness";

/**
 * บาร์: ของทำเองในร้าน — ยิง Supabase จริง (D130 · migration 0092)
 * 🔴 ทำล็อต/แช่/เสร็จ/ยกเลิก + ทุนเฉลี่ย อยู่ใน plpgsql ทั้งหมด (D79) · ทุกข้อที่บล็อกมีคู่ที่ทำได้จริง
 */

let A: Tenant;
let asA: SupabaseClient;
let asBar: SupabaseClient;
const E = () => A.entityId;
const base = () => ({ tenant_id: A.tenantId, entity_id: A.entityId });
const today = "2026-10-25";

const itemOf = async (itemId: string) => {
  const { data } = await admin().from("bar_item").select("qty, cost_per_unit, unit, name")
    .eq("tenant_id", A.tenantId).eq("entity_id", E()).eq("item_id", itemId).maybeSingle();
  return data ? { qty: Number(data.qty), cpu: Number(data.cost_per_unit), unit: data.unit, name: data.name } : null;
};
const batchOf = async (id: string) => {
  const { data } = await admin().from("bar_prep_batch").select("*").eq("tenant_id", A.tenantId).eq("batch_id", id).single();
  return data!;
};
const start = (client: SupabaseClient, itemId: string, mult: number, inputs: { item_id: string; qty: number }[], yieldQty: number | null) =>
  client.rpc("fn_bar_prep_start", {
    p_entity: E(), p_item_id: itemId, p_multiplier: mult, p_inputs: inputs, p_yield: yieldQty, p_note: null, p_business_date: today,
  });

let SYR = "";

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("bar-prep");
  asA = await signIn(A);
  asBar = (await seedUser(A, "bar")).client;
  const r = await admin().from("bar_item").insert([
    { ...base(), item_id: "T-SUGAR", name: "ทดสอบ น้ำตาล", unit: "g", qty: 5000, cost_per_unit: 0.03 },
    { ...base(), item_id: "T-PUMP", name: "ทดสอบ ฟักทอง", unit: "g", qty: 2000, cost_per_unit: 0.05 },
    { ...base(), item_id: "T-GIN", name: "ทดสอบ จิน", unit: "ml", qty: 1000, cost_per_unit: 1 },
  ]);
  if (r.error) throw new Error(r.error.message);
}, 180_000);

afterAll(async () => {
  // ★ cleanup เรียก fn_mig_truncate — พิสูจน์ว่าตารางของทำเองอยู่ในลำดับลบ (ก่อน bar_item)
  await cleanupTestTenants();
}, 120_000);

describe("① ตั้งของทำเอง", () => {
  it("ไม่มีวัตถุดิบ / ได้ 0 = บล็อก", async () => {
    const a = await asBar.rpc("fn_bar_prep_save", { p_entity: E(), p_item_id: null, p_name: "ทดสอบ ไซรัป", p_unit: "ml", p_std_yield: 800, p_inputs: [], p_note: null });
    expect(a.error?.message).toContain("อย่างน้อย 1");
    const b = await asBar.rpc("fn_bar_prep_save", { p_entity: E(), p_item_id: null, p_name: "ทดสอบ ไซรัป", p_unit: "ml", p_std_yield: 0, p_inputs: [{ item_id: "T-SUGAR", qty: 1 }], p_note: null });
    expect(b.error?.message).toContain("มากกว่า 0");
  });

  it("✓ พนักงานบาร์ตั้งได้ → สร้างวัตถุดิบใหม่ (หน่วย ml ยอด 0) + สูตรมาตรฐาน", async () => {
    const r = await asBar.rpc("fn_bar_prep_save", {
      p_entity: E(), p_item_id: null, p_name: "ทดสอบ ไซรัปฟักทอง", p_unit: "ml", p_std_yield: 800,
      p_inputs: [{ item_id: "T-SUGAR", qty: 500 }, { item_id: "T-PUMP", qty: 300 }], p_note: "เคี่ยว 20 นาที",
    });
    expect(r.error, r.error?.message).toBeNull();
    SYR = (r.data as { item_id: string }).item_id;
    expect(await itemOf(SYR)).toMatchObject({ qty: 0, unit: "ml", name: "ทดสอบ ไซรัปฟักทอง" });
  });

  it("ชื่อซ้ำวัตถุดิบอื่น / ใช้ตัวเองในสูตร = บล็อก", async () => {
    const dup = await asA.rpc("fn_bar_prep_save", { p_entity: E(), p_item_id: null, p_name: "ทดสอบ น้ำตาล", p_unit: "g", p_std_yield: 1, p_inputs: [{ item_id: "T-PUMP", qty: 1 }], p_note: null });
    expect(dup.error?.message).toContain("อยู่แล้ว");
    const self = await asA.rpc("fn_bar_prep_save", { p_entity: E(), p_item_id: SYR, p_name: "ทดสอบ ไซรัปฟักทอง", p_unit: "ml", p_std_yield: 800, p_inputs: [{ item_id: SYR, qty: 10 }], p_note: null });
    expect(self.error?.message).toContain("ของตัวเอง");
  });
});

let B1 = "";

describe("② ทำเสร็จแล้ว — เข้าสต็อกเลย", () => {
  it("0.5 ล็อต: ตัดน้ำตาล 250 + ฟักทอง 150 · ได้จริง 380 ml · ทุน 15 · ทุนต่อ ml = 15/380", async () => {
    const r = await start(asBar, SYR, 0.5, [{ item_id: "T-SUGAR", qty: 250 }, { item_id: "T-PUMP", qty: 150 }], 380);
    expect(r.error, r.error?.message).toBeNull();
    B1 = (r.data as { batch_id: string }).batch_id;
    expect(Number((r.data as { cost: number }).cost)).toBe(15); // 250×0.03 + 150×0.05
    expect((await itemOf("T-SUGAR"))!.qty).toBe(4750);
    expect((await itemOf("T-PUMP"))!.qty).toBe(1850);
    const s = await itemOf(SYR);
    expect(s!.qty).toBe(380);
    expect(s!.cpu).toBe(Math.round((15 / 380) * 10000) / 10000); // ยอดเดิม 0 → ราคาล็อตล้วน (B3)
    const b = await batchOf(B1);
    expect([b.status, Number(b.yield_qty), Number(b.cost_total), Number(b.prev_qty)]).toEqual(["เสร็จแล้ว", 380, 15, 0]);
    const { data: rc } = await admin().from("bar_receive").select("qty, cost_total, source, note").eq("tenant_id", A.tenantId).eq("id", b.receive_id).single();
    expect([Number(rc!.qty), Number(rc!.cost_total), rc!.source, rc!.note]).toEqual([380, 15, "ทำเองในร้าน", B1]);
    const { data: mv } = await admin().from("bar_move").select("item_id, reason").eq("tenant_id", A.tenantId).eq("ref_no", B1);
    expect(mv!.every((m) => m.reason === "ทำของ")).toBe(true);
  });
});

describe("③ เริ่มแช่ → เสร็จแล้ว", () => {
  let B2 = "";
  it("เริ่มแช่: ตัดวัตถุดิบทันที แต่ของทำเองยังไม่เข้า", async () => {
    const r = await start(asA, SYR, 1, [{ item_id: "T-SUGAR", qty: 500 }, { item_id: "T-PUMP", qty: 300 }], null);
    expect(r.error, r.error?.message).toBeNull();
    B2 = (r.data as { batch_id: string }).batch_id;
    expect((r.data as { finished: boolean }).finished).toBe(false);
    expect((await itemOf("T-SUGAR"))!.qty).toBe(4250);
    expect((await itemOf(SYR))!.qty).toBe(380);
    expect((await batchOf(B2)).status).toBe("กำลังแช่");
  });

  it("เสร็จแล้ว: ปริมาณ 0 = บล็อก · ✓ 760 ml เข้า ทุนเฉลี่ยถัวกับของเดิม (สูตรเดียวกับรับของ)", async () => {
    const bad = await asA.rpc("fn_bar_prep_finish", { p_entity: E(), p_batch_id: B2, p_yield: 0, p_business_date: today });
    expect(bad.error?.message).toContain("มากกว่า 0");
    const before = await itemOf(SYR);
    const r = await asA.rpc("fn_bar_prep_finish", { p_entity: E(), p_batch_id: B2, p_yield: 760, p_business_date: today });
    expect(r.error, r.error?.message).toBeNull();
    const after = await itemOf(SYR);
    expect(after!.qty).toBe(1140);
    const expected = Math.round(((before!.qty * before!.cpu + 30) / (before!.qty + 760)) * 10000) / 10000;
    expect(after!.cpu).toBe(expected);
    const again = await asA.rpc("fn_bar_prep_finish", { p_entity: E(), p_batch_id: B2, p_yield: 10, p_business_date: today });
    expect(again.error?.message).toContain("ไม่ได้อยู่ระหว่างแช่");
  });

  it("แก้สูตรมาตรฐานทีหลัง → ล็อตเก่าไม่ขยับ", async () => {
    const r = await asA.rpc("fn_bar_prep_save", {
      p_entity: E(), p_item_id: SYR, p_name: "ทดสอบ ไซรัปฟักทอง", p_unit: "ml", p_std_yield: 900,
      p_inputs: [{ item_id: "T-SUGAR", qty: 400 }], p_note: null,
    });
    expect(r.error, r.error?.message).toBeNull();
    const { data } = await admin().from("bar_prep_batch_line").select("input_item_id, qty").eq("tenant_id", A.tenantId).eq("batch_id", B1).order("line_no");
    expect(data!.map((l) => [l.input_item_id, Number(l.qty)])).toEqual([["T-SUGAR", 250], ["T-PUMP", 150]]);
  });
});

describe("④ ยกเลิกล็อต", () => {
  it("ล็อตที่แช่อยู่ → ยกเลิกได้ วัตถุดิบคืนเป๊ะ ของทำเองไม่ขยับ", async () => {
    const before = { sugar: (await itemOf("T-SUGAR"))!.qty, syr: await itemOf(SYR) };
    const r = await start(asA, SYR, 1, [{ item_id: "T-SUGAR", qty: 400 }], null);
    const id = (r.data as { batch_id: string }).batch_id;
    const c = await asA.rpc("fn_bar_prep_cancel", { p_entity: E(), p_batch_id: id });
    expect(c.error, c.error?.message).toBeNull();
    expect((await itemOf("T-SUGAR"))!.qty).toBe(before.sugar);
    expect(await itemOf(SYR)).toEqual(before.syr);
    expect((await batchOf(id)).status).toBe("ยกเลิก");
  });

  it("✓ ล็อตเสร็จที่เป็นการเคลื่อนไหวล่าสุด → ยอด+ทุนเฉลี่ยกลับค่าเดิมเป๊ะ · แถวราคารับของหาย · วัตถุดิบคืน", async () => {
    const before = { sugar: (await itemOf("T-SUGAR"))!.qty, syr: await itemOf(SYR) };
    const r = await start(asA, SYR, 1, [{ item_id: "T-SUGAR", qty: 400 }], 900);
    const id = (r.data as { batch_id: string }).batch_id;
    const rid = (await batchOf(id)).receive_id;
    expect((await itemOf(SYR))!.cpu).not.toBe(before.syr!.cpu);
    const c = await asA.rpc("fn_bar_prep_cancel", { p_entity: E(), p_batch_id: id });
    expect(c.error, c.error?.message).toBeNull();
    expect(await itemOf(SYR)).toEqual(before.syr);
    expect((await itemOf("T-SUGAR"))!.qty).toBe(before.sugar);
    const { data } = await admin().from("bar_receive").select("id").eq("tenant_id", A.tenantId).eq("id", rid);
    expect(data).toEqual([]);
  });

  it("🚨 มีการเคลื่อนไหวของของทำเองตามหลังแล้ว → ยกเลิกไม่ได้ (ทุนเฉลี่ยย้อนเป๊ะไม่ได้)", async () => {
    const r = await start(asA, SYR, 1, [{ item_id: "T-SUGAR", qty: 400 }], 900);
    const id = (r.data as { batch_id: string }).batch_id;
    // ใช้ไซรัปในห้องทดลอง 1 ครั้ง (การเคลื่อนไหวตามหลัง)
    const u = await asA.rpc("fn_bar_lab_use", {
      p_entity: E(), p_category_id: "content", p_event: null, p_note: null,
      p_menus: [], p_recipes: [], p_items: [{ item_id: SYR, qty: 10 }], p_business_date: today,
    });
    expect(u.error, u.error?.message).toBeNull();
    const c = await asA.rpc("fn_bar_prep_cancel", { p_entity: E(), p_batch_id: id });
    expect(c.error?.message).toContain("นับสต็อก");
    expect((await batchOf(id)).status).toBe("เสร็จแล้ว");
  });
});

describe("⑤ ลบ / สิทธิ์", () => {
  it("เคยทำล็อตแล้ว ลบไม่ได้ · ยังไม่เคยทำ ลบได้ (วัตถุดิบหายด้วย)", async () => {
    const bad = await asA.rpc("fn_bar_prep_delete", { p_entity: E(), p_item_id: SYR });
    expect(bad.error?.message).toContain("ปิดใช้");
    const n = await asA.rpc("fn_bar_prep_save", { p_entity: E(), p_item_id: null, p_name: "ทดสอบ จิน infused", p_unit: "ml", p_std_yield: 700, p_inputs: [{ item_id: "T-GIN", qty: 700 }], p_note: null });
    const id = (n.data as { item_id: string }).item_id;
    const ok = await asA.rpc("fn_bar_prep_delete", { p_entity: E(), p_item_id: id });
    expect(ok.error, ok.error?.message).toBeNull();
    expect(await itemOf(id)).toBeNull();
  });

  it("🚨 ไม่มี policy เขียน — แก้ทุนล็อตตรงผ่าน API ไม่ได้ · อ่านได้", async () => {
    const u = await asA.from("bar_prep_batch").update({ cost_total: 0 }).eq("batch_id", B1).select();
    expect(u.data ?? []).toEqual([]);
    expect(Number((await batchOf(B1)).cost_total)).toBe(15);
    const read = await asBar.from("bar_prep_batch").select("batch_id").eq("batch_id", B1);
    expect(read.data).toHaveLength(1);
  });
});
