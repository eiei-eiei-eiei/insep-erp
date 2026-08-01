"use client";

import { useEffect } from "react";
import Link from "next/link";
import { IconRefresh } from "@/lib/shared/icons";

/**
 * หน้า error ภาษาไทยของทุก workspace — แทนจอขาว Next default ภาษาอังกฤษ
 * (เช่น Supabase ล่มชั่วคราว / query พัง) ผู้ใช้กด "ลองใหม่" ได้โดยไม่ต้องรีเฟรชทั้งหน้า
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="mb-3 text-4xl">⚠️</div>
      <h1 className="mb-2 text-xl font-bold text-ink">เปิดหน้านี้ไม่สำเร็จ</h1>
      <p className="mb-1 text-sm text-muted">
        ระบบโหลดข้อมูลไม่ได้ชั่วคราว — มักเกิดจากอินเทอร์เน็ตหลุด หรือฐานข้อมูลตอบช้า
      </p>
      <p className="mb-5 text-sm text-muted">ข้อมูลที่บันทึกไปแล้วไม่หาย กด &quot;ลองใหม่&quot; ได้เลย</p>

      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={reset}
          className="min-h-[44px] rounded-lg bg-brand px-5 font-medium text-on-brand hover:opacity-90"
        ><IconRefresh size={15} className="mr-1 inline align-[-2px]" />ลองใหม่
        </button>
        <Link
          href="/"
          className="flex min-h-[44px] items-center rounded-lg border border-line px-5 font-medium text-muted hover:bg-raised"
        >
          กลับหน้าแรก
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 text-xs text-faint">
          รหัสอ้างอิงสำหรับตรวจสอบ: <code>{error.digest}</code>
        </p>
      )}
      <details className="mt-2 text-left text-xs text-faint">
        <summary className="cursor-pointer">รายละเอียดทางเทคนิค</summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">{error.message}</pre>
      </details>
    </div>
  );
}
