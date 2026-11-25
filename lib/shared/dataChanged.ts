"use client";

/**
 * lib/shared/dataChanged — สัญญาณ "บันทึกแล้ว ข้อมูลเปลี่ยน" ข้ามแท็บในหน้าเดียวกัน (D181)
 *
 * 🪤 แท็บในแอปบัญชีถูก mount ค้างไว้ (visited) แล้วซ่อน/โชว์ — แท็บที่อ่านข้อมูลจะโหลดใหม่ตอนกลับมาเปิด
 *    แต่ถ้าผู้ใช้กดบันทึกแล้วสลับแท็บ**ก่อนบันทึกเสร็จ** แท็บปลายทางจะอ่านก่อนแถวใหม่ลง DB
 *    แล้วค้างข้อมูลเก่าไว้จนกว่าจะสลับแท็บอีกรอบ ("บันทึกแล้วไม่ขึ้น แต่มาดูอีกทีก็มี")
 *    ⇒ ฝั่งบันทึกส่งสัญญาณหลังบันทึกสำเร็จ · ฝั่งอ่านเอาเลขรุ่นไปใส่ deps ของ `useRead`
 * ★ เป็นแค่ตัวเร่งให้โหลดใหม่ ไม่ใช่ที่เก็บข้อมูล — ไม่มีสัญญาณก็ยังถูก แค่ช้ากว่า
 */

import { useEffect, useState } from "react";

const EVENT = "insep:data-changed";

export type DataScope = "accounting";

export function emitDataChanged(scope: DataScope): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DataScope>(EVENT, { detail: scope }));
}

/** เลขรุ่นที่เพิ่มทุกครั้งที่มีการบันทึกใน scope นี้ — ใส่ใน deps ของ useRead */
export function useDataVersion(scope: DataScope): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<DataScope>).detail === scope) setV((n) => n + 1);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [scope]);
  return v;
}
