import { requireModule } from "@/lib/shared/tenant-plan";
import { getPayrollConfig, getEmployees, getPeriods } from "./data";
import { PayrollApp } from "./_components/PayrollApp";

export default async function PayrollPage() {
  // กันเข้าโมดูลที่ลูกค้าไม่ได้ซื้อผ่าน URL ตรง (เมนูซ่อนอย่างเดียวไม่พอ)
  // ★ ชั้นสิทธิ์จริงอยู่ที่ RLS ของ 0040 (select เฉพาะ role main) — นี่เป็นชั้นแพ็กเกจ
  await requireModule("payroll");
  const [config, employees, periods] = await Promise.all([
    getPayrollConfig(),
    getEmployees(),
    getPeriods(),
  ]);
  return <PayrollApp config={config} employees={employees} periods={periods} />;
}
