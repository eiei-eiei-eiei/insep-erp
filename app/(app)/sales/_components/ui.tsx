"use client";

/**
 * UI ของโดเมนขาย — ตรรกะจริงอยู่ที่ `lib/shared/ui`
 * (เดิมโดเมนนี้ใช้สี amber เป็น accent ของตัวเอง — D43 ยุบเป็นสีแบรนด์เดียวทั้งแอป
 *  เพราะสีแบรนด์ต้องเปลี่ยนตามลูกค้าได้ จะมี accent ประจำโดเมนไม่ได้)
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
  IconBtn,
  Badge,
  MissingHint,
} from "@/lib/shared/ui";

import { Badge } from "@/lib/shared/ui";

/** ป้ายสถานะออเดอร์ — แมปสถานะเป็น "ความหมาย" ไม่ใช่สีสุ่ม (D43) */
export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "ปิดการขาย"
      ? "ok"
      : status === "ยกเลิก"
        ? "neutral"
        : status === "รอคอนเฟิร์ม" || status === "รอคลังจัดส่ง"
          ? "warn"
          : "brand"; // รอชำระเงิน/ส่งของแล้วรอชำระ = กำลังดำเนินการ
  return <Badge tone={tone}>{status}</Badge>;
}
