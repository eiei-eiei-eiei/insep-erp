import { redirect } from "next/navigation";

/** /settings ไม่มีเนื้อหาของตัวเอง — พาไปแท็บแรก (guard role อยู่ที่ layout แล้ว) */
export default function SettingsIndexPage() {
  redirect("/settings/company");
}
