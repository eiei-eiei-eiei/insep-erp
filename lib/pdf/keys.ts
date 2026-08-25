/**
 * ค่าคงที่ path ของ template/font ใน Supabase Storage
 * แยกออกจากไฟล์ที่ import pdf-lib (wht50/excise) เพื่อให้ component import ค่าคงที่ได้
 * โดยไม่ดึง pdf-lib + fontkit เข้า bundle (โหลด builder แบบ dynamic import ตอนกดพิมพ์แทน)
 */
export const WHT_TEMPLATE_KEY = "wht/wh3_template.pdf";
export const FONT_KEY = "fonts/THSARABUN.TTF";

/**
 * ⚠️ `0702_1` และ `0702_1_chae` **หัวกระดาษพิมพ์เลขฟอร์มเดียวกัน** คือ ภส.๐๗-๐๒/๑(๑)
 *    แต่เป็นกระดาษคนละใบ: `0702_1` = สุรากลั่น (มีคอลัมน์การกลั่น/ปรุงแต่ง)
 *    `0702_1_chae` = สุราแช่ (ไม่มีการกลั่น · 14 คอลัมน์ · 17 แถว) — D78
 *    → ห้าม reuse key เดิม และ UI ต้องเรียกชื่อให้ต่างกัน ("บัญชีผลิตสุรากลั่น"/"บัญชีผลิตสุราแช่")
 */
export type ExciseKind = "0701" | "0702_1" | "0702_1_chae" | "0702_2" | "0704";

/** path ใน bucket pdf-templates (ตรงกับ scripts/upload-pdf-templates.ts) */
export const EXCISE_TEMPLATE_KEY: Record<ExciseKind, string> = {
  "0701": "excise/pso_07-01_1.pdf",
  "0702_1": "excise/pso_07-02_1.pdf",
  "0702_1_chae": "excise/pso_07-02_1_chae.pdf",
  "0702_2": "excise/pso_07-02_12.pdf",
  "0704": "excise/pso_07-04_1.pdf",
};
