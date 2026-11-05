import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * D158 — integration_log อ่านได้เฉพาะโดเมนของรายการ (migration 0105)
 *
 * 🔴 เดิมทุกบทบาทอ่านได้ทุกแถว ⇒ payload `POST_PAYROLL` (ชื่อ+เงินเดือนรายคน) รั่วไปถึงฝ่ายขาย/viewer/บาร์
 * ★ ตัวจริงคือ RLS ใน SQL — เทสนี้อ่าน SQL เป็นข้อความ (ชั้นเดียวกับ rolesSql.test.ts D85)
 *   แล้วไล่ action **ทุกตัวที่โค้ดเขียนลงตาราง** มาเทียบ: ลืมเติม action ใหม่ = แถวนั้น main เห็นคนเดียว
 *   (ปลอดภัยแต่หน้าจอของโดเมนนั้นจะว่างเงียบ ๆ) → เทสแดงให้ตัดสินใจเอง
 * 🪤 ผลจริงกับบทบาทจริงอยู่ที่ tests/tenant/integration-log-caps.test.ts
 */

const MIG = "supabase/migrations";
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(join(MIG, f), "utf8");

/** ไฟล์ล่าสุดที่นิยามฟังก์ชันนี้ (บทเรียน D95 — "ไฟล์ที่จำได้" ≠ "ไฟล์ล่าสุด") */
function latestDef(name: string): string {
  const f = [...files].reverse().find((x) => read(x).includes(`create or replace function ${name}(`));
  if (!f) throw new Error(`ไม่พบนิยาม ${name}`);
  const src = read(f);
  const start = src.indexOf(`create or replace function ${name}(`);
  return src.slice(start, src.indexOf("$$;", src.indexOf("$$", start) + 2) + 3);
}

/** ตีความ CASE ใน integration_log_cap() → cap ของ action (ตรรกะเดียวกับ SQL) */
function capOf(action: string): string {
  const def = latestDef("integration_log_cap");
  for (const line of def.split("\n")) {
    const cap = line.match(/then '([a-z.]+)'/)?.[1];
    if (!cap) continue;
    const prefix = line.match(/left\(p_action, (\d+)\) = '([A-Z_]+)'/);
    if (prefix && action.slice(0, Number(prefix[1])) === prefix[2]) return cap;
    const list = line.match(/p_action in \(([^)]*)\)/);
    if (list && [...list[1].matchAll(/'([A-Z_]+)'/g)].some((m) => m[1] === action)) return cap;
    const eq = line.match(/p_action = '([A-Z_]+)'/);
    if (eq && eq[1] === action) return cap;
  }
  return def.match(/else '([a-z.]+)'/)![1];
}

/** action ทุกตัวที่ SQL เขียนลง integration_log */
function sqlActions(): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/insert into integration_log/g)) {
      const tail = src.slice(m.index!, m.index! + 400);
      const a = tail.match(/'([A-Z][A-Z_]+)'/)?.[1];
      if (a) out.add(a);
    }
  }
  return out;
}

/** action ที่ฝั่ง TypeScript เขียน (cron · ค่าคงที่ *_ACTION) */
function tsActions(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) { if (n !== "node_modules") walk(p); continue; }
      if (!/\.tsx?$/.test(n) || n.endsWith(".test.ts")) continue;
      const src = readFileSync(p, "utf8");
      if (!src.includes("integration_log") && !/_ACTION\s*=/.test(src)) continue;
      for (const m of src.matchAll(/_ACTION\s*=\s*"([A-Z_]+)"/g)) out.add(m[1]);
      if (src.includes("integration_log")) for (const m of src.matchAll(/action:\s*"([A-Z_]+)"/g)) out.add(m[1]);
    }
  };
  walk("lib");
  walk("app");
  return out;
}

describe("D158 integration_log_cap", () => {
  it("🔴 เงินเดือนทุกแบบ (POST_PAYROLL · POST_PAYROLL_<ขา>) อ่านได้เฉพาะ pay.read", () => {
    expect(capOf("POST_PAYROLL")).toBe("pay.read");
    expect(capOf("POST_PAYROLL_NET")).toBe("pay.read");
  });
  it("action ที่หน้าประวัติเชื่อมระบบของฝ่ายขายอ่าน ต้องเป็น sales.read (ไม่งั้นหน้านั้นว่างเงียบ ๆ)", () => {
    const data = readFileSync("app/(app)/sales/data.ts", "utf8");
    const list = data.match(/from\("integration_log"\)[\s\S]*?\.in\("action", \[([^\]]*)\]\)/);
    expect(list, "หา .in('action', [...]) ใน getSyncHistory ไม่เจอ").toBeTruthy();
    const actions = [...list![1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) expect(capOf(a), a).toBe("sales.read");
  });
  it("action ที่ไม่รู้จัก = admin (main เท่านั้น · fail-closed)", () => {
    expect(capOf("SOMETHING_NEW")).toBe("admin");
  });
  it("action ทุกตัวที่โค้ดเขียนลงตาราง ถูกกำหนด cap ไว้ชัด ๆ (ไม่ตกไป admin โดยไม่ตั้งใจ)", () => {
    const all = new Set([...sqlActions(), ...tsActions()]);
    // ตรวจว่าตัวไล่หาเจอของจริง ไม่ใช่ผ่านเพราะหาไม่เจอสักตัว (บทเรียน D92)
    for (const must of ["POST_PAYROLL", "RECEIVE_REVENUE", "SELL_PRODUCT", "RECEIVE_MATERIAL", "PAY_TAX", "TAX_REMINDER", "EXCISE_REMINDER", "BAR_POST_REMINDER"]) {
      expect(all.has(must), `ตัวไล่หา action ไม่เจอ ${must}`).toBe(true);
    }
    for (const a of all) expect(capOf(a), `${a} ยังไม่ได้กำหนด cap ใน integration_log_cap()`).not.toBe("admin");
  });
  it("policy อ่านใช้ has_cap(integration_log_cap(action)) + tenant · ไม่มี policy เขียน", () => {
    const f = [...files].reverse().find((x) => /create policy integration_log_sel/.test(read(x)))!;
    const src = read(f);
    expect(src).toContain("using (tenant_id = my_tenant() and has_cap(integration_log_cap(action)))");
    const writes = files.flatMap((x) => [...read(x).matchAll(/create policy (\w+) on integration_log for (insert|update|delete|all)/g)]);
    expect(writes).toEqual([]);
  });
});
