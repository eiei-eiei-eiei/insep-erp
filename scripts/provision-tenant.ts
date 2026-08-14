/**
 * provision-tenant — สร้างลูกค้าจริง 1 ราย (NEXT_STEPS 4.5)
 *
 *   npx tsx scripts/provision-tenant.ts --env=.env.local \
 *     --slug=rongsomchai --name="โรงกลั่นสมชาย" --color=copper \
 *     --modules=production,accounting,sales --max-entities=1 --entity=EID01
 *
 * ★ ตั้งแต่ 0035 มี**แอปจัดการหลังบ้าน** (`/platform`) ที่ทำงานเดียวกันนี้ได้โดยไม่ต้องเปิด terminal
 *   สคริปต์นี้เก็บไว้เป็นทางสำรอง (ตอน bootstrap ระบบใหม่ที่ยังไม่มีบัญชีแอดมิน)
 *   → **ตรรกะอยู่ที่ `lib/platform/provision.ts` ที่เดียว** ทั้งสองทางเรียกตัวเดียวกัน
 *     ห้ามก๊อปตรรกะกลับมาที่นี่ ไม่งั้นวันหนึ่งสองทางจะสร้างลูกค้าได้คนละแบบ
 *
 * ⚠️ รหัสผ่านชั่วคราวพิมพ์ออกมา **ครั้งเดียว** — ไม่มีทางสั่งพิมพ์ซ้ำ
 */
import { adminFromEnv, argOf, die } from "./lib/provision";
import { createTenant } from "../lib/platform/provision";
import { MODULES } from "../lib/shared/workspaces";

async function main() {
  const envFile = argOf("env") || ".env.local";
  const input = {
    slug: argOf("slug"),
    name: argOf("name"),
    color: argOf("color") || "steel",
    entityId: argOf("entity") || "EID01",
    maxEntities: Number(argOf("max-entities") || "1"),
    modules: (argOf("modules") || MODULES.join(",")).split(",").map((m) => m.trim()).filter(Boolean),
  };

  const { db, ref } = adminFromEnv(envFile);
  console.log(`\n🏗️  สร้างลูกค้าใหม่ที่ project: ${ref}`);
  console.log(`   slug=${input.slug} · โมดูล=${input.modules.join(",")} · โควตากิจการ=${input.maxEntities}\n`);

  const { username, password } = await createTenant(db, input);

  console.log("✅ สร้างเสร็จ — ระบบเปล่า พร้อมให้ลูกค้าคีย์ข้อมูลจริง\n");
  console.log(`   ชื่อผู้ใช้        : ${username}`);
  console.log(`   รหัสผ่านชั่วคราว : ${password}`);
  console.log(`   ⚠️  รหัสนี้พิมพ์ครั้งเดียว ไม่มีทางสั่งพิมพ์ซ้ำ — ส่งให้ลูกค้าแล้วเก็บให้ดี`);
  console.log(`   ระบบจะบังคับให้ลูกค้าตั้งรหัสใหม่เองตอนล็อกอินครั้งแรก\n`);
  console.log(`   สิ่งที่ลูกค้าต้องตั้งเองหลังเข้าระบบ: ข้อมูลบนเอกสารการค้า · เลขสรรพสามิต · แจ้งเตือน LINE`);
  console.log(`   (ดู docs/GOLIVE_CHECKLIST.md)\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
