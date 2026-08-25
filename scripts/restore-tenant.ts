/**
 * restore-tenant — เอาไฟล์ที่ลูกค้า "ดาวน์โหลดข้อมูล" ไว้ กลับเข้า DB (D82)
 *
 *   npm run restore:tenant -- --env=.env.local.testing-backup --file="D:/…/insep-rongkor-….json"
 *   npm run restore:tenant -- --env=… --file=… --apply        # ลงจริง
 *
 * 🎯 ทำไมเป็นสคริปต์ฝั่งเจ้าของ ไม่ใช่ปุ่มในแอป: ระบบ snapshot เดิมมีปุ่มย้อนกลับให้ลูกค้ากดเอง
 *    ซึ่งเรียก `fn_mig_set_triggers` = ปิด trigger **ทั้งฐานข้อมูล** กระทบลูกค้าเจ้าอื่นที่ใช้อยู่
 *    (เหตุผลเต็ม `docs/DECISIONS.md` D82)
 *
 * 🚨 สคริปต์นี้ **ห้ามเรียก `fn_mig_set_triggers` เด็ดขาด** — นั่นคือสิ่งที่งานนี้ตั้งใจกำจัด
 *    ปล่อย trigger ทำงานปกติ · สต็อกยังถูกเพราะเรียก `fn_mig_recompute_stock` ปิดท้าย
 *    · `edit_log` จะมีแถวเพิ่มจากการ restore ซึ่ง **ควรมี** (ย้อนข้อมูลทั้งระบบคือเหตุการณ์ที่ต้อง audit)
 *
 * 🚨 ใช้ service role = bypass RLS → ทุก query ต้องผูก tenant ด้วยมือเอง DB ช่วยไม่ได้
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  EXPORT_FORMAT, EXPORT_VERSION, RESTORE_ORDER, RESTORE_SKIP, totalRows,
  type ExportEnvelope,
} from "../lib/export/tenantExport";

/** ★ ลิสต์ที่ `lib/shared/tenantTables.test.ts` ไล่อ่านมาเทียบ — ต้องครบทุกตารางเสมอ */
const TABLES = [...RESTORE_ORDER, ...RESTORE_SKIP];

const BATCH = 500;

const argOf = (n: string) =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=").trim() ?? "";
const hasFlag = (n: string) => process.argv.includes(`--${n}`);

/** อ่าน .env แบบง่าย — ตัดคอมเมนต์ท้ายบรรทัดเหมือน backup-tables.ts (ไม่ตัด = key เพี้ยน) */
function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const q = v.match(/^(["'])([\s\S]*?)\1/);
    v = q ? q[2] : v.replace(/\s+#.*$/, "").trim();
    out[m[1]] = v;
  }
  return out;
}

async function rpc(db: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { error } = await db.rpc(fn, args);
  if (error) throw new Error(`rpc ${fn}: ${error.message}`);
}

async function countOf(db: SupabaseClient, table: string, tenant: string): Promise<number | null> {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenant);
  return error ? null : count ?? 0;
}

async function insertBatch(db: SupabaseClient, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from(table).insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`insert ${table} (แถว ${i + 1}+): ${error.message}`);
  }
}

/** อ่าน counter ปัจจุบัน (ใช้เป็น "พื้น" กันเลขถอยหลัง) */
async function readCounters(db: SupabaseClient, tenant: string): Promise<Map<string, number>> {
  const { data } = await db.from("counters").select("key, value").eq("tenant_id", tenant);
  return new Map((data ?? []).map((r) => [String((r as Record<string, unknown>).key), Number((r as Record<string, unknown>).value) || 0]));
}

/**
 * ตั้ง counter ใหม่จาก max ของข้อมูลที่เพิ่งใส่กลับ — กัน `next_serial` แจกเลขชนของเดิม
 * ★ ตรรกะคิด max จากข้อมูล ยกมาจาก `lib/snapshot/engine.ts` ที่ถูกลบไป
 *
 * 🚨 **เลขเอกสารห้ามถอยหลังเด็ดขาด** (เพิ่มใน D82 — ของเดิมถอย)
 *    ของเดิมตั้ง counter = max ของ*ข้อมูลที่เหลืออยู่* เฉย ๆ → เอกสารที่ออกไปหลังวันสำรอง
 *    (แล้วถูกล้างทิ้งตอน restore) จะปล่อยเลขนั้นกลับมาให้ใช้ซ้ำ
 *    = ใบกำกับภาษี/ใบเสร็จ **เลขเดียวกันสองใบคนละเนื้อหา** ซึ่งเป็นปัญหากับสรรพากรจริง
 *    → ใช้ค่าสูงสุดของ 3 ทาง: ค่าก่อน restore · ค่าในไฟล์ · max จากข้อมูลที่ใส่กลับ
 *
 * 🪤 ครอบคีย์ที่คำนวณจากข้อมูลไม่ได้ด้วย (`EMP` · `INV-…` · `TAX-…`) — พวกนี้ถ้าไม่มีพื้น
 *    จะเหลือแค่ค่าในไฟล์ ซึ่งเก่ากว่าความจริงเสมอถ้ามีการออกเอกสารหลังวันสำรอง
 */
async function reseedIdCounters(db: SupabaseClient, tenant: string, floor: Map<string, number>) {
  const max = new Map<string, number>(floor);
  const bump = (key: string, serial: number) => {
    if (Number.isFinite(serial)) max.set(key, Math.max(max.get(key) ?? 0, serial));
  };
  // ค่าที่เพิ่ง restore มาจากไฟล์ก็ต้องนับเป็นพื้นด้วย
  for (const [k, v] of await readCounters(db, tenant)) bump(k, v);
  const str = (r: unknown, col: string) => String((r as Record<string, unknown>)[col] ?? "");

  const { data: txs } = await db.from("transactions").select("tx_id, transfer_id").eq("tenant_id", tenant);
  for (const t of txs ?? []) {
    const m = str(t, "tx_id").match(/^(TR-\d{8})-(\d+)$/);
    if (m) bump(m[1], Number(m[2]));
    const trf = str(t, "transfer_id").match(/^(TRF-\d{8})-(\d+)$/);
    if (trf) bump(trf[1], Number(trf[2]));
  }
  const { data: os } = await db.from("sales_orders").select("qu_no, order_no").eq("tenant_id", tenant);
  for (const o of os ?? []) {
    const q = str(o, "qu_no").match(/^QU(\d{6})-(\d+)$/);
    if (q) bump(`QU-${q[1]}`, Number(q[2]));
    const r = str(o, "order_no").match(/^ORD(\d{6})-(\d+)$/);
    if (r) bump(`ORD-${r[1]}`, Number(r[2]));
  }
  const { data: cs } = await db.from("contacts").select("contact_id").eq("tenant_id", tenant);
  for (const c of cs ?? []) {
    const m = str(c, "contact_id").match(/^C-(\d+)$/);
    if (m) bump("CONTACT", Number(m[1]));
  }
  const { data: bs } = await db.from("bank_accounts").select("account_id").eq("tenant_id", tenant);
  for (const b of bs ?? []) {
    const m = str(b, "account_id").match(/^ACC-(\d+)$/);
    if (m) bump("BANK_ACC", Number(m[1]));
  }

  const ups = [...max.entries()].map(([key, value]) => ({ tenant_id: tenant, key, value }));
  if (ups.length) {
    const { error } = await db.from("counters").upsert(ups, { onConflict: "tenant_id,key" });
    if (error) throw new Error(`reseed counters: ${error.message}`);
  }
}

async function main() {
  const envFile = argOf("env") || ".env.local";
  const file = argOf("file");
  const apply = hasFlag("apply");
  const forceTenant = argOf("tenant");
  if (!file) throw new Error("ต้องระบุ --file=<ไฟล์ .json ที่ลูกค้าดาวน์โหลดไว้>");

  const env = readEnv(envFile);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`${envFile}: ต้องมี NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY`);

  const snap = JSON.parse(readFileSync(file, "utf8")) as ExportEnvelope;
  if (snap.format !== EXPORT_FORMAT) throw new Error(`ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบ (format=${snap.format})`);
  if (snap.version > EXPORT_VERSION) {
    throw new Error(`ไฟล์เป็นเวอร์ชัน ${snap.version} แต่สคริปต์รู้จักถึง ${EXPORT_VERSION} — อัปเดตโค้ดก่อน`);
  }

  const ref = url.replace(/^https:\/\//, "").split(".")[0];
  const db = createClient(url, key, { auth: { persistSession: false } });

  // 🚨 ด่านกันเอาไฟล์ของลูกค้า A ลงทับลูกค้า B — เช็คว่า tenant ในไฟล์มีอยู่จริงในปลายทาง
  const tenantId = forceTenant || snap.tenant?.id;
  if (!tenantId) throw new Error("ไฟล์ไม่มี tenant.id — ใช้ไม่ได้ (ต้องระบุ --tenant=<uuid> เอง)");
  const { data: t } = await db.from("tenants").select("id, slug, name").eq("id", tenantId).maybeSingle();
  if (!t) {
    throw new Error(
      `ไม่พบกิจการ ${tenantId} ใน DB ${ref}\n` +
      `   ไฟล์นี้เป็นของ "${snap.tenant?.name}" (${snap.tenant?.slug}) — น่าจะคนละ DB\n` +
      `   ถ้าตั้งใจจริง ให้ระบุ --tenant=<uuid ปลายทาง>`,
    );
  }
  if (!forceTenant && snap.tenant.slug !== t.slug) {
    throw new Error(`slug ไม่ตรง: ไฟล์เป็นของ "${snap.tenant.slug}" แต่ปลายทางคือ "${t.slug}"`);
  }

  console.log(`\n📥 เอาข้อมูลกลับเข้า DB: ${ref}`);
  console.log(`   กิจการ  : ${t.name} (${t.slug})`);
  console.log(`   ไฟล์    : ${file}`);
  console.log(`   สำรองไว้: ${snap.exported_at} โดย ${snap.exported_by}`);
  console.log(`   รวม     : ${totalRows(snap.counts).toLocaleString("th-TH")} แถว\n`);

  console.log("   ตาราง                    ตอนนี้ →  ในไฟล์      ต่าง");
  console.log("   " + "─".repeat(56));
  for (const table of TABLES) {
    const cur = await countOf(db, table, tenantId);
    const inFile = snap.tables[table]?.length ?? 0;
    const skip = RESTORE_SKIP.includes(table);
    const delta = cur === null ? "" : String(inFile - cur);
    const note = skip ? "  (ข้าม — คำนวณใหม่/แตะไม่ได้)" : "";
    console.log(
      `   ${table.padEnd(22)} ${String(cur ?? "-").padStart(7)} → ${String(inFile).padStart(7)}  ${delta.padStart(7)}${note}`,
    );
  }

  if (!apply) {
    console.log(`\n👀 โหมดดูอย่างเดียว — ยังไม่แตะ DB เลย`);
    console.log(`   ลงจริงด้วยการเติม --apply ต่อท้ายคำสั่งเดิม\n`);
    return;
  }

  console.log(`\n⚠️  กำลังลงจริง — ล้างข้อมูลเดิมของกิจการนี้แล้วใส่จากไฟล์\n`);
  // 🚨 ต้องอ่าน**ก่อน**ล้าง — เลขเอกสารที่เดินไปแล้วห้ามถอยกลับ (ดู reseedIdCounters)
  const counterFloor = await readCounters(db, tenantId);
  await rpc(db, "fn_mig_truncate", { p_tenant: tenantId });

  for (const table of RESTORE_ORDER) {
    const rows = (snap.tables[table] ?? []).map((r) => {
      // strip `id` (bigserial) — ให้ DB แจกใหม่ · บังคับ tenant_id กันไฟล์เก่าที่ไม่มีคอลัมน์นี้
      const { id: _drop, ...rest } = r as Record<string, unknown>;
      void _drop;
      return { ...rest, tenant_id: tenantId };
    });
    if (rows.length) {
      await insertBatch(db, table, rows);
      console.log(`   ✓ ${table.padEnd(22)} ${rows.length} แถว`);
    }
  }

  await rpc(db, "fn_mig_recompute_stock", { p_tenant: tenantId });
  await reseedIdCounters(db, tenantId, counterFloor);
  console.log(`\n✅ เสร็จ — คำนวณสต็อกใหม่และตั้งเลขรันนิ่งให้แล้ว\n`);
}

main().catch((e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  // 🪤 ใช้ exitCode ไม่ใช่ process.exit() — บน Windows การ exit ทั้งที่ยังมี handle ของ
  //    supabase-js ค้างอยู่ ทำให้ libuv พ่น "Assertion failed: UV_HANDLE_CLOSING" ต่อท้าย
  //    ข้อความ error ซึ่งน่าตกใจเกินเหตุ ตอนที่คนรันกำลังกู้ข้อมูลลูกค้าอยู่พอดี
  process.exitCode = 1;
});
