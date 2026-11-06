import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { DATE_FORMAT_KIND, DOC_DATE_FORMAT_KIND } from "./dateFormat";

/**
 * 🪤 `app_settings.kind` เป็น CHECK whitelist ที่ **เขียนทับทั้งก้อน** ทุกครั้งที่เพิ่ม kind (D80)
 *    ลืมยก kind เดิมมาสักตัว = migration ลงผ่าน แต่ **ค่าตั้งของลูกค้าที่มีแถวนั้นอยู่แล้ว
 *    ทำให้ `add constraint` ล้มทั้ง fleet** หรือถ้าไม่มีแถว ก็บันทึกค่านั้นไม่ได้อีกเลยแบบเงียบ ๆ
 *    → เทสนี้อ่าน whitelist ทุกรุ่นตามลำดับไฟล์ แล้วตรวจว่ารุ่นใหม่ **ไม่ทำ kind เดิมหาย**
 */
const DIR = "supabase/migrations";

/** kind ที่ตั้งใจเอาออกจริง (ใส่พร้อมเหตุผล) — ว่าง = ยังไม่เคยเอาออก */
const REMOVED_ON_PURPOSE: string[] = [];

function whitelists(): { file: string; kinds: string[] }[] {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const out: { file: string; kinds: string[] }[] = [];
  for (const f of files) {
    const src = readFileSync(`${DIR}/${f}`, "utf8");
    for (const m of src.matchAll(/add constraint app_settings_kind_check[\s\S]*?\)\);/g)) {
      const code = m[0].replace(/--.*$/gm, ""); // คอมเมนต์มีชื่อ kind ปน — ห้ามนับ
      out.push({ file: f, kinds: [...code.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) });
    }
  }
  return out;
}

describe("app_settings.kind whitelist (D80/D161)", () => {
  const lists = whitelists();

  it("เจอ whitelist อย่างน้อย 2 รุ่น (กันเทสผ่านเพราะ regex ไม่เจออะไร)", () => {
    expect(lists.length).toBeGreaterThanOrEqual(2);
    for (const l of lists) expect(l.kinds.length, l.file).toBeGreaterThan(3); // รุ่นแรก (0013) มี 6 ตัว
  });

  it("รุ่นใหม่ไม่ทำ kind ของรุ่นก่อนหาย", () => {
    for (let i = 1; i < lists.length; i++) {
      const lost = lists[i - 1].kinds.filter((k) => !lists[i].kinds.includes(k) && !REMOVED_ON_PURPOSE.includes(k));
      expect(lost, `${lists[i].file} ทำหายจาก ${lists[i - 1].file}`).toEqual([]);
    }
  });

  it("รุ่นล่าสุดมี kind รูปแบบวันที่ทั้ง 2 ตัว", () => {
    const latest = lists[lists.length - 1].kinds;
    expect(latest).toContain(DATE_FORMAT_KIND);
    expect(latest).toContain(DOC_DATE_FORMAT_KIND);
  });

  it("ไม่มี kind ซ้ำในรุ่นเดียวกัน", () => {
    for (const l of lists) expect(new Set(l.kinds).size, l.file).toBe(l.kinds.length);
  });
});
