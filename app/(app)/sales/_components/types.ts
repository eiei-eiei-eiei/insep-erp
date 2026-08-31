import type { MenuRow, CustomerRow, OrderRow } from "../data";
import type { CompanyInfo } from "@/lib/sales/company";

export type { MenuRow, CustomerRow, OrderRow };

export type SalesBoot = {
  role: string;
  /** ชื่อผู้ใช้ที่ล็อกอิน (display_name → username) — ใช้เป็นผู้ทำรายการ/ผู้ขาย (D86) */
  userName: string;
  customers: CustomerRow[];
  menu: MenuRow[];
  /** ผู้ขายบนหัวเอกสาร (มาจากตาราง entities — ตั้งที่ บัญชี › ตั้งค่า) */
  company: CompanyInfo;
  /** กิจการที่ออกเอกสารจดทะเบียน VAT ไหม (4.3)
   *  ★ ใช้แสดงผลเท่านั้น — ตอนบันทึก server อ่าน `entities.is_vat` ใหม่เองเสมอ */
  isVat: boolean;
  /** contact_id ของ "ลูกค้าทั่วไป" ที่ตั้งไว้สำหรับหน้าขายหน้าร้าน (D86)
   *  ว่าง = ยังไม่ได้ตั้ง หรือถูกลบไปแล้ว → หน้าขายหน้าร้านขึ้นการ์ดให้ไปตั้งก่อน */
  posWalkinId: string;
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
