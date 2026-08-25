/**
 * ดาวน์โหลดไฟล์จากฝั่งเบราว์เซอร์ — ของกลางที่เดียว (D82)
 *
 * ★ ยกมาจาก `ExciseTab.tsx` ที่เคยมีตัวนี้ฝังอยู่ในไฟล์เดียว — ตอนนี้มีคนใช้ 2 ที่แล้ว
 *   (ฟอร์ม ภส. + ดาวน์โหลดข้อมูลสำรอง) · ห้ามก๊อปตัวที่ 3 ไปวางที่อื่น (บทเรียน `lib/shared/ui` D42)
 *
 * 🪤 ต้อง `revokeObjectURL` ทีหลัง ไม่งั้น blob ค้างในหน่วยความจำจนกว่าจะปิดแท็บ —
 *    ไฟล์สำรองของลูกค้าอาจหลายสิบ MB · หน่วงไว้ให้เบราว์เซอร์เริ่มโหลดก่อนค่อยคืน
 */
export function downloadBlob(data: BlobPart, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const MIME = {
  pdf: "application/pdf",
  json: "application/json",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
