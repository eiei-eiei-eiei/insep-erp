/**
 * คุกกี้เซสชันของ Supabase — `sb-<project-ref>-auth-token` (+ ชิ้น `.0` `.1` … เมื่อยาวเกิน 4 KB)
 * และ `sb-<project-ref>-auth-token-code-verifier` ของ PKCE (D135)
 *
 * 🚨 ห้ามจับกว้างกว่านี้ — คุกกี้อื่นของแอป (`theme` โหมดสว่าง/มืด ฯลฯ) ต้องอยู่รอดหลังออกจากระบบ
 */
export function isSessionCookie(name: string): boolean {
  return /^sb-[^-]+(?:-[^-]+)*-auth-token(?:-code-verifier)?(?:\.\d+)?$/.test(name);
}
