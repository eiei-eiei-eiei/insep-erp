/**
 * lib/shared/paginate — ดึงข้อมูลทั้งชุดจาก PostgREST แบบแบ่งหน้า (กันโดนตัดเงียบ ๆ)
 *
 * ทำไมต้องมี: PostgREST มี max_rows (default 1,000) ถ้า query รายงานเงิน/ภาษี
 * ไม่แบ่งหน้า จะได้แค่ 1,000 แถวแรก **โดยไม่มี error** → ยอดบัญชี/ภพ.30 ขาดแถวเก่า
 * (APP_REVIEW ข้อ D-P0) · ฟังก์ชันนี้วนอ่านทีละก้อนจนหมด แล้ว "ตรวจยอดกับ count"
 * ถ้าได้ไม่ครบให้ throw ดีกว่าปล่อยเลขผิดไปขึ้นรายงานภาษี
 *
 * บริสุทธิ์ ไม่ผูกกับ supabase client — รับ callback ดึงทีละหน้ามา (เทสได้)
 */

export type PageResult<T> = {
  data: T[] | null;
  error?: { message: string } | null;
  count?: number | null; // จำนวนแถวทั้งหมดที่ตรงเงื่อนไข (ถ้า caller ขอ count: "exact")
};

export type FetchPage<T> = (from: number, to: number) => Promise<PageResult<T>>;

export async function fetchAllRows<T>(
  fetchPage: FetchPage<T>,
  opts: { chunk?: number; maxPages?: number; label?: string } = {},
): Promise<T[]> {
  const chunk = opts.chunk ?? 1000;
  const maxPages = opts.maxPages ?? 1000; // safety cap = 1,000,000 แถว
  const label = opts.label ?? "ข้อมูล";

  const all: T[] = [];
  let total: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const from = page * chunk;
    const res = await fetchPage(from, from + chunk - 1);
    if (res.error) throw new Error(res.error.message);
    if (res.count != null && total == null) total = res.count;

    const rows = res.data ?? [];
    all.push(...rows);
    if (rows.length < chunk) break; // หน้าสุดท้าย (สั้นกว่าก้อน = หมดแล้ว)

    if (page === maxPages - 1) {
      throw new Error(`โหลด${label}ไม่ครบ (เกิน ${maxPages * chunk} แถว) — แจ้งผู้ดูแลระบบ`);
    }
  }

  // ยามสุดท้าย: ถ้า DB บอกจำนวนจริงมาแล้วได้ไม่ครบ = โดนตัด อย่าปล่อยเลขผิดออกรายงาน
  if (total != null && all.length < total) {
    throw new Error(`โหลด${label}ได้ไม่ครบ (${all.length}/${total} แถว) — ยอดในรายงานจะผิด กรุณาลองใหม่`);
  }
  return all;
}
