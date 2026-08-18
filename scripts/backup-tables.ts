/**
 * backup-tables — ดึงข้อมูลทุกตารางออกเป็นไฟล์ JSON (สำรองก่อนรัน migration ที่เสี่ยง)
 *
 *   npx tsx scripts/backup-tables.ts --env=.env.local.production-backup --out="D:/insep-erp-backup/xxx"
 *
 * ทำไมไม่ใช้ `supabase db dump`: ต้องมี Docker (หรือ pg_dump) ซึ่งเครื่องผู้ใช้ไม่มี
 * ทำไมพอ: **schema อยู่ใน git อยู่แล้ว** (supabase/migrations/*) สิ่งที่แทนไม่ได้คือข้อมูล
 *
 * 🚨 ไฟล์ที่ได้คือข้อมูลจริงที่ใช้ยื่นภาษี — เก็บนอก repo เสมอ (.gitignore กัน /backup/ ไว้ด้วย)
 * 🚨 ใช้ service role key → bypass RLS โดยตั้งใจ (ต้องได้ทุกแถวจริง ๆ ถึงจะเรียกว่าสำรอง)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/** ทุกตารางของแอป ณ migration 0024 (ตรงกับ TENANT_TABLES ใน tests/tenant/harness.ts ลบ tenants) */
const TABLES = [
  "entities", "bank_accounts", "app_settings", "contacts", "counters", "integration_log",
  "materials", "containers", "products",
  "log_material", "log_ferment", "log_distill", "log_distill_run",
  "log_ferment_monitor", "log_dilute", "log_product", "stock_product",
  "transactions", "transaction_items", "tax_summaries", "wht_certificates",
  "sale_menu", "sales_orders", "sales_order_items", "warehouse_stock", "stock_moves",
  "report_runs", "edit_log", "snapshots", "profiles",
];

const PAGE = 1000; // limit ปริยายของ PostgREST — ต้องวนหน้า ไม่งั้นตารางใหญ่ขาดเงียบ ๆ

const argOf = (n: string) =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=").trim() ?? "";

/** อ่าน .env แบบง่าย — ไม่พึ่ง dotenv (ไม่ได้ติดตั้งไว้)
 *  ⚠️ ต้องตัดคอมเมนต์ท้ายบรรทัด (`KEY=ค่า   # หมายเหตุ`) ไม่งั้นคอมเมนต์กลายเป็นส่วนหนึ่งของค่า
 *     .env.local.production-backup มีจริง → key เพี้ยน แล้วพังตอนยัดใส่ HTTP header
 *     ด้วย error ที่อ่านไม่ออกเลยว่าเกิดจากอะไร ("Cannot convert argument to a ByteString") */
function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const q = v.match(/^(["'])([\s\S]*?)\1/);        // มีเครื่องหมายคำพูด = เอาข้างในตรง ๆ
    v = q ? q[2] : v.replace(/\s+#.*$/, "").trim();  // ไม่มี = ตัดตั้งแต่ " #" เป็นต้นไป
    out[m[1]] = v;
  }
  return out;
}

async function main() {
  const envFile = argOf("env") || ".env.local";
  const outDir = argOf("out");
  if (!outDir) throw new Error("ต้องระบุ --out=<โฟลเดอร์ปลายทาง>");

  const env = readEnv(envFile);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`${envFile}: ต้องมี NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY`);

  // ★ พิมพ์แค่ ref ไม่พิมพ์ key — ผู้ใช้ต้องเห็นด้วยตาว่ากำลังสำรองของ project ไหน
  const ref = url.replace(/^https:\/\//, "").split(".")[0];
  console.log(`\n📦 สำรองจาก project: ${ref}`);
  console.log(`   ปลายทาง: ${outDir}\n`);

  mkdirSync(outDir, { recursive: true });
  const db = createClient(url, key, { auth: { persistSession: false } });

  const counts: Record<string, number | string> = {};
  let total = 0;

  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(t).select("*").range(from, from + PAGE - 1);
      if (error) {
        // ตารางที่ยังไม่มีใน DB นั้น = ข้ามไป แต่ต้องบันทึกไว้ให้เห็น ไม่ใช่เงียบ
        counts[t] = `ข้าม (${error.message})`;
        console.log(`   ⚠️  ${t.padEnd(22)} ${counts[t]}`);
        break;
      }
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) {
        counts[t] = rows.length;
        total += rows.length;
        writeFileSync(path.join(outDir, `${t}.json`), JSON.stringify(rows, null, 1), "utf8");
        console.log(`   ✓ ${t.padEnd(22)} ${rows.length} แถว`);
        break;
      }
    }
  }

  writeFileSync(
    path.join(outDir, "_manifest.json"),
    JSON.stringify({ project_ref: ref, taken_at: new Date().toISOString(), counts, total }, null, 1),
    "utf8",
  );

  console.log(`\n✅ เสร็จ — รวม ${total} แถว · รายละเอียดอยู่ใน _manifest.json\n`);
}

main().catch((e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
