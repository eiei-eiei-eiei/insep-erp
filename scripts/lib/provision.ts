/**
 * ตัวช่วยร่วมของสคริปต์ฝั่งผู้ดูแลระบบ (provision-tenant / add-entity)
 *
 * 🚨 ทั้งหมดใช้ service role = bypass RLS → ต้องระบุ tenant เองทุก query เสมอ
 * 🚨 ห้าม import อะไรจาก tests/tenant/harness.ts — ตัวนั้นยัดข้อมูลตัวอย่างเข้าไปด้วย
 *    (materials/products/ออเดอร์ "ทดสอบ") ซึ่งลูกค้าจริงต้องไม่ได้รับ
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

export const argOf = (n: string) =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=").trim() ?? "";

export const hasFlag = (n: string) => process.argv.includes(`--${n}`);

/** อ่าน .env แบบง่าย — ตัดคอมเมนต์ท้ายบรรทัดด้วย (ดูเหตุผลใน scripts/backup-tables.ts) */
export function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const raw = m[2].trim();
    const q = raw.match(/^(["'])([\s\S]*?)\1/);
    out[m[1]] = q ? q[2] : raw.replace(/\s+#.*$/, "").trim();
  }
  return out;
}

/**
 * เปิด client แบบ service role จากไฟล์ env ที่ระบุ + พิมพ์ให้เห็นว่ากำลังยิงไป project ไหน
 * ★ พิมพ์เฉพาะ ref ห้ามพิมพ์ key — สคริปต์พวกนี้ผู้ใช้ก๊อป output ไปแปะถามได้
 */
export function adminFromEnv(envFile: string): { db: SupabaseClient; ref: string } {
  const env = readEnv(envFile);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(`${envFile}: ต้องมี NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY`);
  }
  const ref = url.replace(/^https:\/\//, "").split(".")[0];
  return { db: createClient(url, key, { auth: { persistSession: false } }), ref };
}

export const die = (msg: string): never => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};
