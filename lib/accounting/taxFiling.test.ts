import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_FILING_METHOD,
  dueDateOf,
  effectiveMethod,
  fileWithoutFormWarn,
  filingBadge,
  filingHintText,
  filingLine,
  filingStateOf,
  finalDueDate,
  stageDates,
  stageOn,
  stagesDescText,
  toFilingMethod,
  type TaxFilingRow,
} from "./taxFiling";

/**
 * golden A20 — "ยื่นแล้ว" + วิธียื่น + 3 จังหวะเตือน (D95)
 *
 * 🚨 สิ่งที่เทสชุดนี้ปกป้อง:
 *   · ค่าปริยายของวิธียื่นคือ **กระดาษ** (เร็วกว่าเสมอ) — เปลี่ยนเมื่อไหร่ ลูกค้าที่ยังไม่ตั้ง
 *     จะถูกเตือนช้าลง 8 วัน ซึ่งอาจเลยกำหนดจริงไปแล้ว
 *   · "ยังไม่ได้ตั้ง" ต้องเดินทางมาถึงหน้าจอ/ข้อความในสภาพ null — ห้ามให้ชั้นข้อมูลเติมให้เงียบ ๆ
 *   · กำหนดยื่นตามกฎหมาย (15/23 · 7/15) **ห้ามขยับ**
 */

describe("วิธียื่น", () => {
  it("ค่าที่ระบบไม่รู้จัก = ยังไม่ได้ตั้ง (null) ไม่ใช่เดาให้เป็นกระดาษ", () => {
    expect(toFilingMethod("paper")).toBe("paper");
    expect(toFilingMethod("efiling")).toBe("efiling");
    for (const v of [null, undefined, "", "  ", "PAPER", "อีไฟลิ่ง", 1]) {
      expect(toFilingMethod(v), String(v)).toBeNull();
    }
  });

  it("🚨 ไม่ตั้ง = ใช้กำหนดของกระดาษ (มาก่อนเสมอ — เตือนเร็วไปดีกว่าเตือนช้า)", () => {
    expect(DEFAULT_FILING_METHOD).toBe("paper");
    expect(effectiveMethod(null)).toBe("paper");
    expect(effectiveMethod("efiling")).toBe("efiling");
  });
});

describe("กำหนดยื่น (ห้ามขยับ — เป็นวันตามกฎหมาย)", () => {
  it("ภพ.30 งวด ส.ค. → กระดาษ 15 ก.ย. · ออนไลน์ 23 ก.ย.", () => {
    expect(dueDateOf("vat", "2026-08")).toEqual({ paper: "2026-09-15", efiling: "2026-09-23" });
  });
  it("ภงด.3/53 งวด ส.ค. → กระดาษ 7 ก.ย. · ออนไลน์ 15 ก.ย.", () => {
    expect(dueDateOf("pnd3", "2026-08")).toEqual({ paper: "2026-09-07", efiling: "2026-09-15" });
    expect(dueDateOf("pnd53", "2026-08")).toEqual(dueDateOf("pnd3", "2026-08"));
  });
  it("ข้ามปี — งวด ธ.ค. ครบกำหนดเดือน ม.ค. ปีถัดไป", () => {
    expect(dueDateOf("vat", "2026-12").paper).toBe("2027-01-15");
  });
  it("วันสุดท้ายจริงขึ้นกับวิธียื่น · ไม่ตั้ง = กระดาษ", () => {
    expect(finalDueDate("vat", "2026-08", null)).toBe("2026-09-15");
    expect(finalDueDate("vat", "2026-08", "paper")).toBe("2026-09-15");
    expect(finalDueDate("vat", "2026-08", "efiling")).toBe("2026-09-23");
  });
});

describe("3 จังหวะเตือน", () => {
  it("pre = วันสุดท้าย − leadDays · due = วันสุดท้าย · late = วันถัดมา 1 วัน", () => {
    expect(stageDates("vat", "2026-08", null)).toEqual([
      { stage: "pre", date: "2026-09-12" },
      { stage: "due", date: "2026-09-15" },
      { stage: "late", date: "2026-09-16" },
    ]);
  });

  it("🪤 leadDays = 0 → pre ชนกับ due ต้องเหลือวันเดียว (ไม่ยิง 2 ข้อความวันเดียวกัน)", () => {
    expect(stageDates("vat", "2026-08", null, 0)).toEqual([
      { stage: "due", date: "2026-09-15" },
      { stage: "late", date: "2026-09-16" },
    ]);
  });

  it("ข้ามเดือน/ข้ามปีคิดถูก (ถอยวันไม่ใช่ลบตัวเลข)", () => {
    expect(stageDates("pnd3", "2026-12", null)).toEqual([
      { stage: "pre", date: "2027-01-04" },
      { stage: "due", date: "2027-01-07" },
      { stage: "late", date: "2027-01-08" },
    ]);
  });

  it("stageOn คืน null ในวันที่ไม่ใช่จังหวะใด", () => {
    expect(stageOn("2026-09-13", "vat", "2026-08", null)).toBeNull();
    expect(stageOn("2026-09-15", "vat", "2026-08", null)).toBe("due");
  });

  it("คำอธิบายบนจอบอกครบทุกวันที่จะถูกเตือน (หน้าจอต้องตรงกับสิ่งที่ระบบทำ)", () => {
    expect(stagesDescText("vat", "2026-08", null)).toBe("12 ก.ย. · 15 ก.ย. · 16 ก.ย.");
    expect(stagesDescText("vat", "2026-08", "efiling")).toBe("20 ก.ย. · 23 ก.ย. · 24 ก.ย.");
  });
});

describe("บรรทัดข้อความ", () => {
  it("ไม่บอกยอดเงินเด็ดขาด (กลุ่ม LINE มีคนนอกฝ่ายบัญชี)", () => {
    for (const m of [null, "paper", "efiling"] as const) {
      expect(filingLine("vat", "2026-08", m)).not.toMatch(/บาท|\d{1,3},\d{3}/);
    }
  });

  it("ยังไม่ตั้งวิธียื่น → บอกว่ายังไม่ได้ตั้ง + บอกว่าตั้งได้ที่ไหน", () => {
    const line = filingLine("vat", "2026-08", null);
    expect(line).toContain("ยังไม่ได้ตั้งวิธียื่น");
    expect(line).toContain("ตั้งค่า → กิจการ");
  });

  it("ตั้งแล้ว → บอกวิธีที่ตั้งไว้ และไม่มีวันของอีกวิธีปน", () => {
    expect(filingLine("vat", "2026-08", "efiling")).toContain("ยื่นออนไลน์");
    expect(filingLine("vat", "2026-08", "efiling")).not.toContain("15 ก.ย.");
  });
});

describe("สถานะการยื่นของงวด", () => {
  const rows: TaxFilingRow[] = [
    { id: 1, kind: "vat", period: "2026-08", filedAt: "2026-09-10", filedOn: "2026-09-10", source: "manual", note: null, reopenedAt: "2026-09-11" },
    { id: 2, kind: "vat", period: "2026-08", filedAt: "2026-09-12", filedOn: null, source: "pay", note: null, reopenedAt: null },
    { id: 3, kind: "pnd3", period: "2026-07", filedAt: "2026-08-05", filedOn: null, source: "manual", note: null, reopenedAt: null },
  ];

  it("แถวที่ถอนแล้วไม่นับว่ายื่น แต่ยังนับเป็นประวัติ", () => {
    const st = filingStateOf(rows, "vat", "2026-08");
    expect(st.submitted).toBe(true);
    expect(st.active?.id).toBe(2);
    expect(st.reopenedTimes).toBe(1);
  });

  it("งวด/แบบที่ไม่มีแถว = ยังไม่ยื่น", () => {
    expect(filingStateOf(rows, "vat", "2026-07").submitted).toBe(false);
    expect(filingStateOf(rows, "pnd53", "2026-07").submitted).toBe(false);
    expect(filingStateOf([], "vat", "2026-08").submitted).toBe(false);
  });

  it("ถอนแล้วทุกแถว = กลับมาเป็น 'ยังไม่ยื่น' (ถอนแล้วต้องกลับมาเตือน)", () => {
    const onlyReopened = rows.filter((r) => r.reopenedAt);
    expect(filingStateOf(onlyReopened, "vat", "2026-08").submitted).toBe(false);
  });
});

describe("ป้ายและคำอธิบายบนจอ (ตัดสินใน lib ห้ามเขียน ternary ในคอมโพเนนต์ — D84)", () => {
  it("ป้ายตอบคำถาม 'ยื่นแล้วหรือยัง' อย่างเดียว", () => {
    expect(filingBadge(true)).toEqual({ text: "ยื่นแล้ว", tone: "ok" });
    expect(filingBadge(false)).toEqual({ text: "ยังไม่ได้ยื่น", tone: "warn" });
  });

  it("ยังไม่ยื่น → บอกวันที่จะถูกเตือน · ยื่นแล้ว → บอกว่าไม่เตือนอีก", () => {
    expect(filingHintText({ submitted: false }, "12 ก.ย. · 15 ก.ย.")).toContain("12 ก.ย.");
    expect(filingHintText({ submitted: true }, "x")).toContain("ไม่เตือน");
  });

  it("ระบบติ๊กให้ตอนจ่าย ต้องบอกว่ามาจากไหน (ไม่งั้นผู้ใช้งงว่าใครกด)", () => {
    expect(filingHintText({ submitted: true, bySystem: true }, "x")).toContain("บันทึกจ่าย");
    expect(filingHintText({ submitted: true, bySystem: false }, "x")).not.toContain("บันทึกจ่าย");
  });

  it("🚨 ยังไม่สร้างแบบ = เตือน ไม่บล็อก (ผู้ใช้ยื่นผ่านเว็บสรรพากรเองได้ — D69)", () => {
    expect(fileWithoutFormWarn(true)).toBeNull();
    expect(fileWithoutFormWarn(false)).toContain("เว็บสรรพากร");
  });
});

/**
 * ── กติกาที่อยู่คนละฝั่งกับ TypeScript ────────────────────────────────────────
 *
 * 🔴 ชั้นนี้จำเป็นเพราะกติกาของ D95 กระจายอยู่ **3 ที่ที่ TypeScript มองไม่ทะลุถึงกัน**:
 *      · cron route (เลือกว่าจะถามตารางไหน)
 *      · migration  (plpgsql — `npm run build/lint/test` มองไม่เห็นเลยสักบรรทัด · D79)
 *      · lib        (สูตรวัน/ข้อความ)
 *    หลุดข้างใดข้างหนึ่ง **ไม่มี error ทั้งคู่** — เหมือน `exciseHidden.test.ts` ของ D90
 *    และ `rolesSql.test.ts` ของ D85
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const latestSqlWith = (needle: string) => {
  const dir = path.join(ROOT, "supabase/migrations");
  const hit = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => fs.readFileSync(path.join(dir, f), "utf8").includes(needle));
  expect(hit, `ไม่พบ migration ที่มี ${needle}`).toBeTruthy();
  return fs.readFileSync(path.join(dir, hit!), "utf8");
};

describe("cron ต้องถามตารางที่ถูก (ต้นเรื่องทั้งหมดของ D95)", () => {
  const src = read("app/api/cron/tax-reminder/route.ts");
  const taxPart = () => {
    const i = src.indexOf("async function taxPart(");
    expect(i, "ไม่พบ taxPart").toBeGreaterThan(-1);
    return src.slice(i, src.indexOf("\n  }\n", i));
  };

  it('🚨 ตัวปิดเสียงคือ "ยื่นแล้ว" (tax_filings) — ไม่ใช่ "กดพิมพ์แล้ว" (report_runs)', () => {
    expect(taxPart()).toContain('from("tax_filings")');
    /**
     * report_runs = เช็กลิสต์ · เอากลับมาทำหน้าที่นี้เมื่อไหร่ = บั๊กเดิมของ D88 กลับมาทันที
     * 🪤 ต้องตรวจ **การ query จริง** ไม่ใช่คำในไฟล์ — คอมเมนต์ที่อธิบายว่า "ห้ามใช้ report_runs"
     *    มีคำนั้นอยู่ด้วย · ตรวจแบบหยาบ = เทสห้ามไม่ให้เขียนคำอธิบายที่จำเป็นที่สุดของงานนี้
     */
    expect(taxPart()).not.toMatch(/from\(\s*"report_runs"\s*\)/);
    expect(taxPart()).not.toMatch(/getReportRuns\(/);
  });

  it("นับเฉพาะแถวที่ยังไม่ถูกถอน — ถอนการยื่นแล้วต้องกลับมาเตือน", () => {
    expect(taxPart()).toMatch(/tax_filings[\s\S]{0,300}is\("reopened_at", null\)/);
  });

  it("🚨 อ่าน tax_filings ไม่สำเร็จต้องหยุดและฟ้อง — ไม่ใช่เดาว่ายังไม่ยื่นแล้วสแปม (D89)", () => {
    expect(taxPart()).toMatch(/fileRes\.error[\s\S]{0,200}return;/);
  });

  it("ส่งวิธียื่นของกิจการเข้าไปคิดวัน (ไม่ใช่ใช้กระดาษตายตัวทั้งระบบ)", () => {
    expect(taxPart()).toContain("toFilingMethod(e.filing_method)");
    expect(src).toContain('.select("entity_id, name, is_vat, excise_id, filing_method")');
  });
});

describe("ตรรกะฝั่ง DB ที่ build/lint/test มองไม่เห็น (D79)", () => {
  const sql = latestSqlWith("create table if not exists tax_filings");

  it("🚨 บันทึกจ่ายสำเร็จ = ติ๊กยื่นให้เอง (กฎที่ผู้ใช้เลือก: จ่ายได้แปลว่ายื่นแล้ว)", () => {
    const i = sql.indexOf("create or replace function fn_pay_tax(");
    expect(i, "0063 ต้องยก fn_pay_tax มาด้วย ไม่งั้นการติ๊กอัตโนมัติไม่มีอยู่จริง").toBeGreaterThan(-1);
    const fn = sql.slice(i, sql.indexOf("\nend $$;\n", i));
    expect(fn).toContain("insert into tax_filings");
    expect(fn).toContain("'pay'");
  });

  it("🚨 ทิศทางเดียว — fn_unpay_tax ต้องไม่ถอนการยื่นตามไปด้วย", () => {
    // ถอนจ่ายเพราะกรอกยอดผิด ไม่ได้แปลว่าไม่ได้ยื่น · ถ้าจะถอนยื่นต้องกดอีกปุ่มโดยเจตนา
    const i = sql.indexOf("create or replace function fn_unpay_tax(");
    if (i >= 0) {
      const fn = sql.slice(i, sql.indexOf("\nend $$;\n", i));
      expect(fn).not.toContain("tax_filings");
    }
  });

  it("🚨 backfill เฉพาะจาก tax_payments — ห้าม backfill จาก report_runs (นั่นแปลว่ากดพิมพ์)", () => {
    const ins = sql.slice(sql.indexOf("insert into tax_filings ("));
    const backfill = ins.slice(0, ins.indexOf(";"));
    expect(backfill).toContain("from tax_payments");
    expect(sql).not.toMatch(/insert into tax_filings[\s\S]{0,400}from report_runs/);
  });

  it("กันติ๊กซ้อนด้วย partial unique index (แถวที่ถอนแล้วไม่กันรอบใหม่ — แพตเทิร์น D91)", () => {
    expect(sql).toMatch(
      /create unique index[\s\S]{0,160}tax_filings \(tenant_id, entity_id, kind, period\) where reopened_at is null/,
    );
  });

  it("🚨 ไม่มี policy เขียน — เขียนผ่าน RPC definer เท่านั้น (บทเรียน D85/0052: for all ครอบ SELECT)", () => {
    const policies = sql.match(/create policy \w+ on tax_filings for (\w+)/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) expect(p, p).toContain("for select");
  });

  it("อ่านได้เฉพาะฝ่ายบัญชีและเฉพาะกิจการที่มีสิทธิ์ (definer bypass RLS ได้ → ต้องเช็คเอง)", () => {
    expect(sql).toMatch(/create policy tax_filing_sel[\s\S]{0,200}has_cap\('acct\.read'\)/);
    expect(sql).toMatch(/create policy tax_filing_sel[\s\S]{0,260}my_entities\(\)/);
  });

  it("ติ๊กยื่น = acct.write · ถอน = acct.config (ถอนแล้วระบบกลับไปเตือนคนทั้งกลุ่ม LINE)", () => {
    const file = sql.slice(sql.indexOf("function fn_file_tax("));
    expect(file.slice(0, file.indexOf("end $$;"))).toContain("has_cap('acct.write')");
    const un = sql.slice(sql.indexOf("function fn_unfile_tax("));
    expect(un.slice(0, un.indexOf("end $$;"))).toContain("has_cap('acct.config')");
  });

  it("🚨 ผู้ไม่จด VAT ยื่น ภพ.30 ไม่ได้ — บล็อกที่ DB ด้วย ยิง API ตรงก็ไม่รอด (ม.86/13 · D55)", () => {
    const file = sql.slice(sql.indexOf("function fn_file_tax("));
    expect(file.slice(0, file.indexOf("end $$;"))).toContain("entity_is_vat");
  });

  it("🚨 ไม่มีแถวให้ถอน = ตอบ error ไทย ไม่ใช่ ok (บทเรียน D93/D94)", () => {
    const un = sql.slice(sql.indexOf("function fn_unfile_tax("));
    const body = un.slice(0, un.indexOf("end $$;"));
    expect(body).toMatch(/v_n = 0[\s\S]{0,200}'ok', false/);
  });

  it("วิธียื่นเก็บเป็นชุดปิดที่ DB — ค่าที่ไม่รู้จักเข้าไปไม่ได้", () => {
    expect(sql).toMatch(/filing_method is null or filing_method in \('paper','efiling'\)/);
  });
});
