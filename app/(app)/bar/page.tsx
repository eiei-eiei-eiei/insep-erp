import { getBarBootstrap } from "./data";
import { BarApp } from "./_components/BarApp";
import { requireModule } from "@/lib/shared/tenant-plan";
import { requireCap } from "@/lib/shared/guard";

export default async function BarPage() {
  // กันเข้าโดเมนที่ลูกค้าไม่ได้ซื้อผ่าน URL ตรง (ซ่อนเมนูอย่างเดียวไม่พอ)
  await requireModule("bar");
  // ชั้นสิทธิ์ผู้ใช้ (คนละเรื่องกับชั้นแพ็กเกจข้างบน) — ตัวจริงคือ RLS ของ 0064
  await requireCap("bar.read");
  const boot = await getBarBootstrap();
  return <BarApp boot={boot} />;
}
