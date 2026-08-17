/**
 * fleet-sync — สร้าง/อัปเดต `supabase/fleet.json` จาก `supabase/targets.json`
 *
 *   npm run fleet:sync            ← อัปเดตไฟล์ให้ตรงกับ targets.json
 *   npm run fleet:sync -- --check ← ตรวจว่าตรงกันไหม (ไม่เขียนไฟล์) พังถ้าไม่ตรง
 *
 * ทำไมต้องมี 2 ไฟล์:
 *   targets.json  — มี **รหัสผ่าน DB** → .gitignore · ใช้ลง migration (db:push:all)
 *   fleet.json    — มีแค่ url + anon key (สาธารณะ) → **คอมมิตลง git** ให้ GitHub Actions
 *                   อ่านได้ตรง ๆ ไม่ต้องตั้ง secret
 *
 * 🚨 สคริปต์นี้ปฏิเสธการเขียนถ้าเจอ service role / secret key ในช่อง anonKey
 *    (ค่าที่ก๊อปผิดช่องแล้วขึ้น git = ต้อง rotate คีย์ทุก DB ย้อนกลับไม่ได้จริง ๆ)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { argOf, hasFlag, readEnv, die } from "./lib/provision";
import { parseTargets, type DbTarget } from "./lib/db-targets";
import { fleetFromTargets, parseFleet, staleFleetEntries, type PingTarget } from "./lib/ping";

const README =
  "ไฟล์นี้สร้างด้วย `npm run fleet:sync` — อย่าแก้มือ · " +
  "รายชื่อ DB ที่ต้องปิงกันแผนฟรีหลับ (docs/DECISIONS.md D60) · " +
  "เก็บแค่ค่าสาธารณะที่ติดไปกับ bundle ฝั่ง browser อยู่แล้ว " +
  "🚨 ห้ามใส่ service role key / รหัสผ่าน DB ลงไฟล์นี้เด็ดขาด (อยู่ใน git)";

/** เขียนแบบ stable — ลำดับ key คงที่ ให้ diff อ่านรู้เรื่องว่าเพิ่ม/เปลี่ยนก้อนไหน */
function render(fleet: PingTarget[]): string {
  const body = {
    _readme: README,
    targets: fleet.map((t) => ({ name: t.name, url: t.url, anonKey: t.anonKey })),
  };
  return JSON.stringify(body, null, 2) + "\n";
}

function readFleet(file: string): PingTarget[] {
  if (!existsSync(file)) return [];
  try {
    return parseFleet(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return []; // ไฟล์เดิมเสีย/ว่าง → ถือว่ายังไม่มี แล้วเขียนใหม่ทับ
  }
}

function main() {
  const targetsFile = argOf("targets") || "supabase/targets.json";
  const fleetFile = argOf("fleet") || "supabase/fleet.json";
  const checkOnly = hasFlag("check");

  if (!existsSync(targetsFile)) {
    die(
      `ไม่พบไฟล์ ${targetsFile}\n` +
        `   วิธีทำ: ก๊อป supabase/targets.example.json เป็น supabase/targets.json แล้วกรอกค่าจริง`,
    );
  }

  let targets: DbTarget[];
  try {
    targets = parseTargets(JSON.parse(readFileSync(targetsFile, "utf8")));
  } catch (e) {
    return die(`อ่าน ${targetsFile} ไม่ได้: ${e instanceof Error ? e.message : e}`);
  }

  const { fleet, problems } = fleetFromTargets(targets, readEnv);
  if (problems.length) {
    console.log(`\n⚠️  ข้ามไป ${problems.length} ก้อนเพราะตั้งค่าไม่ครบ:\n`);
    for (const p of problems) console.log(`   • ${p}`);
  }
  if (!fleet.length) die(`ไม่มีก้อนไหนพร้อมเลย — แก้ปัญหาข้างบนก่อน (ยังไม่เขียนไฟล์)`);

  const before = readFleet(fleetFile);
  const next = render(fleet);
  const same = existsSync(fleetFile) && readFileSync(fleetFile, "utf8") === next;

  console.log(`\n🗂  ${fleetFile} — ${fleet.length} ก้อน\n`);
  const knownNames = new Set(before.map((b) => b.name));
  for (const t of fleet) {
    const mark = knownNames.has(t.name) ? "•" : "＋";
    console.log(`   ${mark} ${t.name}  ${t.url}`);
  }
  for (const s of staleFleetEntries(targets, before)) {
    console.log(`   － ${s}  (ไม่มีใน targets.json แล้ว → จะถูกเอาออก)`);
  }

  if (checkOnly) {
    if (same) {
      console.log(`\n✅ ตรงกันอยู่แล้ว\n`);
      return;
    }
    die(`${fleetFile} ไม่ตรงกับ ${targetsFile} — รัน npm run fleet:sync แล้ว git push`);
  }

  if (same) {
    console.log(`\n✅ ไม่มีอะไรเปลี่ยน (ไฟล์ตรงอยู่แล้ว)\n`);
    return;
  }

  mkdirSync(path.dirname(fleetFile), { recursive: true });
  writeFileSync(fleetFile, next, "utf8");
  console.log(`\n✅ อัปเดต ${fleetFile} แล้ว\n`);
  console.log(`   ขั้นต่อไป — ต้อง push ไม่งั้น GitHub Actions ยังปิงตามรายชื่อเก่า:\n`);
  console.log(`      git add ${fleetFile}`);
  console.log(`      git commit -m "chore(ops): เพิ่ม DB เข้ารายชื่อปิงกันหลับ"`);
  console.log(`      git push\n`);
  console.log(`   แล้วตรวจด้วย:  npm run db:ping:all\n`);
}

try {
  main();
} catch (e) {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
}
