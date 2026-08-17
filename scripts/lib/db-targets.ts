/**
 * รายชื่อ DB ที่เราถืออยู่ (fleet) — ตัวช่วยล้วน ๆ ไม่มี side effect เพื่อให้เทสได้
 *
 * ใช้โดย `scripts/db-push-all.ts` (npm run db:push:all)
 *
 * 🚨 หัวใจของไฟล์นี้คือ `crossCheckRef` — กันเคสที่อันตรายที่สุดของงาน fleet:
 *    "ก๊อป connection string ผิดก้อน" แล้ว migration ของลูกค้าไปลงใน DB ธุรกิจตัวเอง
 *    (หรือกลับกัน) โดยไม่มีใครรู้ตัวจนกว่าจะสาย → จึงบังคับให้ทุก target มี 2 แหล่ง
 *    ที่บอก ref ได้ (ไฟล์ env กับ connection string) แล้วต้องตรงกันเท่านั้นถึงจะรัน
 */

/** 1 ปลายทาง = 1 Supabase project */
export type DbTarget = {
  /** ชื่อที่มนุษย์อ่าน เช่น "กิจการเจ้าของ (insep-erp)" */
  name: string;
  /** ไฟล์ env ที่มี NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (ใช้ตอนสำรองข้อมูล) */
  env: string;
  /** connection string ของ Postgres (ก๊อปจากปุ่ม Connect ใน Supabase dashboard) */
  dbUrl: string;
};

/**
 * แกะ project ref จาก URL ของ Supabase API
 *   https://tnuxrufpzeyuvwdmkojv.supabase.co → tnuxrufpzeyuvwdmkojv
 */
export function refFromSupabaseUrl(url: string): string | null {
  const m = url.trim().match(/^https?:\/\/([a-z0-9]{16,})\.supabase\./i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * แกะ project ref จาก connection string ของ Postgres — รองรับทั้ง 2 แบบที่ dashboard ให้มา
 *
 *   direct:  postgresql://postgres:PWD@db.<ref>.supabase.co:5432/postgres
 *   pooler:  postgresql://postgres.<ref>:PWD@aws-0-<region>.pooler.supabase.com:5432/postgres
 *
 * ★ ห้ามใช้ `new URL()` แกะรหัสผ่าน — รหัสที่มีอักขระพิเศษทำให้ parse พังเงียบ ๆ
 *   ที่นี่สนใจแค่ host กับ username จึงตัดส่วนรหัสผ่านทิ้งก่อนด้วย regex
 */
export function refFromDbUrl(dbUrl: string): string | null {
  const s = dbUrl.trim();

  // pooler: ชื่อผู้ใช้เป็น postgres.<ref>
  const user = s.match(/:\/\/postgres\.([a-z0-9]{16,})[:@]/i);
  if (user) return user[1].toLowerCase();

  // direct: host เป็น db.<ref>.supabase.co
  const host = s.match(/@db\.([a-z0-9]{16,})\.supabase\./i);
  if (host) return host[1].toLowerCase();

  return null;
}

/** ปัญหาที่เจอใน target หนึ่ง ๆ — คืนเป็น list ว่าง = ผ่าน */
export function checkTarget(t: Partial<DbTarget>, envUrl: string | null): string[] {
  const problems: string[] = [];
  if (!t.name?.trim()) problems.push("ไม่มีช่อง name");
  if (!t.env?.trim()) problems.push("ไม่มีช่อง env");
  if (!t.dbUrl?.trim()) problems.push("ไม่มีช่อง dbUrl");
  if (problems.length) return problems;

  if (!/^postgres(ql)?:\/\//i.test(t.dbUrl!.trim())) {
    problems.push("dbUrl ต้องขึ้นต้นด้วย postgresql://");
  }
  if (/\[YOUR-PASSWORD\]|\[รหัสผ่าน\]/i.test(t.dbUrl!)) {
    problems.push("dbUrl ยังเป็นตัวอย่างอยู่ — ต้องแทน [YOUR-PASSWORD] ด้วยรหัสจริง");
  }

  const dbRef = refFromDbUrl(t.dbUrl!);
  if (!dbRef) {
    problems.push("แกะ project ref จาก dbUrl ไม่ได้ (ก๊อปมาไม่ครบ?)");
    return problems;
  }

  const envRef = envUrl ? refFromSupabaseUrl(envUrl) : null;
  if (!envRef) {
    problems.push(`ไฟล์ ${t.env} ไม่มี NEXT_PUBLIC_SUPABASE_URL ที่อ่าน ref ได้`);
  } else if (envRef !== dbRef) {
    // 🚨 เคสที่สคริปต์นี้มีไว้เพื่อกัน — คนละ project กันแต่ผูกไว้ใน target เดียว
    problems.push(`ref ไม่ตรงกัน! ไฟล์ env ชี้ ${envRef} แต่ dbUrl ชี้ ${dbRef}`);
  }
  return problems;
}

/** อ่าน targets.json ที่ parse แล้ว → ตรวจรูปร่าง (ยังไม่แตะไฟล์ env) */
export function parseTargets(raw: unknown): DbTarget[] {
  if (!Array.isArray(raw)) throw new Error("targets ต้องเป็น array (ขึ้นต้นด้วย [ )");
  if (raw.length === 0) throw new Error("targets ว่างเปล่า — ยังไม่ได้ใส่ DB สักก้อน");
  return raw.map((r, i) => {
    if (typeof r !== "object" || r === null) throw new Error(`รายการที่ ${i + 1} ไม่ใช่ object`);
    return r as DbTarget;
  });
}

/** ซ่อนรหัสผ่านก่อนพิมพ์ออกจอ — output ของสคริปต์ถูกก๊อปไปแปะถามได้เสมอ */
export function maskDbUrl(dbUrl: string): string {
  return dbUrl.replace(/(:\/\/[^:@/]+:)[^@]*@/, "$1••••••@");
}
