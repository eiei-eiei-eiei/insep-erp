import {
  getProductionMasters,
  getPendingBatches,
  getProductStock,
} from "./data";
import { ProductionApp } from "./_components/ProductionApp";
import type { Container, Material, Product, StockRow } from "./_components/types";

export default async function ProductionPage() {
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
