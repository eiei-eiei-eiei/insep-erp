/**
 * provision-tenant — สร้างลูกค้าจริง 1 ราย (NEXT_STEPS 4.5)
 *
 *   npx tsx scripts/provision-tenant.ts --env=.env.local \
 *     --slug=rongsomchai --name="โรงกลั่นสมชาย" --color=copper \
 *     --modules=production,accounting,sales --max-entities=1 --entity=EID01
 *
 * 🚨 ต่างจาก `seed-demo-tenant.ts` ตรงที่ **ไม่ยัดข้อมูลตัวอย่างใด ๆ**
 *    ตัวนั้นเรียก seedTenant() ของ test harness ซึ่งใส่ "สุราทดสอบ"/ออเดอร์/บิลเข้าไปด้วย
 *    ลูกค้าที่จ่ายเงินต้องได้ระบบเปล่าที่พร้อมคีย์ของจริง ไม่ใช่ระบบที่มีขยะรออยู่
 *
 * ⚠️ รหัสผ่านชั่วคราวพิมพ์ออกมา **ครั้งเดียว** — ไม่มีทางสั่งพิมพ์ซ้ำ
 *    (บทเรียนจากรอบ demo tenant 2026-08-12: ผู้ใช้เกือบเข้าระบบไม่ได้เพราะรหัสหายไปกับ terminal)
 */
import { adminFromEnv, argOf, die } from "./lib/provision";
import { isValidTenantSlug } from "../lib/shared/tenant";
import { usernameToEmail } from "../lib/shared/auth-domain";
import { generateInitialPassword } from "../lib/shared/password";
import { MODULES } from "../lib/shared/workspaces";
import { BRAND_COLORS } from "../lib/shared/branding";

async function main() {
  const envFile = argOf("env") || ".env.local";
  const slug = argOf("slug").toLowerCase();
  const name = argOf("name");
  const color = argOf("color") || "steel";
  const entityId = (argOf("entity") || "EID01").toUpperCase();
  const maxEntities = Number(argOf("max-entities") || "1");
  const modules = (argOf("modules") || MODULES.join(",")).split(",").map((m) => m.trim()).filter(Boolean);

  // ── ตรวจ input ให้ครบก่อนแตะ DB — สร้างครึ่งทางแล้วค้างคือสิ่งที่แก้ยากที่สุด ──
  if (!slug || !isValidTenantSlug(slug)) {
    die("--slug ต้องเป็น a-z 0-9 และ - เท่านั้น (ห้ามภาษาไทย — subdomain ไทยต้องแปลง punycode)\n" +
        "   ตัวอย่าง: --slug=rongsomchai");
  }
  if (!name) die('--name ต้องระบุ ชื่อกิจการที่จะโชว์ในแอป เช่น --name="โรงกลั่นสมชาย"');
  if (!BRAND_COLORS.some((c) => c.key === color)) {
    die(`--color ต้องเป็นหนึ่งใน: ${BRAND_COLORS.map((c) => c.key).join(", ")}`);
  }
  const badModule = modules.find((m) => !MODULES.includes(m as (typeof MODULES)[number]));
  if (badModule) die(`--modules มีค่าที่ไม่รู้จัก "${badModule}" — ใช้ได้: ${MODULES.join(", ")}`);
  if (!Number.isInteger(maxEntities) || maxEntities < 1) die("--max-entities ต้องเป็นจำนวนเต็ม >= 1");

  const { db, ref } = adminFromEnv(envFile);
  console.log(`\n🏗️  สร้างลูกค้าใหม่ที่ project: ${ref}`);
  console.log(`   slug=${slug} · โมดูล=${modules.join(",")} · โควตากิจการ=${maxEntities}\n`);

  const { data: dup } = await db.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (dup) die(`มี tenant slug "${slug}" อยู่แล้ว — ใช้ชื่ออื่น`);

  // ── 1. tenants ────────────────────────────────────────────────────────────
  const { data: t, error: tErr } = await db
    .from("tenants")
    .insert({ slug, name, modules_enabled: modules, max_entities: maxEntities })
    .select("id")
    .single();
  if (tErr) die(`สร้าง tenant: ${tErr.message}`);
  const tenantId = t!.id as string;

  // ── 2. กิจการแรก (is_default → my_default_entity() ใช้ตัวนี้) ──────────────
  const { error: eErr } = await db.from("entities").insert({
    tenant_id: tenantId, entity_id: entityId, name, is_vat: true, is_default: true,
  });
  if (eErr) die(`สร้างกิจการ: ${eErr.message}`);

  // ── 3. แบรนด์ (อยู่ที่ app_settings ที่เดียว — D47) ────────────────────────
  const { error: sErr } = await db.from("app_settings").insert([
    { tenant_id: tenantId, kind: "brand_name", value: name },
    { tenant_id: tenantId, kind: "brand_color", value: color },
    { tenant_id: tenantId, kind: "default_mode", value: "light" },
  ]);
  if (sErr) die(`ตั้งแบรนด์: ${sErr.message}`);

  // ── 4. ผู้ใช้ role main ────────────────────────────────────────────────────
  //    ชื่อผู้ใช้ห้ามซ้ำ "ทั้งระบบ" (0032) → ใช้ owner-<slug> ให้ชนยาก
  //    must_change_password ปล่อยให้ trigger handle_new_user (0031) ตั้งเอง — ห้ามส่ง skip
  const username = `owner-${slug}`;
  const password = generateInitialPassword();
  const { data: u, error: uErr } = await db.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username, display_name: `เจ้าของ${name}`, tenant_id: tenantId },
  });
  if (uErr) {
    die(/already been registered|already exists/i.test(uErr.message)
      ? `ชื่อผู้ใช้ "${username}" ถูกใช้แล้ว (ชื่อผู้ใช้ห้ามซ้ำทั้งระบบ) — เปลี่ยน --slug`
      : `สร้างผู้ใช้: ${uErr.message}`);
  }
  const { error: rErr } = await db.from("profiles").update({ role: "main" }).eq("id", u!.user!.id);
  if (rErr) die(`ตั้ง role main: ${rErr.message}`);

  console.log("✅ สร้างเสร็จ — ระบบเปล่า พร้อมให้ลูกค้าคีย์ข้อมูลจริง\n");
  console.log(`   ชื่อผู้ใช้        : ${username}`);
  console.log(`   รหัสผ่านชั่วคราว : ${password}`);
  console.log(`   ⚠️  รหัสนี้พิมพ์ครั้งเดียว ไม่มีทางสั่งพิมพ์ซ้ำ — ส่งให้ลูกค้าแล้วเก็บให้ดี`);
  console.log(`   ระบบจะบังคับให้ลูกค้าตั้งรหัสใหม่เองตอนล็อกอินครั้งแรก\n`);
  console.log(`   สิ่งที่ลูกค้าต้องตั้งเองหลังเข้าระบบ: ข้อมูลบนเอกสารการค้า · เลขสรรพสามิต · แจ้งเตือน LINE`);
  console.log(`   (ดู docs/GOLIVE_CHECKLIST.md)\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
