/**
 * seed-demo-tenant — สร้างลูกค้าสาธิต 1 รายที่ "ค้างอยู่" ใน DB ทดสอบ
 *
 * ใช้เปิดดูหน้า login ต่อ subdomain ในเบราว์เซอร์ได้จริง เช่น
 *   npm run seed:demo-tenant -- --slug=rongkor --name="โรง ก."
 *   → เปิด http://rongkor.localhost:3000/login
 *
 * ต่างจาก tenant ที่ npm run test:tenant สร้าง: อันนั้นขึ้นต้นด้วย zz-test- และ
 * ถูกลบทิ้งทุกครั้งหลังรันเทส · อันนี้ตั้ง slug เองจึงรอด cleanup
 *
 * ใช้ seedTenant() จาก tests/tenant/harness.ts ซ้ำ — ไม่เขียน logic สร้างข้อมูลใหม่
 * (นี่คือเมล็ดของ provision script ในงาน 4.5)
 *
 * 🚨 อ่าน env จาก .env.tenant-test.local เท่านั้น (ผ่าน harness) — ไม่แตะ .env.local
 */
import { assertTestEnv, seedTenant, admin } from "../tests/tenant/harness";
import { isValidTenantSlug } from "../lib/shared/tenant";

const argOf = (n: string) =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=").trim() ?? "";

async function main() {
  assertTestEnv();

  const slug = argOf("slug");
  const name = argOf("name") || `กิจการ ${slug}`;

  if (!slug || !isValidTenantSlug(slug)) {
    console.error(
      "\n❌ ต้องระบุ --slug=<ชื่อ> ที่เป็น a-z 0-9 และ - เท่านั้น (ห้ามภาษาไทย — subdomain ไทยต้องแปลง punycode)\n" +
        "   ตัวอย่าง: npm run seed:demo-tenant -- --slug=rongkor",
    );
    process.exit(1);
  }

  const { data: existing } = await admin().from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (existing) {
    console.error(`\n❌ มี tenant slug "${slug}" อยู่แล้ว — ใช้ชื่ออื่น หรือลบของเดิมก่อน`);
    process.exit(1);
  }

  // forcePasswordChange: ให้เห็นโฟลว์บังคับเปลี่ยนรหัสจริงตอนล็อกอินครั้งแรก (0031)
  const t = await seedTenant(slug, { slug, forcePasswordChange: true });

  // แบรนด์อยู่ใน app_settings ที่เดียว (0030) — หน้า login กับในแอปจึงเห็นตรงกันเสมอ
  const db = admin();
  await db.from("tenants").update({ name }).eq("id", t.tenantId);
  await db.from("app_settings").update({ value: name })
    .eq("tenant_id", t.tenantId).eq("kind", "brand_name");
  const color = argOf("color");
  if (color) {
    await db.from("app_settings").update({ value: color })
      .eq("tenant_id", t.tenantId).eq("kind", "brand_color");
  }

  console.log(`\n✅ สร้างลูกค้าสาธิตแล้ว`);
  console.log(`   slug      : ${slug}`);
  console.log(`   ชื่อแบรนด์  : ${name}`);
  console.log(`   ผู้ใช้      : ${t.username}  (role main · ชื่อเดียวกันทุกเจ้า — slug เป็นตัวแยก)`);
  console.log(`   รหัสผ่านชั่วคราว: ${t.password}  ← ระบบจะบังคับให้ตั้งใหม่ตอนล็อกอินครั้งแรก`);
  console.log(`\n   เปิดดู: http://${slug}.localhost:3000/login`);
  console.log(`   เทียบกับ: http://localhost:3000/login  (ไม่มี subdomain = หน้าตาเดิม)\n`);
}

main().catch((e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
