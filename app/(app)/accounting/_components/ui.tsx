"use client";

/**
 * UI ของโดเมนบัญชี — ตรรกะจริงอยู่ที่ `lib/shared/ui` (ชุดเดียวใช้ 3 โดเมน)
 * ไฟล์นี้เหลือแค่ re-export ให้ import เดิมของทุก Tab ใช้ได้เหมือนเดิม
 * accent = slate (สีเดิมของบัญชี)
 */
export {
  todayISO,
  nowMonth,
  fmt,
  fmt0,
  cleanTaxId13,
  useSaver,
  Msg,
  Field,
  Card,
  Stat,
  TextInput,
  NumInput,
  Select,
  NumBox,
  Combobox,
  SaveButton,
  RowBtn,
} from "@/lib/shared/ui";
