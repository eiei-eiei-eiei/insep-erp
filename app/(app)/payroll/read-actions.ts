"use server";

import {
  getPeriodDetail,
  getPayrollReportSource,
  getFilingPeriod,
  getFilingYear,
} from "./data";

/**
 * read wrapper สำหรับ client component (โหลดงวดตอนสลับงวด)
 * แยกไฟล์จาก actions.ts เพราะไฟล์นั้นเป็นฝั่ง "เขียน" ล้วน — อ่านคนละความเสี่ยง
 */
export async function getPeriodDetailAction(periodId: string) {
  return getPeriodDetail(periodId);
}

/** ข้อมูลรายงานของปีหนึ่ง (แท็บรายงาน) */
export async function getPayrollReportAction(year: number) {
  return getPayrollReportSource(year);
}

/** ข้อมูลเอกสารยื่นรายเดือน (ภงด.1 · สปส.1-10) */
export async function getFilingPeriodAction(periodId: string) {
  return getFilingPeriod(periodId);
}

/** ข้อมูลเอกสารยื่นรายปี (ภงด.1ก · 50ทวิ) — year เป็น ค.ศ. */
export async function getFilingYearAction(year: number) {
  return getFilingYear(year);
}
