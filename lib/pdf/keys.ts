/**
 * ค่าคงที่ path ของ template/font ใน Supabase Storage
 * แยกออกจากไฟล์ที่ import pdf-lib (wht50/excise) เพื่อให้ component import ค่าคงที่ได้
 * โดยไม่ดึง pdf-lib + fontkit เข้า bundle (โหลด builder แบบ dynamic import ตอนกดพิมพ์แทน)
 */
export const WHT_TEMPLATE_KEY = "wht/wh3_template.pdf";
export const FONT_KEY = "fonts/THSARABUN.TTF";

export type ExciseKind = "0701" | "0702_1" | "0702_2" | "0704";

/** path ใน bucket pdf-templates (ตรงกับ scripts/upload-pdf-templates.ts) */
export const EXCISE_TEMPLATE_KEY: Record<ExciseKind, string> = {
  "0701": "excise/pso_07-01_1.pdf",
  "0702_1": "excise/pso_07-02_1.pdf",
  "0702_2": "excise/pso_07-02_12.pdf",
  "0704": "excise/pso_07-04_1.pdf",
};
