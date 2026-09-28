import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DOC_TYPES, DOC_TYPE_INFO, DOC_GROUPS, DATE_FMTS, allowedResets, fitReset, toCfg } from "./docNumbering";

/**
 * D100 — รูปแบบเลขเอกสาร · ชั้นอ่านไฟล์ (ชั้นที่พิสูจน์จริงคือ tests/tenant/doc-numbering.test.ts)
 *
 * ทำไมต้องอ่าน SQL: รายชื่อชนิดเอกสารมี 2 ฝั่ง (DOC_TYPES ฝั่ง TS คุมหน้าจอ · fn_doc_types/
 * fn_doc_default/fn_doc_nos ฝั่ง SQL คือตัวจริง) หลุดจากกันแล้ว **ไม่มี error ทั้งคู่**
 * — ชนิดที่ fn_doc_nos ไม่รู้จัก = หาเลขล่าสุดไม่เจอ (เริ่ม 1 ใหม่) และกันเลขซ้ำไม่ได้ เงียบ ๆ
 *
 * 🪤 ตรวจ "ไฟล์ล่าสุดที่นิยามฟังก์ชันจริง" ด้วย `create … function` ไม่ใช่คำว่า function X
 *    (บรรทัด revoke ก็มีคำนั้น · D99)
 */
const DIR = path.resolve(__dirname, "../../supabase/migrations");
const ROOT = path.resolve(__dirname, "../..");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(path.join(DIR, f), "utf8").replace(/\r\n/g, "\n");
const noComments = (s: string) => s.replace(/--[^\n]*/g, " ");
const src = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
/** โค้ด TS ที่ตัดคอมเมนต์ทิ้งแล้ว — ตรวจโค้ดจริง ไม่ใช่คำในคอมเมนต์ (D92/D95) */
const tsCode = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** body ของนิยามล่าสุด (โค้ดล้วน ไม่มีคอมเมนต์) */
function latestDef(fn: string): string {
  const re = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+${fn}\\s*\\(`, "i");
  const f = [...files].reverse().find((x) => re.test(noComments(read(x))));
  expect(f, `ไม่พบนิยามของ ${fn}`).toBeTruthy();
  const s = noComments(read(f!));
  const head = s.search(re);
  const tag = s.slice(head).match(/as\s+(\$[a-z]*\$)/i)![1];
  const open = s.indexOf(tag, head);
  return s.slice(head, s.indexOf(tag, open + tag.length) + tag.length);
}

describe("ชนิดเอกสาร ฝั่ง TS ↔ SQL ต้องตรงกัน (D100)", () => {
  it("DOC_TYPES ตรงกับ fn_doc_types() ทั้งรายชื่อและลำดับ", () => {
    const list = [...latestDef("fn_doc_types").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(list).toEqual([...DOC_TYPES]);
  });

  it("ทุกชนิดมีค่าปริยายใน fn_doc_default — ไม่มี = ออกเลขไม่ได้เลย", () => {
    const body = latestDef("fn_doc_default");
    for (const t of DOC_TYPES) expect(body, t).toContain(`'${t}'`);
  });

  it("🚨 ทุกชนิดมีกิ่งใน fn_doc_nos — ไม่มี = หาเลขล่าสุดไม่เจอ (เริ่ม 1 ใหม่) และกันเลขซ้ำไม่ได้", () => {
    const body = latestDef("fn_doc_nos");
    for (const t of DOC_TYPES) {
      const covered =
        (t.startsWith("sales_") && /left\(p_type,\s*6\)\s*=\s*'sales_'/.test(body)) || body.includes(`'${t}'`);
      expect(covered, `${t} ไม่มีกิ่งใน fn_doc_nos`).toBe(true);
    }
  });

  it("fn_doc_no_taken ใช้ทะเบียนเดียวกับ fn_doc_nos (ไม่มีรายชื่อตารางชุดที่สอง)", () => {
    expect(latestDef("fn_doc_no_taken")).toMatch(/fn_doc_nos\(/);
  });

  it("ฝั่งขายรวมทุกช่องเลขของออเดอร์ (รวม rcpt_no ที่เคยใช้ชุด INV · D89) · batch ครบ 3 ตาราง", () => {
    const body = latestDef("fn_doc_nos");
    for (const c of ["qu_no", "order_no", "inv_no", "dep_inv_no", "tax_no1", "tax_no2", "rcpt_no1", "rcpt_no2"]) {
      expect(body, c).toContain(c);
    }
    for (const t of ["from log_ferment ", "from log_distill ", "from log_ferment_draw "]) expect(body, t).toContain(t);
  });

  it("ตัวส่งต่อเดิมแปลง prefix ครบทุกชนิด — ผู้เรียกเก่าไม่ต้องแก้", () => {
    const sales = latestDef("fn_next_sales_doc");
    for (const [p, t] of [["QU", "sales_qu"], ["ORD", "sales_ord"], ["INV", "sales_inv"], ["TAX", "sales_tax"], ["RC", "sales_rcpt"]]) {
      expect(sales).toMatch(new RegExp(`when\\s+'${p}'\\s+then\\s+'${t}'`));
    }
    const bar = latestDef("fn_bar_next_doc");
    expect(bar).toMatch(/when\s+'B'\s+then\s+'bar_bill'/);
    expect(bar).toMatch(/when\s+'BR'\s+then\s+'bar_rcpt'/);
  });

  it("ทุกชนิดมีชื่อไทยไม่ซ้ำกัน (Record บังคับความครบอยู่แล้ว — ข้อนี้กันชื่อซ้ำ · D84)", () => {
    const labels = DOC_TYPES.map((t) => DOC_TYPE_INFO[t].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("ทุกชนิดอยู่ในกลุ่มบนหน้าตั้งค่าพอดีกลุ่มเดียว — ตกกลุ่ม = ตั้งค่าไม่ได้", () => {
    const all = DOC_GROUPS.flatMap((g) => g.types);
    expect([...all].sort()).toEqual([...DOC_TYPES].sort());
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("เฟส 0 — ประกอบเลขด้วยวันที่ไทย ไม่ใช่ current_date (UTC)", () => {
  // ★ ตรวจเฉพาะ "การประกอบเลข" — `fn_save_transfer` ยังมี coalesce(p_date, current_date)
  //   เป็นวันที่ของรายการ ซึ่งจงใจไม่แตะในเฟส 0 (เป็นงานเฟส 3 ลงย้อนหลัง)
  for (const fn of ["next_tx_id", "fn_save_transfer", "fn_next_doc_no", "fn_suggest_doc_no", "fn_doc_numbering_save"]) {
    it(`${fn} ไม่ใช้ current_date ประกอบเลข`, () => {
      expect(latestDef(fn)).not.toMatch(/to_char\(\s*current_date/i);
    });
  }
  for (const fn of ["fn_next_doc_no", "fn_suggest_doc_no"]) {
    it(`${fn} ใช้วันนี้ตามเวลาไทยเมื่อไม่ได้ส่งวันที่มา`, () => {
      expect(latestDef(fn)).toMatch(
        /coalesce\(\s*p_date\s*,\s*\(now\(\)\s+at\s+time\s+zone\s+'Asia\/Bangkok'\)::date\)/i,
      );
    });
  }
});

describe("เฟส 2 — กฎ 'มากกว่าเลขที่มีอยู่เสมอ' + ตัวเสนอเลข (0077)", () => {
  it("🚨 ตัวออกเลขและพรีวิวคิดจากเลขมากสุดที่มีอยู่ (ไม่เติมช่องว่าง)", () => {
    expect(latestDef("fn_next_doc_no")).toMatch(/fn_doc_max_n\(/);
    expect(latestDef("fn_doc_peek")).toMatch(/fn_doc_max_n\(/);
    expect(latestDef("fn_suggest_doc_no")).toMatch(/fn_doc_peek\(/);
  });

  it("🚨 บันทึก 'เลขถัดไป' ต้องบล็อกเลขที่ไม่มากกว่าเลขล่าสุด", () => {
    expect(latestDef("fn_doc_numbering_save")).toMatch(/p_next\s*<=\s*v_last/);
    expect(latestDef("fn_doc_numbering_preview")).toMatch(/p_next\s*<=\s*v_last/);
  });

  it("🚨 0079 — 'เลขล่าสุด' ต้องรวมตัวนับ ไม่ใช่แค่เลขในเอกสาร (เลขที่แจกแล้วแต่บันทึกไม่สำเร็จ)", () => {
    // 0077 ใช้ fn_doc_max_n อย่างเดียว → ตั้งเลขถัดไปทับเลขที่แจกไปแล้วได้ (test:tenant จับได้)
    expect(latestDef("fn_doc_last_n")).toMatch(/greatest\(\s*coalesce\(\s*v_cnt/);
    expect(latestDef("fn_doc_numbering_save")).toMatch(/v_last\s*:=\s*fn_doc_last_n\(/);
    expect(latestDef("fn_doc_numbering_preview")).toMatch(/v_last\s*:=\s*fn_doc_last_n\(/);
    expect(latestDef("fn_doc_peek")).toMatch(/greatest\(\s*coalesce\(\s*v_cnt/);
  });

  it("🚨 0079 — เปลี่ยนรูปแบบกลางรอบต้องยกตัวนับเดิมไปด้วย (0077 ตัดทิ้งแล้วเลขเริ่ม 1 ใหม่)", () => {
    const save = latestDef("fn_doc_numbering_save");
    expect(save).toMatch(/elsif\s+v_key\s*<>\s*v_old_key/);
    expect(save).toMatch(/on conflict \(tenant_id, key\) do nothing/);
  });

  it("regex หาเลขล่าสุดครอบทุกส่วนวันที่ — ตกตัวไหน = เลขรันเริ่ม 1 ใหม่ทุกครั้ง", () => {
    const body = latestDef("fn_doc_no_regex");
    for (const d of DATE_FMTS.filter((x) => x !== "none")) expect(body, d).toContain(`'${d}'`);
  });

  it("50ทวิ (บัญชี + เงินเดือน) · batch · ล็อต ขอเลขผ่าน fn_suggest_doc_no", () => {
    expect(tsCode("app/(app)/accounting/actions.ts")).toMatch(/fn_suggest_doc_no", \{ p_type: "acct_wht"/);
    expect(tsCode("app/(app)/payroll/actions.ts")).toMatch(/fn_suggest_doc_no", \{ p_type: "acct_wht"/);
    const prod = tsCode("app/(app)/production/data.ts");
    expect(prod).toMatch(/suggestProdNo\("prod_batch"/);
    expect(prod).toMatch(/suggestProdNo\("prod_lot"/);
  });

  it("🚨 แอปเลิกหาเลขถัดไปเองฝั่ง TS แล้ว — ไม่งั้นรูปแบบที่ตั้งไว้ไม่มีผล (หน้าจอบอกอย่าง ทำอีกอย่าง)", () => {
    for (const p of ["app/(app)/accounting/actions.ts", "app/(app)/payroll/actions.ts",
                     "app/(app)/production/data.ts", "app/(app)/production/actions.ts"]) {
      expect(tsCode(p), p).not.toMatch(/\bnext(WhtDocNo|BatchNumber|LotNumber)\(/);
    }
  });
});

describe("ฝั่งขาย: ชุด RC (ข้อ 4) · เลขตามวันที่เอกสาร + เลขที่กรอกเอง (เฟส 3)", () => {
  const s = () => tsCode("app/(app)/sales/actions.ts");

  it("ใบเสร็จผู้ไม่จด VAT ขอเลขชุด sales_rcpt (RC) ไม่ใช่ sales_inv", () => {
    expect(s()).toMatch(/gen\.rcptNo1\s*=\s*manualPay\s*\|\|\s*\(await\s+nextDoc\("sales_rcpt"\)\)/);
    expect(s()).toMatch(/gen\.rcptNo2\s*=\s*manualPay\s*\|\|\s*\(await\s+nextDoc\("sales_rcpt"\)\)/);
  });

  it("🚨 ขอเลขจุดเดียว · อ่าน error · และเป็นเลขของ **วันที่บนเอกสาร** (ไม่ใช่วันที่กดบันทึก)", () => {
    expect([...s().matchAll(/rpc\("fn_next_doc_no"/g)].length).toBe(1);
    expect(s()).not.toMatch(/rpc\("fn_next_sales_doc"/);
    expect(s()).toMatch(
      /const \{ data, error \} = await supabase\.rpc\("fn_next_doc_no", \{ p_type: type, p_entity: null, p_date: docDate \}\)/,
    );
  });

  it("🚨 วันที่เดียวกันไปถึงบัญชี — processOrder ได้ docDate ที่ตัดสินแล้ว ไม่ตกไปใช้วันที่ UTC ของ server", () => {
    expect(s()).toMatch(/processOrder\(order, action, \{ \.\.\.payload, docDate \}/);
  });

  it("🚨 ฟอร์ม ภส. ได้วันที่ส่งของ — ทั้งหน้าคลังและขายหน้าร้านส่ง p_date", () => {
    const calls = [...s().matchAll(/rpc\("fn_confirm_fulfillment", \{[^}]*\}/g)].map((m) => m[0]);
    expect(calls.length).toBe(2);
    for (const c of calls) expect(c).toMatch(/p_date:/);
  });

  it("fn_confirm_fulfillment ใน SQL ลงวันที่จากพารามิเตอร์ ไม่ใช่ current_date", () => {
    const body = latestDef("fn_confirm_fulfillment");
    expect(body).toMatch(/p_date date default null/);
    expect(body).not.toMatch(/\bcurrent_date\b/);
    expect(body).toMatch(/v_ship\s*>\s*v_today/); // ห้ามล่วงหน้า
  });
});

describe("allowedResets — ส่วนวันที่ต้องละเอียดพอจะแยกรอบ (ฝาแฝดของ fn_doc_cfg_error)", () => {
  it("ไม่ใส่วันที่ = รันต่อไปเรื่อย ๆ ได้อย่างเดียว", () => {
    expect(allowedResets("none")).toEqual(["never"]);
  });
  it("มีแค่ปี = ทุกปี หรือไม่เริ่มใหม่", () => {
    expect(allowedResets("YY")).toEqual(["year", "never"]);
    expect(allowedResets("YYYY")).toEqual(["year", "never"]);
  });
  it("ปี+เดือน = ไม่มีทุกวัน", () => {
    expect(allowedResets("YYMM")).toEqual(["month", "year", "never"]);
  });
  it("ครบวัน = เลือกได้ทุกแบบ", () => {
    expect(allowedResets("YYMMDD")).toEqual(["day", "month", "year", "never"]);
    expect(allowedResets("YYYYMMDD")).toEqual(["day", "month", "year", "never"]);
  });
  it("ทุกส่วนวันที่มี 'never' เสมอ — ไม่มีทางตั้งแล้วไม่มีตัวเลือกเหลือ", () => {
    for (const d of DATE_FMTS) expect(allowedResets(d)).toContain("never");
  });
  it("fitReset เลื่อนไปรอบที่ละเอียดที่สุดที่ยังใช้ได้ · ใช้ได้อยู่แล้ว = คงเดิม", () => {
    const base = toCfg({ prefix: "INV", date_fmt: "YYMMDD", reset: "day" });
    expect(fitReset({ ...base, date_fmt: "YYMM" }).reset).toBe("month");
    expect(fitReset({ ...base, date_fmt: "YY" }).reset).toBe("year");
    expect(fitReset({ ...base, date_fmt: "none" }).reset).toBe("never");
    expect(fitReset({ ...base, reset: "year" }).reset).toBe("year");
  });
});

describe("toCfg — ค่าแปลกจาก DB ไม่ throw", () => {
  it("ค่าที่ไม่รู้จัก = ค่าปริยายที่ปลอดภัย", () => {
    const c = toCfg({ prefix: null, date_fmt: "XX", era: "??", reset: 5, digits: "abc", sep: "#", num_first: "yes" });
    expect(c).toEqual({ prefix: "", date_fmt: "YYMMDD", era: "ce", reset: "day", digits: 3, sep: "-", num_first: false });
  });
});
