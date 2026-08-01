"use client";

/**
 * UI ของโดเมนขาย — ตรรกะจริงอยู่ที่ `lib/shared/ui`
 * ต่างจากโดเมนอื่นแค่สี accent = amber → ห่อทับเฉพาะ input ที่มีสี
 */
import {
  TextInput as SharedTextInput,
  NumInput as SharedNumInput,
  Select as SharedSelect,
  NumBox as SharedNumBox,
  Combobox as SharedCombobox,
} from "@/lib/shared/ui";

export { todayISO, nowMonth, fmt, fmt0, cleanTaxId13, useSaver, Msg, Field, Card, Stat, SaveButton, RowBtn } from "@/lib/shared/ui";

type P<T> = Omit<T, "accent">;

export function TextInput(props: P<React.ComponentProps<typeof SharedTextInput>>) {
  return <SharedTextInput accent="amber" {...props} />;
}
export function NumInput(props: P<React.ComponentProps<typeof SharedNumInput>>) {
  return <SharedNumInput accent="amber" {...props} />;
}
export function Select(props: P<React.ComponentProps<typeof SharedSelect>>) {
  return <SharedSelect accent="amber" {...props} />;
}
export function NumBox(props: P<React.ComponentProps<typeof SharedNumBox>>) {
  return <SharedNumBox accent="amber" {...props} />;
}
export function Combobox(props: P<React.ComponentProps<typeof SharedCombobox>>) {
  return <SharedCombobox accent="amber" {...props} />;
}

/** ป้ายสถานะออเดอร์ (สีตามสถานะเดิม) — เฉพาะโดเมนขาย */
export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "รอคอนเฟิร์ม"
      ? "bg-yellow-100 text-yellow-700"
      : status === "รอคลังจัดส่ง"
        ? "bg-orange-100 text-orange-700"
        : status === "ปิดการขาย"
          ? "bg-green-100 text-green-700"
          : status === "ยกเลิก"
            ? "bg-slate-200 text-slate-500"
            : "bg-blue-100 text-blue-700";
  return <span className={`inline-block rounded px-2 py-1 text-[11px] font-bold leading-tight ${cls}`}>{status}</span>;
}
