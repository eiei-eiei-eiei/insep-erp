/**
 * ชั้นที่แตะ DB ของงานค่างวด — คู่กับสูตรล้วนใน `./billing.ts`
 *
 * ★ แบบเดียวกับ `./provision.ts`: **รับ `SupabaseClient` เข้ามา ห้าม `import "server-only"`**
 *   (สคริปต์เรียกได้ · และเปิดทางไป fleet หลาย DB ตาม NEXT_STEPS 10.2 โดยไม่ต้องรื้อ)
 *
 * 🚨 ใช้ service role ข้าม RLS ทั้งหมด → ต้องระบุ tenant เองทุก query เสมอ
 * 🚨 `current_period_end` **คำนวณที่นี่ที่เดียวด้วย periodEnd()** — ห้ามให้ UI ส่งค่านี้เข้ามา
 *    ไม่งั้นวันตัดรอบจะเพี้ยนได้จากหน้าจอโดยไม่มีอะไรจับ
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { periodEnd, type Cycle } from "./billing";

export type SubscriptionRow = {
  plan: string;
  price: number;
  cycle: Cycle;
  startedOn: string;
  periodsPaid: number;
  currentPeriodEnd: string;
  status: "active" | "paused" | "cancelled";
  note: string | null;
};

export type PaymentRow = {
  id: number;
  amount: number;
  paidOn: string;
  periodEndAfter: string;
  note: string | null;
};

export type BillingRow = {
  tenantId: string;
  slug: string;
  name: string;
  isActive: boolean;
  billingNotice: boolean;
  modules: string[];
  entityCount: number;
  subscription: SubscriptionRow | null;
  payments: PaymentRow[];
};

export type SubscriptionInput = {
  plan: string;
  price: number;
  cycle: Cycle;
  startedOn: string;
  status: "active" | "paused" | "cancelled";
  note: string | null;
  billingNotice: boolean;
};

const fail = (msg: string): never => {
  throw new Error(msg);
};

const CYCLES = ["monthly", "yearly"] as const;
const STATUSES = ["active", "paused", "cancelled"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ตรวจ input ของฟอร์มค่างวด — คืนข้อความไทย หรือ null ถ้าผ่าน (ล้วน เทสได้) */
export function validateSubscription(input: SubscriptionInput): string | null {
  if (!input.plan.trim()) return "ต้องใส่ชื่อแพ็กเกจ";
  if (!Number.isFinite(input.price) || input.price < 0) return "ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป";
  if (!CYCLES.includes(input.cycle)) return "รอบการชำระต้องเป็นรายเดือนหรือรายปี";
  if (!STATUSES.includes(input.status)) return "สถานะไม่ถูกต้อง";
  if (!ISO_DATE.test(input.startedOn)) return "วันเริ่มใช้บริการไม่ถูกต้อง";
  return null;
}

// ── อ่าน ─────────────────────────────────────────────────────────────────────

/**
 * รายการค่างวดทั้งหมด **เรียงครบกำหนดเร็วสุดก่อน**
 * ลูกค้าที่ยังไม่ได้ตั้งค่างวดคืนมาด้วย (subscription = null) และถูกดันไปท้ายรายการ
 * — ต้องเห็นว่าใครตกหล่น ไม่ใช่ซ่อนทิ้ง
 */
export async function listBilling(db: SupabaseClient): Promise<BillingRow[]> {
  const [{ data: tenants, error: tErr }, subsRes, entRes, payRes] =
    await Promise.all([
      db
        .from("tenants")
        .select("id, slug, name, is_active, billing_notice, modules_enabled")
        .eq("is_platform", false)
        .order("created_at", { ascending: true }),
      db.from("subscriptions").select("*"),
      db.from("entities").select("tenant_id, entity_id"),
      db
        .from("subscription_payments")
        .select("id, tenant_id, amount, paid_on, period_end_after, note")
        .order("id", { ascending: false }),
    ]);
  if (tErr) fail(`อ่านรายชื่อลูกค้า: ${tErr.message}`);
  // 🚨 D89 — ของเดิมเช็คแต่ `tErr` · 3 ก้อนที่เหลือเงียบ →
  //    ลูกค้าที่จ่ายเงินแล้วขึ้นว่า "ยังไม่ได้ตั้งค่างวด" บนหน้าที่ใช้ตัดสินใจทวงเงิน
  if (subsRes.error) fail(`อ่านค่างวด: ${subsRes.error.message}`);
  if (entRes.error) fail(`อ่านรายชื่อกิจการ: ${entRes.error.message}`);
  if (payRes.error) fail(`อ่านประวัติการชำระ: ${payRes.error.message}`);
  const subs = subsRes.data;
  const entities = entRes.data;
  const payments = payRes.data;

  const rows: BillingRow[] = (tenants ?? []).map((t) => {
    const id = t.id as string;
    const s = (subs ?? []).find((x) => x.tenant_id === id);
    return {
      tenantId: id,
      slug: t.slug as string,
      name: t.name as string,
      isActive: t.is_active as boolean,
      billingNotice: t.billing_notice as boolean,
      modules: (t.modules_enabled as string[] | null) ?? [],
      entityCount: (entities ?? []).filter((e) => e.tenant_id === id).length,
      subscription: s
        ? {
            plan: s.plan as string,
            price: Number(s.price) || 0,
            cycle: s.cycle as Cycle,
            startedOn: s.started_on as string,
            periodsPaid: Number(s.periods_paid) || 1,
            currentPeriodEnd: s.current_period_end as string,
            status: s.status as SubscriptionRow["status"],
            note: (s.note as string | null) ?? null,
          }
        : null,
      payments: (payments ?? [])
        .filter((p) => p.tenant_id === id)
        .map((p) => ({
          id: Number(p.id),
          amount: Number(p.amount) || 0,
          paidOn: p.paid_on as string,
          periodEndAfter: p.period_end_after as string,
          note: (p.note as string | null) ?? null,
        })),
    };
  });

  // ครบกำหนดเร็วสุดก่อน · ยังไม่ได้ตั้งค่างวดไปท้ายสุด (แต่มีกล่องเตือนแยกบนหัวหน้าจอ)
  return rows.sort((a, b) => {
    if (!a.subscription) return b.subscription ? 1 : 0;
    if (!b.subscription) return -1;
    return a.subscription.currentPeriodEnd.localeCompare(b.subscription.currentPeriodEnd);
  });
}

// ── เขียน ────────────────────────────────────────────────────────────────────

/**
 * สร้าง/แก้ค่างวด — `current_period_end` คำนวณใหม่จาก `startedOn` + `periodsPaid` เสมอ
 * (แก้วันเริ่มหรือรอบการชำระแล้ววันครบกำหนดต้องขยับตามทันที ไม่ใช่ค้างค่าเดิม)
 */
export async function saveSubscription(
  db: SupabaseClient,
  tenantId: string,
  input: SubscriptionInput,
): Promise<void> {
  const bad = validateSubscription(input);
  if (bad) fail(bad);

  // 🚨 D89 — อ่านไม่ได้แล้วปล่อยผ่าน = periods_paid เด้งกลับเป็น 1
  //    → จำนวนรอบที่ลูกค้าจ่ายมาแล้วถูกรีเซ็ต แล้ววันตัดรอบ (anniversary) เพี้ยนถาวร (D59)
  const { data: existing, error: exErr } = await db
    .from("subscriptions")
    .select("periods_paid")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (exErr) fail(`อ่านค่างวดเดิม: ${exErr.message}`);

  const periodsPaid = Number(existing?.periods_paid) || 1;
  const row = {
    tenant_id: tenantId,
    plan: input.plan.trim(),
    price: input.price,
    cycle: input.cycle,
    started_on: input.startedOn,
    periods_paid: periodsPaid,
    current_period_end: periodEnd(input.startedOn, input.cycle, periodsPaid),
    status: input.status,
    note: input.note?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db.from("subscriptions").upsert(row, { onConflict: "tenant_id" });
  if (error) fail(`บันทึกค่างวด: ${error.message}`);

  // ธงแจ้งเตือนอยู่บน tenants (ลูกค้าอ่านได้) ไม่ใช่บน subscriptions (ลูกค้าอ่านไม่ได้)
  const { error: nErr } = await db
    .from("tenants")
    .update({ billing_notice: input.billingNotice })
    .eq("id", tenantId);
  if (nErr) fail(`ตั้งค่าการแจ้งเตือน: ${nErr.message}`);
}

/**
 * บันทึกว่าจ่ายแล้ว 1 รอบ
 *
 * ⚠️ **เลื่อนจากรอบเดิม ไม่ใช่จากวันนี้** — ลูกค้าจ่ายช้าต้องไม่เสียวันที่จ่ายไปแล้ว
 *    ผลคือถ้าค้างมา 3 รอบ กด 1 ครั้งจะยังเลยกำหนดอยู่ = ถูกต้อง (1 การจ่าย = 1 รอบ)
 *    หน้าจอมีหน้าที่บอกให้กดซ้ำ ไม่ใช่ให้ฟังก์ชันนี้เดาว่าจ่ายมากี่รอบ
 */
export async function recordPayment(
  db: SupabaseClient,
  tenantId: string,
  input: { amount: number; paidOn: string; note: string | null; actor: string },
): Promise<{ periodEndAfter: string }> {
  if (!Number.isFinite(input.amount) || input.amount < 0) fail("จำนวนเงินต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป");
  if (!ISO_DATE.test(input.paidOn)) fail("วันที่จ่ายไม่ถูกต้อง");

  const { data: sub } = await db
    .from("subscriptions")
    .select("cycle, started_on, periods_paid")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!sub) fail("ลูกค้ารายนี้ยังไม่ได้ตั้งค่างวด");

  const periodsPaid = (Number(sub!.periods_paid) || 1) + 1;
  const newEnd = periodEnd(sub!.started_on as string, sub!.cycle as Cycle, periodsPaid);

  const { error } = await db
    .from("subscriptions")
    .update({
      periods_paid: periodsPaid,
      current_period_end: newEnd,
      // จ่ายแล้ว = กลับมาใช้งานได้ (เคยหยุดพัก/ยกเลิกไว้ก็ถือว่ากลับมา)
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
  if (error) fail(`เลื่อนรอบชำระ: ${error.message}`);

  const { error: pErr } = await db.from("subscription_payments").insert({
    tenant_id: tenantId,
    amount: input.amount,
    paid_on: input.paidOn,
    period_end_after: newEnd,
    note: input.note?.trim() || null,
    created_by: input.actor,
  });
  if (pErr) fail(`บันทึกประวัติการจ่าย: ${pErr.message}`);

  return { periodEndAfter: newEnd };
}

/**
 * ย้อนรายการจ่ายล่าสุด (คีย์ผิด/บันทึกซ้ำ) — ตามกติกา CLAUDE.md ที่ว่าทุกจุดที่บันทึกได้ต้องมีปุ่มลบ
 *
 * ★ ย้อนได้เฉพาะ**รายการล่าสุด** เท่านั้น — ย้อนอันกลางแล้วเลขรอบกับประวัติจะไม่ตรงกันอีกเลย
 *   เรียงด้วย id ไม่ใช่ paid_on เพราะ paid_on ย้อนหลังได้ (ลูกค้าโอนวันที่ 1 แต่มาบันทึกวันที่ 5)
 */
export async function voidLastPayment(
  db: SupabaseClient,
  tenantId: string,
): Promise<{ periodEndAfter: string }> {
  const { data: sub } = await db
    .from("subscriptions")
    .select("cycle, started_on, periods_paid")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!sub) fail("ลูกค้ารายนี้ยังไม่ได้ตั้งค่างวด");

  const periodsPaid = Number(sub!.periods_paid) || 1;
  if (periodsPaid <= 1) {
    fail("ย้อนไม่ได้ — รอบแรกมาจากการตั้งค่างวด ไม่ใช่การบันทึกจ่าย (แก้ที่ปุ่มแก้ไขแทน)");
  }

  const { data: last } = await db
    .from("subscription_payments")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) fail("ไม่มีรายการจ่ายให้ย้อน");

  const { error: dErr } = await db.from("subscription_payments").delete().eq("id", last!.id);
  if (dErr) fail(`ลบรายการจ่าย: ${dErr.message}`);

  const newPeriods = periodsPaid - 1;
  const newEnd = periodEnd(sub!.started_on as string, sub!.cycle as Cycle, newPeriods);
  const { error } = await db
    .from("subscriptions")
    .update({ periods_paid: newPeriods, current_period_end: newEnd, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId);
  if (error) fail(`ย้อนรอบชำระ: ${error.message}`);

  return { periodEndAfter: newEnd };
}

/**
 * ระงับ / คืนสิทธิ์การใช้งานของลูกค้า
 *
 * 🚨 บังคับที่ชั้นแอป (`app/(app)/layout.tsx`) **ไม่ใช่ RLS** — ระงับเป็นเรื่องการเก็บเงิน
 *    ไม่ใช่ขอบเขตความปลอดภัย (หลักเดียวกับ D53) · ถ้าไปตัดที่ `my_tenant()`/RLS แล้วกดพลาด
 *    ลูกค้าจะเข้าข้อมูลภาษีตัวเองไม่ได้ และ trigger/RPC ที่พึ่ง my_tenant() จะทำงานผิดตามไปด้วย
 */
export async function setTenantActive(
  db: SupabaseClient,
  tenantId: string,
  active: boolean,
): Promise<void> {
  const { error } = await db.from("tenants").update({ is_active: active }).eq("id", tenantId);
  if (error) fail(`${active ? "คืนสิทธิ์" : "ระงับ"}การใช้งาน: ${error.message}`);
}
