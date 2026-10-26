/**
 * lib/supabase/authFetch — เพดานเวลาของคำขอไป Supabase Auth (D135)
 *
 * ที่มา: เปิดแอปด้วยเซสชันที่หมดอายุ → ทุก workspace ค้างที่ "กำลังโหลด…" ตลอดไป (NEXT_STEPS · เจอตอนเทส D98)
 *   ตอนเรียก `getUser()` แล้ว access token หมดอายุ ไลบรารีจะขอต่ออายุ (`/auth/v1/token`) เอง **โดยไม่มีเพดานเวลา**
 *   · คำขอที่ไม่มีคำตอบกลับ (เน็ตสะดุด · ฝั่ง Auth ช้า) = รอตลอดกาล
 *   · ได้ 5xx = ไลบรารีลองซ้ำเองจนครบ ~30 วิ (พิสูจน์ด้วย mock server — ดู TESTING ส่วนที่ 93)
 *   ⇒ ให้ทุกคำขอไป Auth มีเพดาน → ไลบรารีได้ error กลับมา → ผู้เรียกได้ `user = null` → เด้งไปหน้า login
 *
 * ★ จำกัดเฉพาะ `/auth/v1/` — คำขอข้อมูล (PostgREST/Storage) ไม่ถูกแตะ (รายงานใหญ่บางตัวใช้เวลานานโดยชอบธรรม)
 * ★ ใช้ AbortController + setTimeout (ไม่ใช่ AbortSignal.timeout/any) — middleware รันบน Edge runtime
 * ★ หยิบ `globalThis.fetch` ตอนเรียก ไม่ใช่ตอนสร้าง — Next.js ห่อ fetch ของ server component ไว้
 */
export const AUTH_FETCH_TIMEOUT_MS = 10_000;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function isAuthRequest(input: RequestInfo | URL): boolean {
  return urlOf(input).includes("/auth/v1/");
}

export function withAuthTimeout(
  base?: typeof fetch,
  ms: number = AUTH_FETCH_TIMEOUT_MS,
): typeof fetch {
  return async (input, init) => {
    const f = base ?? globalThis.fetch;
    if (!isAuthRequest(input)) return f(input, init);

    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(new Error(`Supabase Auth ไม่ตอบภายใน ${ms / 1000} วิ`)),
      ms,
    );
    // ผู้เรียกส่ง signal ของตัวเองมาด้วย → ยกเลิกตามได้เหมือนเดิม
    const outer = init?.signal;
    if (outer) {
      if (outer.aborted) ctrl.abort(outer.reason);
      else outer.addEventListener("abort", () => ctrl.abort(outer.reason), { once: true });
    }
    try {
      return await f(input, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}
