/**
 * import-csv.ts — ย้ายข้อมูลจริงจาก .xlsx 3 แอป เข้า Supabase (MIGRATION_PLAN sec 7.2)
 *
 * ใช้:
 *   npm run migrate:import -- --dry                     ตรวจ/สร้าง record อย่างเดียว ไม่เขียน DB
 *   npm run migrate:import -- --tenant=<uuid>           โหลดเข้า DB ว่าง ของ tenant นั้น
 *   npm run migrate:import -- --tenant=<uuid> --fresh   ล้างข้อมูลของ tenant นั้นแล้วโหลดใหม่
 *   (ตัวเลือก) --entity=EID02                            กิจการปลายทาง (ไม่ใส่ = EID01)
 *
 * ต้องมี .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * และ push migration ถึง 0029 ก่อน: npm run db:push
 *
 * 🚨 multi-tenant: สคริปต์นี้ใช้ service role = bypass RLS ทั้งหมด
 *    --tenant จึงเป็น **ตัวเดียว** ที่กันไม่ให้เขียนทับข้อมูลลูกค้าเจ้าอื่น → บังคับใส่เสมอ
 *    (--fresh ลบเฉพาะแถวของ tenant นั้น ไม่ใช่ truncate ทั้งตารางเหมือนเดิมแล้ว)
 *
 * ลำดับ: ล้างของ tenant(ถ้า --fresh) → ปิด trigger → insert ตาม FK → เปิด trigger
 *        → recompute stock_product → seed counters
 */
import { buildDataset } from "./lib/transform";
import { serviceClient, insertBatch } from "./lib/client";

const DRY = process.argv.includes("--dry");
const FRESH = process.argv.includes("--fresh");
const argOf = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? "";
const TENANT = argOf("tenant").trim();
const ENTITY = argOf("entity").trim() || "EID01";

/** ตารางที่มีคอลัมน์ entity_id (ตรงกับรายการใน migration 0026) */
const TABLES_WITH_ENTITY = new Set([
  "materials", "containers", "products",
  "log_material", "log_ferment", "log_distill", "log_distill_run",
  "log_ferment_monitor", "log_dilute", "log_product", "stock_product",
  "sale_menu", "sales_orders", "warehouse_stock", "stock_moves",
  "contacts",
  // ฝั่งบัญชีมี entity_id มาแต่เดิม — transform ใส่ค่ามาเองแล้ว จึงไม่อยู่ในนี้
]);

/**
 * ประทับ tenant (+ entity ถ้าตารางนั้นมี) ให้ทุกแถวก่อน insert
 * จำเป็นเพราะ default my_tenant()/my_default_entity() คืน null ตอนรันด้วย service role
 * → ถ้าไม่ประทับ จะติด not null ทันที (ตั้งใจให้ fail closed)
 */
function stamp(table: string, rows: Record<string, unknown>[]) {
  const withEntity = TABLES_WITH_ENTITY.has(table);
  return rows.map((r) => ({
    ...r,
    tenant_id: TENANT,
    ...(withEntity && !r.entity_id ? { entity_id: ENTITY } : {}),
  }));
}

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

  if (!TENANT) {
    console.error(
      "\n❌ ต้องระบุ --tenant=<uuid> เสมอ\n" +
        "   สคริปต์นี้ใช้ service role ที่ bypass RLS — ถ้าไม่ระบุ tenant จะไม่มีอะไรกันการเขียน\n" +
        "   ทับข้อมูลลูกค้าเจ้าอื่นเลย · ดู uuid ได้จากตาราง tenants",
    );
    process.exit(1);
  }

  const db = serviceClient();

  // กันเขียนทับข้อมูลของ tenant นี้โดยไม่ตั้งใจ
  if (!FRESH) {
    const { count, error } = await db
      .from("entities").select("*", { count: "exact", head: true }).eq("tenant_id", TENANT);
    if (error) throw new Error(`เช็คสถานะ DB: ${error.message}`);
    if ((count ?? 0) > 0) {
      console.error(
        `\n❌ tenant นี้มี entities อยู่แล้ว ${count} แถว — ถ้าต้องการโหลดใหม่ทับ ให้รันด้วย --fresh\n` +
          "   (--fresh จะล้างข้อมูลของ tenant นี้ก่อนโหลด — ไม่แตะ tenant อื่น/profiles/auth)",
      );
      process.exit(1);
    }
  }

  if (FRESH) {
    console.log(`\n── ล้างข้อมูลเดิมของ tenant ${TENANT} (fn_mig_truncate) ──`);
    await rpc(db, "fn_mig_truncate", { p_tenant: TENANT });
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
      await insertBatch(db, t, stamp(t, recs as Record<string, unknown>[]));
      console.log(`  ${t.padEnd(22)} ✓ ${recs.length}`);
    }
  } finally {
    console.log("── เปิด trigger กลับ ──");
    await rpc(db, "fn_mig_set_triggers", { p_enable: true });
  }

  console.log("── สร้าง stock_product จาก log (recompute) ──");
  await rpc(db, "fn_mig_recompute_stock", { p_tenant: TENANT });

  if (ds.counters.length) {
    console.log("── seed counters ──");
    const { error } = await db
      .from("counters")
      .upsert(stamp("counters", ds.counters as unknown as Record<string, unknown>[]),
              { onConflict: "tenant_id,key" });
    if (error) throw new Error(`seed counters: ${error.message}`);
    ds.counters.forEach((c) => console.log(`  ${c.key} = ${c.value}`));
  }

  console.log("\n✅ import เสร็จ — ต่อไปรัน: npm run migrate:reconcile");
}

main().catch((e) => {
  console.error("\n❌ " + (e as Error).message);
  process.exit(1);
});
