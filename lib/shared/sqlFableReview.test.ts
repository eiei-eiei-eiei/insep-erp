/**
 * D182 — ล็อกผลแก้รีวิว Fable รอบ 1 ที่อยู่ใน plpgsql (อ่านนิยาม "ล่าสุด" ของแต่ละฟังก์ชันจากไฟล์ migration)
 *
 * ★ ชั้นเสริม — ชั้นที่พิสูจน์พฤติกรรมจริงคือ `tests/tenant/fable-review.test.ts` (ยิง DB จริง)
 *   ชั้นนี้มีไว้กัน "คนในอนาคตยกฟังก์ชันเก่ามาแก้แล้วพาบั๊กเดิมกลับมา" โดยไม่ต้องต่อเน็ต
 * 🪤 ตรวจ **โค้ด** ไม่ใช่คำในคอมเมนต์ (บทเรียน D92/D95) — ตัดคอมเมนต์ออกก่อนทุกครั้ง
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(path.join(DIR, f), "utf8");
/** ตัดคอมเมนต์ `--` (ทั้งบรรทัด/ท้ายบรรทัด) และ block comment ออก */
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

/** นิยามล่าสุดของทุกฟังก์ชัน: ชื่อ → { ไฟล์, ตัวฟังก์ชัน (ตัดคอมเมนต์แล้ว) } */
function latestDefs(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
  for (const f of files) {
    const s = noComments(read(f));
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const tail = s.slice(m.index);
      const tag = tail.match(/\$[a-z_]*\$/i);
      if (!tag) continue;
      const open = tail.indexOf(tag[0]);
      const close = tail.indexOf(tag[0], open + tag[0].length);
      out.set(m[1].toLowerCase(), { file: f, body: tail.slice(0, close + tag[0].length) });
    }
  }
  return out;
}
const defs = latestDefs();
const body = (fn: string) => {
  const d = defs.get(fn);
  expect(d, `ไม่พบนิยามของ ${fn}`).toBeTruthy();
  return d!.body;
};

describe("R3 — 'วันนี้' ฝั่ง SQL ต้องเป็นเวลาไทย (current_date บน Supabase = UTC)", () => {
  it("🚨 ไม่มีฟังก์ชันไหน (นิยามล่าสุด) ใช้ current_date / now()::date เป็นวันที่อีกแล้ว", () => {
    const bad = [...defs]
      .filter(([, d]) => /\bcurrent_date\b|now\(\)\s*::\s*date|current_timestamp\s*::\s*date/i.test(d.body))
      .map(([n, d]) => `${n} (${d.file})`);
    expect(bad, "ใช้ (now() at time zone 'Asia/Bangkok')::date หรือ fn_today_th() แทน").toEqual([]);
  });

  it("แถวรับคืนสต็อกตอนยกเลิกออเดอร์ (ลงฟอร์ม ภส.) ใช้วันไทย", () => {
    expect(body("fn_cancel_order")).toMatch(/v_order\.entity_id,\s*v_today,\s*'รับ'/);
  });
});

describe("R5 — ลบ batch หมักที่รินสุราแช่แล้วไม่ได้", () => {
  it("ด่านเช็คทั้งฝั่งกลั่น (log_distill_run/log_distill) และฝั่งริน (log_ferment_draw)", () => {
    const b = body("fn_delete_ferment_batch");
    for (const t of ["log_distill_run", "log_distill", "log_ferment_draw"]) {
      expect(b, t).toMatch(new RegExp(`exists\\s*\\(\\s*select 1 from ${t} where batch = p_batch\\s*\\)`));
    }
  });
  it("🪤 ด่านต้องมาก่อนคำสั่งลบตัวแรก (กันก่อนลบ ไม่ใช่ลบแล้วค่อยกัน)", () => {
    const b = body("fn_delete_ferment_batch");
    expect(b.indexOf("log_ferment_draw")).toBeLessThan(b.indexOf("delete from"));
  });
});

describe("Y3/Y4/Y5 — กิจการต้องมาจากของจริง ไม่ใช่ค่าเดา", () => {
  it("Y4 fn_issue_wht เลิกฮาร์ดโค้ด 'EID01' · ไม่ระบุ = ใช้กิจการของบิล", () => {
    const b = body("fn_issue_wht");
    expect(b).not.toContain("'EID01'");
    expect(b).toMatch(/array_agg\(distinct entity_id\)[\s\S]*from transactions where tx_id = any/);
  });
  it("Y3 fn_save_transfer ไม่รับกิจการว่าง/'ALL'", () => {
    expect(body("fn_save_transfer")).toMatch(/coalesce\(trim\(p_entity\),''\) in \('', 'ALL'\)/);
  });
  it("Y5 fn_manual_stock_move กรอง tenant + กิจการ ทั้งตอนหาและตอนแก้", () => {
    const b = body("fn_manual_stock_move");
    const where = b.match(/where tenant_id = v_tenant and entity_id = v_entity and item_code = v_code/g) ?? [];
    expect(where.length).toBe(2); // select … for update + update
    expect(b).not.toMatch(/where item_code = v_code/);
  });
});

describe("Y6 — ยกเลิกรายการบิลบาร์: ส่วนลด % และปัดเศษ คิดจากยอดใหม่", () => {
  it("ไม่บวก rounding เดิมกลับเข้าไปอีก", () => {
    expect(body("fn_bar_void_line")).not.toMatch(/\+\s*s\.rounding/);
  });
  it("ส่วนลด % คิดจากยอดใหม่ · ส่วนลดบาทคงเดิม", () => {
    expect(body("fn_bar_void_line")).toMatch(/when v_sale\.discount_pct is not null[\s\S]*round\(v_sub \* least\(v_sale\.discount_pct, 100\) \/ 100, 2\)/);
  });
  it("ยอดซื้อสะสมลูกค้าถอยตามส่วนต่าง", () => {
    expect(body("fn_bar_void_line")).toMatch(/spend_total = greatest\(0, spend_total - \(v_sale\.grand_total - v_grand\)\)/);
  });
});
