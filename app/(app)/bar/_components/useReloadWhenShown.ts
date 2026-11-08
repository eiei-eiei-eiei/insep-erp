"use client";

import { useEffect, useRef, useState } from "react";

/**
 * D163 — แท็บที่ค้นข้อมูลเอง (แดชบอร์ด · ประวัติบิล) ต้องโหลดใหม่เมื่อมีอะไรเปลี่ยนในแท็บอื่น
 *
 * 🐛 อาการที่ผู้ใช้แจ้ง: เปิดแดชบอร์ด → ไปแท็บขายกดรับเงิน → กลับมาแดชบอร์ด ยอดไม่ขึ้น
 *    ต้องรีเฟรชทั้งหน้า · สาเหตุ: แท็บ mount ค้างไว้ (BarApp) และสองแท็บนี้ไม่ได้อ่านจาก `boot`
 *    แต่ค้นเองด้วย server action แล้วค้นแค่ตอนเปิดครั้งแรก/เปลี่ยนช่วงวันที่
 *
 * ★ กติกา: `boot` เปลี่ยนตัว (= มีคนกดบันทึกอะไรสักอย่างแล้ว onReload) → จดว่าข้อมูลเก่า
 *   แล้ว **ค้นใหม่ตอนแท็บถูกเปิดขึ้นมา** ไม่ใช่ทันที
 *   🪤 ค้นทันทีทุกครั้งที่ boot เปลี่ยน = แดชบอร์ดที่ซ่อนอยู่ยิง 5 คิวรีทุกครั้งที่ขายแก้วหนึ่ง
 *      ทั้งคืน · และยังขัดกับเหตุผลในคอมเมนต์ของ BarApp (อย่าโหลดซ้ำโดยไม่จำเป็น)
 */
export function useReloadWhenShown(active: boolean, version: unknown, reload: () => void) {
  const seen = useRef(version);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (version !== seen.current) {
      seen.current = version;
      setStale(true);
    }
  }, [version]);

  useEffect(() => {
    if (active && stale) {
      setStale(false);
      reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stale]);
}
