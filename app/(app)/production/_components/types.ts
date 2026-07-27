export type Material = { material_id: string; name: string; unit: string | null };
export type Container = {
  container_id: string;
  container_type: string | null;
  capacity_l: number | null;
};
export type Product = {
  product_id: string;
  name: string;
  degree: number | null;
  bottle_size_l: number | null;
  liquor_type: string | null;
  liquor_kind: string | null;
};
export type PendingBatch = { batch: string; productName: string; fermVol: number };
export type StockRow = {
  product_id: string;
  balance: number;
  last_updated: string;
  products: { name: string; degree: number | null; bottle_size_l: number | null } | null;
};

export const MATERIAL_TYPES = [
  "รับ",
  "จ่าย",
  "ผลิตสินค้าอื่น",
  "เสียหาย",
  "อื่นๆ",
] as const;

export const PRODUCT_TYPES = [
  "รับ",
  "จ่าย",
  "จำหน่ายต่างประเทศ",
  "แตกหักเสียหาย",
  "เสียหาย",
  "อื่นๆ",
] as const;

export const DISTILL_PHASES = [
  "เริ่มกลั่น",
  "หัว",
  "กลาง",
  "หาง",
  "จบหม้อ",
] as const;
