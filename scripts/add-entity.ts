/**
 * add-entity — เพิ่มกิจการที่ 2 (ขึ้นไป) ให้ลูกค้าที่ซื้อ add-on (NEXT_STEPS 4.2/4.4)
 *
 *   npx tsx scripts/add-entity.ts --env=.env.local --slug=rongsomchai \
 *     --entity=EID02 --name="สมชาย (บุคคลธรรมดา)" --no-vat
 *
 * ★ นี่คือ**จุดบังคับ `max_entities` จริง** — RLS (0028) ห้ามลูกค้า insert `entities` เองอยู่แล้ว
 *   สร้างได้เฉพาะ service role = ผ่านสคริปต์นี้เท่านั้น → โควตาเลี่ยงผ่าน API ไม่ได้
 *
 * ⚠️ UI ฝั่งแอป **ไม่ได้** ดู max_entities — มันดูจากจำนวนกิจการที่มีจริง
 *   (ถ้าไปผูก UI กับโควตา ลูกค้าที่มีหลายกิจการอยู่แล้วแต่โควตาเป็น 1 จะเข้าถึงข้อมูลไม่ได้)
 */
import { adminFromEnv, argOf, hasFlag, die } from "./lib/provision";

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

  const { data: t } = await db
    .from("tenants").select("id, name, max_entities").eq("slug", slug).maybeSingle();
  if (!t) die(`ไม่พบลูกค้า slug "${slug}" ที่ project นี้`);
  const tenantId = t!.id as string;
  const quota = Number(t!.max_entities) || 1;

  const { data: existing, error: exErr } = await db
    .from("entities").select("entity_id, name").eq("tenant_id", tenantId).order("entity_id");
  if (exErr) die(`อ่านรายการกิจการ: ${exErr.message}`);

  console.log(`   กิจการที่มีอยู่ (${existing!.length}/${quota}):`);
  for (const e of existing!) console.log(`     · ${e.entity_id} — ${e.name}`);
  console.log("");

  if (existing!.some((e) => e.entity_id === entityId)) {
    die(`กิจการรหัส "${entityId}" มีอยู่แล้วในลูกค้ารายนี้`);
  }

  // ★ ด่านโควตา — ตรงนี้คือสิ่งที่ทำให้ "กิจการที่ 2" ขายเป็น add-on ได้จริง
  if (existing!.length >= quota) {
    die(
      `ลูกค้ารายนี้ใช้โควตาครบแล้ว (${existing!.length}/${quota})\n` +
      `   ถ้าลูกค้าซื้อ add-on กิจการเพิ่มแล้ว ให้ขยายโควตาก่อนด้วย SQL ใน Supabase Dashboard:\n` +
      `     update tenants set max_entities = ${quota + 1} where slug = '${slug}';\n` +
      `   (จงใจไม่ให้สคริปต์นี้ขยายโควตาเอง — เพิ่มกิจการกับอนุมัติการขายต้องเป็นคนละการตัดสินใจ)`,
    );
  }

  const { error } = await db.from("entities").insert({
    tenant_id: tenantId, entity_id: entityId, name, is_vat: isVat, is_default: false,
  });
  if (error) die(`สร้างกิจการ: ${error.message}`);

  console.log(`✅ เพิ่ม ${entityId} — ${name} แล้ว (${isVat ? "จด VAT" : "ไม่จด VAT"})`);
  console.log(`   ลูกค้าจะเห็นตัวเลือกกิจการในแอปทันทีที่รีเฟรช (เพราะตอนนี้มีมากกว่า 1 กิจการ)\n`);
  if (!isVat) {
    console.log(`   ⚠️ กิจการไม่จด VAT: ระบบ**ยังไม่ได้แยกสูตร VAT ตามกิจการ** (งาน 4.3 ยังไม่ทำ)`);
    console.log(`      ตอนนี้ทุกกิจการยังคิด VAT 7% เหมือนกันหมด — อย่าเพิ่งใช้กับลูกค้าจริงที่ไม่จด VAT\n`);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
