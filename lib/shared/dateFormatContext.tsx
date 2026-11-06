"use client";

import { createContext, useContext, useMemo } from "react";
import {
  DEFAULT_DATE_FORMATS,
  formatDate,
  formatDateTime,
  formatDayShort,
  formatMonth,
  type DateFormat,
  type DateFormats,
} from "./dateFormat";

/**
 * รูปแบบวันที่ของกิจการนี้ ส่งจาก `(app)/layout.tsx` ลงไปทุกหน้า (D161)
 *
 * ★ layout อ่านค่าจาก `app_settings` ฝั่ง server แล้วส่งค่าเดียวกันให้ทั้ง SSR และเบราว์เซอร์
 *   ⇒ server กับ client render ตรงกันเสมอ (เวลาเป็นเวลาไทยแบบระบุโซนเอง ไม่พึ่งเครื่อง)
 * ★ ไม่มี Provider ครอบ (เช่นหน้า /platform ของผู้ดูแล) = ใช้ค่าเริ่มต้น ไม่พัง
 *
 * 🚨 ฟอร์มราชการห้ามใช้ hook นี้ — ใช้ตัวจัดรูปของตัวเอง (ดูหัวไฟล์ lib/shared/dateFormat.ts)
 */
const Ctx = createContext<DateFormats>(DEFAULT_DATE_FORMATS);

export function DateFormatProvider({ value, children }: { value: DateFormats; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export type DateFmt = {
  /** รูปแบบของหน้าจอ */
  fmt: DateFormat;
  /** รูปแบบของเอกสารการค้า (ใบเสนอราคา · ใบกำกับ · ใบเสร็จ · ใบลดหนี้ · บิลบาร์ · สลิป) */
  docFmt: DateFormat;
  date: (v: string | null | undefined) => string;
  day: (v: string | null | undefined) => string;
  month: (period: string | null | undefined) => string;
  dateTime: (v: string | Date | null | undefined) => string;
  /** วันที่บนเอกสารการค้า */
  docDate: (v: string | null | undefined) => string;
  /** เดือนบนเอกสารการค้า (เช่น งวดบนสลิปเงินเดือน) */
  docMonth: (period: string | null | undefined) => string;
};

export function useDateFmt(): DateFmt {
  const { screen, doc } = useContext(Ctx);
  return useMemo(
    () => ({
      fmt: screen,
      docFmt: doc,
      date: (v) => formatDate(v, screen),
      day: (v) => formatDayShort(v, screen),
      month: (p) => formatMonth(p, screen),
      dateTime: (v) => formatDateTime(v, screen),
      docDate: (v) => formatDate(v, doc),
      docMonth: (p) => formatMonth(p, doc),
    }),
    [screen, doc],
  );
}
