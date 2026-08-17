/**
 * lib/shared/format — ฟังก์ชัน format ที่ระบบเดิมกระจายอยู่ 2 แอป (P0 ข้อ 4)
 * รวมมาไว้จุดเดียว · port byte-compatible จาก accounting/Config.js
 *
 * ⚠️ A9/A12: ห้ามแก้ logic — ตัวเลขไปลงรายงานภาษี/50ทวิ ต้องตรงระบบเดิม
 * มี golden test เทียบค่าใน format.test.ts
 */

const NUMBER_TEXT = "ศูนย์,หนึ่ง,สอง,สาม,สี่,ห้า,หก,เจ็ด,แปด,เก้า,สิบ".split(",");
const UNIT_TEXT = "สิบ,ร้อย,พัน,หมื่น,แสน,ล้าน".split(",");

const TH_MONTHS_ABBR = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/**
 * A9 — วันที่ไทยย่อ จาก 'yyyy-MM-dd' → "d ม.ค. 69" (ปี พ.ศ. 2 หลัก) · ไม่ pad วัน
 *
 * ★ เดิมอยู่ใน `lib/accounting/wht.ts` (ยัง re-export จากที่นั่นเพื่อให้ golden test A9 เดิมไม่ต้องแก้)
 *   ย้ายมาที่นี่เพราะฝั่งลูกค้า/แพลตฟอร์มก็ต้องใช้ — ปล่อยไว้จะได้ตัวก๊อปชุดที่สองแล้วเพี้ยนกันวันหนึ่ง
 * ⚠️ แกะสตริงตรง ๆ ไม่ผ่าน `new Date()` โดยตั้งใจ — parse ISO แล้ว format ตาม timezone เครื่อง
 *   จะได้วันคลาดไป 1 วันบนเครื่องที่ offset ติดลบ
 */
export function formatDateThai(iso: string | null | undefined): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "-";
  const day = parseInt(m[3], 10);
  const mon = TH_MONTHS_ABBR[parseInt(m[2], 10) - 1];
  const yy = ((parseInt(m[1], 10) + 543) % 100).toString().padStart(2, "0");
  return `${day} ${mon} ${yy}`;
}

/**
 * A9 — แปลงตัวเลขเป็นข้อความภาษาไทย (บาทถ้วน) สำหรับ 50ทวิ
 * port ตรงจาก ThaiBaht (accounting/Config.js:99) — คง edge case เอ็ด/ยี่/สิบ/ล้าน
 */
export function thaiBaht(value: number | string | null | undefined): string {
  const number = typeof value === "string" ? Number(value) : value;
  if (number === 0 || !number || Number.isNaN(number)) return "ศูนย์บาทถ้วน";

  const strNum = Number(number).toFixed(2).toString();
  let bahtText = "";
  const baht = strNum.split(".")[0];
  const satang = strNum.split(".")[1];

  function convertToText(str: string): string {
    let text = "";
    const len = str.length;
    for (let i = 0; i < len; i++) {
      const n = parseInt(str.charAt(i));
      if (n !== 0) {
        if (i === len - 1 && n === 1 && len > 1 && str.charAt(len - 2) !== "0") {
          text += "เอ็ด";
        } else if (i === len - 2 && n === 2) {
          text += "ยี่";
        } else if (i === len - 2 && n === 1) {
          text += "";
        } else {
          text += NUMBER_TEXT[n];
        }
        const unitIndex = len - i - 2;
        if (unitIndex >= 0) text += UNIT_TEXT[unitIndex % 6];
      }
    }
    return text;
  }

  if (parseInt(baht) > 0) bahtText += convertToText(baht) + "บาท";
  if (parseInt(satang) > 0) bahtText += convertToText(satang) + "สตางค์";
  else bahtText += "ถ้วน";

  return bahtText;
}

/**
 * A12 — จัดรูปแบบเลขประจำตัวผู้เสียภาษี 13 หลัก
 * port ตรงจาก formatTaxId (accounting/Config.js:140)
 * ตัดอักขระ ['" ] ที่ติดมาจาก Sheets + pad 0 หน้าให้ครบ 13 · ว่าง/"-" → "-"
 */
export function formatTaxId(taxId: string | null | undefined): string {
  if (!taxId || taxId === "-") return "-";
  const t = taxId.toString().replace(/['" ]/g, "").trim();
  if (/^[0-9]+$/.test(t) && t.length > 0 && t.length < 13) {
    return t.padStart(13, "0");
  }
  return t || "-";
}

export type BranchInfo = { isHQ: boolean; text: string };

/**
 * A12 — จัดรูปแบบสาขา (5 หลัก)
 * port ตรงจาก formatBranch (accounting/Config.js:151) — คืน object {isHQ, text}
 * '-' / 'สำนักงานใหญ่' / '00000' / ว่าง = สำนักงานใหญ่ (text '00000')
 */
export function formatBranch(branch: string | null | undefined): BranchInfo {
  if (!branch || branch === "-" || branch === "สำนักงานใหญ่" || branch === "00000") {
    return { isHQ: true, text: "00000" };
  }
  const b = branch.toString().trim();
  if (/^[0-9]+$/.test(b) && b.length > 0 && b.length < 5) {
    return { isHQ: false, text: b.padStart(5, "0") };
  }
  return { isHQ: false, text: b };
}
