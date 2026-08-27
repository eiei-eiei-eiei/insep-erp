import {
  getProductionMasters,
  getPendingBatches,
  getProductStock,
} from "./data";
import { ProductionApp } from "./_components/ProductionApp";
import type { Container, Material, Product, StockRow } from "./_components/types";
import { requireModule } from "@/lib/shared/tenant-plan";
import { requireCap } from "@/lib/shared/guard";

export default async function ProductionPage() {
  // 4.5 — กันเข้าโดเมนที่ลูกค้าไม่ได้ซื้อผ่าน URL ตรง (เมนูซ่อนอย่างเดียวไม่พอ)
  await requireModule("production");
  // ชั้นสิทธิ์ผู้ใช้ (คนละเรื่องกับชั้นแพ็กเกจข้างบน) — ตัวจริงคือ RLS ของ 0051
  await requireCap("prod.read");
  const [masters, pending, stock] = await Promise.all([
    getProductionMasters(),
    getPendingBatches(),
    getProductStock(),
  ]);

  return (
    <ProductionApp
      materials={masters.materials as Material[]}
      containers={masters.containers as Container[]}
      products={masters.products as Product[]}
      pending={pending}
      stock={stock as unknown as StockRow[]}
    />
  );
}
