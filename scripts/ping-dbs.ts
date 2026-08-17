/**
 * ping-dbs — ปิงทุก DB ที่เราถืออยู่ **ในคำสั่งเดียว** เพื่อกันแผนฟรี pause โปรเจกต์
 *
 *   npm run db:ping:all                 ← ปิงทุกก้อน (ใช้ตรวจมือได้ตลอด)
 *   npm run db:ping:all -- --notify     ← เด้งหน้าต่างเตือนถ้าพัง (ใช้กับ Task Scheduler)
 *
 * รายชื่อ DB อยู่ที่ `supabase/fleet.json` — **คอมมิตลง git โดยเจตนา** เก็บแค่ค่า
 * สาธารณะ (url + anon key ที่ติดไปกับ bundle ฝั่ง browser อยู่แล้ว) → GitHub Actions
 * อ่านไฟล์นี้ได้ตรง ๆ ไม่ต้องตั้ง secret และ "เพิ่มลูกค้าใหม่" เหลือแก้ที่เดียว
 * สร้าง/อัปเดตไฟล์ด้วย `npm run fleet:sync` (อย่าแก้มือ)
 *
 * เวลาที่ต้องยิง: แผนฟรี pause เมื่อไม่มี user activity "พอ" ใน 7 วัน · เอกสารเขาบอก
 * ว่า "a few user requests each day" พอกันหลับ → **วันละครั้ง ครั้งละ 3 request**
 * (สัปดาห์ละครั้งไม่พอ · รายละเอียด docs/DECISIONS.md D60)
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { argOf, hasFlag, die } from "./lib/provision";
import { refFromSupabaseUrl } from "./lib/db-targets";
import {
  httpError,
  logLine,
  parseFleet,
  pingEndpoint,
  summarize,
  type PingResult,
  type PingTarget,
} from "./lib/ping";

const LOG_FILE = "logs/ping.log";
const LOG_KEEP = 400; // บรรทัดที่เก็บไว้ — ~1 ปีของการยิงวันละครั้ง
const TIMEOUT_MS = 15_000;
const GAP_MS = 1_000; // เว้นระหว่าง request เพื่อให้นับเป็น "หลายครั้ง" จริง ๆ ไม่ใช่ burst เดียว

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ยิง 1 ครั้ง — คืนเวลาที่ DB ตอบ (ยืนยันว่า SQL วิ่งจริง) หรือโยน error */
async function pingOnce(t: PingTarget): Promise<string> {
  const res = await fetch(pingEndpoint(t.url), {
    method: "POST",
    headers: {
      apikey: t.anonKey,
      Authorization: `Bearer ${t.anonKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(httpError(res.status, text));
  // ค่าที่ได้คือ timestamptz ใน JSON → มี " ครอบ
  return text.replace(/^"|"$/g, "") || "(ไม่มีค่าตอบกลับ)";
}

async function pingTarget(t: PingTarget, tries: number): Promise<PingResult> {
  const ref = refFromSupabaseUrl(t.url) ?? "?";
  let ok = 0;
  let ms = 0;
  let detail = "";
  const errors: string[] = [];

  for (let i = 0; i < tries; i++) {
    if (i > 0) await sleep(GAP_MS);
    const started = Date.now();
    try {
      const at = await pingOnce(t);
      ok++;
      if (ok === 1) {
        ms = Date.now() - started;
        detail = at;
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (ok === 0) {
    // ข้อความสุดท้ายคือสิ่งที่ผู้ใช้จะเห็น — ต้องบอกทางแก้ ไม่ใช่แค่บอกว่าพัง
    detail = errors[errors.length - 1] ?? "ไม่ทราบสาเหตุ";
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|timed? ?out|aborted/i.test(detail)) {
      detail += "  → อาจถูก pause ไปแล้ว: เข้า Supabase dashboard ของก้อนนี้แล้วกด Restore";
    } else if (/HTTP 40[0-9]/.test(detail)) {
      detail += "  → คีย์/ฟังก์ชันไม่ตรง: ลง migration 0038 ครบทุก DB แล้วหรือยัง (npm run db:push:all)";
    }
  }
  return { name: t.name, ref, ok, tries, ms, detail };
}

/** เขียน log ต่อท้าย + ตัดบรรทัดเก่าทิ้ง (ไฟล์ต้องไม่โตไม่จำกัด) */
function writeLog(line: string) {
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, line + "\n", "utf8");
    const lines = readFileSync(LOG_FILE, "utf8").split(/\r?\n/).filter(Boolean);
    if (lines.length > LOG_KEEP) {
      writeFileSync(LOG_FILE, lines.slice(-LOG_KEEP).join("\n") + "\n", "utf8");
    }
  } catch {
    // log เขียนไม่ได้ต้องไม่ทำให้การปิงล้มเหลว — หน้าที่หลักคือปิง ไม่ใช่จด
  }
}

/**
 * เด้งหน้าต่างเตือนบน Windows (ใช้ตอนรันจาก Task Scheduler ที่ไม่มีใครดูจอ)
 * ★ เตือนเฉพาะตอนพัง — สำเร็จแล้วเด้งทุกวันคือความรำคาญที่ทำให้คนปิด task ทิ้ง
 */
function notifyFailure(message: string) {
  if (process.platform !== "win32") return;
  const safe = message.replace(/['\r\n]/g, " ").slice(0, 500);
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName PresentationFramework; ` +
        `[System.Windows.MessageBox]::Show('${safe}','PROOF — ปิง Supabase ไม่ผ่าน') | Out-Null`,
    ],
    { stdio: "ignore" },
  );
}

async function main() {
  const file = argOf("fleet") || "supabase/fleet.json";
  const tries = Math.max(1, Number(argOf("tries") || 3));
  const notify = hasFlag("notify");

  if (!existsSync(file)) {
    die(
      `ไม่พบไฟล์ ${file}\n` +
        `   วิธีทำ: รัน npm run fleet:sync (สร้างจาก supabase/targets.json ให้เอง)`,
    );
  }

  let fleet: PingTarget[];
  try {
    fleet = parseFleet(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    return die(`อ่าน ${file} ไม่ได้: ${e instanceof Error ? e.message : e}`);
  }

  console.log(`\n📡 ปิง ${fleet.length} ก้อน (จาก ${file}) · ${tries} ครั้งต่อก้อน\n`);

  const results: PingResult[] = [];
  for (const t of fleet) results.push(await pingTarget(t, tries));

  const { lines, failed } = summarize(results);
  for (const l of lines) console.log(l);

  if (!process.env.CI) writeLog(logLine(new Date(), results));

  if (failed.length) {
    const msg =
      `ปิงไม่ผ่าน ${failed.length} จาก ${results.length} ก้อน:\n` +
      failed.map((f) => `• ${f.name} (${f.ref}) — ${f.detail}`).join("\n");
    if (notify) notifyFailure(msg);
    console.error(`\n❌ ${msg}\n`);
    console.error(`   🚨 ถ้าก้อนไหนถูก pause ไปแล้ว **ปิงปลุกให้ไม่ได้** ต้องเข้า dashboard กด Restore เอง\n`);
    process.exit(1);
  }

  console.log(`\n✅ ครบทั้ง ${results.length} ก้อน — ตัวนับ 7 วันของทุกก้อนถูกรีเซ็ตแล้ว\n`);
}

main().catch((e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
