/**
 * ตัวช่วยของงาน "กัน DB แผนฟรีหลับ" — ตัวช่วยล้วน ๆ ไม่มี side effect เพื่อให้เทสได้
 *
 * ใช้โดย `scripts/ping-dbs.ts` (npm run db:ping:all)
 *        `scripts/fleet-sync.ts` (npm run fleet:sync)
 *        `scripts/db-push-all.ts` (เตือนเมื่อ fleet.json ไม่ครบ)
 *
 * 🚨 หัวใจของไฟล์นี้คือ `keyKind` — `supabase/fleet.json` **ถูกคอมมิตลง git**
 *    (ตั้งใจ · เก็บแค่ค่าที่ติดไปกับ bundle ฝั่ง browser อยู่แล้ว) → ถ้าวันหนึ่ง
 *    มีคนก๊อป SUPABASE_SERVICE_ROLE_KEY ลงช่อง anonKey ผิดช่อง = **คีย์เทพขึ้น git**
 *    ซึ่งย้อนกลับไม่ได้จริง ๆ (ต้อง rotate ทุก DB) → fleet:sync ต้องปฏิเสธก่อนเขียนไฟล์
 */
import { refFromDbUrl, refFromSupabaseUrl, type DbTarget } from "./db-targets";

/** 1 ปลายทางที่ต้องปิง — **ค่าสาธารณะเท่านั้น** (ไฟล์นี้อยู่ใน git) */
export type PingTarget = {
  /** ชื่อที่มนุษย์อ่าน — ใช้ในผลลัพธ์/log ให้รู้ว่าก้อนไหนพัง */
  name: string;
  /** https://<ref>.supabase.co */
  url: string;
  /** anon / publishable key — สาธารณะอยู่แล้ว (อยู่ใน bundle ฝั่ง browser) */
  anonKey: string;
};

export type PingResult = {
  name: string;
  ref: string;
  /** ยิงสำเร็จกี่ครั้งจากทั้งหมด — สำเร็จอย่างน้อย 1 ครั้งถือว่าก้อนนี้ผ่าน */
  ok: number;
  tries: number;
  /** เวลาตอบของครั้งที่สำเร็จครั้งแรก (ms) */
  ms: number;
  /** เวลาที่ DB ตอบกลับมา (ยืนยันว่า SQL วิ่งจริง) หรือสาเหตุที่พัง */
  detail: string;
};

/** ปลายทาง REST ของ RPC — `stable` จึงเรียกได้ทั้ง GET/POST (0038) */
export const pingEndpoint = (url: string) => `${url.trim().replace(/\/+$/, "")}/rest/v1/rpc/ping`;

/**
 * แยกประเภทคีย์ Supabase จากตัวคีย์เอง
 *
 * รองรับทั้ง 2 ยุค:
 *   legacy JWT      — 3 ท่อน base64url · payload มี {"role":"anon"|"service_role"}
 *   คีย์แบบใหม่     — ขึ้นต้น sb_publishable_ (สาธารณะ) / sb_secret_ (ห้ามขึ้น git)
 */
export function keyKind(key: string): "public" | "secret" | "unknown" {
  const k = key.trim();
  if (!k) return "unknown";

  if (/^sb_publishable_/.test(k)) return "public";
  if (/^sb_secret_/.test(k)) return "secret";

  const parts = k.split(".");
  if (parts.length === 3) {
    try {
      const payload = Buffer.from(parts[1], "base64url").toString("utf8");
      const role = String(JSON.parse(payload).role ?? "");
      if (role === "service_role") return "secret";
      if (role === "anon" || role === "authenticated") return "public";
    } catch {
      // แกะไม่ออก = ไม่รู้จัก (ไม่เดา) — ตกไปเช็ก fallback ข้างล่าง
    }
  }
  // เผื่อรูปแบบที่ยังไม่รู้จักแต่มีคำว่า service_role ปนอยู่ → ถือว่าอันตราย
  return /service_role/i.test(k) ? "secret" : "unknown";
}

/**
 * ย่อ error ของ PostgREST ให้เหลือบรรทัดเดียวที่อ่านรู้เรื่อง
 * (body ดิบเป็น JSON หลายบรรทัด ตัดดิบ ๆ แล้วได้ข้อความค้างกลาง " ซึ่งอ่านไม่ออก)
 */
export function httpError(status: number, body: string): string {
  const raw = body.trim();
  try {
    const j = JSON.parse(raw) as { code?: string; message?: string; hint?: string };
    const parts = [j.code, j.message ?? j.hint].filter(Boolean).join(": ");
    if (parts) return `HTTP ${status} ${parts.slice(0, 160)}`;
  } catch {
    // ไม่ใช่ JSON (เช่นหน้า HTML ของ gateway) → ใช้ข้อความดิบแบบย่อ
  }
  return `HTTP ${status}${raw ? ` ${raw.replace(/\s+/g, " ").slice(0, 120)}` : ""}`;
}

/** ปัญหาที่เจอใน 1 รายการของ fleet — คืน list ว่าง = ผ่าน */
export function checkPingTarget(t: Partial<PingTarget>): string[] {
  const problems: string[] = [];
  if (!t.name?.trim()) problems.push("ไม่มีช่อง name");
  if (!t.url?.trim()) problems.push("ไม่มีช่อง url");
  if (!t.anonKey?.trim()) problems.push("ไม่มีช่อง anonKey");
  if (problems.length) return problems;

  if (!refFromSupabaseUrl(t.url!)) {
    problems.push(`url ต้องเป็น https://<ref>.supabase.co (ได้มา: ${t.url})`);
  }

  const kind = keyKind(t.anonKey!);
  if (kind === "secret") {
    // 🚨 เคสที่ไฟล์นี้มีไว้เพื่อกัน — คีย์เทพหลุดขึ้น git
    problems.push(
      "anonKey เป็น **service role / secret key** ห้ามใส่ตรงนี้เด็ดขาด " +
        "(ไฟล์ fleet.json อยู่ใน git) — ใช้ค่าจาก NEXT_PUBLIC_SUPABASE_ANON_KEY เท่านั้น",
    );
  } else if (kind === "unknown") {
    problems.push("anonKey ไม่ใช่รูปแบบคีย์ Supabase ที่รู้จัก (ก๊อปมาไม่ครบ?)");
  }
  return problems;
}

/** อ่าน fleet.json ที่ parse แล้ว → รับได้ทั้ง `[...]` และ `{ targets: [...] }` */
export function parseFleet(raw: unknown): PingTarget[] {
  const list =
    Array.isArray(raw) ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { targets?: unknown }).targets)
      ? (raw as { targets: unknown[] }).targets
      : null;

  if (!list) throw new Error("รูปแบบไฟล์ไม่ถูก — ต้องเป็น array หรือ object ที่มีช่อง targets");
  if (list.length === 0) throw new Error("ยังไม่มี DB สักก้อนในไฟล์ — รัน npm run fleet:sync");

  return list.map((r, i) => {
    if (typeof r !== "object" || r === null) throw new Error(`รายการที่ ${i + 1} ไม่ใช่ object`);
    const t = r as Partial<PingTarget>;
    const problems = checkPingTarget(t);
    if (problems.length) throw new Error(`รายการที่ ${i + 1} (${t.name ?? "ไม่มีชื่อ"}): ${problems.join(" · ")}`);
    return { name: t.name!.trim(), url: t.url!.trim(), anonKey: t.anonKey!.trim() };
  });
}

/**
 * สร้าง fleet จาก targets.json + ไฟล์ env ของแต่ละก้อน
 *
 * ★ cross-check ref เหมือน db-push-all — ถ้าไฟล์ env ชี้คนละ project กับ dbUrl
 *   แปลว่า target นั้นตั้งค่าผิดอยู่แล้ว **ห้ามเขียนลง fleet.json** ไม่งั้นเราจะ
 *   ปิง DB ก้อนหนึ่งวันละครั้งอย่างขยันขันแข็ง แล้วปล่อยอีกก้อนหลับไปเงียบ ๆ
 */
export function fleetFromTargets(
  targets: DbTarget[],
  readEnvFile: (file: string) => Record<string, string>,
): { fleet: PingTarget[]; problems: string[] } {
  const fleet: PingTarget[] = [];
  const problems: string[] = [];

  for (const t of targets) {
    const label = t.name?.trim() || "(ไม่มีชื่อ)";
    let env: Record<string, string>;
    try {
      env = readEnvFile(t.env);
    } catch {
      problems.push(`${label}: อ่านไฟล์ env ไม่ได้ (${t.env})`);
      continue;
    }

    const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
    const anonKey = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
    const entry: PingTarget = { name: label, url, anonKey };

    const bad = checkPingTarget(entry);
    if (bad.length) {
      problems.push(`${label}: ${bad.join(" · ")}`);
      continue;
    }

    const envRef = refFromSupabaseUrl(url);
    const dbRef = refFromDbUrl(t.dbUrl ?? "");
    if (dbRef && envRef !== dbRef) {
      problems.push(`${label}: ref ไม่ตรงกัน! ไฟล์ env ชี้ ${envRef} แต่ dbUrl ชี้ ${dbRef}`);
      continue;
    }

    fleet.push(entry);
  }
  return { fleet, problems };
}

/**
 * DB ที่อยู่ใน targets.json แต่ยังไม่มีใน fleet.json = **ก้อนที่ไม่มีใครปิง**
 * ใช้ให้ db:push:all ฟ้องเองตอนรับลูกค้าใหม่ (จุดที่ลืมได้ง่ายที่สุดของงานนี้)
 */
export function unpingedTargets(targets: DbTarget[], fleet: PingTarget[]): string[] {
  const known = new Set(fleet.map((f) => refFromSupabaseUrl(f.url)).filter(Boolean) as string[]);
  return targets
    .filter((t) => {
      const ref = refFromDbUrl(t.dbUrl ?? "");
      return ref ? !known.has(ref) : false;
    })
    .map((t) => `${t.name?.trim() || "(ไม่มีชื่อ)"} (${refFromDbUrl(t.dbUrl ?? "")})`);
}

/** ก้อนที่อยู่ใน fleet.json แต่ไม่มีใน targets.json แล้ว (เลิกเป็นลูกค้าแล้ว?) */
export function staleFleetEntries(targets: DbTarget[], fleet: PingTarget[]): string[] {
  const live = new Set(targets.map((t) => refFromDbUrl(t.dbUrl ?? "")).filter(Boolean) as string[]);
  return fleet.filter((f) => !live.has(refFromSupabaseUrl(f.url) ?? "")).map((f) => f.name);
}

/** สรุปผลการปิงเป็นข้อความ + บอกว่ามีก้อนพังไหม (ใช้ตัดสิน exit code) */
export function summarize(results: PingResult[]): { lines: string[]; failed: PingResult[] } {
  const failed = results.filter((r) => r.ok === 0);
  const lines = results.map((r) =>
    r.ok > 0
      ? `   ✅ ${r.name} (${r.ref}) · ${r.ok}/${r.tries} ครั้ง · ${r.ms} ms · เวลาใน DB ${r.detail}`
      : `   ❌ ${r.name} (${r.ref}) · ยิง ${r.tries} ครั้งไม่ผ่านเลย · ${r.detail}`,
  );
  return { lines, failed };
}

/**
 * 1 บรรทัดสำหรับ log ไฟล์ — สั้น อ่านย้อนหลังรู้เรื่อง
 *
 * ★ ใช้ **เวลาเครื่อง** ไม่ใช่ UTC (`toISOString`) — ไฟล์นี้มีไว้ให้คนอ่านตอบคำถาม
 *   "วันนี้ปิงไปแล้วหรือยัง" · UTC ช้ากว่าไทย 7 ชม. → รอบที่ยิงหลังเที่ยงคืน
 *   จะถูกจดเป็น**วันก่อนหน้า** ซึ่งตอบคำถามนั้นผิดเลย
 *   (log ฝั่ง GitHub Actions ไม่ได้เขียนไฟล์นี้ จึงไม่มีปัญหาเรื่อง tz ของเครื่อง CI)
 */
export function logLine(now: Date, results: PingResult[]): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ` +
    `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  const body = results.map((r) => `${r.name}=${r.ok > 0 ? `ok/${r.ms}ms` : "FAIL"}`).join(" · ");
  return `${stamp}  ${results.every((r) => r.ok > 0) ? "OK  " : "FAIL"}  ${body}`;
}
