"use server";

import { getPeriodDetail } from "./data";

/**
 * read wrapper สำหรับ client component (โหลดงวดตอนสลับงวด)
 * แยกไฟล์จาก actions.ts เพราะไฟล์นั้นเป็นฝั่ง "เขียน" ล้วน — อ่านคนละความเสี่ยง
 */
export async function getPeriodDetailAction(periodId: string) {
  return getPeriodDetail(periodId);
}
