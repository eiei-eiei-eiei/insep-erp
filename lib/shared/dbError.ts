/**
 * แปล error จาก Postgres/Supabase เป็นข้อความไทยที่ผู้ใช้ (เขียนโค้ดไม่ได้) เข้าใจ
 * ใช้แทน `fail(error.message)` ที่คืน SQLSTATE ดิบเป็นภาษาอังกฤษ
 * code = SQLSTATE ของ Postgres · ถ้าไม่รู้จัก คืน message เดิม (RPC ที่ raise มักเป็นไทยอยู่แล้ว)
 */
export function mapDbError(err: { code?: string | null; message?: string | null } | null | undefined): string {
  const code = err?.code ?? "";
  const msg = err?.message || "เกิดข้อผิดพลาด";
  switch (code) {
    case "23505": return "มีข้อมูลนี้อยู่แล้ว (ชื่อ/เลขที่ซ้ำ) — ตรวจแล้วลองใหม่";
    case "23503": return "ลบไม่ได้ — มีรายการอื่นอ้างอิงข้อมูลนี้อยู่";
    case "23502": return "ข้อมูลไม่ครบ — มีช่องบังคับที่ยังว่าง";
    case "23514": return "ค่าที่กรอกไม่ถูกต้องตามที่ระบบกำหนด";
    case "42501": return "สิทธิ์ไม่พอ — ต้องเป็นผู้ใช้ระดับ main ถึงจะทำรายการนี้ได้";
    case "P0001": return msg; // RAISE จาก RPC — เป็นข้อความไทยอยู่แล้ว
    default: return msg;
  }
}
