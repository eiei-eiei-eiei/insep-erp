/**
 * ค่าคงที่ path ของ template/font ใน Supabase Storage
 * แยกออกจากไฟล์ที่ import pdf-lib (wht50/excise) เพื่อให้ component import ค่าคงที่ได้
 * โดยไม่ดึง pdf-lib + fontkit เข้า bundle (โหลด builder แบบ dynamic import ตอนกดพิมพ์แทน)
 */
export const WHT_TEMPLATE_KEY = "wht/wh3_template.pdf";
export const FONT_KEY = "fonts/THSARABUN.TTF";
