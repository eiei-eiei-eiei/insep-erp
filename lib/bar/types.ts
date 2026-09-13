/**
 * lib/bar/types — ชนิดข้อมูลกลางของโมดูลบาร์ (D96)
 *
 * ★ ไฟล์นี้ไม่มีตรรกะเลยสักบรรทัด — ตรรกะทั้งหมดอยู่ในไฟล์ที่มี golden test คุม
 * 🚨 ห้าม import อะไรจาก `lib/sales` หรือ `lib/production` (กติกาเหล็กข้อ 1 + D92)
 */

/** ของที่บาร์มี — `qty`/`costPerUnit` อยู่ในหน่วยฐาน (หน่วยที่สูตรกิน ไม่ใช่หน่วยที่ซื้อ) */
export type BarItem = {
  itemId: string;
  name: string;
  /** หน่วยฐาน: 'ml' | 'ขวด' | 'ชิ้น' | 'g' */
  unit: string;
  qty: number;
  costPerUnit: number;
  /** 1 หน่วยซื้อ = กี่หน่วยฐาน (ขวด 700ml → 700) · null = ซื้อเป็นหน่วยฐานอยู่แล้ว */
  packSize?: number | null;
  /** ป้ายหน่วยซื้อสำหรับแสดงผล — 'ขวด (700 ml)' */
  packLabel?: string | null;
  lowQty?: number | null;
  active?: boolean;
};

/** 1 บรรทัดในสูตร */
export type BarRecipeLine = { itemId: string; qty: number };

/**
 * เมนูขาย — โหมดต้นทุนตัดสินจาก `recipe` และ `fixedCost` (ดู `menuMode()` ใน recipe.ts)
 * 🚨 `createdFor` เป็น **ป้ายบอกที่มา ไม่ใช่สิทธิ์** — ห้ามเอาไปกรองเมนูออกจากคนอื่น
 */
export type BarMenu = {
  menuId: string;
  name: string;
  price: number;
  /** โหมด "ต้นทุนตายตัว" (อาหาร/กับแกล้มที่ BOM ไม่คุ้มจะคีย์) · null = ไม่ใช่โหมดนี้ */
  fixedCost?: number | null;
  categoryId: string;
  /** ว่าง = ยังไม่มีสูตร */
  recipe: BarRecipeLine[];
  method?: string | null;
  glass?: string | null;
  note?: string | null;
  createdFor?: string | null;
  active?: boolean;
  sort?: number | null;
};

/** 1 บรรทัดในตะกร้า/บิล */
export type CartLine = {
  menuId: string | null;
  /** snapshot ชื่อ ณ ตอนสั่ง — เมนูถูกเปลี่ยนชื่อทีหลังได้ */
  menuName: string;
  qty: number;
  price: number;
  /** ส่วนลดต่อรายการ (บาท) — **นี่คือตัวจริงที่ลงบัญชี** */
  lineDiscount?: number;
  /**
   * ผู้ใช้เลือกลดเป็น % — เก็บไว้เพื่อ **คิดบาทสดระหว่างที่ยังอยู่ในถาด** และพิมพ์บนสลิป
   * 🚨 ไม่ใช่ตัวเงิน · พอส่งเข้าบิลแล้วค่าบาทถูกแช่ลง DB และ % ไม่มีผลอีก (D75)
   */
  lineDiscountPct?: number | null;
  /** ของแถม — ยอดขาย 0 แต่ **ต้นทุนยังนับ** */
  isComp?: boolean;
};

/** รอบขาย — `start === end` แปลว่า "ไม่ได้ตั้งรอบ" (ใช้วันตามปฏิทิน) */
export type SaleWindow = {
  /** 'HH:mm' */
  start: string;
  /** 'HH:mm' */
  end: string;
};

export type BarCategory = {
  categoryId: string;
  name: string;
  sort: number;
  isSystem?: boolean;
};

/** หมวดที่เมนูใหม่จากหน้าขายตกลงมา — ห้ามลบ (`is_system`) */
export const CUSTOM_CATEGORY_ID = "custom";
