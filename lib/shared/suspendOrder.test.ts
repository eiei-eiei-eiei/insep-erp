import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ลำดับด่านใน `app/(app)/layout.tsx` — **ระงับการใช้งานต้องมาก่อนบังคับเปลี่ยนรหัส**
 *
 * 🚩 ต้นเรื่อง (เจ้าของกิจการชี้เองตอนเทส 2026-09-06): ลูกค้าค้างค่างวดจนถูกระงับ
 *    แล้วโทรมาขอรีเซ็ตรหัส → ล็อกอิน → **ถูกบังคับคิดรหัสใหม่ กรอก 2 ช่อง กดบันทึก**
 *    แล้วค่อยเจอหน้า "บัญชีถูกระงับ" = ให้ผู้ใช้ทำงานฟรีก่อนบอกความจริง
 *    เส้นทางจริงคือ ล็อกอิน → เห็นว่าถูกระงับ → ติดต่อผู้ดูแล → จ่ายเงิน → ปลดล็อก
 *
 * 🪤 ทำไมต้องอ่านซอร์สมาตรวจ: layout เป็น server component ที่เรียก `redirect()`
 *    ของ Next — เรียกตรง ๆ ในเทสไม่ได้ · และลำดับ `if` สองบรรทัดนี้สลับกันเมื่อไหร่
 *    **TypeScript มองไม่เห็นเลย** (ชั้นเดียวกับ tenantTables.test.ts / rolesSql.test.ts)
 */
describe("ลำดับด่านของ (app)/layout — ระงับต้องมาก่อนเปลี่ยนรหัส", () => {
  const src = readFileSync(join(process.cwd(), "app/(app)/layout.tsx"), "utf8");
  const iSuspend = src.indexOf('redirect("/suspended")');
  const iChangePw = src.indexOf('redirect("/change-password")');

  it("มีทั้งสองด่านอยู่จริง", () => {
    expect(iSuspend).toBeGreaterThan(-1);
    expect(iChangePw).toBeGreaterThan(-1);
  });

  it("🚩 ด่านระงับต้องอยู่ก่อนด่านเปลี่ยนรหัส", () => {
    expect(iSuspend).toBeLessThan(iChangePw);
  });

  // 🚨 fail-open: อ่านค่าไม่ได้/null ห้ามถือว่าถูกระงับ (D53) — ห้ามเปลี่ยนเป็น `!tenant?.is_active`
  it("🚨 ยังเทียบ === false อยู่ (ไม่ใช่ falsy) และยังยกเว้น tenant แพลตฟอร์ม", () => {
    expect(src).toContain("tenant?.is_active === false && !tenant?.is_platform");
  });
});
