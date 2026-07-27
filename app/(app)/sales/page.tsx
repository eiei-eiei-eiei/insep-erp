import { getSalesBootstrap } from "./data";
import { SalesApp } from "./_components/SalesApp";
import type { SalesBoot } from "./_components/types";

export default async function SalesPage() {
  const boot = (await getSalesBootstrap()) as SalesBoot;
  return <SalesApp boot={boot} />;
}
