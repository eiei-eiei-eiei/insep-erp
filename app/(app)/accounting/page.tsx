import { getBootstrap } from "./data";
import { AccountingApp } from "./_components/AccountingApp";
import type { Bootstrap } from "./_components/types";
import { requireModule } from "@/lib/shared/tenant-plan";

export default async function AccountingPage() {
  // 4.5 — กันเข้าโดเมนที่ลูกค้าไม่ได้ซื้อผ่าน URL ตรง (เมนูซ่อนอย่างเดียวไม่พอ)
  await requireModule("accounting");
  const boot = (await getBootstrap()) as Bootstrap;
  return <AccountingApp boot={boot} />;
}
