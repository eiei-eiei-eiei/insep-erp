/**
 * บอกผู้ใช้ว่า "ยังกรอกไม่ครบตรงไหน" เมื่อปุ่มถูก disable
 *
 * เหตุผล (ตระกูล D74/D77/D80 — *ระบบทำได้ แต่ผู้ใช้ไม่รู้ว่าต้องทำอะไรต่อ*):
 * ปุ่มบันทึกทั่วแอปเขียนเงื่อนไขรวมไว้ในบรรทัดเดียว เช่น
 *   `disabled={pending || items.length === 0 || !selCustId || !saleName.trim()}`
 * ขาดอย่างใดอย่างหนึ่งใน 3 อย่าง ปุ่มก็เทาเหมือนกันหมด **โดยไม่บอกว่าขาดอะไร**
 * → ผู้ใช้ใหม่นึกว่าปุ่มเสีย (เจอเองตอนเทสเบราว์เซอร์ 2026-08-25)
 *
 * 🚨 ที่นี่เป็นแค่ "คำอธิบาย" — **ไม่ใช่ตัวตัดสินว่าบันทึกได้หรือไม่**
 *    เงื่อนไข `disabled=` ของปุ่มยังเป็นตัวจริงเสมอ (และ server action ยัง validate ซ้ำ)
 *    ถ้าเอาสองที่มาผูกกันแล้วเผลอแก้ข้างเดียว จะได้ปุ่มที่กดไม่ได้แต่บอกว่าครบแล้ว
 */

/** ช่องหนึ่งช่อง: `ok=false` = ยังขาด */
export type FieldCheck = { label: string; ok: boolean };

/** ชื่อช่องที่ยังขาด (เรียงตามลำดับที่ส่งเข้ามา = ลำดับบนหน้าจอ) */
export function missingLabels(checks: FieldCheck[]): string[] {
  return checks.filter((c) => !c.ok).map((c) => c.label);
}

/**
 * ข้อความใต้ปุ่ม — คืน `null` เมื่อครบแล้ว (จะได้ไม่ต้อง render อะไรเลย)
 * เช่น `"ยังกรอกไม่ครบ: ลูกค้า · ผู้เสนอราคา"`
 */
export function missingText(checks: FieldCheck[], prefix = "ยังกรอกไม่ครบ"): string | null {
  const miss = missingLabels(checks);
  if (miss.length === 0) return null;
  return `${prefix}: ${miss.join(" · ")}`;
}
