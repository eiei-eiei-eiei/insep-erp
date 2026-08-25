/**
 * หมวดหมู่รายจ่ายที่ "จุดชนวน" การรับวัตถุดิบเข้าสต็อกผลิต (T6 · D80)
 *
 * 🚨 เดิมฮาร์ดโค้ดคำว่า `"ต้นทุนสุรา"` ไว้ในหน้าจอ — แต่ผังบัญชีจริงของลูกค้าไม่มีคำนี้
 *    (แอปแอบเติมเป็นตัวเลือกใน <datalist> ให้ ผู้ใช้เลยต้องพิมพ์เองทุกครั้ง และหมวดที่ใช้จริง
 *    อย่าง "ค่าต้นทุนสินค้า" ก็ไม่จุดชนวนอะไรเลย) → ทำให้ตั้งค่าได้ เลือกได้หลายหมวด
 *
 * ★ ไม่มีแถวใน app_settings = ใช้ค่าปริยายในไฟล์นี้ → **ไม่ต้องมี migration และไม่ต้อง seed**
 *   ให้ลูกค้าเดิม · เปลี่ยนค่าปริยายได้อย่างปลอดภัยเพราะเส้นทางนี้ไม่เคยทำงานสำเร็จเลยก่อน 0046
 *   (DB จริงไม่มีบิลหมวดนี้สักใบ) = ไม่มีข้อมูลเดิมที่พึ่งคำเดิมอยู่
 */
export const FORWARD_CAT_KIND = "material_forward_cat";

/** ค่าปริยายเมื่อลูกค้ายังไม่ได้ตั้งเอง */
export const DEFAULT_FORWARD_CATS = ["วัตถุดิบผลิตสุรา"] as const;

export function forwardCatsOf(configured: readonly string[] | null | undefined): string[] {
  const list = (configured ?? []).map((c) => c.trim()).filter(Boolean);
  return list.length ? list : [...DEFAULT_FORWARD_CATS];
}

/** หมวดนี้ทำให้บิลรับวัตถุดิบเข้าสต็อกผลิตไหม (เทียบแบบ trim — ห้าม fuzzy) */
export function isForwardCat(category: string, cats: readonly string[]): boolean {
  const c = category.trim();
  return c !== "" && cats.some((x) => x.trim() === c);
}
