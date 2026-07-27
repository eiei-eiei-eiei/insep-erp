/**
 * import-csv.ts — ย้ายข้อมูลจริงจาก .xlsx 3 แอป เข้า Supabase (MIGRATION_PLAN sec 7.2)
 *
 * ใช้:
 *   npm run migrate:import -- --dry       ตรวจ/สร้าง record อย่างเดียว ไม่เขียน DB (ดู warning ก่อน)
 *   npm run migrate:import -- --fresh      ล้างตารางทั้งหมดแล้วโหลดใหม่ (rerun/cutover)
 *   npm run migrate:import                 โหลดเข้า DB ว่าง (ถ้ามีข้อมูลอยู่จะเตือนให้ใช้ --fresh)
 *
 * ต้องมี .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * และ push migration 0014 (fn_mig_*) ก่อน: npm run db:push
 *
 * ลำดับ: truncate(ถ้า --fresh) → ปิด trigger → insert ตาม FK → เปิด trigger
 *        → recompute stock_product → seed counters
 */
import { buildDataset } from "./lib/transform";
import { serviceClient, insertBatch } from "./lib/client";

const DRY = process.argv.includes("--dry");
const FRESH = process.argv.includes("--fresh");

async function rpc(db: ReturnType<typeof serviceClient>, fn: string, args?: Record<string, unknown>) {
  const { error } = await db.rpc(fn, args ?? {});
  if (error) throw new Error(`rpc ${fn}: ${error.message}`);
}

async function main() {
  console.log("── สร้างชุดข้อมูลจากชีท (clean + validate) ──");
  const ds = buildDataset();

  console.log("\nจำนวน record ต่อตาราง:");
  for (const t of ds.order) console.log(`  ${t.padEnd(22)} ${ds.tables[t].length}`);
  console.log(`  ${"counters".padEnd(22)} ${ds.counters.length}`);

  if (ds.warnings.length) {
    console.log(`\n⚠️ warning ${ds.warnings.length} รายการ (จัดการอัตโนมัติแล้ว):`);
    ds.warnings.forEach((w) => console.log("   - " + w));
  }
  if (ds.contactRemap.size) {
    console.log("\nremap ลูกค้า (order custId → contacts):");
    for (const [k, v] of ds.contactRemap) console.log(`   ${k} → ${v}`);
  }

  if (DRY) {
    console.log("\n✅ --dry: ตรวจอย่างเดียว ไม่เขียน DB");
    return;
  }

  const db = serviceClient();

  // กันเขียนทับ DB ที่มีข้อมูลอยู่โดยไม่ตั้งใจ
  if (!FRESH) {
    const { count, error } = await db.from("entities").select("*", { count: "exact", head: true });
    if (error) throw new Error(`เช็คสถานะ DB: ${error.message}`);
    if ((count ?? 0) > 0) {
      console.error(
        `\n❌ DB มี entities อยู่แล้ว ${count} แถว — ถ้าต้องการโหลดใหม่ทับ ให้รันด้วย --fresh\n` +
          "   (--fresh จะล้างข้อมูล migration ทั้งหมดก่อนโหลด — ไม่แตะ profiles/auth)",
      );
      process.exit(1);
    }
  }

  if (FRESH) {
    console.log("\n── ล้างตารางเดิม (fn_mig_truncate) ──");
    await rpc(db, "fn_mig_truncate");
  }

  console.log("── ปิด trigger (audit + stock) ──");
  await rpc(db, "fn_mig_set_triggers", { p_enable: false });

  try {
    console.log("── insert ตามลำดับ FK ──");
    for (const t of ds.order) {
      const recs = ds.tables[t];
      if (recs.length === 0) {
        console.log(`  ${t.padEnd(22)} (ว่าง ข้าม)`);
        continue;
      }
      await insertBatch(db, t, recs);
      console.log(`  ${t.padEnd(22)} ✓ ${recs.length}`);
    }
  } finally {
    console.log("── เปิด trigger กลับ ──");
    await rpc(db, "fn_mig_set_triggers", { p_enable: true });
  }

  console.log("── สร้าง stock_product จาก log (recompute) ──");
  await rpc(db, "fn_mig_recompute_stock");

  if (ds.counters.length) {
    console.log("── seed counters ──");
    const { error } = await db.from("counters").upsert(ds.counters);
    if (error) throw new Error(`seed counters: ${error.message}`);
    ds.counters.forEach((c) => console.log(`  ${c.key} = ${c.value}`));
  }

  console.log("\n✅ import เสร็จ — ต่อไปรัน: npm run migrate:reconcile");
}

main().catch((e) => {
  console.error("\n❌ " + (e as Error).message);
  process.exit(1);
});
