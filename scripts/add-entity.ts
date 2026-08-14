/**
 * add-entity — เพิ่มกิจการที่ 2 (ขึ้นไป) ให้ลูกค้าที่ซื้อ add-on (NEXT_STEPS 4.2/4.4)
 *
 *   npx tsx scripts/add-entity.ts --env=.env.local --slug=rongsomchai \
 *     --entity=EID02 --name="สมชาย (บุคคลธรรมดา)" --no-vat
 *
 * ★ ตั้งแต่ 0035 ทำจากแอปจัดการหลังบ้าน (`/platform`) ได้แล้ว — สคริปต์นี้เป็นทางสำรอง
 *   ตรรกะ (รวมทั้ง**ด่านโควตา**) อยู่ที่ `lib/platform/provision.ts` ที่เดียว
 *
 * ★ ด่าน `max_entities` บังคับจริงตรงนั้น — RLS (0028) ห้ามลูกค้า insert `entities` เองอยู่แล้ว
 *   สร้างได้เฉพาะ service role → โควตาเลี่ยงผ่าน API ไม่ได้
 *
 * ⚠️ UI ฝั่งแอปลูกค้า **ไม่ได้** ดู max_entities — มันดูจากจำนวนกิจการที่มีจริง (D53)
 */
import { adminFromEnv, argOf, hasFlag, die } from "./lib/provision";
import { addEntityToTenant, findTenantBySlug } from "../lib/platform/provision";

async function main() {
  const envFile = argOf("env") || ".env.local";
  const slug = argOf("slug").toLowerCase();
  const entityId = argOf("entity").toUpperCase();
  const name = argOf("name");
  const isVat = !hasFlag("no-vat");

  if (!slug) die('--slug ต้องระบุ (ลูกค้ารายไหน) เช่น --slug=rongsomchai');
  if (!entityId) die('--entity ต้องระบุ รหัสกิจการใหม่ เช่น --entity=EID02');
  if (!name) die('--name ต้องระบุ ชื่อกิจการใหม่');

  const { db, ref } = adminFromEnv(envFile);
  console.log(`\n➕ เพิ่มกิจการที่ project: ${ref} · ลูกค้า: ${slug}\n`);

  const tenant = await findTenantBySlug(db, slug);
  if (!tenant) die(`ไม่พบลูกค้า slug "${slug}" ที่ project นี้`);

  const { data: existing } = await db
    .from("entities").select("entity_id, name").eq("tenant_id", tenant!.id).order("entity_id");
  console.log(`   กิจการที่มีอยู่ (${existing?.length ?? 0}/${tenant!.maxEntities}):`);
  for (const e of existing ?? []) console.log(`     · ${e.entity_id} — ${e.name}`);
  console.log("");

  await addEntityToTenant(db, tenant!.id, { entityId, name, isVat });

  console.log(`✅ เพิ่ม ${entityId} — ${name} แล้ว (${isVat ? "จด VAT" : "ไม่จด VAT"})`);
  console.log(`   ลูกค้าจะเห็นตัวเลือกกิจการในแอปทันทีที่รีเฟรช (เพราะตอนนี้มีมากกว่า 1 กิจการ)\n`);
  if (!isVat) {
    console.log(`   ⚠️ กิจการไม่จด VAT: ระบบ**ยังไม่ได้แยกสูตร VAT ตามกิจการ** (งาน 4.3 ยังไม่ทำ)`);
    console.log(`      ตอนนี้ทุกกิจการยังคิด VAT 7% เหมือนกันหมด — อย่าเพิ่งใช้กับลูกค้าจริงที่ไม่จด VAT\n`);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
