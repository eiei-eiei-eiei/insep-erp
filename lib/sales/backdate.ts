/**
 * lib/sales/backdate — ลงเอกสารขายย้อนหลัง (D100 เฟส 3)
 *
 * เคสจริงของผู้ใช้: ระบบล่มในวันที่ขาย → ออกใบกระดาษไปก่อน → มาลงระบบทีหลัง
 * ต้องได้ 3 อย่างตรงกันทั้งหมด:
 *   1. **เลขเอกสาร** เป็นของวันที่บนเอกสาร (ไม่ใช่วันที่กดบันทึก) — หรือเลขที่เขียนบนกระดาษไปแล้ว
 *   2. **บัญชี / ภพ.30** ลงวันนั้น (ของเดิมทำอยู่แล้ว: transaction_date = tax_invoice_date = docDate)
 *   3. **ฟอร์ม ภส.** (log_product.doc_date) เป็นวันที่ของออกจริง — เดิมตายตัวที่ current_date (UTC)
 *   🚨 แก้แค่ข้อ 1 = ใบกำกับลงวันที่ 25 แต่ฟอร์มสรรพสามิตบอกของออกวันที่ 28 = สองใบขัดกันเอง
 *
 * ★ ทุกประโยคที่ขึ้นจอตัดสินที่นี่ (มีเทสคุม) ไม่ใช่ในคอมโพเนนต์ (D84/D91)
 */
import { neededSerials, formatThaiDate, type OrderAction, type OrderState } from "./orders";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' ที่เป็นวันจริง (2026-02-30 = ไม่จริง) */
export function isRealISODate(s: string | null | undefined): boolean {
  if (!s || !ISO.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * วันที่เอกสาร/วันที่รับเงิน — คืนข้อความ error (บันทึกไม่ได้) หรือ null
 * ★ ไม่ส่งมา = วันนี้ (พฤติกรรมเดิม) · ★ ไม่บล็อกวันล่วงหน้า (ใบแจ้งหนี้ลงวันวางบิลล่วงหน้าได้ — ของเดิม)
 */
export function docDateError(docDate: string | undefined): string | null {
  if (docDate === undefined || docDate === "") return null;
  return isRealISODate(docDate) ? null : "วันที่เอกสารไม่ถูกต้อง";
}

/**
 * วันที่ส่งของ — ขึ้นฟอร์ม ภส. เป็นวันที่จ่ายสุราออกจากโรง
 * 🚨 **ห้ามล่วงหน้า** — ฟอร์มบันทึกของที่ออกไปแล้วเท่านั้น (ลงล่วงหน้า = ยอดคงเหลือบนฟอร์มวันนี้ผิด)
 */
export function shipDateError(shipDate: string | undefined, today: string): string | null {
  return pastDateError(shipDate, today, "วันที่ส่งของ");
}

/** วันที่ขายหน้าร้าน — ขายแล้วส่งของทันที ⇒ กติกาเดียวกับวันที่ส่งของ */
export function saleDateError(saleDate: string | undefined, today: string): string | null {
  return pastDateError(saleDate, today, "วันที่ขาย");
}

function pastDateError(d: string | undefined, today: string, label: string): string | null {
  if (d === undefined || d === "") return null;
  if (!isRealISODate(d)) return `${label}ไม่ถูกต้อง`;
  if (d > today) return `${label}เลยวันนี้ไม่ได้ — ฟอร์ม ภส. บันทึกเฉพาะของที่ออกไปแล้ว`;
  return null;
}

/**
 * action นี้ลงบัญชีรายรับ (RECEIVE_REVENUE) ไหม — แหล่งเดียว ใช้ทั้งด่านฝั่ง server และประโยคบนจอ
 * ★ ออกใบแจ้งหนี้ / ส่งคลังแบบเครดิต **ยังไม่ลงบัญชี** (ลงตอนรับเงินจริง · D45)
 */
export function actionPostsRevenue(action: OrderAction): boolean {
  return (
    action === "DEPOSIT_AND_SEND" || action === "FULL_PAYMENT_AND_SEND" ||
    action === "FULL_PAYMENT_LATER" || action === "PAY_BALANCE"
  );
}

/**
 * คำอธิบายสีเหลืองใต้ช่องวันที่ของเอกสาร — วันนี้ = ไม่มีอะไรต้องบอก
 * @param postsRevenue ขั้นนี้ลงบัญชีไหม (`actionPostsRevenue`)
 * 🪤 เทสเบราว์เซอร์เจอ: เดิมบอก "บัญชี และ ภพ.30 จะเป็นของวันนั้น" ทุก action รวมขั้นออกใบแจ้งหนี้
 *    ที่ยังไม่ลงบัญชีเลย — ประโยคบอกเกินสิ่งที่ปุ่มทำ (ตระกูล D91/0059)
 */
export function docDateNote(docDate: string, today: string, postsRevenue = true): string | null {
  if (!docDate || docDate === today || !isRealISODate(docDate)) return null;
  const d = formatThaiDate(docDate);
  if (docDate > today) {
    return postsRevenue
      ? `ลงวันที่ล่วงหน้า (${d}) — เลขเอกสารและบัญชีจะเป็นของวันนั้น`
      : `ลงวันที่ล่วงหน้า (${d}) — เลขเอกสารจะเป็นของวันนั้น · ขั้นนี้ยังไม่ลงบัญชี`;
  }
  return postsRevenue
    ? `ลงย้อนหลังเป็นวันที่ ${d} — เลขเอกสาร บัญชี และ ภพ.30 จะเป็นของวันนั้น ` +
        `(เลขต่อจากเลขล่าสุดของรอบนั้น) · ถ้าเดือนนั้นยื่นแบบไปแล้ว ต้องยื่นเพิ่มเติม`
    : `ลงย้อนหลังเป็นวันที่ ${d} — เลขเอกสารจะเป็นของวันนั้น (เลขต่อจากเลขล่าสุดของรอบนั้น) ` +
        `· ขั้นนี้ยังไม่ลงบัญชี (ลงตอนรับเงิน)`;
}

/** คำอธิบายใต้ช่องวันที่ส่งของ */
export function shipDateNote(shipDate: string, today: string): string | null {
  if (!shipDate || shipDate === today || !isRealISODate(shipDate) || shipDate > today) return null;
  return (
    `ส่งของย้อนหลังเป็นวันที่ ${formatThaiDate(shipDate)} — ฟอร์ม ภส. จะบันทึกการจ่ายสุราวันนั้น ` +
    `· ถ้าปิดเดือนสรรพสามิตเดือนนั้นไปแล้ว ต้องกลับไปตรวจและยื่นใหม่`
  );
}

/** คำอธิบายใต้ช่องวันที่ขายหน้าร้าน — ใบเดียวครบ 3 อย่าง (ใบเสร็จ · บัญชี · ภส.) */
export function saleDateNote(saleDate: string, today: string): string | null {
  if (!saleDate || saleDate === today || !isRealISODate(saleDate) || saleDate > today) return null;
  return (
    `ขายย้อนหลังเป็นวันที่ ${formatThaiDate(saleDate)} — เลขใบเสร็จ บัญชี/ภพ.30 และฟอร์ม ภส. จะเป็นของวันนั้น ` +
    `· ถ้าเดือนนั้นยื่นแบบหรือปิดเดือนสรรพสามิตไปแล้ว ต้องกลับไปตรวจและยื่นเพิ่มเติม`
  );
}

// ── เลขเอกสารที่กรอกเอง (ใบกระดาษที่ออกไปแล้วช่วงระบบล่ม) ──────────────────────────

/**
 * action นี้จะออกเลขอะไรบ้าง — ใช้ตัดสินว่าจะโชว์ช่องกรอกเลขเองช่องไหน
 *   inv = ใบแจ้งหนี้ (รวมใบแจ้งหนี้มัดจำ) · pay = ใบกำกับภาษี/ใบเสร็จของการรับเงินครั้งนี้
 * ★ หน้าจอไม่รู้ว่ากิจการจด VAT ไหม → ดูทั้งสองโลกแล้วเอา "ทั้งคู่ยังต้องออก" (AND)
 *   ออเดอร์ที่มีเลขในโลกใดโลกหนึ่งแล้ว = ไม่ต้องออกอีก · เป็นตัวเดียวกับที่ server ใช้ (neededSerials)
 */
export function manualNoFields(action: OrderAction, order: OrderState): { inv: boolean; pay: boolean } {
  const v = neededSerials(action, order, true);
  const n = neededSerials(action, order, false);
  return {
    inv: v.inv && n.inv,
    pay: (v.tax1 || v.tax2) && !!(n.rcpt1 || n.rcpt2),
  };
}

/** เลขที่กรอกเอง — ตัวอักษรชุดเดียวกับตัวอักษรนำหน้า (ไม่มีเว้นวรรค) · ยาวไม่เกิน 30 */
export function manualNoError(no: string): string | null {
  const s = no.trim();
  if (!s) return "ยังไม่ได้กรอกเลขเอกสาร";
  if (s.length > 30) return "เลขเอกสารยาวเกิน 30 ตัว";
  if (!/^[A-Za-z0-9ก-๙._/-]+$/.test(s)) return "เลขเอกสารใช้ได้เฉพาะ ก-ฮ A-Z 0-9 และ . _ / - (ห้ามเว้นวรรค)";
  return null;
}
