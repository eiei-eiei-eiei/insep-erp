import { signOut } from "@/app/(app)/actions";

/**
 * หน้าที่ลูกค้าเห็นเมื่อกิจการถูกระงับการใช้งาน (`tenants.is_active = false` — 0037)
 *
 * อยู่นอกกลุ่ม `(app)` โดยตั้งใจ — ถ้าอยู่ข้างในจะโดน layout เด้งกลับมาที่นี่ไม่รู้จบ
 * (เหตุผลเดียวกับ `/change-password`)
 *
 * ★ ถ้อยคำต้องไม่กล่าวหา: ลูกค้าอาจโอนแล้วแต่ยังไม่ได้บันทึก และคนที่เปิดเจอหน้านี้
 *   อาจเป็นพนักงานที่ไม่รู้เรื่องการเงินเลย · บอกสิ่งที่ต้องทำต่อ ไม่ใช่บอกว่าใครผิด
 * ★ ต้องบอกชัดว่า **ข้อมูลไม่ได้ถูกลบ** — ความกลัวแรกของคนที่เจอหน้านี้คือ "ข้อมูลบัญชีหายไหม"
 */
export default function SuspendedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-raised p-4">
      <div className="w-full max-w-md rounded-lg bg-card p-8 shadow-lg">
        <h1 className="text-xl font-bold text-ink">บัญชีถูกระงับการใช้งานชั่วคราว</h1>

        <p className="mt-3 text-sm text-muted">
          ระบบของกิจการนี้ถูกระงับการเข้าใช้งานชั่วคราว
          กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดใช้งานอีกครั้ง
        </p>

        <div className="mt-4 rounded-lg border border-ok-line bg-ok-bg p-3 text-sm text-ok">
          <strong>ข้อมูลทั้งหมดยังอยู่ครบ ไม่ได้ถูกลบ</strong>
          <br />
          เมื่อเปิดใช้งานแล้วจะเข้าถึงได้เหมือนเดิมทันที
        </div>

        <p className="mt-4 text-xs text-faint">
          ถ้าคุณชำระเงินแล้ว อาจเป็นเพราะยังบันทึกรายการไม่ทัน — แจ้งผู้ดูแลระบบพร้อมหลักฐานการโอนได้เลย
        </p>

        <form action={signOut} className="mt-6">
          <button
            type="submit"
            className="min-h-[44px] w-full rounded border border-line text-sm font-medium text-muted transition hover:bg-raised hover:text-ink sm:py-2"
          >
            ออกจากระบบ
          </button>
        </form>
      </div>
    </main>
  );
}
