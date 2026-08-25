import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, type Tenant } from "./harness";

/**
 * เทสสะพาน T6: ลงรายจ่ายหมวด "ต้นทุนสุรา" ในแอปบัญชี → รับวัตถุดิบเข้าสต็อกผลิต (D79)
 *
 * 🚨 ทำไมต้องเป็นเทสชั้นนี้ (ยิง Supabase จริง) ไม่ใช่ unit test:
 *    ตรรกะทั้งก้อนอยู่ใน **plpgsql ในฐานข้อมูล** (fn_save_transaction → fn_receive_material)
 *    — build/lint/test ฝั่ง TypeScript มองไม่เห็นเลยแม้แต่บรรทัดเดียว
 *    บั๊ก `column reference "it" is ambiguous` จึงอยู่รอดมาตั้งแต่ 0011 โดยไม่มีอะไรฟ้อง
 *    และทำให้ฟีเจอร์นี้ **ไม่เคยทำงานสำเร็จเลยสักครั้ง** ใน DB จริง
 *
 * สิ่งที่ต้องพิสูจน์:
 *   1. เส้นทางสุข — บิลลงบัญชีได้ + log_material ได้แถว 'รับ' + ไม่มี warning
 *   2. ชื่อวัตถุดิบไม่ตรง master — **บิลบัญชียังต้องถูกบันทึก** แล้วคืน warning (ห้าม roll back ทั้งใบ)
 *   3. ยิงซ้ำด้วย tx เดิมไม่ได้ (idempotency ที่ integration_log)
 */

let A: Tenant;
let asA: SupabaseClient;

type SaveRes = { ok: boolean; tx_id: string; warning?: string | null };

async function saveCost(items: { item_name: string; quantity: number }[], entityId?: string) {
  const res = await asA.rpc("fn_save_transaction", {
    p: {
      transaction_date: "2026-08-24",
      type: "รายจ่าย",
      account_name: "บัญชีทดสอบ",
      category: "ต้นทุนสุรา",
      contact_name: "ร้านวัตถุดิบทดสอบ",
      description: "ซื้อวัตถุดิบทดสอบ",
      base_amount: 1000, discount: 0, amount_after_discount: 1000,
      vat_amount: 70, wht_rate: 0, wht_amount: 0, net_amount: 1070,
      entity_id: entityId ?? A.entityId,
      forward_material: true,
    },
    p_items: items.map((it) => ({ ...it, in_vat: 0, ex_vat: 0, total_price: 1000 })),
  });
  expect(res.error, "fn_save_transaction ไม่ควร error — forward พลาดต้องคืน warning แทน").toBeNull();
  return res.data as SaveRes;
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("fwdmat");
  asA = await signIn(A);
}, 120_000);

afterAll(async () => {
  await asA?.auth.signOut();
  await cleanupTestTenants();
});

describe("ต้นทุนสุรา (บัญชี) → วัตถุดิบ (ผลิต)", () => {
  it("ชื่อตรง master → ได้แถว 'รับ' ใน log_material ของกิจการเดียวกับบิล", async () => {
    const r = await saveCost([{ item_name: A.materialName, quantity: 25 }]);
    expect(r.ok).toBe(true);
    expect(r.warning, `ไม่ควรมี warning แต่ได้: ${r.warning}`).toBeNull();

    const { data } = await asA.from("log_material")
      .select("trans_type, material_id, amount, doc_ref, entity_id")
      .eq("doc_ref", r.tx_id);
    expect(data, "ไม่มีแถวโผล่ในแท็บวัตถุดิบฝั่งผลิต = อาการที่ผู้ใช้แจ้ง").toHaveLength(1);
    expect(data![0].trans_type).toBe("รับ");
    expect(Number(data![0].amount)).toBe(25);
    // ★ ต้องเป็นกิจการของ "บิล" ไม่ใช่กิจการหลักของคนล็อกอิน
    expect(data![0].entity_id).toBe(A.entityId);
  });

  it("แถวที่กรอกแต่ราคาไม่กรอกชื่อ ต้องถูกข้าม ไม่ล้ม forward ทั้งใบ", async () => {
    const r = await saveCost([
      { item_name: "", quantity: 1 },
      { item_name: A.materialName, quantity: 5 },
    ]);
    expect(r.warning, `ไม่ควรมี warning แต่ได้: ${r.warning}`).toBeNull();

    const { data } = await asA.from("log_material").select("amount").eq("doc_ref", r.tx_id);
    expect(data).toHaveLength(1);
    expect(Number(data![0].amount)).toBe(5);
  });

  it("ชื่อไม่ตรง master → บิลบัญชียังถูกบันทึก + คืน warning (ห้าม roll back ทั้งใบ)", async () => {
    const r = await saveCost([{ item_name: "ไม่มีชื่อนี้ใน master", quantity: 3 }]);
    expect(r.ok).toBe(true);
    expect(r.warning, "forward พลาดแล้วต้องบอกผู้ใช้").toContain("รับวัตถุดิบเข้าสต็อกผลิตไม่ได้");

    // 🚨 หัวใจของเทสนี้: บิลต้องอยู่ใน DB จริง (บั๊กเดิมทำให้ทั้ง transaction หายไปด้วย)
    const { data } = await asA.from("transactions").select("tx_id").eq("tx_id", r.tx_id);
    expect(data, "บัญชีต้อง commit แม้ forward พลาด").toHaveLength(1);

    const { data: lm } = await asA.from("log_material").select("id").eq("doc_ref", r.tx_id);
    expect(lm).toHaveLength(0);
  });

  it("idempotency: เรียก fn_receive_material ซ้ำด้วยคีย์เดิม → duplicate ไม่ลงซ้ำ", async () => {
    const key = "T-FWD-IDEM";
    const first = await asA.rpc("fn_receive_material", {
      p_idempotency_key: key, p_date: "2026-08-24", p_doc_ref: key, p_note: "ทดสอบ",
      p_items: [{ material_name: A.materialName, amount: 2 }],
    });
    expect(first.error).toBeNull();
    expect((first.data as { duplicate: boolean }).duplicate).toBe(false);

    const again = await asA.rpc("fn_receive_material", {
      p_idempotency_key: key, p_date: "2026-08-24", p_doc_ref: key, p_note: "ทดสอบ",
      p_items: [{ material_name: A.materialName, amount: 2 }],
    });
    expect(again.error).toBeNull();
    expect((again.data as { duplicate: boolean }).duplicate).toBe(true);

    const { data } = await asA.from("log_material").select("id").eq("doc_ref", key);
    expect(data, "ยิงซ้ำแล้วต้องไม่ได้แถวเพิ่ม").toHaveLength(1);
  });

  it("วัตถุดิบอยู่คนละกิจการกับบิล → บอกเหตุให้ต่างจาก 'สะกดผิด'", async () => {
    // เพิ่มกิจการที่ 2 ให้ tenant นี้ (ไม่มี master วัตถุดิบของตัวเอง)
    const { error } = await admin().from("entities").insert({
      tenant_id: A.tenantId, entity_id: "EID02", name: "กิจการที่สองทดสอบ", is_vat: true,
    });
    expect(error).toBeNull();

    const r = await saveCost([{ item_name: A.materialName, quantity: 1 }], "EID02");
    expect(r.warning).toContain("คนละกิจการกับบิล");
    // ★ ของต้องไม่ไปโผล่ในกิจการหลักแทน (บั๊กเดิม: default my_default_entity())
    const { data } = await asA.from("log_material").select("id").eq("doc_ref", r.tx_id);
    expect(data).toHaveLength(0);
  });
});
