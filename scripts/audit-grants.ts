/**
 * audit-grants — ตรวจว่า security definer ทุกตัว **ปิดประตูจริง** ในทุก DB ที่เราถืออยู่ (D99)
 *
 *   npm run db:audit-grants
 *
 * อ่านอย่างเดียว — เรียก `fn_audit_definer_grants()` (0074) ด้วย service role แล้วตรวจด้วย
 * ตัวตรวจตัวเดียวกับ test:tenant (`lib/shared/definerPolicy.ts`)
 *
 * 🔴 ทำไมต้องมี: `revoke ... from public` **รันผ่านแต่ไม่มีผล** บน Supabase และ drop+create
 *    ฟังก์ชันใหม่ = ได้สิทธิ์ default คืนมาเงียบ ๆ ⇒ "migration ลงสำเร็จ" ไม่ได้แปลว่าปิดแล้ว
 *    รันคำสั่งนี้หลัง `db:push:all -- --apply` ทุกครั้งที่แตะฟังก์ชัน
 *
 * รายชื่อ DB + ไฟล์ env มาจาก `supabase/targets.json` (ไม่อยู่ใน git — มีรหัส DB)
 * ใช้แค่ NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY จากไฟล์ env ของแต่ละก้อน
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { readEnv, die } from "./lib/provision";
import { parseTargets } from "./lib/db-targets";
import { auditDefiners, staleAllowlist, type DefinerRow } from "../lib/shared/definerPolicy";

async function main() {
  const file = "supabase/targets.json";
  if (!existsSync(file)) die(`ไม่พบ ${file} — ก๊อปจาก supabase/targets.example.json`);
  const targets = parseTargets(JSON.parse(readFileSync(file, "utf8")));

  let failed = 0;
  for (const t of targets) {
    const env = readEnv(t.env);
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    // ★ พิมพ์แค่ ref ไม่พิมพ์ key
    const ref = (url ?? "").replace(/^https:\/\//, "").split(".")[0];
    console.log(`\n▶ ${t.name}  (${ref || "?"})`);
    if (!url || !key) {
      console.log(`   ❌ ${t.env}: ต้องมี NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY`);
      failed++;
      continue;
    }

    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await db.rpc("fn_audit_definer_grants");
    if (error) {
      console.log(`   ❌ เรียก fn_audit_definer_grants ไม่ได้: ${error.message}`);
      console.log("      (ยังไม่ได้ลง migration 0074 ใน DB นี้? → npm run db:push:all -- --apply)");
      failed++;
      continue;
    }

    const rows = (data ?? []) as DefinerRow[];
    const a = auditDefiners(rows);
    const stale = staleAllowlist(rows);
    const definers = rows.filter((r) => r.definer).length;
    const closed = rows.filter((r) => r.definer && !r.anon && !r.authed).length;
    console.log(`   definer ${definers} ตัว · ปิดจาก anon+authenticated ${closed} ตัว`);

    const problems = [
      ...a.mustClosedMissing.map((n) => `หาไม่เจอใน DB (ต้องปิด): ${n}`),
      ...a.mustClosedOpen.map((f) => `🚨 ยังเปิดอยู่ (ต้องปิด): ${f}`),
      ...a.pTenantOpen.map((f) => `🚨 รับ p_tenant และเปิดอยู่โดยไม่มีด่านเทียบ my_tenant(): ${f}`),
      ...a.unguarded.map((u) => `🚨 คนนอกเรียกได้โดยไม่มีด่าน: ${u.fn} — ${u.why}`),
      ...stale.map((n) => `allowlist ค้าง (ไม่ต้องอยู่แล้ว): ${n}`),
    ];
    if (problems.length === 0) {
      console.log("   ✅ ผ่านทุกกฎ");
    } else {
      failed++;
      for (const p of problems) console.log(`   ❌ ${p}`);
    }
  }

  console.log("");
  if (failed) die(`ไม่ผ่าน ${failed} จาก ${targets.length} ก้อน`);
  console.log(`✅ ผ่านครบทั้ง ${targets.length} ก้อน`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
