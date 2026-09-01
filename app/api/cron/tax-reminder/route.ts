import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendLineToTenant } from "@/lib/line";
import { taxRemindersFor, reminderMessage, type TaxReminder } from "@/lib/accounting/taxReminder";
import { nextMonth, prevMonth } from "@/lib/accounting/taxPay";
import {
  EXCISE_REMINDER_ACTION,
  exciseRemindersFor,
  exciseReminderMessage,
  type ExciseReminder,
} from "@/lib/production/exciseReminder";

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
};
type Tn = { id: string; slug: string };
type ReportRow = {
  tenant: string;
  job: "tax" | "excise";
  sent: boolean;
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
  const today = url.searchParams.get("date") || todayBangkok();
  const dry = url.searchParams.get("dry") === "1";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return NextResponse.json({ ok: false, error: "date ต้องเป็น yyyy-MM-dd" }, { status: 400 });
  }

  const admin = createAdminClient();
  const months = [today.slice(0, 7), prevMonth(today.slice(0, 7)), prevMonth(prevMonth(today.slice(0, 7)))];
  const report: ReportRow[] = [];

  // ── งานที่ 1: ภาษีสรรพากร (D88) — ตรรกะเดิมทั้งดุ้น ห่อเป็นฟังก์ชันเท่านั้น ──────
  async function taxPart(t: Tn, entities: Ent[]) {
    const [setRes, runRes] = await Promise.all([
      admin.from("app_settings").select("value").eq("tenant_id", t.id).eq("kind", "tax_account"),
      admin.from("report_runs").select("report_key, month, entity_id").eq("tenant_id", t.id).in("month", months),
    ]);

    // บัญชีในระบบภาษี — เกณฑ์เดียวกับ `passesTaxGuard` ในรายงาน (ไม่งั้นเตือนเดือนที่ไม่ต้องยื่น)
    const taxAccounts = new Set<string>(
      (setRes.data ?? []).map((r) => String(r.value)).filter(Boolean),
    );
    if (taxAccounts.size === 0) taxAccounts.add("บัญชีบริษัท");

    const filedSet = new Set(
      (runRes.data ?? []).map((r) => `${r.entity_id ?? ""}|${r.report_key}|${r.month}`),
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

    const blocks: { entityName: string; lines: string[] }[] = [];
    const all: TaxReminder[] = [];
    for (const e of entities) {
      const rs = taxRemindersFor({
        todayISO: today,
        entityId: e.entity_id,
        isVat: (e.is_vat ?? true) !== false,
        hasWht: (p) => whtSet.has(`${e.entity_id}|${p}`),
        filed: (key, p) => filedSet.has(`${e.entity_id}|${key}|${p}`),
      });
      if (rs.length === 0) continue;
      all.push(...rs);
      blocks.push({ entityName: e.name ?? e.entity_id, lines: rs.map((r) => r.line) });
    }
    if (all.length === 0) return;

    // กันส่งซ้ำ — key ที่เคยจดไว้แล้วตัดทิ้งก่อน
    const { data: done } = await admin
      .from("integration_log")
      .select("idempotency_key")
      .eq("tenant_id", t.id)
      .eq("action", "TAX_REMINDER")
      .eq("status", "ok")
      .in("idempotency_key", all.map((r) => r.key));
    const sentKeys = new Set((done ?? []).map((d) => String(d.idempotency_key)));
    const fresh = all.filter((r) => !sentKeys.has(r.key));
    if (fresh.length === 0) return;

    const freshBlocks = blocks
      .map((b) => ({
        entityName: b.entityName,
        lines: b.lines.filter((l) => fresh.some((f) => f.line === l)),
      }))
      .filter((b) => b.lines.length > 0);
    const text = reminderMessage(freshBlocks, { multiEntity: entities.length > 1 });

    if (dry) {
      report.push({ tenant: t.slug, job: "tax", sent: false, keys: fresh.map((f) => f.key), lines: freshBlocks.flatMap((b) => b.lines) });
      return;
    }

    const sent = await sendLineToTenant(t.id, text);
    if (sent) {
      await admin.from("integration_log").insert(
        fresh.map((r) => ({
          tenant_id: t.id,
          action: "TAX_REMINDER",
          idempotency_key: r.key,
          status: "ok",
          message: r.line,
        })),
      );
    }
    report.push({ tenant: t.slug, job: "tax", sent, keys: fresh.map((f) => f.key), lines: freshBlocks.flatMap((b) => b.lines) });
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

    const blocks: { entityName: string; lines: string[] }[] = [];
    const all: ExciseReminder[] = [];
    for (const e of factories) {
      const rs = exciseRemindersFor({
        todayISO: today,
        entityId: e.entity_id,
        hasExciseId: true,
        closed: (p) => closedSet.has(`${e.entity_id}|${p}`),
      });
      if (rs.length === 0) continue;
      all.push(...rs);
      blocks.push({ entityName: e.name ?? e.entity_id, lines: rs.map((r) => r.line) });
    }
    if (all.length === 0) return;

    const { data: done } = await admin
      .from("integration_log")
      .select("idempotency_key")
      .eq("tenant_id", t.id)
      .eq("action", EXCISE_REMINDER_ACTION)
      .eq("status", "ok")
      .in("idempotency_key", all.map((r) => r.key));
    const sentKeys = new Set((done ?? []).map((d) => String(d.idempotency_key)));
    const fresh = all.filter((r) => !sentKeys.has(r.key));
    if (fresh.length === 0) return;

    const freshBlocks = blocks
      .map((b) => ({ entityName: b.entityName, lines: b.lines.filter((l) => fresh.some((f) => f.line === l)) }))
      .filter((b) => b.lines.length > 0);
    const text = exciseReminderMessage(freshBlocks, { multiEntity: factories.length > 1 });

    if (dry) {
      report.push({ tenant: t.slug, job: "excise", sent: false, keys: fresh.map((f) => f.key), lines: freshBlocks.flatMap((b) => b.lines) });
      return;
    }

    const sent = await sendLineToTenant(t.id, text);
    if (sent) {
      await admin.from("integration_log").insert(
        fresh.map((r) => ({
          tenant_id: t.id,
          action: EXCISE_REMINDER_ACTION,
          idempotency_key: r.key,
          status: "ok",
          message: r.line,
        })),
      );
    }
    report.push({ tenant: t.slug, job: "excise", sent, keys: fresh.map((f) => f.key), lines: freshBlocks.flatMap((b) => b.lines) });
  }

  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, slug, name, is_active, is_platform, modules_enabled");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  for (const t of tenants ?? []) {
    if (!t.is_active || t.is_platform) continue;
    const mods = ((t.modules_enabled as string[]) ?? []);
    if (!mods.includes("accounting") && !mods.includes("production")) continue;

    const entRes = await admin
      .from("entities")
      .select("entity_id, name, is_vat, excise_id")
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
  }

  return NextResponse.json({ ok: true, date: today, dry, tenants: report });
}
