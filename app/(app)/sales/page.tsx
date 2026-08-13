import { getSalesBootstrap } from "./data";
import { SalesApp } from "./_components/SalesApp";
import type { SalesBoot } from "./_components/types";
import { requireModule } from "@/lib/shared/tenant-plan";

export default async function SalesPage() {
  // 4.5 — กันเข้าโดเมนที่ลูกค้าไม่ได้ซื้อผ่าน URL ตรง (เมนูซ่อนอย่างเดียวไม่พอ)
  await requireModule("sales");
  const boot = (await getSalesBootstrap()) as SalesBoot;
  return <SalesApp boot={boot} />;
}
