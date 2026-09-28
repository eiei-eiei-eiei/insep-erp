/**
 * lib/shared/docNumbering — รูปแบบเลขเอกสารที่ผู้ใช้ตั้งเอง (D100 · migration 0076)
 *
 * 🚨 **การจัดรูปเลขไม่อยู่ที่นี่** — อยู่ใน SQL `fn_doc_no_format` ที่เดียว
 *    หน้าตั้งค่าขอตัวอย่างเลขถัดไปจาก RPC (`fn_doc_numbering_preview`) ที่เรียกตัวเดียวกับตอนออกเลขจริง
 *    ⇒ ตัวอย่างบนจอกับเลขที่ออกจริงไม่มีทางหลุดจากกัน (พรีวิวที่ไม่ตรงของจริงแย่กว่าไม่มีพรีวิว · D96)
 *
 * ไฟล์นี้มีแค่ของที่หน้าจอต้องใช้: รายชื่อชนิดเอกสาร · ป้ายภาษาไทย · และกฎว่า
 * "ส่วนวันที่แบบนี้ เลือกเริ่มนับใหม่แบบไหนได้" (ใช้ปิดตัวเลือกบนจอ)
 *
 * 🚨 ฝาแฝดฝั่ง SQL — ต้องตรงกันเสมอ:
 *    · DOC_TYPES      ↔ `fn_doc_types()` + `fn_doc_default()` + `fn_doc_no_taken()` (docNumberingSql.test.ts)
 *    · allowedResets  ↔ `fn_doc_cfg_error()` (test:tenant เทียบทุกคู่ · SQL คือตัวตัดสินจริง)
 */
import type { ModuleKey } from "./workspaces";

/** ชนิดเอกสาร — ★ ลำดับนี้คือลำดับที่แสดงบนหน้าตั้งค่า และต้องตรงกับ `fn_doc_types()` */
export const DOC_TYPES = [
  "sales_qu",
  "sales_ord",
  "sales_inv",
  "sales_tax",
  "sales_rcpt",
  "bar_bill",
  "bar_rcpt",
  // เฟส 2 (0077) — เลขที่ "เสนอให้ในฟอร์ม แล้วผู้ใช้แก้ได้" (fn_suggest_doc_no ไม่กินเลข)
  "acct_wht",
  "prod_batch",
  "prod_lot",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/**
 * ★ `Record<DocType,…>` — เพิ่มชนิดใหม่แล้วลืมใส่ชื่อ = build ไม่ผ่าน (บทเรียน D84)
 */
export const DOC_TYPE_INFO: Record<DocType, { label: string; modules: ModuleKey[]; hint?: string }> = {
  sales_qu: { label: "ใบเสนอราคา", modules: ["sales"] },
  sales_ord: { label: "เลขออเดอร์", modules: ["sales"], hint: "ออกคู่กับใบเสนอราคาทุกใบ" },
  sales_inv: { label: "ใบแจ้งหนี้", modules: ["sales"], hint: "รวมใบแจ้งหนี้ค่ามัดจำ" },
  sales_tax: { label: "ใบกำกับภาษี", modules: ["sales"], hint: "ใช้เมื่อกิจการที่ออกเอกสารขายจด VAT" },
  sales_rcpt: {
    label: "ใบเสร็จรับเงิน (กิจการไม่จด VAT)",
    modules: ["sales"],
    hint: "ใช้แทนใบกำกับภาษีเมื่อกิจการที่ออกเอกสารขายไม่ได้จด VAT",
  },
  bar_bill: { label: "เลขบิลบาร์", modules: ["bar"] },
  bar_rcpt: {
    label: "ใบกำกับภาษีอย่างย่อ / ใบเสร็จ (บาร์)",
    modules: ["bar"],
    hint: "จด VAT = ใบกำกับภาษีอย่างย่อ ออกทุกบิล · ไม่จด VAT = ใบเสร็จ ออกเมื่อลูกค้าขอ",
  },
  acct_wht: {
    label: "หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)",
    modules: ["accounting", "payroll"],
    hint: "ใบของคู่ค้า (บัญชี) และของพนักงาน (เงินเดือน) ใช้เลขชุดเดียวกัน · เลขในฟอร์มยังแก้เองได้",
  },
  prod_batch: {
    label: "เลข batch",
    modules: ["production"],
    hint: "ใช้ร่วมทุกกิจการ · เลขในฟอร์มลงหมักยังพิมพ์เองได้",
  },
  prod_lot: {
    label: "เลขล็อตกลั่นซ้ำ",
    modules: ["production"],
    hint: "ใช้ร่วมทุกกิจการ · เลขในฟอร์มยังแก้เองได้",
  },
};

/**
 * กลุ่มบนหน้า ตั้งค่า → เลขเอกสาร
 * 🚨 ทุกชนิดใน DOC_TYPES ต้องอยู่ในกลุ่มเดียวพอดี (docNumberingSql.test.ts ตรวจ) — ตกกลุ่ม = ตั้งค่าไม่ได้
 * perEntity = เลขแยกตามกิจการ (ตัวเลือกกิจการบนหน้ามีผล) · note: `{กิจการ}` = ชื่อกิจการของแถว
 */
export const DOC_GROUPS: { title: string; types: DocType[]; perEntity: boolean; note?: string }[] = [
  {
    title: "เอกสารขาย",
    types: ["sales_qu", "sales_ord", "sales_inv", "sales_tax", "sales_rcpt"],
    perEntity: false,
    note: "ออกในนามกิจการ {กิจการ} — เปลี่ยนได้ที่ ตั้งค่า → กิจการ",
  },
  { title: "บาร์", types: ["bar_bill", "bar_rcpt"], perEntity: true },
  { title: "บัญชี / เงินเดือน", types: ["acct_wht"], perEntity: true },
  {
    title: "ผลิต",
    types: ["prod_batch", "prod_lot"],
    perEntity: false,
    note: "เลข batch และล็อตใช้ร่วมกันทุกกิจการ (ไม่ซ้ำกันทั้งระบบ)",
  },
];

export const DATE_FMTS = ["none", "YY", "YYYY", "YYMM", "YYYYMM", "YYMMDD", "YYYYMMDD"] as const;
export type DateFmt = (typeof DATE_FMTS)[number];
export const DATE_FMT_LABEL: Record<DateFmt, string> = {
  none: "ไม่ใส่วันที่",
  YY: "ปี 2 หลัก",
  YYYY: "ปี 4 หลัก",
  YYMM: "ปี 2 หลัก + เดือน",
  YYYYMM: "ปี 4 หลัก + เดือน",
  YYMMDD: "ปี 2 หลัก + เดือน + วัน",
  YYYYMMDD: "ปี 4 หลัก + เดือน + วัน",
};

export const RESETS = ["day", "month", "year", "never"] as const;
export type Reset = (typeof RESETS)[number];
export const RESET_LABEL: Record<Reset, string> = {
  day: "ทุกวัน",
  month: "ทุกเดือน",
  year: "ทุกปี",
  never: "ไม่เริ่มใหม่ (รันต่อไปเรื่อย ๆ)",
};

export const ERAS = ["ce", "be"] as const;
export type Era = (typeof ERAS)[number];
export const ERA_LABEL: Record<Era, string> = { ce: "ค.ศ.", be: "พ.ศ." };

export const SEPS = ["-", "/", ".", ""] as const;
export type Sep = (typeof SEPS)[number];
export const SEP_LABEL: Record<Sep, string> = { "-": "ขีด  -", "/": "ทับ  /", ".": "จุด  .", "": "ไม่มีตัวคั่น" };

/** รูปแบบ — ชื่อคีย์ตรงกับ JSON ฝั่ง SQL เป๊ะ (ไม่แปลงชื่อไปมา = ไม่มีจุดให้หลุด) */
export type DocNumberCfg = {
  prefix: string;
  date_fmt: DateFmt;
  era: Era;
  reset: Reset;
  digits: number;
  sep: Sep;
  num_first: boolean;
};

/**
 * เริ่มนับใหม่แบบไหนได้บ้าง เมื่อในเลขมีวันที่แบบนี้
 *
 * 🚨 กฎ: ส่วนวันที่ในเลขต้องละเอียดพอจะแยกรอบออกจากกัน — เริ่มนับใหม่ทุกวันแต่ในเลขไม่มีวัน
 *    = เลขของพรุ่งนี้ซ้ำกับวันนี้ทุกตัว · ตัวตัดสินจริงคือ `fn_doc_cfg_error` ฝั่ง SQL
 */
export function allowedResets(df: DateFmt): Reset[] {
  const hasDay = df === "YYMMDD" || df === "YYYYMMDD";
  const hasMonth = hasDay || df === "YYMM" || df === "YYYYMM";
  const hasYear = df !== "none";
  return RESETS.filter(
    (r) => r === "never" || (r === "year" && hasYear) || (r === "month" && hasMonth) || (r === "day" && hasDay),
  );
}

/**
 * เปลี่ยนส่วนวันที่แล้ว "เริ่มนับใหม่" เดิมใช้ไม่ได้ → เลื่อนไปรอบที่ละเอียดที่สุดที่ยังใช้ได้
 * (เช่น วัน → ปี เมื่อเหลือแค่ปีในเลข) · ใช้ได้อยู่แล้ว = คงเดิม
 */
export function fitReset(cfg: DocNumberCfg): DocNumberCfg {
  const ok = allowedResets(cfg.date_fmt);
  return ok.includes(cfg.reset) ? cfg : { ...cfg, reset: ok[0] };
}

/** แถวจาก `fn_doc_numbering_list` */
export type DocNumberingRow = {
  doc_type: DocType;
  entity_id: string | null;
  cfg: DocNumberCfg & { configured: boolean; updated_at?: string };
  next_no: string;
  next_n: number;
  skipped: number;
};

/** ผลจาก `fn_doc_numbering_preview` */
export type DocNumberPreview =
  | { ok: false; error: string }
  | {
      ok: true;
      next_no: string;
      next_n: number;
      skipped: number;
      /** true = "เลขถัดไป" ที่กรอกชนเลขที่มีอยู่ หรือไม่มากกว่าเลขล่าสุดของรอบนี้ (0077) */
      taken: boolean;
      /** เลขรันที่มากที่สุดที่ออกไปแล้วในรอบนี้ (0 = ยังไม่มี) */
      last_n?: number;
    };

/** แปลงค่าจาก DB ให้เป็นชนิดที่หน้าจอใช้ (ค่าแปลก = ค่าปริยายที่ปลอดภัย ไม่ throw) */
export function toCfg(raw: Partial<Record<keyof DocNumberCfg, unknown>>): DocNumberCfg {
  const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T =>
    (list as readonly string[]).includes(String(v)) ? (v as T) : d;
  return {
    prefix: String(raw.prefix ?? ""),
    date_fmt: pick(DATE_FMTS, raw.date_fmt, "YYMMDD"),
    era: pick(ERAS, raw.era, "ce"),
    reset: pick(RESETS, raw.reset, "day"),
    digits: Number(raw.digits) || 3,
    sep: pick(SEPS, raw.sep, "-"),
    num_first: raw.num_first === true,
  };
}

/** ตัวอักษรนำหน้าที่ยอมรับ — ฝาแฝดของ regex ใน `fn_doc_cfg_error` (ใช้เตือนก่อนส่ง) */
export const PREFIX_RE = /^[A-Za-z0-9ก-๙._/-]{0,12}$/;
