/**
 * lib/connector/cardView — ข้อมูลและการตัดสินของ "การ์ดตรวจบิล" ใน Claude (MCP App · D141)
 *
 * ★ ไฟล์นี้ใช้ 2 ฝั่ง: server ประกอบ CardData · การ์ด (เบราว์เซอร์ใน Claude) ตัดสินปุ่ม/ข้อความ
 *   ⇒ ห้าม import ของฝั่ง server (supabase, server-only) และห้ามคิดเงิน — ตัวเลขทุกตัวมาจาก server
 * ★ ประโยคบนการ์ดตัดสินที่นี่ (มีเทสคุม) ไม่ใช่ในตัวการ์ด (D84/D91)
 */
import type { BillDraft, Computed, Mismatch } from "./bill";

/** คู่ค้าของบิล: มีในทะเบียน · ใหม่ (จะเพิ่มตอนบันทึก) · ไม่ผูก */
export type CardContact =
  | { kind: "existing"; contact_id: string; name: string; tax_id: string | null }
  | { kind: "new"; name: string; tax_id: string | null; branch: string | null; address: string | null }
  | { kind: "none" };

/** ข้อมูลที่ preview_bill / recalc_bill ส่งให้การ์ด (structuredContent) */
export type CardData = {
  v: 1;
  tenant_slug: string;
  tenant_name: string;
  /** ค่าปัจจุบันของบิล (+ ธงยืนยันว่าไม่ซ้ำ ที่ save_bill รับ) */
  draft: BillDraft & { confirm_not_duplicate?: boolean };
  /** กิจการทั้งหมดที่ผู้ใช้เห็น — การ์ดโชว์ตัวเลือกเมื่อมีมากกว่า 1 */
  entities: { entity_id: string; name: string; is_vat: boolean }[];
  /** หมวดที่เสนอให้กด (ตัวที่เลือกอยู่ + ที่คู่ค้าเจ้านี้เคยใช้ · สูงสุด CATEGORY_CHIPS) */
  category_chips: string[];
  /** หมวดทั้งหมดของประเภทนี้ (ปุ่ม อื่น ๆ กางในการ์ด ไม่ต้องย้อนไปแชท) */
  categories_all: string[];
  /** บัญชีเงินของกิจการที่เลือก */
  accounts: string[];
  /** งานที่เคยใช้ (งานของคู่ค้าเจ้านี้ก่อน · jobs.rankJobs) */
  jobs: string[];
  /** กิจการนี้เคยใช้งาน ⇒ ทุกแถวต้องเลือกงาน หรือ ไม่ระบุงาน */
  jobs_required: boolean;
  contact: CardContact;
  /** มี VAT จริงไหม (บิลมี VAT และกิจการจด VAT) */
  vat_effective: boolean;
  computed: Computed | null;
  mismatch: Mismatch | null;
  used_bill_amounts: boolean;
  /** error ที่ไม่ใช่เรื่องยอดไม่ตรง (เช่น ยังไม่เลือกบัญชี) */
  errors: string[];
  warnings: string[];
  possible_duplicates: { tx_id: string; transaction_date: string; net_amount: number; tax_invoice_no: string | null }[];
};

export const CATEGORY_CHIPS = 3;
/** การ์ดย่อโชว์รายการได้เท่านี้แถว ที่เหลือบอกจำนวน (ข้อจำกัดการ์ดในแชท: ห้ามเลื่อนในตัว) */
export const INLINE_ITEMS = 3;

/**
 * หมวดที่เสนอเป็นปุ่ม — ตัวที่เลือกอยู่ก่อน แล้วตามด้วยหมวดที่คู่ค้าเจ้านี้เคยใช้ (ใหม่สุดก่อน)
 * 🚨 เฉพาะหมวดที่มีอยู่ในผังบัญชีจริง (save_bill ปฏิเสธหมวดนอกผังอยู่แล้ว — โชว์ไปก็กดแล้วล้ม)
 */
export function categoryChips(current: string, history: string[], all: readonly string[]): string[] {
  const ok = new Set(all);
  const out: string[] = [];
  for (const c of [current, ...history].map((x) => String(x ?? "").trim())) {
    if (c && ok.has(c) && !out.includes(c)) out.push(c);
    if (out.length >= CATEGORY_CHIPS) break;
  }
  return out;
}

const baht = (n: number) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type PrimaryKind = "save" | "confirm_dup" | "switch_mode" | "use_bill_amounts" | "ask_claude" | "fix";

export type Primary = {
  kind: PrimaryKind;
  label: string;
  /** บรรทัดอธิบายใต้ปุ่ม (ทุกครั้งที่ปุ่มไม่ใช่ "บันทึก" ต้องบอกว่าทำไม · D83) */
  hint: string;
  /** ข้อความที่ส่งเข้าแชทเมื่อกด (เฉพาะ ask_claude) */
  message?: string;
};

/**
 * ปุ่มหลักของการ์ด — 3 ขั้นของยอดไม่ตรง (สลับโหมด → ยอดตามบิล ≤ 1 บาท → ให้ Claude อ่านใหม่) + ด่านอื่น
 * 🚨 ลำดับสำคัญ: ด่านที่ยังเลือกไม่ครบมาก่อนเรื่องยอด (ยอดอาจเปลี่ยนเมื่อเลือกกิจการ) · บิลซ้ำมาหลังสุด
 */
export function primaryAction(d: CardData): Primary {
  if (d.errors.length) {
    return { kind: "fix", label: "บันทึก", hint: d.errors[0] };
  }
  const m = d.mismatch;
  if (m && !d.used_bill_amounts) {
    if (m.altPriceMode) {
      const to = m.altPriceMode === "in" ? "รวม VAT" : "ไม่รวม VAT";
      return {
        kind: "switch_mode",
        label: `นับราคาเป็น${to}`,
        hint: `คิดได้ ${baht(m.computed)} บนบิล ${baht(m.onBill)} — ถ้าราคาบนบิลเป็นราคา${to} จะตรงพอดี`,
      };
    }
    if (m.canUseBillAmounts) {
      // บิลมี VAT ต้องมียอดก่อน VAT + VAT ที่อ่านจากบิล — ไม่มีให้ Claude อ่านเพิ่ม (การ์ดไม่เดาตัวเลข)
      if (d.vat_effective && (d.draft.bill_before_vat == null || d.draft.bill_vat == null)) {
        return {
          kind: "ask_claude",
          label: "ให้ Claude อ่านยอดก่อน VAT",
          hint: `ต่าง ${baht(Math.abs(m.diff))} มักเกิดจากผู้ขายปัดเศษ — ต้องใช้ยอดก่อน VAT และ VAT ที่พิมพ์บนบิล`,
          message: "อ่านยอดก่อน VAT และ VAT ที่พิมพ์บนบิลนี้ แล้วเปิดการ์ดใหม่พร้อม bill_before_vat และ bill_vat",
        };
      }
      return {
        kind: "use_bill_amounts",
        label: "ใช้ยอดตามบิล",
        hint: `คิดได้ ${baht(m.computed)} บนบิล ${baht(m.onBill)} ต่าง ${baht(Math.abs(m.diff))} — มักเกิดจากผู้ขายปัดเศษคนละวิธี`,
      };
    }
    const n = m.suspectLines.length;
    return {
      kind: "ask_claude",
      label: "ให้ Claude อ่านใหม่",
      hint: `ไม่ตรงบิล ต่าง ${baht(Math.abs(m.diff))}${n ? ` — เช็คแถวที่ไฮไลต์ (${n} แถว)` : ""} หรือแก้รายการเอง`,
      message: "ยอดไม่ตรงกับบิล ช่วยอ่านรายการ จำนวน และราคาบนบิลใหม่อีกครั้ง",
    };
  }
  if (d.possible_duplicates.length && !d.draft.confirm_not_duplicate) {
    const x = d.possible_duplicates[0];
    return {
      kind: "confirm_dup",
      label: "เป็นบิลใหม่ บันทึกเลย",
      hint: `มีบิลหน้าตาเหมือนกันแล้ว ${x.tx_id} (${x.transaction_date} · ${baht(x.net_amount)}) — กดเฉพาะเมื่อแน่ใจว่าไม่ซ้ำ`,
    };
  }
  return { kind: "save", label: "บันทึก", hint: "" };
}

/** แถวที่ต้องไฮไลต์ในรายการ (ขั้น 3) */
export function suspectSet(d: CardData): Set<number> {
  return new Set(d.mismatch && !d.mismatch.altPriceMode && !d.mismatch.canUseBillAmounts ? d.mismatch.suspectLines : []);
}

/** คำเตือนตอนกด "แก้ยอดบนบิล" — ต้องแก้ตามกระดาษ ไม่ใช่แก้ให้ตรง (ผู้ใช้ตัดสิน D141) */
export const EDIT_TOTAL_WARN =
  "แก้ช่องนี้เฉพาะเมื่อ Claude อ่านยอดรวมบนบิลผิด — ใส่ตัวเลขที่พิมพ์บนกระดาษเท่านั้น ห้ามใส่ยอดที่ทำให้ตรงกับที่ระบบคิด";

/** ข้อความที่การ์ดบอก Claude หลังบันทึกสำเร็จ (กัน Claude เรียก save_bill ซ้ำ) */
export function savedContextText(txId: string): string {
  return `ผู้ใช้กดบันทึกบิลในการ์ดแล้ว เลขที่ ${txId} — ไม่ต้องเรียก save_bill ซ้ำ`;
}
