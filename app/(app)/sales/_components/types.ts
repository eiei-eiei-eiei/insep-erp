import type { MenuRow, CustomerRow, OrderRow } from "../data";
import type { CompanyInfo } from "@/lib/sales/company";

export type { MenuRow, CustomerRow, OrderRow };

export type SalesBoot = {
  role: string;
  customers: CustomerRow[];
  menu: MenuRow[];
  /** ผู้ขายบนหัวเอกสาร (มาจากตาราง entities — ตั้งที่ บัญชี › ตั้งค่า) */
  company: CompanyInfo;
};

export type OrderItem = { name: string; qty: number; price: number };

export type WarehouseOrder = OrderRow & { items: OrderItem[] };

export type StockItem = {
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  currentStock: number;
  isLive: boolean;
};

export type SyncRow = {
  id: number;
  action: string;
  key: string;
  status: string;
  message: string;
  createdAt: string;
};
