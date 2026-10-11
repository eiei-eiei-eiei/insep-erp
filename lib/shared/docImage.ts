/**
 * docImage — ป้าย/ชื่อไฟล์/ข้อความของแถบ "คัดลอกเป็นภาพ · แชร์" ในหน้าต่างเอกสาร (ขาย D105 · บาร์ D106)
 *
 * ตัวแปลงภาพจริงอยู่ที่ `lib/shared/docViewer.ts` (แตะ DOM)
 * ไฟล์นี้เก็บเฉพาะ "ประโยคที่ผู้ใช้อ่านแล้วตัดสินใจกด" — ตัดสินที่นี่ที่เดียวเพื่อให้มีเทสคุม
 * (บทเรียน D84/D91: ประโยคที่แต่งในคอมโพเนนต์หลุดจากสิ่งที่ปุ่มทำจริงเงียบ ๆ)
 *
 * 🚨 ภาพถ่ายจาก HTML ชุดเดียวกับที่พิมพ์ — ห้ามเขียนเอกสารเวอร์ชันภาพแยก (หน้าตาจะหลุดจากกระดาษ)
 */

/** ป้ายของแต่ละหน้า เช่น "ใบกำกับภาษี/ใบเสร็จรับเงิน (ต้นฉบับ / Original)" */
export function docPageLabel(title: string, copyType?: string): string {
  const t = (title || "").trim() || "เอกสาร";
  const c = (copyType || "").trim();
  return c ? `${t} ${c}` : t;
}

/**
 * ชื่อไฟล์ภาพ — LINE/แชทโชว์ชื่อไฟล์ จึงใส่ชื่อเอกสาร + เลขที่ ให้ผู้รับรู้ว่าเป็นใบไหน
 * ตัดอักขระที่ระบบไฟล์ไม่รับ (/ \ : * ? " < > |) · ไม่มีอะไรเลย = "เอกสาร-<ลำดับ>"
 */
export function docImageFileName(label: string, docNo: string | undefined, index: number): string {
  const clean = (s: string) =>
    s
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "_")
      .replace(/-{2,}/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "");
  const parts = [clean(label || ""), clean(docNo || "")].filter(Boolean);
  const base = parts.length ? parts.join("_") : `เอกสาร-${index + 1}`;
  return `${base}.png`;
}

/** ข้อความบนปุ่มแชร์รวม — บอกเสมอว่าจะส่งกี่รูป (เมนูแชร์ของมือถือเอารูปออกทีหลังไม่ได้) */
export function shareAllLabel(selected: number, total: number): string {
  if (total <= 1) return "แชร์ภาพ";
  return `แชร์ ${selected} จาก ${total} รูป`;
}

/** แปลงภาพไม่สำเร็จ — กระดาษยังพิมพ์ได้ (ปุ่มพิมพ์ไม่พึ่งภาพ) ต้องบอกให้ชัดว่าทางไหนยังใช้ได้ */
export const IMAGE_FAILED_TEXT = "สร้างภาพไม่สำเร็จ — ยังกดพิมพ์ได้ตามปกติ ลองปิดหน้าต่างนี้แล้วเปิดเอกสารใหม่";

export type ShareSupport = "ok" | "no-api" | "no-files";
export type ImageState = "loading" | "ready" | "failed";

/**
 * เหตุผลที่ปุ่มแชร์กดไม่ได้ — ปุ่มเทาต้องบอกว่าทำไม (D83/D86: ซ่อนปุ่มแย่กว่าปุ่มเทา)
 * คืน "" = กดได้
 */
export function shareDisabledReason(support: ShareSupport, selected: number, state: ImageState): string {
  if (state === "failed") return IMAGE_FAILED_TEXT;
  if (support === "no-api") return "เบราว์เซอร์นี้แชร์ไม่ได้ — ใช้ปุ่มคัดลอกเป็นภาพแทน";
  if (support === "no-files") return "เบราว์เซอร์นี้แชร์ไฟล์ภาพไม่ได้ — ใช้ปุ่มคัดลอกเป็นภาพแทน";
  if (state === "loading") return "กำลังเตรียมภาพ…";
  if (selected === 0) return "ยังไม่ได้เลือกรูป — ติ๊กหน้าที่จะส่งก่อน";
  return "";
}
