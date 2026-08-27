import { requireModule } from "@/lib/shared/tenant-plan";
import { requireCap } from "@/lib/shared/guard";
import { getPayrollConfig, getEmployees, getPeriods } from "./data";
import { PayrollApp } from "./_components/PayrollApp";

export default async function PayrollPage() {
  // กันเข้าโมดูลที่ลูกค้าไม่ได้ซื้อผ่าน URL ตรง (เมนูซ่อนอย่างเดียวไม่พอ)
  // ★ ชั้นสิทธิ์จริงอยู่ที่ RLS ของ 0040 (select เฉพาะ role main) — นี่เป็นชั้นแพ็กเกจ
  await requireModule("payroll");
  // ชั้นสิทธิ์ผู้ใช้ (คนละเรื่องกับชั้นแพ็กเกจข้างบน) — ตัวจริงคือ RLS ของ 0051
  await requireCap("pay.read");
  const [config, employees, periods] = await Promise.all([
    getPayrollConfig(),
    getEmployees(),
    getPeriods(),
  ]);
  return <PayrollApp config={config} employees={employees} periods={periods} />;
}
