"use client";

/**
 * UI ของโดเมนผลิต — ตรรกะจริงอยู่ที่ `lib/shared/ui` (ชุดเดียวใช้ 3 โดเมน)
 */
import { SaveButton as SharedSaveButton } from "@/lib/shared/ui";

export {
  todayISO,
  nowMonth,
  fmt,
  fmt0,
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
  RowBtn,
  IconBtn,
  Badge,
} from "@/lib/shared/ui";

/** ผลิตใช้ข้อความ "กำลังบันทึก…" ตามเดิม (บัญชี/ขายใช้ "กำลังทำงาน…") */
export function SaveButton(props: React.ComponentProps<typeof SharedSaveButton>) {
  return <SharedSaveButton pendingText="กำลังบันทึก…" {...props} />;
}
