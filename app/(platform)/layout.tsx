import { requirePlatformAdmin } from "@/lib/platform/auth";
import { signOut } from "@/app/(app)/actions";
import { PRODUCT_NAME } from "@/lib/shared/branding";
import { IconLogout } from "@/lib/shared/icons";

/**
 * Layout ของแอปจัดการหลังบ้าน — **แยกจาก (app) โดยตั้งใจ**
 *
 * ไม่มี `data-brand` → ใช้สีเริ่มต้น (steel) เสมอ · นี่คือหน้าจอของเจ้าของระบบ ไม่ใช่ของลูกค้า
 * ถ้าไปหยิบแบรนด์ของ tenant ที่บัญชีแอดมินสังกัดมาทา จะดูเหมือนกำลังยืนอยู่ในระบบของลูกค้ารายนั้น
 * ซึ่งอันตรายกับคนกดปุ่ม (เข้าใจผิดว่ากำลังแก้ของใคร)
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin(); // 404 ถ้า env ไม่เปิด / ไม่ใช่แอดมิน

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="border-b border-line bg-nav">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <div className="text-sm font-bold tracking-wide text-ink">จัดการแพลตฟอร์ม</div>
            <div className="text-xs text-faint">{PRODUCT_NAME} · เจ้าของระบบเท่านั้น</div>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="flex min-h-[44px] items-center gap-1.5 rounded border border-line px-3 text-xs font-medium text-muted transition hover:bg-raised hover:text-ink sm:min-h-0 sm:py-2"
            >
              <IconLogout size={14} />
              ออกจากระบบ
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
