import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendLineToTenant } from "@/lib/line";
import { taxRemindersFor, reminderMessage, type TaxReminder } from "@/lib/accounting/taxReminder";
import { nextMonth, prevMonth } from "@/lib/accounting/taxPay";
import { toFilingMethod } from "@/lib/accounting/taxFiling";
import { DUE_STAGES, type DueStage } from "@/lib/shared/period";
import { effectiveTaxAccounts } from "@/lib/accounting/taxAccounts";
import {
  EXCISE_REMINDER_ACTION,
  exciseRemindersFor,
  exciseReminderMessage,
  type ExciseReminder,
} from "@/lib/production/exciseReminder";
import {
  BAR_POST_REMINDER_ACTION,
  barReminderKey,
  barReminderMessage,
} from "@/lib/bar/reminder";
import { unpostedDays } from "@/lib/bar/posting";
import { businessDate } from "@/lib/bar/businessDate";

/**
 * cron — เตือนกำหนดยื่นเข้ากลุ่ม LINE ล่วงหน้า 3 วัน (D88 ภาษีสรรพากร · D92 งบเดือนสรรพสามิต)
 *
 * ── ทำไมต้องมี ──────────────────────────────────────────────────────────────
 * เช็กลิสต์ในแอปช่วยได้เฉพาะตอนที่เปิดแอป — ถ้าไม่ได้เข้าเลยทั้งเดือนก็เลยกำหนดยื่น
 * แล้วค่อยรู้ ซึ่งแปลว่าเบี้ยปรับ/เงินเพิ่มของจริง
 *
 * ── 2 งานที่เป็นอิสระต่อกัน ─────────────────────────────────────────────────
 * · `taxPart`    — ภพ.30 / ภงด.3-53 (กรมสรรพากร) · โมดูล `accounting`
 * · `excisePart` — งบเดือน ภส.๐๗-๐๔ (กรมสรรพสามิต) · โมดูล `production`
 *
 * 🚨 **ต้องแยกเป็นฟังก์ชัน ห้ามเขียนต่อท้ายกันในลูป** — บล็อกภาษีมี `continue` หลายจุด
 *    (ไม่มีกิจการ · อ่าน wht ไม่ได้ · ไม่มีอะไรต้องเตือน · ส่งไปแล้ว) ถ้าเอางานสรรพสามิต
 *    ไปต่อท้าย **`continue` เหล่านั้นจะข้ามงานใหม่ไปด้วยเงียบ ๆ** และ TypeScript มองไม่เห็นเลย
 *
 * 🚨 **ส่งแยกกัน 2 ข้อความ** โดยตั้งใจ — วันเตือนของ ภพ.30 (ครบกำหนดวันที่ 15) ชนกับ
 *    งบเดือนสรรพสามิตทุกเดือนพอดี แต่เป็นคนละกรมและ **คนละสิ่งที่ต้องไปกด**
 *    (สรรพากร → สร้างแบบ · สรรพสามิต → ปิดเดือน) รวมข้อความเดียวจะเหลือคำสั่งท้าย 2 อัน
 *
 * ── ความปลอดภัย ────────────────────────────────────────────────────────────
 * 🚨 route นี้ใช้ **service role** (ข้าม RLS ไล่ดูลูกค้าทุกราย) จึงต้องกัน 2 ชั้น:
 *    1. `CRON_SECRET` — ไม่ตั้ง = ปิดตาย (503) ไม่ใช่เปิดฟรี
 *    2. middleware ปล่อย `/api/cron/*` ผ่านโดยไม่ต้องมี session → ที่นี่คือด่านเดียว
 * 🚨 `tenantId` ที่ส่งให้ `sendLineToTenant` **มาจากแถวในตาราง `tenants` เท่านั้น**
 *    ไม่มีทางให้ผู้เรียกระบุเองได้ — ไม่งั้นใครก็สั่งยิงข้อความเข้ากลุ่มลูกค้าได้
 *
 * ── ลำดับ ส่งก่อน แล้วค่อยจด ────────────────────────────────────────────────
 * 🪤 จดก่อนส่งแล้วส่งพลาด = **เตือนหายไปเลยตลอดกาล** (วันเตือนผ่านไปแล้ว ไม่มีรอบสอง)
 *    ส่งก่อนแล้วจดพลาด = อย่างมากได้ข้อความซ้ำถ้ามีการยิง cron ซ้ำในวันเดียวกัน
 *    → เลือกอย่างหลัง (ใช้กับทั้ง 2 งาน)
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** วันนี้ตามเวลาไทย — เซิร์ฟเวอร์เป็น UTC การใช้วันของเครื่องจะคลาด 1 วันช่วงหัวค่ำ */
function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

type Ent = {
  entity_id: string;
  name: string | null;
  is_vat: boolean | null;
  excise_id: string | null;
  /** D95 — วิธียื่นแบบ (null = ยังไม่ตั้ง → ใช้กำหนดกระดาษ และบอกในข้อความ) */
  filing_method: string | null;
};
type Tn = { id: string; slug: string };
/** รายการเตือน 1 รายการพร้อมชื่อกิจการที่มันสังกัด */
type Item<R> = { entityName: string; r: R };
type ReportRow = {
  tenant: string;
  job: "tax" | "excise" | "bar";
  sent: boolean;
  /** จังหวะที่ยิง — dry-run ใช้ตรวจว่าวันนี้เป็นจังหวะไหนของงวดไหน */
  stage?: DueStage;
  keys: string[];
  lines: string[];
};

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ตั้ง CRON_SECRET — งานเตือนกำหนดยื่นถูกปิดไว้" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateOverride = url.searchParams.get("date");
  const today = dateOverride || todayBangkok();
  const dry = url.searchParams.get("dry") === "1";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return NextResponse.json({ ok: false, error: "date ต้องเป็น yyyy-MM-dd" }, { status: 400 });
  }

  const admin = createAdminClient();
  const months = [today.slice(0, 7), prevMonth(today.slice(0, 7)), prevMonth(prevMonth(today.slice(0, 7)))];
  const report: ReportRow[] = [];

  // ── งานที่ 1: ภาษีสรรพากร (D88) — ตรรกะเดิมทั้งดุ้น ห่อเป็นฟังก์ชันเท่านั้น ──────
  async function taxPart(t: Tn, entities: Ent[]) {
    const [setRes, bankRes, fileRes] = await Promise.all([
      admin.from("app_settings").select("value").eq("tenant_id", t.id).eq("kind", "tax_account"),
      admin.from("bank_accounts").select("account_name").eq("tenant_id", t.id),
      /**
       * 🚨 D95 — ตัวปิดเสียงคือ `tax_filings` (ประกาศว่ายื่นแล้ว) **ไม่ใช่ `report_runs`**
       *    `report_runs` แปลว่า *กดพิมพ์แล้ว* — กดดูตัวเลขกลางเดือนแล้วการเตือนหายตลอดกาล
       *    (ความผิดพลาดตัวเดียวกับที่ D90/D91 แก้ไปแล้วฝั่งสรรพสามิต)
       */
      admin
        .from("tax_filings")
        .select("kind, period, entity_id")
        .eq("tenant_id", t.id)
        .in("period", months)
        .is("reopened_at", null),
    ]);

    // บัญชีในระบบภาษี — 🚨 ต้องใช้กฎ **ตัวเดียวกับแอป** (`effectiveTaxAccounts`)
    //    หลุดจากกันเมื่อไหร่ = เตือนเดือนที่ไม่ต้องยื่น หรือเงียบในเดือนที่ต้องยื่น
    const taxAccounts = effectiveTaxAccounts(
      (setRes.data ?? []).map((r) => String(r.value)),
      (bankRes.data ?? []).map((r) => String(r.account_name)),
    );

    // 🚨 อ่านไม่ได้ ≠ ยังไม่ยื่น — เดาว่ายังไม่ยื่นแล้วส่ง = สแปมเตือนงวดที่ยื่นไปแล้ว (D89)
    if (fileRes.error) {
      report.push({ tenant: t.slug, job: "tax", sent: false, keys: [], lines: [`ERROR: อ่านสถานะการยื่นแบบไม่สำเร็จ — ${fileRes.error.message}`] });
      return;
    }
    const filedSet = new Set(
      (fileRes.data ?? []).map((r) => `${r.entity_id ?? ""}|${r.kind}|${r.period}`),
    );

    // มีการหัก ณ ที่จ่ายในงวดไหนบ้าง (ต่อกิจการ)
    //
    // 🚨 ปลายช่วงต้องเป็น "วันที่ 1 ของเดือนถัดไป แล้วใช้ `lt`" ห้ามต่อท้ายด้วย `-31`
    //    `2026-11-31` ไม่มีอยู่จริง → Postgres คืน error 22008 → `data` เป็น null →
    //    **ภงด. ไม่เคยถูกเตือนเลยในเดือนที่มี 30 วันและเดือนกุมภาพันธ์ (5 ใน 12 เดือน)**
    //    และเงียบสนิทเพราะโค้ดเดิมไม่ได้อ่าน `error` (เจอตอนเทสเบราว์เซอร์ 2026-08-31)
    const from = `${months[months.length - 1]}-01`;
    const to = `${nextMonth(months[0])}-01`;
    const { data: whtTx, error: whtErr } = await admin
      .from("transactions")
      .select("transaction_date, entity_id, account_name, status, ap_ar_status, wht_amount, type")
      .eq("tenant_id", t.id)
      .gt("wht_amount", 0)
      .gte("transaction_date", from)
      .lt("transaction_date", to);
    // 🚨 อ่านไม่ได้ ≠ ไม่มีการหักภาษี — เงียบไปคือเตือนหายทั้งเดือน ต้องดังให้เห็นใน log + ผลลัพธ์
    if (whtErr) {
      report.push({ tenant: t.slug, job: "tax", sent: false, keys: [], lines: [`ERROR: อ่านบิลหัก ณ ที่จ่ายไม่สำเร็จ — ${whtErr.message}`] });
      return;
    }
    const whtSet = new Set<string>();
    for (const tx of whtTx ?? []) {
      if (tx.status !== "ปกติ" || tx.ap_ar_status) continue;
      if (tx.type !== "รายจ่าย") continue;
      if (!taxAccounts.has(String(tx.account_name ?? ""))) continue;
      whtSet.add(`${tx.entity_id ?? ""}|${String(tx.transaction_date ?? "").slice(0, 7)}`);
    }

    const items: Item<TaxReminder>[] = [];
    for (const e of entities) {
      const rs = taxRemindersFor({
        todayISO: today,
        entityId: e.entity_id,
        isVat: (e.is_vat ?? true) !== false,
        hasWht: (p) => whtSet.has(`${e.entity_id}|${p}`),
        // 🚨 D95 — ถามว่า "ยื่นแล้วหรือยัง" (tax_filings) ไม่ใช่ "กดพิมพ์แล้วหรือยัง"
        submitted: (kind, p) => filedSet.has(`${e.entity_id}|${kind}|${p}`),
        method: toFilingMethod(e.filing_method),
      });
      for (const r of rs) items.push({ entityName: e.name ?? e.entity_id, r });
    }

    await sendByStage({
      tenant: t,
      job: "tax",
      action: "TAX_REMINDER",
      items,
      multiEntity: entities.length > 1,
      render: (blocks, stage) => reminderMessage(blocks, { multiEntity: entities.length > 1, stage }),
    });
  }

  // ── งานที่ 2: งบเดือนสรรพสามิต (D92) ────────────────────────────────────────
  async function excisePart(t: Tn, entities: Ent[]) {
    // เฉพาะโรงสุรา — `excise_id` เป็นธง "กิจการนี้ต้องยื่นงบเดือน" (คอมเมนต์ใน schema 0001)
    const factories = entities.filter((e) => (e.excise_id ?? "").trim() !== "");
    if (factories.length === 0) return;

    // เดือนที่ **ปิดอยู่** (ยังไม่ถูกถอน) — 🚨 ถอนปิดแล้ว = ยังไม่ปิด → ต้องกลับมาเตือน
    const { data: closeRows, error: closeErr } = await admin
      .from("excise_month_close")
      .select("entity_id, month")
      .eq("tenant_id", t.id)
      .in("month", months)
      .is("reopened_at", null);
    // 🚨 อ่านไม่ได้ ≠ ยังไม่ปิด — เดาว่ายังไม่ปิดแล้วส่ง = สแปมเตือนทั้งที่ปิดไปแล้ว (D89)
    if (closeErr) {
      report.push({ tenant: t.slug, job: "excise", sent: false, keys: [], lines: [`ERROR: อ่านสถานะปิดเดือนไม่สำเร็จ — ${closeErr.message}`] });
      return;
    }
    const closedSet = new Set((closeRows ?? []).map((r) => `${r.entity_id ?? ""}|${r.month}`));

    const items: Item<ExciseReminder>[] = [];
    for (const e of factories) {
      const rs = exciseRemindersFor({
        todayISO: today,
        entityId: e.entity_id,
        hasExciseId: true,
        closed: (p) => closedSet.has(`${e.entity_id}|${p}`),
      });
      for (const r of rs) items.push({ entityName: e.name ?? e.entity_id, r });
    }

    await sendByStage({
      tenant: t,
      job: "excise",
      action: EXCISE_REMINDER_ACTION,
      items,
      multiEntity: factories.length > 1,
      render: (blocks, stage) =>
        exciseReminderMessage(blocks, { multiEntity: factories.length > 1, stage }),
    });
  }

  /**
   * ส่ง + จดกันซ้ำ — ใช้ร่วมกันทั้ง 2 งาน
   *
   * 🚨 **1 ข้อความต่อ 1 จังหวะ** — หัวข้อความ ("อีก 3 วัน" / "วันนี้วันสุดท้าย" /
   *    "เลยกำหนดแล้ว") ต้องตรงกับทุกบรรทัดที่อยู่ในข้อความนั้น · ยัดคนละจังหวะไว้ด้วยกัน
   *    = หัวข้อความโกหกบรรทัดใดบรรทัดหนึ่งเสมอ (ตระกูล D91/0059)
   *
   * 🪤 ลำดับ **ส่งก่อน แล้วค่อยจด** ยกมาจาก D88 ทั้งดุ้น — จดก่อนแล้วส่งพลาด =
   *    เตือนหายไปเลยตลอดกาล (วันนั้นผ่านไปแล้ว ไม่มีรอบสอง)
   */
  async function sendByStage<R extends { key: string; line: string; stage: DueStage }>(o: {
    tenant: Tn;
    job: "tax" | "excise";
    action: string;
    items: Item<R>[];
    multiEntity: boolean;
    render: (blocks: { entityName: string; lines: string[] }[], stage: DueStage) => string;
  }) {
    if (o.items.length === 0) return;

    const { data: done } = await admin
      .from("integration_log")
      .select("idempotency_key")
      .eq("tenant_id", o.tenant.id)
      .eq("action", o.action)
      .eq("status", "ok")
      .in("idempotency_key", o.items.map((i) => i.r.key));
    const sentKeys = new Set((done ?? []).map((d) => String(d.idempotency_key)));
    const fresh = o.items.filter((i) => !sentKeys.has(i.r.key));
    if (fresh.length === 0) return;

    for (const stage of DUE_STAGES) {
      const group = fresh.filter((i) => i.r.stage === stage);
      if (group.length === 0) continue;

      // รวมบรรทัดตามกิจการ โดยคงลำดับกิจการที่พบครั้งแรก
      const byEntity = new Map<string, string[]>();
      for (const i of group) byEntity.set(i.entityName, [...(byEntity.get(i.entityName) ?? []), i.r.line]);
      const blocks = [...byEntity.entries()].map(([entityName, lines]) => ({ entityName, lines }));
      const text = o.render(blocks, stage);
      const keys = group.map((i) => i.r.key);
      const lines = group.map((i) => i.r.line);

      if (dry) {
        report.push({ tenant: o.tenant.slug, job: o.job, sent: false, stage, keys, lines });
        continue;
      }

      const sent = await sendLineToTenant(o.tenant.id, text);
      if (sent) {
        await admin.from("integration_log").insert(
          group.map((i) => ({
            tenant_id: o.tenant.id,
            action: o.action,
            idempotency_key: i.r.key,
            status: "ok",
            message: i.r.line,
          })),
        );
      }
      report.push({ tenant: o.tenant.slug, job: o.job, sent, stage, keys, lines });
    }
  }

  /**
   * ── งานที่ 3: ยอดบาร์ค้างยังไม่ได้ลงบัญชี (D96 เฟส E) ──────────────────────
   *
   * 🚨 **แยกเป็นฟังก์ชันของตัวเอง เรียกด้วยธงโมดูล `bar` ของตัวเอง**
   *    ห้ามเอาไปต่อท้าย `taxPart`/`excisePart` — สองตัวนั้นมี `continue` หลายจุด
   *    งานใหม่จะถูกข้ามเงียบ ๆ และ TypeScript มองไม่เห็น (บทเรียน D92)
   *
   * 🚨 **ไม่บอกยอดเงิน** · **ส่งก่อนแล้วค่อยจด** · ไม่มีอะไรค้าง = เงียบ
   */
  async function barPart(t: Tn) {
    // กิจการของบาร์ + รอบขาย + บัญชีรับเงิน — อยู่ใน app_settings ต่อ tenant
    const { data: cfgRows, error: cfgErr } = await admin
      .from("app_settings")
      .select("kind, value")
      .eq("tenant_id", t.id)
      .in("kind", ["bar_entity", "bar_day_start", "bar_day_end", "bar_revenue_account"]);
    // 🚨 อ่านค่าตั้งค่าไม่ได้ ≠ ไม่มีบาร์ — เดาว่าไม่มีแล้วเงียบ = เตือนหายโดยไม่มีใครรู้ (D89)
    if (cfgErr) {
      report.push({ tenant: t.slug, job: "bar", sent: false, keys: [], lines: [`ERROR: อ่านค่าตั้งค่าบาร์ไม่สำเร็จ — ${cfgErr.message}`] });
      return;
    }
    const cfg = (k: string) => (cfgRows ?? []).find((r) => r.kind === k)?.value as string | undefined;
    const entityId = (cfg("bar_entity") ?? "").trim();
    // ★ ยังไม่ได้ตั้งกิจการของบาร์ = ยังไม่ได้เริ่มใช้โมดูลเลย → เงียบ ไม่ใช่ error
    if (!entityId) return;

    const [closed, posts] = await Promise.all([
      admin
        .from("bar_sale")
        .select("business_date, grand_total")
        .eq("tenant_id", t.id)
        .eq("entity_id", entityId)
        .eq("status", "ปกติ")
        .not("business_date", "is", null),
      admin
        .from("bar_post")
        .select("post_date")
        .eq("tenant_id", t.id)
        .eq("entity_id", entityId)
        .eq("status", "ปกติ"),
    ]);
    if (closed.error || posts.error) {
      report.push({ tenant: t.slug, job: "bar", sent: false, keys: [], lines: [`ERROR: อ่านยอดบาร์ไม่สำเร็จ — ${closed.error?.message ?? posts.error?.message}`] });
      return;
    }

    // 🚨 "วันขายของตอนนี้" ต้องคิดจากรอบขาย ไม่ใช่วันปฏิทิน
    //    ตี 1 ของรอบ 18:00–03:00 ยังอยู่ในวันขายของเมื่อวาน — เตือนตอนนั้น = บอกให้ปิดยอดคืนที่ยังขายอยู่
    const days = unpostedDays(
      (closed.data ?? []).map((x) => ({
        businessDate: (x.business_date as string) ?? "",
        grandTotal: Number(x.grand_total) || 0,
      })),
      (posts.data ?? []).map((x) => x.post_date as string),
      // 🚨 "วันขายของตอนนี้" ต้องคิดจาก **รอบขาย** ไม่ใช่วันปฏิทิน
      //    ตี 1 ของรอบ 18:00–03:00 ยังอยู่ในวันขายของเมื่อวาน — เตือนตอนนั้น
      //    = บอกให้ปิดยอดคืนที่ยังขายอยู่ แล้วยอดที่ลงจะขาด
      // ★ พารามิเตอร์ date= ใช้จำลองวันได้เหมือนอีก 2 งาน — ไม่งั้น dry-run ของงานนี้
      //   จะตอบตามเวลาจริงเสมอ ทดสอบอะไรไม่ได้เลย (และคนอ่านผลจะเข้าใจผิดว่าไม่มีอะไรค้าง)
      dateOverride ??
        businessDate(new Date(), {
          start: cfg("bar_day_start") || "00:00",
          end: cfg("bar_day_end") || "00:00",
        }),
    );

    const text = barReminderMessage({
      days,
      hasRevenueAccount: Boolean((cfg("bar_revenue_account") ?? "").trim()),
    });
    if (!text) return; // ไม่มีอะไรค้าง = เงียบ

    const key = barReminderKey(today);
    const { data: done } = await admin
      .from("integration_log")
      .select("idempotency_key")
      .eq("tenant_id", t.id)
      .eq("action", BAR_POST_REMINDER_ACTION)
      .eq("status", "ok")
      .eq("idempotency_key", key);
    if ((done ?? []).length > 0) return; // ส่งไปแล้ววันนี้

    if (dry) {
      report.push({ tenant: t.slug, job: "bar", sent: false, keys: [key], lines: text.split("\n") });
      return;
    }

    // 🪤 ส่งก่อน แล้วค่อยจด — จดก่อนแล้วส่งพลาด = เตือนหายตลอดกาล
    const sent = await sendLineToTenant(t.id, text);
    if (sent) {
      await admin.from("integration_log").insert({
        tenant_id: t.id,
        action: BAR_POST_REMINDER_ACTION,
        idempotency_key: key,
        status: "ok",
        message: text,
      });
    }
    report.push({ tenant: t.slug, job: "bar", sent, keys: [key], lines: text.split("\n") });
  }

  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, slug, name, is_active, is_platform, modules_enabled");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  for (const t of tenants ?? []) {
    if (!t.is_active || t.is_platform) continue;
    const mods = ((t.modules_enabled as string[]) ?? []);
    // 🐛 D96 — เดิมเขียนแค่ accounting/production ⇒ ลูกค้าที่ซื้อ **แค่โมดูลบาร์**
    //    ถูกข้ามตั้งแต่บรรทัดนี้ งานเตือนบาร์จะไม่มีวันทำงาน (กับดัก D92 เป๊ะ)
    if (!mods.includes("accounting") && !mods.includes("production") && !mods.includes("bar")) continue;

    const entRes = await admin
      .from("entities")
      .select("entity_id, name, is_vat, excise_id, filing_method")
      .eq("tenant_id", t.id)
      .order("entity_id");
    // 🚨 อ่านกิจการไม่ได้ = ทำอะไรต่อไม่ได้ทั้ง 2 งาน ต้องดังให้เห็น ไม่ใช่ข้ามเงียบ ๆ
    if (entRes.error) {
      report.push({ tenant: t.slug as string, job: "tax", sent: false, keys: [], lines: [`ERROR: อ่านรายชื่อกิจการไม่สำเร็จ — ${entRes.error.message}`] });
      continue;
    }
    const entities = (entRes.data ?? []) as Ent[];
    if (entities.length === 0) continue;

    const tn: Tn = { id: t.id as string, slug: t.slug as string };
    if (mods.includes("accounting")) await taxPart(tn, entities);
    if (mods.includes("production")) await excisePart(tn, entities);
    // ★ เตือนเรื่องลงบัญชีจะมีความหมายก็ต่อเมื่อซื้อโมดูลบัญชีด้วย —
    //   ซื้อแค่บาร์ = ไม่มีที่ให้ลงบัญชี ไม่ต้องเตือน
    if (mods.includes("bar") && mods.includes("accounting")) await barPart(tn);
  }

  return NextResponse.json({ ok: true, date: today, dry, tenants: report });
}
