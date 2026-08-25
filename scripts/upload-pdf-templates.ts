/**
 * upload-pdf-templates — อัปโหลดฟอร์มราชการ + ฟอนต์เข้า Supabase Storage bucket `pdf-templates`
 * ใช้ SERVICE ROLE (bypass RLS) — ห้ามรันฝั่ง client
 *
 * ต้นฉบับอยู่ที่ docs/form/ (แบน) — สคริปต์ map เป็น path ใน bucket ตาม MIGRATION_PLAN sec 5.3
 * ที่ Phase 2 (getPdfAsset) จะเรียกใช้: fonts/… · excise/… · wht/…
 *
 * วิธีใช้:
 *   1. ตั้ง env ใน .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   2. รัน:  npm run upload:templates                 (ใช้ docs/form เป็นต้นทาง)
 *      หรือ  npm run upload:templates -- <src-dir> [--include-wh3]
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

try {
  process.loadEnvFile?.(".env.local"); // Node 21+ อ่าน .env.local เอง
} catch {
  /* ไม่มีไฟล์ก็อ่านจาก env ที่ตั้งไว้ */
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const SRC = args[0] ?? "docs/form";
const INCLUDE_WH3 = flags.includes("--include-wh3");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "pdf-templates";

if (!URL || !KEY) {
  console.error("❌ ต้องตั้ง NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env.local");
  process.exit(1);
}

// map: ไฟล์ต้นทางใน docs/form (ชื่อไทยได้) → path ปลายทางใน bucket
// ⚠️ Supabase Storage key รับเฉพาะ ASCII — ปลายทางต้องเป็นอังกฤษ (ไทย = "Invalid key")
//    ชื่อ pso_07-XX_Y = ภส.๐๗-XX/Y · Phase 2 (getPdfAsset) จะอ้าง path เหล่านี้
// wh3 มี confirm=true (ผู้ใช้ยืนยันแล้วว่าเป็นเทมเพลตเปล่า — รันด้วย --include-wh3)
type Item = { src: string; dest: string; confirm?: boolean };
const MAPPING: Item[] = [
  { src: "THSARABUN.TTF", dest: "fonts/THSARABUN.TTF" },       // เลขอารบิก (ใช้จริง)
  { src: "THSARABUNIT๙.TTF", dest: "fonts/THSARABUNIT9.TTF" }, // เลขไทย (สำรอง)
  { src: "ภส_07-01ทับ1.pdf", dest: "excise/pso_07-01_1.pdf" },
  { src: "ภส_07-02ทับ1.pdf", dest: "excise/pso_07-02_1.pdf" },
  { src: "ภส_07-02ทับ11.pdf", dest: "excise/pso_07-02_1_chae.pdf" }, // สุราแช่ (D78)
  { src: "ภส_07-02ทับ12.pdf", dest: "excise/pso_07-02_12.pdf" },
  { src: "ภส_07-04ทับ1.pdf", dest: "excise/pso_07-04_1.pdf" },
  { src: "approve_wh3_081156.pdf", dest: "wht/wh3_template.pdf", confirm: true },
];

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

function contentType(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".pdf")) return "application/pdf";
  if (p.endsWith(".ttf")) return "font/ttf";
  return "application/octet-stream";
}

async function main() {
  let ok = 0;
  let skipped = 0;
  const missing: string[] = [];

  for (const item of MAPPING) {
    if (item.confirm && !INCLUDE_WH3) {
      console.log(
        `  ⏭  ข้าม ${item.src} — ต้องยืนยันว่าเป็นเทมเพลตเปล่าก่อน แล้วรันด้วย --include-wh3`,
      );
      skipped++;
      continue;
    }
    const full = join(SRC, item.src);
    if (!existsSync(full)) {
      missing.push(item.src);
      continue;
    }
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(item.dest, readFileSync(full), {
        contentType: contentType(item.dest),
        upsert: true,
      });
    if (error) console.error(`  ✗ ${item.dest} — ${error.message}`);
    else {
      console.log(`  ✓ ${item.src} → ${item.dest}`);
      ok++;
    }
  }

  if (missing.length) console.error(`\n⚠️ ไม่พบไฟล์ใน ${SRC}: ${missing.join(", ")}`);
  console.log(`\nเสร็จ: อัปโหลด ${ok} · ข้าม ${skipped} · ขาด ${missing.length}`);
  if (missing.length) process.exit(1);
}

main();
