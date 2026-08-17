/**
 * db-push-all — ลง migration ให้ **ทุก DB ที่เราถืออยู่** ในคำสั่งเดียว
 *
 *   npm run db:push:all                          ← ดูก่อนว่าจะลงอะไร (ไม่แตะ DB)
 *   npm run db:push:all -- --apply               ← ลงจริง
 *   npm run db:push:all -- --apply --backup="D:/insep-erp-backup/2026-08-17"
 *
 * รายชื่อ DB อยู่ที่ `supabase/targets.json` (ก๊อปจาก targets.example.json)
 * 🚨 ไฟล์นั้นมีรหัสผ่าน DB → .gitignore กันไว้แล้ว ห้ามเอาขึ้น git เด็ดขาด
 *
 * ── ทำไมใช้ `--db-url` ไม่ใช่ `supabase link` ─────────────────────────────
 * `link` เขียนทับ `supabase/.temp/project-ref` = เปลี่ยนปลายทางของ `npm run db:push`
 * ธรรมดาไปด้วย → เคยเป็นต้นเหตุของ "เผลอ push ใส่ DB จริง" มาแล้ว
 * `--db-url` ระบุปลายทางต่อคำสั่ง **ไม่แตะสถานะ link ในเครื่อง** ปลอดภัยกว่าสำหรับงานวน
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { argOf, hasFlag, readEnv, die } from "./lib/provision";
import { checkTarget, maskDbUrl, parseTargets, refFromDbUrl, type DbTarget } from "./lib/db-targets";

/**
 * เรียก npx โดย **ไม่ผ่าน shell**
 *
 * 🪤 บน Windows spawn ไฟล์ `.cmd` ตรง ๆ พังด้วย `EINVAL` (Node ปิดช่องโหว่ CVE-2024-27980)
 *    ทางแก้ที่คนมักใช้คือ `shell: true` — **ห้ามใช้ที่นี่** เพราะเราส่ง connection string
 *    เป็น argument และรหัสผ่านมี percent-encoding (`%40`) ซึ่ง cmd.exe จะพยายามแปลงเป็นตัวแปร
 *    → เรียก `npx-cli.js` ด้วย node ตรง ๆ แทน ได้ทั้งไม่พังและไม่ต้องกังวลเรื่อง quote
 */
const NPX_CLI = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");

function run(tool: string, args: string[]): number {
  const r = existsSync(NPX_CLI)
    ? spawnSync(process.execPath, [NPX_CLI, tool, ...args], { stdio: "inherit", shell: false })
    : // เครื่องที่หา npx-cli.js ไม่เจอ — ยอมใช้ shell (ไม่ควรเกิด แต่ดีกว่ารันไม่ได้เลย)
      spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", [tool, ...args], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

/**
 * ⚠️ ต้องส่ง `--db-url` เป็น flag เท่านั้น **ห้ามใช้ env `SUPABASE_DB_URL`**
 *    ทดสอบแล้ว (2026-08-17 · CLI v2.109): CLI **เพิกเฉยต่อ env ตัวนั้น** แล้วเงียบ ๆ
 *    ไปใช้ project ที่ `supabase link` ไว้แทน → จะกลายเป็น "ลง migration ผิดก้อนโดยไม่มีใครรู้"
 *    ซึ่งเป็นหายนะที่สคริปต์นี้ตั้งใจจะกันพอดี · flag `--db-url` ตรวจแล้วว่าใช้จริง
 */
const supabase = (args: string[]) => run("supabase", args);

function backup(t: DbTarget, ref: string, dir: string): number {
  const out = `${dir.replace(/[/\\]+$/, "")}/${ref}`;
  console.log(`\n   📦 สำรองข้อมูลก่อน → ${out}`);
  return run("tsx", ["scripts/backup-tables.ts", `--env=${t.env}`, `--out=${out}`]);
}

function main() {
  const file = argOf("targets") || "supabase/targets.json";
  const apply = hasFlag("apply");
  const backupDir = argOf("backup");

  if (!existsSync(file)) {
    die(
      `ไม่พบไฟล์ ${file}\n` +
        `   วิธีทำ: ก๊อป supabase/targets.example.json เป็น supabase/targets.json แล้วกรอกค่าจริง\n` +
        `   (ไฟล์ targets.json ถูก .gitignore กันไว้แล้ว ไม่ขึ้น git)`,
    );
  }

  let targets: DbTarget[];
  try {
    targets = parseTargets(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    return die(`อ่าน ${file} ไม่ได้: ${e instanceof Error ? e.message : e}`);
  }

  // ── ตรวจทุก target ให้ครบก่อน แล้วค่อยเริ่มรัน ───────────────────────────
  //    ★ ตรวจทั้งชุดก่อน ไม่ใช่ตรวจไปรันไป — ไม่งั้นก้อนแรกลงไปแล้วก้อนสองเพิ่งพบว่าตั้งค่าผิด
  //      = fleet อยู่คนละเวอร์ชันกัน ซึ่งแก้ยากกว่าไม่ได้เริ่มเลย
  const rows = targets.map((t) => {
    let envUrl: string | null = null;
    if (t.env && existsSync(t.env)) envUrl = readEnv(t.env).NEXT_PUBLIC_SUPABASE_URL ?? null;
    return { t, ref: refFromDbUrl(t.dbUrl ?? "") ?? "?", problems: checkTarget(t, envUrl) };
  });

  console.log(`\n🗂  ปลายทางทั้งหมด ${rows.length} ก้อน (จาก ${file})\n`);
  for (const { t, ref, problems } of rows) {
    console.log(`   ${problems.length ? "❌" : "•"} ${t.name ?? "(ไม่มีชื่อ)"}`);
    console.log(`      ref: ${ref} · env: ${t.env} · ${maskDbUrl(t.dbUrl ?? "")}`);
    for (const p of problems) console.log(`      ⚠️  ${p}`);
  }

  const bad = rows.filter((r) => r.problems.length);
  if (bad.length) die(`มี ${bad.length} ก้อนตั้งค่าไม่ถูก — แก้ ${file} ให้ครบก่อน (ยังไม่แตะ DB เลย)`);

  if (!apply) {
    console.log(`\n👀 โหมดดูอย่างเดียว — จะแสดงว่าแต่ละก้อนค้าง migration อะไรบ้าง (ไม่แตะ DB)\n`);
  } else {
    console.log(`\n🚀 โหมดลงจริง${backupDir ? " (สำรองข้อมูลก่อนทุกก้อน)" : ""}\n`);
    if (!backupDir) {
      console.log(`   ⚠️  ไม่ได้ใส่ --backup=<โฟลเดอร์> — จะไม่สำรองข้อมูลให้`);
      console.log(`      แนะนำอย่างยิ่งให้ใส่ ถ้า migration รอบนี้แตะข้อมูลเดิม\n`);
    }
  }

  // ── รันทีละก้อน · เจอพังหยุดทันที ──────────────────────────────────────
  //    ไม่ไปต่อโดยตั้งใจ: ถ้า 0037 พังที่ก้อนแรก แล้วดันไปลงก้อนที่สองสำเร็จ
  //    fleet จะอยู่คนละเวอร์ชัน = หาสาเหตุยากกว่าเดิมมาก
  const done: string[] = [];
  for (const { t, ref } of rows) {
    console.log(`\n${"─".repeat(60)}\n▶ ${t.name}  (${ref})\n`);

    if (apply && backupDir) {
      if (backup(t, ref, backupDir) !== 0) {
        die(`สำรองข้อมูลของ ${t.name} ไม่สำเร็จ — หยุดทันที ยังไม่ได้ลง migration ก้อนนี้\n` +
          `   ลงไปแล้ว ${done.length} ก้อน: ${done.join(", ") || "(ยังไม่มี)"}`);
      }
    }

    const args = ["db", "push", "--db-url", t.dbUrl];
    const code = supabase(apply ? [...args, "--yes"] : [...args, "--dry-run"]);

    if (code !== 0) {
      die(
        `${t.name} ไม่สำเร็จ (exit ${code}) — หยุดทันที ไม่ไปก้อนถัดไป\n` +
          `   ลงสำเร็จไปแล้ว ${done.length} ก้อน: ${done.join(", ") || "(ยังไม่มี)"}\n` +
          `   แก้ปัญหาแล้วรันใหม่ได้เลย — ก้อนที่ลงไปแล้วจะถูกข้ามเอง (CLI ดูจากประวัติใน DB)`,
      );
    }
    done.push(t.name);
  }

  console.log(`\n${"─".repeat(60)}`);
  if (apply) {
    console.log(`\n✅ ลง migration ครบทั้ง ${done.length} ก้อนแล้ว\n`);
    console.log(`   ขั้นต่อไป: git push (ให้โค้ดตามไปให้ทัน schema) แล้วเปิดเว็บตรวจ\n`);
  } else {
    console.log(`\n✅ ตรวจครบ ${done.length} ก้อน — ยังไม่ได้แตะ DB เลย`);
    console.log(`\n   ลงจริงด้วย:  npm run db:push:all -- --apply --backup="D:/insep-erp-backup/<วันที่>"\n`);
  }
}

try {
  main();
} catch (e) {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
}
